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
import { chipRadius, pilePyramid, scatterPile, simulatePile } from '../physics/pile';
import type { PyramidGeometry } from '../core/pyramid';
import { binGeometry, type BinGeometry } from '../core/bin';
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
  /** Bac à copeaux du tas affiché (dimensions effectives), ou null. */
  bin: BinGeometry | null = null;
  /** Pyramide du tas affiché (dimensions estimées avant tassement), ou null. */
  pyramid: PyramidGeometry | null = null;
  /**
   * Mode tas : les réglages ont changé depuis la dernière génération. Le tas n'est recalculé qu'à
   * la demande (generatePile), car un grand lot prend du temps.
   */
  stale = false;
  status: Status = { phase: 'pret', progress: 0, message: '', lastMs: 0 };
  exporting = false;

  private listeners = new Set<Listener>();
  private pending = new Set<string>();
  private notifyQueued = false;
  private regenTimer: ReturnType<typeof setTimeout> | undefined;
  private genToken = 0;
  private sim: { cancelled: boolean } | null = null;
  private refit = true;
  /** Affinage automatique de l'aperçu (micro-reliefs) après une pause dans les réglages. */
  private refineTimer: ReturnType<typeof setTimeout> | undefined;
  private refining = false;

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
    this.requestRegen(0);
  }

  /** Remet les paramètres (tous, ou seulement `keys`) aux valeurs du preset. */
  resetParams(keys?: (keyof ChipParams)[]): void {
    const s = this.state;
    if (keys) {
      const next = { ...s.params } as Record<keyof ChipParams, unknown>;
      for (const k of keys) next[k] = s.base[k];
      s.params = next as ChipParams;
    } else s.params = { ...s.base };
    this.emit('params');
    this.requestRegen(0);
  }

  setParam<K extends keyof ChipParams>(key: K, value: ChipParams[K]): void {
    if (this.state.params[key] === value) return;
    this.state.params = { ...this.state.params, [key]: value };
    this.emit('params');
    this.requestRegen();
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
    this.requestRegen(0);
  }

  /** Nouvelle seed ; en mode tas, relance aussitôt la génération (action explicite). */
  rerollSeed(): void {
    this.setSeed(randomSeed());
    if (this.state.mode === 'tas') this.generatePile();
  }

  setMode(mode: Mode): void {
    if (mode === this.state.mode) return;
    this.state.mode = mode;
    this.refit = true;
    this.stale = false;
    this.emit('mode', 'stale');
    this.scheduleRegen(0);
  }

  setPile(p: Partial<PileSettings>): void {
    this.state.pile = { ...this.state.pile, ...p };
    this.emit('pile');
    // Exporter ou non le bac ne change pas la scène.
    const keys = Object.keys(p).filter((k) => k !== 'exportBin');
    if (this.state.mode === 'tas' && keys.length) {
      if (keys.some((k) => k !== 'variability' && k !== 'physics' && k !== 'precision')) this.refit = true;
      this.requestRegen();
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
    if (v.tier && v.tier !== prev.tier) this.requestRegen(0);
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

  /**
   * Réglage modifié : copeau unique recalculé aussitôt ; en mode tas, le tas affiché est seulement
   * marqué périmé, jusqu'au prochain generatePile().
   */
  private requestRegen(delay = 45): void {
    if (this.state.mode !== 'tas') {
      this.scheduleRegen(delay);
      return;
    }
    if (!this.stale) {
      this.stale = true;
      this.emit('stale');
    }
  }

  /** Mode tas : génère le tas avec les réglages courants. */
  generatePile(): void {
    this.scheduleRegen(0);
  }

  scheduleRegen(delay = 45): void {
    clearTimeout(this.regenTimer);
    clearTimeout(this.refineTimer);
    this.regenTimer = setTimeout(() => this.regenerate(), delay);
  }

  private setStatus(st: Partial<Status>): void {
    this.status = { ...this.status, ...st };
    this.emit('status');
  }

  private async regenerate(refine = false): Promise<void> {
    const token = ++this.genToken;
    if (this.sim) this.sim.cancelled = true;
    this.sim = null;
    this.refining = refine;
    if (this.stale) {
      this.stale = false;
      this.emit('stale');
    }
    const specs = this.chipSpecs();
    const quality = previewQuality(refine ? 'detaille' : this.state.view.tier, specs.length);
    this.setStatus({
      phase: 'generation',
      progress: 0,
      message: refine ? 'Affinage des micro-reliefs…' : specs.length > 1 ? `Génération de ${specs.length} copeaux…` : 'Génération…',
    });
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
    this.refining = false;

    if (this.state.mode === 'unique') {
      const m = this.meshes[0];
      this.transforms = [{ q: [...IDENTITY.q], t: [0, -m.bounds[1], 0] }];
      this.bin = null;
      this.pyramid = null;
      this.viewer.setBin(null);
      this.viewer.setChips(this.meshes, this.transforms);
      this.finishRegen(genMs, refine);
      return;
    }

    // Tas : dispersion immédiate, puis chute physique éventuelle (sur la grille, dans le bac ou
    // moulée en pyramide).
    const pile = this.state.pile;
    this.bin =
      pile.container === 'bac'
        ? binGeometry({ length: pile.binLength, width: pile.binWidth, height: pile.binHeight }, this.meshes.map(chipRadius))
        : null;
    const slope = pile.container === 'pyramide' ? pile.pyramidSlope : null;
    this.pyramid = slope ? pilePyramid(this.meshes, slope) : null;
    this.viewer.setBin(this.bin);
    this.transforms = scatterPile(this.meshes, this.state.seed, pile.spread, this.bin, slope);
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
        bin: this.bin,
        pyramid: slope,
        precision: pile.precision,
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

  private finishRegen(ms: number, wasRefine = false): void {
    if (this.refit) {
      this.viewer.frame(true);
      this.refit = false;
    }
    this.setStatus({ phase: 'pret', progress: 1, message: '', lastMs: ms });
    this.emit('meshes');
    // Copeau unique en aperçu rapide : affinage automatique si des micro-reliefs ont été lissés.
    const att = this.meshes[0]?.info.microAttenuation ?? 0;
    clearTimeout(this.refineTimer);
    if (!wasRefine && this.state.mode === 'unique' && this.state.view.tier === 'rapide' && att > 0.02) {
      this.refineTimer = setTimeout(() => void this.regenerate(true), 650);
    }
  }

  frame(): void {
    this.viewer.frame(true);
  }

  // ------------------------------------------------------------ export

  /** Vrai tant que la géométrie affichée ne correspond pas encore aux réglages (l'affinage ne compte pas). */
  get busy(): boolean {
    return this.status.phase === 'simulation' || (this.status.phase === 'generation' && !this.refining);
  }

  async exportAs(format: 'obj' | 'step'): Promise<void> {
    if (this.exporting) return;
    if (this.busy) {
      toast('Patientez : la génération ou la simulation est en cours.', 'warn');
      return;
    }
    if (this.state.mode === 'tas' && this.stale) {
      toast('Les réglages ont changé depuis la génération du tas : cliquez sur « Générer le tas » avant d’exporter.', 'warn');
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
        {
          unit: s.exp.unit,
          uvMode: s.exp.uvMode,
          uvScaleMM: s.exp.uvScaleMM,
          baseName,
          bin: s.mode === 'tas' && s.pile.exportBin && this.bin ? { ...this.bin } : null,
        },
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
    if (p.mode === 'tas') {
      // Tas : génération à la demande, comme pour tout changement de réglage.
      this.stale = true;
      this.emit('stale');
    } else this.scheduleRegen(0);
    toast(`Preset « ${p.name} » chargé.`, 'ok');
  }
}
