import type { App } from '../app/app';
import { SHORTCUTS } from '../core/presets/presets';
import { MATCAPS } from '../viewer/textures';
import { formatValue, segmented } from './controls';
import { formatCount, h, icon } from './dom';
import { buildExportDialog } from './exportDialog';
import { buildLibraryPanel, swatch } from './panels/library';
import type { PanelDef } from './panels/panel';
import { buildParamPanels } from './panels/params';
import { buildPilePanel } from './panels/pile';
import { buildRandomPanel } from './panels/random';
import { PARAM_DEF_MAP, type ParamKey } from '../core/params';
import { toast } from './toast';
import { badge, button, dialog, kbd, menu, type Dialog } from './widgets';

/**
 * Coquille de l'application :
 *  - barre supérieure : identité, preset courant, mode, seed, presets personnels, export ;
 *  - barre d'activité (icônes) + volet latéral : un panneau à la fois ;
 *  - vue 3D et sa barre d'outils d'affichage ;
 *  - barre d'état : progression et statistiques de l'aperçu.
 */

const UI_KEY = 'chipforge.ui';
const NARROW = '(max-width: 900px)';

interface UiPrefs {
  tab: string;
  collapsed: boolean;
}

function loadPrefs(): UiPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(UI_KEY) ?? '{}') as Partial<UiPrefs>;
    return { tab: typeof raw.tab === 'string' ? raw.tab : 'preset', collapsed: raw.collapsed === true };
  } catch {
    return { tab: 'preset', collapsed: false };
  }
}

function savePrefs(p: UiPrefs): void {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(p));
  } catch {
    /* préférences non mémorisées */
  }
}

export interface Shell {
  showPanel(id: string): void;
  toggleSidebar(): void;
  closeSidebarIfOverlay(): void;
  exportDialog: Dialog;
  helpDialog: Dialog;
  panels: PanelDef[];
}

export function buildShell(app: App, roots: { top: HTMLElement; rail: HTMLElement; sidebar: HTMLElement; viewport: HTMLElement; status: HTMLElement }): Shell {
  // Panneau Aléatoire : « afficher ce paramètre » ouvre son panneau et le met en évidence.
  const locate = (key: ParamKey) => {
    for (const p of panels) {
      const row = p.body.querySelector<HTMLElement>(`[data-key="${key}"]`);
      if (!row) continue;
      showPanel(p.id);
      const det = row.closest('details');
      if (det) det.open = true;
      row.scrollIntoView({ block: 'center' });
      row.classList.remove('is-flash');
      void row.offsetWidth;
      row.classList.add('is-flash');
      return;
    }
  };
  const panels: PanelDef[] = [buildLibraryPanel(app), ...buildParamPanels(app), buildRandomPanel(app, locate), buildPilePanel(app)];
  const exportDialog = buildExportDialog(app);
  const helpDialog = buildHelpDialog(panels);
  const prefs = loadPrefs();
  if (!panels.some((p) => p.id === prefs.tab)) prefs.tab = 'preset';
  const narrow = window.matchMedia(NARROW);

  // ------------------------------------------------------------ volet latéral
  const sbTitle = h('h2', { class: 'cf-sidebar-title' });
  const sbSub = h('p', { class: 'cf-sidebar-sub' });
  const sbActions = h('div', { class: 'cf-sidebar-actions' });
  const sbClose = button({ icon: 'close', variant: 'ghost', title: 'Fermer le volet (P)', onClick: () => setCollapsed(true) });
  sbClose.classList.add('cf-sidebar-close');
  const sbBody = h('div', { class: 'cf-sidebar-body' });
  const sbFoot = h('div', { class: 'cf-sidebar-foot' });
  roots.sidebar.append(
    h('header', { class: 'cf-sidebar-head' }, [h('div', { class: 'cf-sidebar-titles' }, [sbTitle, sbSub]), sbActions, sbClose]),
    sbBody,
    sbFoot,
  );
  for (const p of panels) {
    p.body.classList.add('cf-panel-body');
    p.body.hidden = true;
    sbBody.append(p.body);
    if (p.footer) {
      const wrap = h('div', { class: 'cf-panel-foot' }, [p.footer]);
      wrap.dataset.panel = p.id;
      sbFoot.append(wrap);
    }
  }

  // ------------------------------------------------------------ barre d'activité
  const railButtons = panels.map((p, i) => {
    const dot = h('span', { class: 'cf-rail-dot', attrs: { hidden: '' } });
    const b = h('button', { class: 'cf-rail-btn', attrs: { type: 'button', role: 'tab', 'aria-controls': 'sidebar', 'data-tip': `${p.label}  ${i + 1}` } }, [
      icon(p.icon, 'w-5 h-5'),
      h('span', { class: 'cf-rail-label', text: p.label }),
      dot,
    ]);
    b.setAttribute('aria-label', p.label);
    b.addEventListener('click', () => {
      if (prefs.tab === p.id && !isCollapsed()) setCollapsed(true);
      else showPanel(p.id);
    });
    return { p, b, dot };
  });
  const helpBtn = h('button', { class: 'cf-rail-btn', attrs: { type: 'button', 'aria-label': 'Raccourcis clavier', 'data-tip': 'Raccourcis clavier  ?' } }, [icon('keyboard', 'w-5 h-5')]);
  helpBtn.addEventListener('click', () => helpDialog.open());
  roots.rail.setAttribute('role', 'tablist');
  roots.rail.setAttribute('aria-orientation', 'vertical');
  roots.rail.append(h('div', { class: 'cf-rail-group' }, railButtons.map((x) => x.b)), h('div', { class: 'cf-rail-group' }, [helpBtn]));

  const isCollapsed = () => document.body.classList.contains('sidebar-collapsed');
  const setCollapsed = (c: boolean) => {
    document.body.classList.toggle('sidebar-collapsed', c);
    if (!narrow.matches) {
      prefs.collapsed = c;
      savePrefs(prefs);
    }
    refreshRail();
  };
  const showPanel = (id: string) => {
    const p = panels.find((x) => x.id === id);
    if (!p) return;
    prefs.tab = id;
    savePrefs(prefs);
    document.body.dataset.panel = id;
    for (const x of panels) x.body.hidden = x.id !== id;
    for (const f of sbFoot.children) (f as HTMLElement).hidden = (f as HTMLElement).dataset.panel !== id;
    sbFoot.hidden = !p.footer;
    sbTitle.replaceChildren(icon(p.icon, 'w-4 h-4'), h('span', { text: p.title }));
    sbSub.textContent = p.subtitle;
    sbActions.replaceChildren(...(p.actions ?? []));
    sbBody.scrollTop = 0;
    setCollapsed(false);
  };
  const refreshRail = () => {
    for (const { p, b, dot } of railButtons) {
      const on = p.id === prefs.tab && !isCollapsed();
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', String(on));
      const n = p.modified?.() ?? 0;
      dot.hidden = n === 0;
      const what = p.id === 'aleatoire' ? 'plage(s)' : 'modifié(s)';
      b.dataset.tip = `${p.label}${n ? ` · ${n} ${what}` : ''}  ${panels.indexOf(p) + 1}`;
    }
  };
  app.on((what) => {
    if (what.has('params') || what.has('preset') || what.has('random')) refreshRail();
  });
  // Écran étroit : le volet recouvre la vue, fermé au départ.
  const startCollapsed = narrow.matches || prefs.collapsed;
  narrow.addEventListener('change', () => setCollapsed(narrow.matches ? true : prefs.collapsed));
  showPanel(prefs.tab);
  if (startCollapsed) setCollapsed(true);
  roots.viewport.addEventListener('pointerdown', () => closeSidebarIfOverlay());
  const closeSidebarIfOverlay = () => {
    if (narrow.matches && !isCollapsed()) setCollapsed(true);
  };

  // ------------------------------------------------------------ barre supérieure
  buildTopbar(app, roots.top, { showPanel, exportDialog });

  // ------------------------------------------------------------ vue 3D et barre d'état
  buildViewportOverlay(app, roots.viewport);
  buildStatusbar(app, roots.status);

  return { showPanel, toggleSidebar: () => setCollapsed(!isCollapsed()), closeSidebarIfOverlay, exportDialog, helpDialog, panels };
}

// ---------------------------------------------------------------------------- barre supérieure

function buildTopbar(app: App, root: HTMLElement, ctx: { showPanel: (id: string) => void; exportDialog: Dialog }): void {
  // Fil du preset courant (ouvre l'onglet Preset)
  const crumbs = h('button', { class: 'cf-crumbs', title: 'Preset courant — cliquer pour le modifier', attrs: { type: 'button' } });
  crumbs.addEventListener('click', () => ctx.showPanel('preset'));

  const modeCtl = segmented(
    [
      { value: 'unique', label: 'Copeau', icon: 'chip', title: 'Copeau unique : aperçu instantané' },
      { value: 'tas', label: 'Tas', icon: 'layers', title: 'Tas de copeaux : lot varié, chute physique' },
    ],
    () => app.state.mode,
    (v) => {
      app.setMode(v);
      if (v === 'tas') ctx.showPanel('tas');
    },
    'cf-seg-mode',
  );

  const seedInput = h('input', {
    class: 'cf-seed-input',
    attrs: { type: 'number', min: '0', max: '4294967295', step: '1', 'aria-label': 'Seed', inputmode: 'numeric' },
  });
  const commitSeed = () => app.setSeed(Number(seedInput.value));
  seedInput.addEventListener('change', commitSeed);
  seedInput.addEventListener('keydown', (e) => e.key === 'Enter' && commitSeed());
  const dice = h('button', { class: 'cf-seed-dice', title: 'Nouveau tirage aléatoire (R) — réglages dans le panneau Aléatoire', attrs: { type: 'button', 'aria-label': 'Nouvelle seed' } }, [icon('dice', 'w-4 h-4')]);
  dice.addEventListener('click', () => app.rerollSeed());
  const seed = h('div', { class: 'cf-seed', title: 'Seed : toute la part aléatoire en dérive. Même seed + mêmes réglages = même géométrie.' }, [
    h('span', { class: 'cf-seed-label', text: 'Seed' }),
    seedInput,
    dice,
  ]);

  // Presets personnels
  const fileInput = h('input', { class: 'hidden', attrs: { type: 'file', accept: '.json,application/json' } });
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (!f) return;
    try {
      await app.loadPreset(f);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  });
  const saveDialog = buildSavePresetDialog(app);
  const presetsBtn = h('button', { class: 'cf-btn cf-btn-ghost', title: 'Presets personnels', attrs: { type: 'button' } }, [icon('folder'), h('span', { class: 'cf-hide-sm', text: 'Presets' }), icon('chevron', 'cf-caret w-3 h-3')]);
  menu(presetsBtn, [
    { icon: 'save', label: 'Enregistrer le preset…', hint: 'Télécharge les réglages actuels (.json)', onClick: () => saveDialog.open() },
    { icon: 'upload', label: 'Ouvrir un preset…', hint: 'Charge un fichier .chipforge.json', onClick: () => fileInput.click() },
    'sep',
    { icon: 'reset', label: 'Revenir au preset', hint: 'Annule toutes les modifications de paramètres', onClick: () => app.resetParams() },
  ]);

  const exportBtn = h('button', { class: 'cf-btn cf-btn-primary', title: 'Exporter en OBJ ou STEP (E)', attrs: { type: 'button' } }, [icon('download'), h('span', { class: 'cf-hide-sm', text: 'Exporter' })]);
  exportBtn.addEventListener('click', () => ctx.exportDialog.open());

  root.append(
    h('div', { class: 'cf-brand' }, [h('span', { class: 'cf-logo' }, [icon('chip', 'w-[18px] h-[18px]')]), h('span', { class: 'cf-brand-name', text: 'ChipForge' })]),
    h('span', { class: 'cf-top-sep' }),
    crumbs,
    h('div', { class: 'cf-top-spacer' }),
    modeCtl.el,
    seed,
    h('span', { class: 'cf-top-sep' }),
    presetsBtn,
    exportBtn,
    fileInput,
  );

  const refresh = (what?: Set<string>) => {
    modeCtl.refresh();
    if (document.activeElement !== seedInput) seedInput.value = String(app.state.seed);
    exportBtn.disabled = app.exporting;
    if (!what || what.has('preset')) {
      const sel = app.state.selection;
      const d = app.describeSelection();
      const sc = sel.shortcut ? SHORTCUTS.find((s) => s.id === sel.shortcut) : undefined;
      const [mat, proc] = d.subtitle.split(' · ');
      crumbs.replaceChildren(
        swatch(sel.material),
        h('span', { class: 'cf-crumb cf-crumb-dim', text: mat }),
        icon('chevron', 'cf-crumb-sep w-3 h-3'),
        h('span', { class: 'cf-crumb cf-crumb-dim cf-hide-md', text: proc }),
        icon('chevron', 'cf-crumb-sep cf-hide-md w-3 h-3'),
        h('span', { class: 'cf-crumb cf-crumb-main', text: sc ? `${sc.name} · ISO ${sel.form}` : d.title }),
        badge(d.quality),
      );
    }
  };
  app.on(refresh);
  refresh();
}

function buildSavePresetDialog(app: App): Dialog {
  const name = h('input', { class: 'cf-text', attrs: { type: 'text', maxlength: '60', placeholder: 'Nom du preset', 'aria-label': 'Nom du preset', spellcheck: 'false' } });
  const save = () => {
    app.savePreset(name.value.trim() || app.defaultBaseName());
    dlg.close();
  };
  name.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') save();
  });
  const dlg = dialog({
    icon: 'save',
    title: 'Enregistrer le preset',
    subtitle: 'Matière, procédé, forme, paramètres, seed et réglages du tas, dans un fichier .json.',
    body: [h('div', { class: 'cf-field' }, [h('div', { class: 'cf-field-label', text: 'Nom' }), name])],
    footer: [h('span', { class: 'cf-dialog-summary' }), button({ label: 'Annuler', variant: 'ghost', onClick: () => dlg.close() }), button({ label: 'Enregistrer', icon: 'save', variant: 'primary', onClick: save })],
    onOpen: () => {
      name.placeholder = app.defaultBaseName();
      name.focus();
      name.select();
    },
  });
  return dlg;
}

function buildHelpDialog(panels: PanelDef[]): Dialog {
  const row = (keys: string[], text: string) => h('div', { class: 'cf-key-row' }, [h('span', { text }), h('span', { class: 'cf-keys' }, keys.map(kbd))]);
  const group = (title: string, rows: HTMLElement[]) => h('div', { class: 'cf-key-group' }, [h('div', { class: 'cf-dialog-label', text: title }), ...rows]);
  return dialog({
    icon: 'keyboard',
    title: 'Raccourcis clavier',
    wide: true,
    body: [
      h('div', { class: 'cf-grid-2' }, [
        group('Génération', [row(['R'], 'Nouveau tirage (copeau unique) ou nouvelle chute (tas)'), row(['G'], 'Générer le tas'), row(['E'], 'Exporter…')]),
        group('Panneaux', [...panels.map((p, i) => row([String(i + 1)], p.label)), row(['P'], 'Afficher / masquer le volet')]),
        group('Vue 3D', [row(['F'], 'Recadrer'), row(['W'], 'Filaire'), row(['U'], 'Damier UV'), row(['Clic gauche'], 'Rotation'), row(['Clic droit'], 'Panoramique'), row(['Molette'], 'Zoom')]),
        group('Paramètres', [row(['Double-clic'], 'Sur un nom : valeur du preset'), row(['Entrée'], 'Valider une saisie'), row(['?'], 'Cette aide'), row(['Échap'], 'Fermer')]),
      ]),
    ],
  });
}

// ---------------------------------------------------------------------------- vue 3D

function buildViewportOverlay(app: App, root: HTMLElement): void {
  const tool = (name: string, title: string, on: () => void) => {
    const b = h('button', { class: 'cf-tool', attrs: { type: 'button', 'aria-label': title, 'data-tip': title } }, [icon(name)]);
    b.addEventListener('click', on);
    return b;
  };
  const v = () => app.state.view;
  const bFrame = tool('frame', 'Recadrer  F', () => app.frame());
  const bGrid = tool('grid', 'Grille d’usinage', () => app.setView({ grid: !v().grid }));
  const bAxes = tool('axes', 'Axes XYZ', () => app.setView({ axes: !v().axes }));
  const bWire = tool('wire', 'Filaire  W', () => app.setView({ wireframe: !v().wireframe }));
  const bUv = tool('checker', 'Damier UV  U', () => app.setView({ uvChecker: !v().uvChecker }));
  const matcap = h(
    'select',
    { class: 'cf-select cf-select-tool', title: 'Ombrage MatCap', attrs: { 'aria-label': 'MatCap' } },
    MATCAPS.map((m) => h('option', { text: m.label, attrs: { value: m.id } })),
  );
  matcap.addEventListener('change', () => app.setView({ matcap: matcap.value }));
  const tier = segmented(
    [
      { value: 'rapide', label: 'Rapide', title: 'Aperçu fluide (micro-reliefs simplifiés, affinés automatiquement)' },
      { value: 'detaille', label: 'Détaillé', title: 'Aperçu dense avec micro-reliefs' },
    ],
    () => app.state.view.tier,
    (t) => app.setView({ tier: t }),
    'cf-seg-sm',
  );
  const sep = () => h('span', { class: 'cf-sep' });
  const toolbar = h('div', { class: 'cf-toolbar', attrs: { role: 'toolbar', 'aria-label': 'Affichage' } }, [
    bFrame,
    sep(),
    bGrid,
    bAxes,
    sep(),
    bWire,
    bUv,
    matcap,
    sep(),
    h('span', { class: 'cf-toolbar-label', text: 'Aperçu' }),
    tier.el,
  ]);

  const progress = h('div', { class: 'cf-progress' }, [h('div', { class: 'cf-progress-bar' })]);
  const staleBtn = h('button', { class: 'cf-btn cf-btn-primary cf-vp-stale', title: 'Les réglages ont changé : générer le tas (G)', attrs: { type: 'button' } }, [
    icon('play'),
    h('span', { text: 'Générer le tas' }),
    kbd('G'),
  ]);
  staleBtn.addEventListener('click', () => app.generatePile());
  // Légende de l'aperçu de plage (fantômes minimum / maximum).
  const pvName = h('span', { class: 'cf-pv-name' });
  const pvMin = h('span', { class: 'cf-pv-v' });
  const pvMax = h('span', { class: 'cf-pv-v' });
  const pvClose = h('button', { class: 'cf-pv-close', title: 'Masquer l’aperçu', attrs: { type: 'button', 'aria-label': 'Masquer l’aperçu de plage' } }, [icon('close', 'w-3.5 h-3.5')]);
  pvClose.addEventListener('click', () => app.setRangePreview(null));
  const pvSide = (side: 'min' | 'max', v: HTMLElement) => {
    const b = h('button', { class: 'cf-pv-item', title: `Montrer le copeau au ${side === 'min' ? 'minimum' : 'maximum'} de la plage`, attrs: { type: 'button' } }, [
      h('span', { class: `cf-pv-dot cf-pv-${side}` }),
      h('span', { text: side }),
      v,
    ]);
    b.addEventListener('click', () => app.setPreviewSide(side));
    return b;
  };
  const pvMinBtn = pvSide('min', pvMin);
  const pvMaxBtn = pvSide('max', pvMax);
  const pvLegend = h('div', { class: 'cf-pv' }, [
    icon('eye', 'w-3.5 h-3.5 shrink-0'),
    pvName,
    h('span', { class: 'cf-pv-sides', attrs: { role: 'group', 'aria-label': 'Extrême montré' } }, [pvMinBtn, pvMaxBtn]),
    pvClose,
  ]);
  root.append(progress, toolbar, pvLegend, staleBtn);
  app.viewer.frame(false);

  const refresh = () => {
    const view = app.state.view;
    bGrid.classList.toggle('is-active', view.grid);
    bAxes.classList.toggle('is-active', view.axes);
    bWire.classList.toggle('is-active', view.wireframe);
    bUv.classList.toggle('is-active', view.uvChecker);
    for (const [b, on] of [[bGrid, view.grid], [bAxes, view.axes], [bWire, view.wireframe], [bUv, view.uvChecker]] as const) b.setAttribute('aria-pressed', String(on));
    matcap.value = view.matcap;
    tier.refresh();
    const st = app.status;
    const busy = st.phase === 'generation' || st.phase === 'simulation' || st.phase === 'export';
    progress.classList.toggle('is-on', busy);
    (progress.firstChild as HTMLElement).style.width = `${Math.round((busy ? Math.max(0.04, st.progress) : 1) * 100)}%`;
    staleBtn.hidden = !(app.state.mode === 'tas' && app.stale);
    const pk = app.rangePreview;
    const pr = pk ? app.state.random.ranges[pk] : undefined;
    const pdef = pk ? PARAM_DEF_MAP[pk] : undefined;
    pvLegend.hidden = !(pk && pr?.kind === 'number' && pdef?.kind === 'number' && app.state.mode === 'unique');
    if (!pvLegend.hidden && pr?.kind === 'number' && pdef?.kind === 'number') {
      const u = pdef.unit ? ` ${pdef.unit}` : '';
      pvName.textContent = pdef.label;
      pvMin.textContent = `${formatValue(pdef, pr.min)}${u}`;
      pvMax.textContent = `${formatValue(pdef, pr.max)}${u}`;
      for (const [b, side] of [[pvMinBtn, 'min'], [pvMaxBtn, 'max']] as const) {
        b.classList.toggle('is-active', app.previewSide === side);
        b.setAttribute('aria-pressed', String(app.previewSide === side));
      }
    }
  };
  app.on(refresh);
  refresh();
}

// ---------------------------------------------------------------------------- barre d'état

function buildStatusbar(app: App, root: HTMLElement): void {
  const spinner = h('span', { class: 'cf-spinner' });
  const dot = h('span', { class: 'cf-status-dot' });
  const statusText = h('span', { class: 'cf-status-text' });
  const item = (label: string, hint: string, cls = '') => {
    const v = h('span', { class: 'cf-sb-v' });
    const el = h('span', { class: `cf-sb-item ${cls}`, title: hint }, [h('span', { class: 'cf-sb-k', text: label }), v]);
    return { el, v };
  };
  const chips = item('Copeaux', 'Nombre de copeaux affichés');
  const quads = item('Quads', 'Faces quadrangulaires de l’aperçu (triangles = 2 × quads)');
  const verts = item('Sommets', 'Sommets uniques (soudés) de l’aperçu', 'cf-hide-md');
  const time = item('Calcul', 'Temps de calcul du dernier aperçu', 'cf-hide-md');
  const micro = item('Micro-reliefs', 'Part des micro-reliefs lissée faute de résolution dans l’aperçu. L’export recalcule la géométrie à sa propre résolution, plus fine.', 'cf-hide-lg');
  const contacts = item('Auto-intersections', 'Zones où le copeau se traverserait lui-même, après résolution (option « Éviter les auto-intersections »)', 'cf-hide-lg');
  const grid = h('span', { class: 'cf-sb-item cf-sb-grid cf-hide-md', title: 'Pas de la grille (fin · principal)' });

  root.append(
    h('div', { class: 'cf-sb-left' }, [spinner, dot, statusText]),
    h('div', { class: 'cf-sb-right' }, [chips.el, quads.el, verts.el, time.el, micro.el, contacts.el, grid]),
  );

  app.viewer.onGridStep = (minor, major) => {
    const f = (x: number) => (x >= 1 ? `${+x.toFixed(2)} mm` : `${+(x * 1000).toFixed(1)} µm`);
    grid.replaceChildren(icon('grid', 'w-3 h-3'), h('span', { text: `${f(minor)} · ${f(major)}` }));
  };

  const refresh = () => {
    const st = app.status;
    const busy = st.phase === 'generation' || st.phase === 'simulation' || st.phase === 'export';
    spinner.hidden = !busy;
    dot.hidden = busy;
    const stale = app.state.mode === 'tas' && app.stale;
    dot.className = `cf-status-dot ${st.phase === 'erreur' ? 'is-error' : stale ? 'is-warn' : 'is-ok'}`;
    statusText.textContent =
      st.phase === 'erreur' || busy ? `${st.message}${busy && st.progress > 0 && st.progress < 1 ? ` ${Math.round(st.progress * 100)} %` : ''}` : stale ? 'Tas périmé — G pour régénérer' : 'Prêt';
    statusText.classList.toggle('is-error', st.phase === 'erreur');

    const s = app.viewer.stats();
    chips.v.textContent = formatCount(s.chips);
    quads.v.textContent = formatCount(s.quads);
    verts.v.textContent = formatCount(s.vertices);
    time.v.textContent = st.lastMs ? `${Math.round(st.lastMs)} ms` : '—';
    const att = app.meshes.length ? app.meshes.reduce((a, m) => a + m.info.microAttenuation, 0) / app.meshes.length : 0;
    micro.v.textContent = att < 0.02 ? 'complets' : `lissés à ${Math.round(att * 100)} %`;
    micro.el.classList.toggle('is-warn', att >= 0.02);
    const cs = app.meshes.map((m) => m.info.selfContacts);
    const unchecked = cs.some((c) => c === null);
    const residual = cs.reduce((a, c) => a + (c?.residual ?? 0), 0);
    const resolved = cs.reduce((a, c) => a + (c ? c.initial - c.residual : 0), 0);
    contacts.v.textContent = unchecked ? 'non contrôlées' : residual > 0 ? `${formatCount(residual)} restante(s)` : resolved > 0 ? `aucune (${formatCount(resolved)} corrigée(s))` : 'aucune';
    contacts.el.classList.toggle('is-warn', unchecked || residual > 0);
  };
  app.on(refresh);
  refresh();
}

// ---------------------------------------------------------------------------- clavier

/** Raccourcis clavier (hors champs de saisie et boîtes de dialogue). */
export function bindShortcuts(app: App, shell: Shell): void {
  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    // Champs de saisie : les touches leur reviennent (curseurs et interrupteurs exceptés).
    const typing = t instanceof HTMLInputElement ? !['range', 'checkbox', 'radio', 'button'].includes(t.type) : t && (t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (typing) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector('dialog[open]')) return;
    const k = e.key.toLowerCase();
    const n = Number(e.key);
    if (k === 'r') app.rerollSeed();
    else if (k === 'g' && app.state.mode === 'tas') app.generatePile();
    else if (k === 'f') app.frame();
    else if (k === 'w') app.setView({ wireframe: !app.state.view.wireframe });
    else if (k === 'u') app.setView({ uvChecker: !app.state.view.uvChecker });
    else if (k === 'e') shell.exportDialog.open();
    else if (k === 'p') shell.toggleSidebar();
    else if (e.key === '?') shell.helpDialog.open();
    else if (Number.isInteger(n) && n >= 1 && n <= shell.panels.length) shell.showPanel(shell.panels[n - 1].id);
    else if (k === 'escape') shell.closeSidebarIfOverlay();
    else return;
    e.preventDefault();
  });
}
