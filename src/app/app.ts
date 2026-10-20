import type { ChipMesh } from '../core/geometry/mesh';
import type { ChipParams } from '../core/params';
import { hashSeed } from '../core/rng';
import type { LengthUnit, UvMode } from '../core/export/obj';
import { IDENTITY, safeFileName, type RigidTransform } from '../core/export/transform';
import {
  composePreset,
  DEFAULT_PILE,
  DEFAULT_SELECTION,
  findForm,
  findMaterial,
  findProcess,
  varyParams,
  type PileSettings,
  type PresetSelection,
} from '../core/presets/presets';
import { previewWorker, exportWorker } from '../worker/client';
import type { ChipSpec } from '../worker/protocol';
import { Viewer } from '../viewer/viewer';
import { scatterPile, simulatePile } from '../physics/pile';
import { meshExportQuality, previewQuality, stepExportQuality, type MeshDetail, type PreviewTier, type StepDetail } from './quality';
import { parsePreset, serializePreset } from './presetFile';
import { downloadBytes, formatBytes, formatCount } from '../ui/dom';
import { toast } from '../ui/toast';

export type Mode = 'unique' | 'tas';

export interface ViewSettings {
  matcap: string;
  wireframe: boolean;
  uvChecker: boolean;
  grid: boolean;
  axes: boolean;
  tier: PreviewTier;
}

export interface ExportSettings {
  unit: LengthUnit;
  uvMode: UvMode;
  uvScaleMM: number;
  meshDetail: MeshDetail;
  stepDetail: StepDetail;
  baseName: string;
}

export interface AppState {
  selection: PresetSelection;
  /** Paramètres du preset courant (référence pour « modifié »). */
  base: ChipParams;
  params: ChipParams;
  seed: number;
  mode: Mode;
  pile: PileSettings;
  view: ViewSettings;
  exp: ExportSettings;
}

export interface Status {
  phase: 'pret' | 'generation' | 'simulation' | 'export' | 'erreur';
  progress: number;
  message: string;
  lastMs: number;
}

type Listener = (what: Set<string>) => void;

const randomSeed = () => {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % 1_000_000;
};

export class App {
  readonly state: AppState;
  readonly viewer: Viewer;
  meshes: ChipMesh[] = [];
  transforms: RigidTransform[] = [];
  status: Status = { phase: 'pret', progress: 0, message: '', lastMs: 0 };
  exporting = false;

  private listeners = new Set<Listener>();
  private pending = new Set<string>();
  private notifyQueued = false;
  private regenTimer: ReturnType<typeof setTimeout> | undefined;
  private genToken = 0;
  private sim: { cancelled: boolean } | null = null;
  private refit = true;

  constructor(viewport: HTMLElement) {
    const base = composePreset(DEFAULT_SELECTION);
    this.state = {
      selection: { ...DEFAULT_SELECTION },
      base,
      params: { ...base },
      seed: 1,
      mode: 'unique',
      pile: { ...DEFAULT_PILE },
      view: { matcap: 'argile', wireframe: false, uvChecker: false, grid: true, axes: true, tier: 'rapide' },
      exp: { unit: 'mm', uvMode: 'reel', uvScaleMM: 10, meshDetail: 'fin', stepDetail: 'standard', baseName: '' },
    };
    this.viewer = new Viewer(viewport);
    this.viewer.setUvPreview({ mode: this.state.exp.uvMode, scaleMM: this.state.exp.uvScaleMM });
    this.regenerate();
  }

  // ------------------------------------------------------------ abonnements

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(...what: string[]): void {
    for (const w of what) this.pending.add(w);
    if (this.notifyQueued) return;
    this.notifyQueued = true;
    queueMicrotask(() => {
      this.notifyQueued = false;
      const set = new Set(this.pending);
      this.pending.clear();
      for (const l of this.listeners) l(set);
    });
  }

  // ------------------------------------------------------------ presets

  applySelection(sel: Partial<PresetSelection>): void {
    const s = this.state;
    const next: PresetSelection = { ...s.selection, ...sel };
    if (sel.form && !('shortcut' in sel)) next.shortcut = undefined;
    s.selection = next;
    s.base = composePreset(next);
    s.params = { ...s.base };
    this.refit = true;
    this.emit('preset', 'params');
    this.scheduleRegen(0);
  }

  resetParams(): void {
    this.state.params = { ...this.state.base };
    this.emit('params');
    this.scheduleRegen(0);
  }

  setParam<K extends keyof ChipParams>(key: K, value: ChipParams[K]): void {
    if (this.state.params[key] === value) return;
    this.state.params = { ...this.state.params, [key]: value };
    this.emit('params');
    this.scheduleRegen();
  }

  isModified(key: keyof ChipParams): boolean {
    const a = this.state.params[key];
    const b = this.state.base[key];
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) > 1e-9 * Math.max(1, Math.abs(b));
    return a !== b;
  }

  describeSelection(): { title: string; subtitle: string; quality: 'bon' | 'acceptable' | 'mauvais'; description: string } {
    const sel = this.state.selection;
    const f = findForm(sel.form);
    return {
      title: `ISO ${f.id} — ${f.familyName} ${f.variant}`,
      subtitle: `${findMaterial(sel.material).name} · ${findProcess(sel.process).name}`,
      quality: f.quality,
      description: f.description,
    };
  }

  // ------------------------------------------------------------ seed, mode, tas, affichage

  setSeed(seed: number): void {
    const v = Math.floor(Math.abs(Number.isFinite(seed) ? seed : 1)) % 4294967296;
    if (v === this.state.seed) return;
    this.state.seed = v;
    this.emit('seed');
    this.scheduleRegen(0);
  }

  rerollSeed(): void {
    this.setSeed(randomSeed());
  }

  setMode(mode: Mode): void {
    if (mode === this.state.mode) return;
    this.state.mode = mode;
    this.refit = true;
    this.emit('mode');
    this.scheduleRegen(0);
  }

  setPile(p: Partial<PileSettings>): void {
    this.state.pile = { ...this.state.pile, ...p };
    this.emit('pile');
    if (this.state.mode === 'tas') {
      if ('count' in p || 'spread' in p) this.refit = true;
      this.scheduleRegen(250);
    }
  }

  setView(v: Partial<ViewSettings>): void {
    const prev = this.state.view;
    this.state.view = { ...prev, ...v };
    const view = this.state.view;
    if (v.matcap) this.viewer.setMatcap(view.matcap);
    if (v.wireframe !== undefined) this.viewer.setWireframe(view.wireframe);
    if (v.uvChecker !== undefined) this.viewer.setUvChecker(view.uvChecker);
    if (v.grid !== undefined) this.viewer.setGridVisible(view.grid);
    if (v.axes !== undefined) this.viewer.setAxesVisible(view.axes);
    if (v.tier && v.tier !== prev.tier) this.scheduleRegen(0);
    this.emit('view');
  }

  setExport(e: Partial<ExportSettings>): void {
    this.state.exp = { ...this.state.exp, ...e };
    if (e.uvMode !== undefined || e.uvScaleMM !== undefined) {
      this.viewer.setUvPreview({ mode: this.state.exp.uvMode, scaleMM: this.state.exp.uvScaleMM });
    }
    this.emit('export');
  }

  // ------------------------------------------------------------ génération

  chipSpecs(): ChipSpec[] {
    const s = this.state;
    if (s.mode === 'unique') return [{ name: 'copeau_001', params: s.params, seed: s.seed }];
    const out: ChipSpec[] = [];
    for (let i = 0; i < s.pile.count; i++) {
      out.push({
        name: `copeau_${String(i + 1).padStart(3, '0')}`,
        params: varyParams(s.params, s.seed, i, s.pile.variability),
        seed: hashSeed(s.seed, i),
      });
    }
    return out;
  }

  scheduleRegen(delay = 45): void {
    clearTimeout(this.regenTimer);
    this.regenTimer = setTimeout(() => this.regenerate(), delay);
  }

  private setStatus(st: Partial<Status>): void {
    this.status = { ...this.status, ...st };
    this.emit('status');
  }

  private async regenerate(): Promise<void> {
    const token = ++this.genToken;
    if (this.sim) this.sim.cancelled = true;
    this.sim = null;
    const specs = this.chipSpecs();
    const quality = previewQuality(this.state.view.tier, specs.length);
    this.setStatus({ phase: 'generation', progress: 0, message: specs.length > 1 ? `Génération de ${specs.length} copeaux…` : 'Génération…' });
    let res: Awaited<ReturnType<ReturnType<typeof previewWorker>['generate']>>;
    try {
      res = await previewWorker().generate(specs, quality, (done, total) => {
        if (token === this.genToken) this.setStatus({ progress: done / total });
      });
    } catch (e) {
      if (token === this.genToken) this.setStatus({ phase: 'erreur', message: `Erreur de génération : ${(e as Error).message}` });
      return;
    }
    if (!res || token !== this.genToken) return;
    this.meshes = res.meshes;
    const genMs = res.ms;

    if (this.state.mode === 'unique') {
      const m = this.meshes[0];
      this.transforms = [{ q: [...IDENTITY.q], t: [0, -m.bounds[1], 0] }];
      this.viewer.setChips(this.meshes, this.transforms);
      this.finishRegen(genMs);
      return;
    }

    // Tas : dispersion immédiate, puis chute physique éventuelle.
    const pile = this.state.pile;
    this.transforms = scatterPile(this.meshes, this.state.seed, pile.spread);
    this.viewer.setChips(this.meshes, this.transforms);
    if (!pile.physics) {
      this.finishRegen(genMs);
      return;
    }
    const signal = { cancelled: false };
    this.sim = signal;
    this.setStatus({ phase: 'simulation', progress: 0, message: 'Chute physique du tas…' });
    let first = true;
    try {
      const final = await simulatePile(this.meshes, {
        seed: this.state.seed,
        spread: pile.spread,
        signal,
        onFrame: (tr, progress) => {
          if (signal.cancelled) return;
          this.transforms = tr;
          this.viewer.updateTransforms(tr);
          if (first && this.refit) {
            this.viewer.frame(true);
            first = false;
          }
          this.setStatus({ progress });
        },
      });
      if (signal.cancelled || token !== this.genToken) return;
      this.transforms = final;
      this.viewer.updateTransforms(final);
      this.sim = null;
      this.finishRegen(genMs);
    } catch (e) {
      if (token !== this.genToken) return;
      this.sim = null;
      toast(`Simulation physique indisponible (${(e as Error).message}) : dispersion simple utilisée.`, 'warn');
      this.finishRegen(genMs);
    }
  }

  private finishRegen(ms: number): void {
    if (this.refit) {
      this.viewer.frame(true);
      this.refit = false;
    }
    this.setStatus({ phase: 'pret', progress: 1, message: '', lastMs: ms });
    this.emit('meshes');
  }

  frame(): void {
    this.viewer.frame(true);
  }

  // ------------------------------------------------------------ export

  get busy(): boolean {
    return this.status.phase === 'generation' || this.status.phase === 'simulation';
  }

  async exportAs(format: 'obj' | 'step'): Promise<void> {
    if (this.exporting) return;
    if (this.busy) {
      toast('Patientez : la génération ou la simulation est en cours.', 'warn');
      return;
    }
    const specs = this.chipSpecs();
    if (specs.length !== this.transforms.length) {
      toast('Aperçu non synchronisé, nouvel essai dans un instant.', 'warn');
      return;
    }
    const s = this.state;
    const quality = format === 'obj' ? meshExportQuality(s.exp.meshDetail, specs.length) : stepExportQuality(s.exp.stepDetail, specs.length);
    const baseName = safeFileName(s.exp.baseName || this.defaultBaseName());
    this.exporting = true;
    this.setStatus({ phase: 'export', progress: 0, message: `Export ${format === 'obj' ? 'OBJ' : 'STEP'}…` });
    try {
      const res = await exportWorker().export(
        format,
        specs,
        this.transforms.map((t) => ({ q: [...t.q], t: [...t.t] })),
        quality,
        { unit: s.exp.unit, uvMode: s.exp.uvMode, uvScaleMM: s.exp.uvScaleMM, baseName },
        (done, total) => this.setStatus({ progress: done / total }),
      );
      downloadBytes(res.file.parts, res.file.name, res.file.mime);
      const what = format === 'obj' ? `${formatCount(res.stats.quads)} quads · ${formatCount(res.stats.vertices)} sommets` : `${formatCount(res.stats.chips)} solide(s) NURBS`;
      toast(`${res.file.name} exporté — ${what} · ${formatBytes(res.file.size)} · ${(res.ms / 1000).toFixed(1)} s`, 'ok');
    } catch (e) {
      toast(`Échec de l'export : ${(e as Error).message}`, 'error');
    } finally {
      this.exporting = false;
      this.setStatus({ phase: 'pret', progress: 1, message: '' });
    }
  }

  defaultBaseName(): string {
    const sel = this.state.selection;
    const mode = this.state.mode === 'tas' ? `tas${this.state.pile.count}` : 'copeau';
    return `chipforge_${sel.material}_iso${sel.form.replace('.', '-')}_${mode}_s${this.state.seed}`;
  }

  // ------------------------------------------------------------ presets personnels

  savePreset(name: string): void {
    const s = this.state;
    const text = serializePreset({ name, selection: s.selection, params: s.params, seed: s.seed, mode: s.mode, pile: s.pile });
    downloadBytes(text, `${safeFileName(name || 'preset', 'preset')}.chipforge.json`, 'application/json');
  }

  async loadPreset(file: File): Promise<void> {
    if (file.size > 256 * 1024) throw new Error('Fichier trop volumineux pour un preset (256 Ko max).');
    const text = await file.text();
    const p = parsePreset(text, this.state.base, this.state.selection);
    const s = this.state;
    s.selection = p.selection;
    s.base = composePreset(p.selection);
    s.params = p.params;
    s.seed = p.seed;
    s.mode = p.mode;
    s.pile = p.pile;
    this.refit = true;
    this.emit('preset', 'params', 'seed', 'mode', 'pile');
    this.scheduleRegen(0);
    toast(`Preset « ${p.name} » chargé.`, 'ok');
  }
}
