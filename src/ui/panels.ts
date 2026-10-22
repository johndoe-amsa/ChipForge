import type { App } from '../app/app';
import { PARAM_DEFS, PARAM_DEF_MAP, SECTIONS, clampParam, type ChipParams, type NumberDef } from '../core/params';
import { FORMS, MATERIALS, PROCESSES, SHORTCUTS, type ChipQuality } from '../core/presets/presets';
import { MATCAPS } from '../viewer/textures';
import { numberControl, segmented, selectControl, toggleControl, type Control } from './controls';
import { formatCount, h, icon } from './dom';
import { toast } from './toast';

const QUALITY_LABEL: Record<ChipQuality, string> = { bon: 'Bon copeau', acceptable: 'Acceptable', mauvais: 'Mauvais copeau' };
const QUALITY_MARK: Record<ChipQuality, string> = { bon: '✓', acceptable: '~', mauvais: '✗' };

function section(title: string, open: boolean, body: Node[], hint?: string, extraClass = ''): HTMLDetailsElement {
  const d = h('details', { class: `cf-section ${extraClass}` }, [
    h('summary', { class: 'cf-section-title', title: hint }, [h('span', { text: title }), icon('chevron', 'cf-chevron w-3.5 h-3.5')]),
    h('div', { class: 'cf-section-body' }, body),
  ]);
  d.open = open;
  return d;
}

function badge(q: ChipQuality, text?: string): HTMLElement {
  return h('span', { class: `cf-badge cf-badge-${q}`, text: `${QUALITY_MARK[q]} ${text ?? QUALITY_LABEL[q]}` });
}

// ---------------------------------------------------------------------------- en-tête

export function buildHeader(app: App, root: HTMLElement): void {
  const modeCtl = segmented(
    [
      { value: 'unique', label: 'Copeau unique' },
      { value: 'tas', label: 'Tas de copeaux' },
    ],
    () => app.state.mode,
    (v) => app.setMode(v),
    'cf-seg-lg',
  );
  const seedInput = h('input', {
    class: 'cf-num cf-seed',
    attrs: { type: 'number', min: '0', max: '4294967295', step: '1', 'aria-label': 'Seed', inputmode: 'numeric' },
  });
  const commitSeed = () => app.setSeed(Number(seedInput.value));
  seedInput.addEventListener('change', commitSeed);
  seedInput.addEventListener('keydown', (e) => e.key === 'Enter' && commitSeed());
  const dice = h('button', { class: 'cf-btn cf-btn-icon', title: 'Nouvelle variation aléatoire (touche R)', attrs: { type: 'button', 'aria-label': 'Nouvelle seed' } }, [icon('dice')]);
  dice.addEventListener('click', () => app.rerollSeed());

  const objBtn = h('button', { class: 'cf-btn', title: 'Exporter OBJ + MTL (archive .zip)', attrs: { type: 'button' } }, [icon('download'), h('span', { text: 'OBJ' })]);
  const stepBtn = h('button', { class: 'cf-btn cf-btn-primary', title: 'Exporter STEP (B-Rep NURBS)', attrs: { type: 'button' } }, [icon('download'), h('span', { text: 'STEP' })]);
  objBtn.addEventListener('click', () => void app.exportAs('obj'));
  stepBtn.addEventListener('click', () => void app.exportAs('step'));

  const leftToggle = h('button', { class: 'cf-btn cf-btn-icon cf-only-narrow', title: 'Paramètres', attrs: { type: 'button', 'aria-label': 'Afficher les paramètres' } }, [icon('sliders')]);
  const rightToggle = h('button', { class: 'cf-btn cf-btn-icon cf-only-narrow', title: 'Tas, statistiques et export', attrs: { type: 'button', 'aria-label': 'Afficher le panneau export' } }, [icon('layers')]);
  leftToggle.addEventListener('click', () => document.body.classList.toggle('show-left'));
  rightToggle.addEventListener('click', () => document.body.classList.toggle('show-right'));

  root.append(
    h('div', { class: 'cf-brand' }, [
      leftToggle,
      h('span', { class: 'cf-logo' }, [icon('chip', 'w-5 h-5')]),
      h('div', { class: 'leading-tight' }, [
        h('div', { class: 'cf-brand-name', text: 'ChipForge' }),
        h('div', { class: 'cf-brand-sub', text: "Copeaux d'usinage paramétriques" }),
      ]),
    ]),
    h('div', { class: 'cf-top-center' }, [
      modeCtl.el,
      h('div', { class: 'cf-seed-group', title: 'La seed détermine toute la part aléatoire : même seed + mêmes réglages = même géométrie.' }, [
        h('span', { class: 'cf-top-label', text: 'Seed' }),
        seedInput,
        dice,
      ]),
    ]),
    h('div', { class: 'cf-top-right' }, [objBtn, stepBtn, rightToggle]),
  );

  const refresh = () => {
    modeCtl.refresh();
    if (document.activeElement !== seedInput) seedInput.value = String(app.state.seed);
    const disabled = app.exporting;
    objBtn.toggleAttribute('disabled', disabled);
    stepBtn.toggleAttribute('disabled', disabled);
  };
  app.on(refresh);
  refresh();
}

// ---------------------------------------------------------------------------- panneau gauche

export function buildLeftPanel(app: App, root: HTMLElement): void {
  // --- Bandeau du preset courant
  const bannerBadge = h('div');
  const bannerTitle = h('div', { class: 'cf-banner-title' });
  const bannerSub = h('div', { class: 'cf-banner-sub' });
  const bannerDesc = h('div', { class: 'cf-banner-desc' });
  const banner = h('div', { class: 'cf-banner' }, [bannerBadge, bannerTitle, bannerSub, bannerDesc]);

  // --- Matières
  const matButtons = MATERIALS.map((m) => {
    const b = h('button', { class: 'cf-chip', title: m.description, attrs: { type: 'button' } }, [
      h('span', { class: 'cf-chip-name', text: m.name }),
      h('span', { class: 'cf-chip-sub', text: m.grade }),
    ]);
    b.addEventListener('click', () => app.applySelection({ material: m.id }));
    return { id: m.id, b };
  });
  // --- Procédés
  const procButtons = PROCESSES.map((p) => {
    const b = h('button', { class: 'cf-chip', title: p.description, attrs: { type: 'button' } }, [h('span', { class: 'cf-chip-name', text: p.name })]);
    b.addEventListener('click', () => app.applySelection({ process: p.id }));
    return { id: p.id, b };
  });
  // --- Formes ISO, groupées par famille
  const families = new Map<number, typeof FORMS>();
  for (const f of FORMS) families.set(f.family, [...(families.get(f.family) ?? []), f]);
  const formButtons: { id: string; b: HTMLButtonElement }[] = [];
  const isoRows = [...families.entries()].map(([fam, forms]) =>
    h('div', { class: 'cf-iso-row' }, [
      h('span', { class: 'cf-iso-fam' }, [h('span', { class: 'cf-iso-num', text: String(fam) }), h('span', { text: forms[0].familyName })]),
      h(
        'div',
        { class: 'cf-iso-variants' },
        forms.map((f) => {
          const b = h('button', {
            class: `cf-pill cf-pill-${f.quality}`,
            title: `ISO ${f.id} — ${f.familyName} ${f.variant} (${QUALITY_LABEL[f.quality]})\n${f.description}`,
            attrs: { type: 'button' },
          }, [h('span', { class: 'cf-pill-mark', text: QUALITY_MARK[f.quality] }), h('span', { text: f.variant })]);
          b.addEventListener('click', () => app.applySelection({ form: f.id }));
          formButtons.push({ id: f.id, b });
          return b;
        }),
      ),
    ]),
  );
  // --- Raccourcis atelier
  const scButtons = SHORTCUTS.map((sc) => {
    const b = h('button', { class: `cf-pill cf-pill-${sc.quality}`, title: `${sc.description} (ISO ${sc.form})`, attrs: { type: 'button' } }, [
      h('span', { class: 'cf-pill-mark', text: QUALITY_MARK[sc.quality] }),
      h('span', { text: sc.name }),
    ]);
    b.addEventListener('click', () => app.applySelection({ form: sc.form, shortcut: sc.id }));
    return { id: sc.id, b, quality: sc.quality };
  });
  // --- Presets perso
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
  const nameInput = h('input', { class: 'cf-text', attrs: { type: 'text', maxlength: '60', placeholder: 'Nom du preset', 'aria-label': 'Nom du preset' } });
  const saveBtn = h('button', { class: 'cf-btn cf-btn-sm', title: 'Télécharger les réglages actuels (.json)', attrs: { type: 'button' } }, [icon('save'), h('span', { text: 'Enregistrer' })]);
  const loadBtn = h('button', { class: 'cf-btn cf-btn-sm', title: 'Charger un preset .json', attrs: { type: 'button' } }, [icon('upload'), h('span', { text: 'Charger' })]);
  saveBtn.addEventListener('click', () => app.savePreset(nameInput.value.trim() || app.defaultBaseName()));
  loadBtn.addEventListener('click', () => fileInput.click());

  const presets = section(
    'Presets',
    true,
    [
      banner,
      h('div', { class: 'cf-sub', text: 'Matière' }),
      h('div', { class: 'cf-chip-grid' }, matButtons.map((x) => x.b)),
      h('div', { class: 'cf-sub', text: 'Procédé' }),
      h('div', { class: 'cf-chip-grid' }, procButtons.map((x) => x.b)),
      h('div', { class: 'cf-sub' }, [h('span', { text: 'Forme ISO 3685' }), h('span', { class: 'cf-legend' }, [badge('bon', 'bon'), badge('acceptable', 'acceptable'), badge('mauvais', 'mauvais')])]),
      h('div', { class: 'cf-iso' }, isoRows),
      h('div', { class: 'cf-sub', text: 'Raccourcis atelier' }),
      h('div', { class: 'cf-sc-row' }, [h('span', { class: 'cf-sc-label', text: 'Bons' }), h('div', { class: 'cf-iso-variants' }, scButtons.filter((s) => s.quality !== 'mauvais').map((s) => s.b))]),
      h('div', { class: 'cf-sc-row' }, [h('span', { class: 'cf-sc-label', text: 'Mauvais' }), h('div', { class: 'cf-iso-variants' }, scButtons.filter((s) => s.quality === 'mauvais').map((s) => s.b))]),
      h('div', { class: 'cf-sub', text: 'Presets personnels' }),
      h('div', { class: 'cf-preset-io' }, [nameInput, saveBtn, loadBtn, fileInput]),
    ],
    'Matière × procédé × forme ISO 3685',
    'cf-section-presets',
  );

  // --- Paramètres
  const controls: Control[] = [];
  const paramSections = SECTIONS.map((sec) => {
    const defs = PARAM_DEFS.filter((d) => d.section === sec.id);
    const items = defs.map((def) => {
      const key = def.key;
      let c: Control;
      if (def.kind === 'number') {
        c = numberControl(
          def,
          () => app.state.params[key] as number,
          (v) => app.setParam(key, clampParam(PARAM_DEF_MAP[key] as NumberDef, v) as ChipParams[typeof key]),
          () => app.isModified(key),
          () => app.setParam(key, app.state.base[key]),
        );
      } else if (def.kind === 'bool') {
        c = toggleControl(def.label, def.hint, () => app.state.params[key] as boolean, (v) => app.setParam(key, v as ChipParams[typeof key]));
      } else {
        c = selectControl(def.label, def.hint, def.options, () => String(app.state.params[key]), (v) => app.setParam(key, v as ChipParams[typeof key]), () => app.isModified(key));
      }
      controls.push(c);
      return c.el;
    });
    return section(sec.title, sec.id === 'macro' || sec.id === 'section', [h('p', { class: 'cf-hint', text: sec.hint }), ...items], sec.hint);
  });
  const resetAll = h('button', { class: 'cf-btn cf-btn-sm w-full justify-center', attrs: { type: 'button' } }, [icon('reset'), h('span', { text: 'Revenir au preset' })]);
  resetAll.addEventListener('click', () => app.resetParams());

  root.append(presets, ...paramSections, h('div', { class: 'p-3' }, [resetAll]));

  const refresh = (what?: Set<string>) => {
    const sel = app.state.selection;
    for (const x of matButtons) x.b.classList.toggle('is-active', x.id === sel.material);
    for (const x of procButtons) x.b.classList.toggle('is-active', x.id === sel.process);
    for (const x of formButtons) x.b.classList.toggle('is-active', x.id === sel.form && !sel.shortcut);
    for (const x of scButtons) x.b.classList.toggle('is-active', x.id === sel.shortcut);
    const d = app.describeSelection();
    bannerBadge.replaceChildren(badge(d.quality));
    const sc = sel.shortcut ? SHORTCUTS.find((s) => s.id === sel.shortcut) : undefined;
    bannerTitle.textContent = sc ? `${sc.name} (ISO ${sel.form})` : d.title;
    bannerSub.textContent = d.subtitle;
    bannerDesc.textContent = d.description;
    if (!what || what.has('params') || what.has('preset')) for (const c of controls) c.refresh();
  };
  app.on(refresh);
  refresh();
}

// ---------------------------------------------------------------------------- panneau droit

export function buildRightPanel(app: App, root: HTMLElement): void {
  // --- Tas
  const pileIntro = h('div', { class: 'cf-hint' }, [
    h('p', { text: 'Génère un lot de copeaux dispersés autour du preset courant, puis les fait tomber sur la grille (simulation physique).' }),
  ]);
  const toPile = h('button', { class: 'cf-btn cf-btn-sm w-full justify-center mt-2', attrs: { type: 'button' } }, [icon('layers'), h('span', { text: 'Passer en mode tas' })]);
  toPile.addEventListener('click', () => app.setMode('tas'));
  const defCount: NumberDef = { kind: 'number', key: 'length', label: 'Nombre de copeaux', section: 'macro', hint: 'Taille du lot (200 max).', min: 1, max: 200, step: 1, hardMin: 1, hardMax: 200, integer: true };
  const defVar: NumberDef = { ...defCount, label: 'Variabilité', hint: 'Dispersion des paramètres autour du preset.', unit: '%', min: 0, max: 100, step: 1, hardMin: 0, hardMax: 100, integer: true };
  const defSpread: NumberDef = { ...defCount, label: 'Étalement', hint: 'Rayon de la zone de chute (0 = automatique).', unit: 'mm', min: 0, max: 200, step: 1, hardMin: 0, hardMax: 2000, integer: false };
  const count = numberControl(defCount, () => app.state.pile.count, (v) => app.setPile({ count: Math.round(Math.min(200, Math.max(1, v))) }), () => false, () => app.setPile({ count: 40 }), 'pile-count');
  const variab = numberControl(defVar, () => Math.round(app.state.pile.variability * 100), (v) => app.setPile({ variability: Math.min(100, Math.max(0, v)) / 100 }), () => false, () => app.setPile({ variability: 0.5 }), 'pile-variability');
  const spread = numberControl(defSpread, () => app.state.pile.spread, (v) => app.setPile({ spread: Math.min(2000, Math.max(0, v)) }), () => false, () => app.setPile({ spread: 0 }), 'pile-spread');
  const physics = toggleControl('Simulation physique', 'Chute réaliste sans interpénétration (sinon dispersion simple sur la grille).', () => app.state.pile.physics, (v) => app.setPile({ physics: v }));
  const rerun = h('button', { class: 'cf-btn cf-btn-sm w-full justify-center mt-1', title: 'Nouvelle seed et nouvelle chute', attrs: { type: 'button' } }, [icon('play'), h('span', { text: 'Nouvelle chute' })]);
  rerun.addEventListener('click', () => app.rerollSeed());
  const pileBody = h('div', {}, [count.el, variab.el, spread.el, physics.el, rerun]);
  const pileOff = h('div', {}, [pileIntro, toPile]);
  const pileSec = section('Mode tas', true, [pileOff, pileBody], 'Lot de copeaux et dispersion contrôlée');

  // --- Statistiques
  const statVals = {
    chips: h('span', { class: 'cf-stat-v' }),
    quads: h('span', { class: 'cf-stat-v' }),
    tris: h('span', { class: 'cf-stat-v' }),
    verts: h('span', { class: 'cf-stat-v' }),
    time: h('span', { class: 'cf-stat-v' }),
    micro: h('span', { class: 'cf-stat-v' }),
    contacts: h('span', { class: 'cf-stat-v' }),
  };
  const stat = (k: string, v: HTMLElement, hint: string) => h('div', { class: 'cf-stat', title: hint }, [h('span', { class: 'cf-stat-k', text: k }), v]);
  const statsSec = section('Statistiques (aperçu)', true, [
    h('div', { class: 'cf-stats' }, [
      stat('Copeaux', statVals.chips, 'Nombre de copeaux affichés'),
      stat('Polygones (quads)', statVals.quads, 'Faces quadrangulaires'),
      stat('Triangles', statVals.tris, 'Équivalent triangulé'),
      stat('Sommets', statVals.verts, 'Sommets uniques (soudés)'),
      stat('Génération', statVals.time, 'Temps de calcul du dernier aperçu'),
      stat('Micro-reliefs', statVals.micro, "Part des micro-reliefs lissée faute de résolution dans l'aperçu"),
      stat('Auto-intersections', statVals.contacts, 'Zones où le copeau se traverserait lui-même, après résolution (option « Éviter les auto-intersections »)'),
    ]),
    h('p', { class: 'cf-hint', text: "L'export recalcule la géométrie à sa propre résolution (plus fine)." }),
  ]);

  // --- Export
  const unit = segmented(
    [
      { value: 'mm', label: 'mm', title: '1 unité = 1 mm (CAO, KeyShot)' },
      { value: 'm', label: 'm', title: '1 unité = 1 m (Blender : taille réelle à l’import)' },
    ],
    () => app.state.exp.unit,
    (v) => app.setExport({ unit: v }),
  );
  const uvMode = segmented(
    [
      { value: 'reel', label: 'Échelle réelle', title: 'Densité de texels constante sur tous les copeaux' },
      { value: 'normalise', label: '0–1 / copeau', title: 'Chaque copeau occupe tout l’espace UV' },
    ],
    () => app.state.exp.uvMode,
    (v) => app.setExport({ uvMode: v }),
  );
  const defUv: NumberDef = { kind: 'number', key: 'length', label: '1 unité UV =', section: 'macro', hint: 'Nombre de millimètres couverts par une répétition de texture.', unit: 'mm', min: 0.5, max: 100, step: 0.1, hardMin: 0.01, hardMax: 10000, log: true };
  const uvScale = numberControl(defUv, () => app.state.exp.uvScaleMM, (v) => app.setExport({ uvScaleMM: Math.min(10000, Math.max(0.01, v)) }), () => false, () => app.setExport({ uvScaleMM: 10 }), 'uv-scale');
  const meshDetail = segmented(
    [
      { value: 'standard', label: 'Standard', title: 'Jusqu’à 600 k sommets par copeau' },
      { value: 'fin', label: 'Fin', title: 'Micro-reliefs résolus, jusqu’à 1,5 M sommets par copeau' },
      { value: 'ultra', label: 'Ultra', title: 'Très dense, jusqu’à 4 M sommets par copeau (fichiers lourds)' },
    ],
    () => app.state.exp.meshDetail,
    (v) => app.setExport({ meshDetail: v }),
  );
  const stepDetail = segmented(
    [
      { value: 'leger', label: 'Léger', title: 'Forme globale, fichiers compacts' },
      { value: 'standard', label: 'Standard', title: 'Forme + bords, bon compromis' },
      { value: 'fin', label: 'Fin', title: 'Micro-reliefs inclus dans les NURBS (fichiers lourds)' },
    ],
    () => app.state.exp.stepDetail,
    (v) => app.setExport({ stepDetail: v }),
  );
  const nameInput = h('input', { class: 'cf-text', attrs: { type: 'text', maxlength: '80', 'aria-label': 'Nom du fichier' } });
  nameInput.addEventListener('change', () => app.setExport({ baseName: nameInput.value.trim() }));
  const objBtn = h('button', { class: 'cf-btn w-full justify-center', attrs: { type: 'button' } }, [icon('download'), h('span', { text: 'Exporter OBJ (.zip)' })]);
  const stepBtn = h('button', { class: 'cf-btn cf-btn-primary w-full justify-center', attrs: { type: 'button' } }, [icon('download'), h('span', { text: 'Exporter STEP' })]);
  objBtn.addEventListener('click', () => void app.exportAs('obj'));
  stepBtn.addEventListener('click', () => void app.exportAs('step'));
  const field = (label: string, el: HTMLElement, hint?: string) => h('div', { class: 'cf-field', title: hint }, [h('div', { class: 'cf-label', text: label }), el]);
  const uvScaleWrap = h('div', {}, [uvScale.el]);
  const exportSec = section('Export', true, [
    field('Unité (OBJ)', unit.el, 'Le STEP est toujours en millimètres.'),
    field('Coordonnées UV', uvMode.el),
    uvScaleWrap,
    field('Résolution du maillage (OBJ)', meshDetail.el),
    field('Détail des surfaces (STEP)', stepDetail.el),
    field('Nom du fichier', nameInput),
    h('div', { class: 'cf-export-buttons' }, [objBtn, stepBtn]),
    h('ul', { class: 'cf-notes' }, [
      h('li', { text: 'OBJ : quads, UV, normales lisses, un objet par copeau, groupes face_coupe / face_libre / flancs / extremites + fichier MTL. Axe vertical Y.' }),
      h('li', { text: 'STEP AP214 : solides B-Rep NURBS fermés (6 faces par copeau), assemblage nommé pour un tas, couleur par groupe de faces. Millimètres, axe vertical Z.' }),
      h('li', { text: 'Tout est calculé dans votre navigateur : aucune donnée ne quitte votre poste.' }),
    ]),
  ]);

  root.append(pileSec, statsSec, exportSec);

  const refresh = () => {
    const tas = app.state.mode === 'tas';
    pileBody.hidden = !tas;
    pileOff.hidden = tas;
    count.refresh();
    variab.refresh();
    spread.refresh();
    physics.refresh();
    const st = app.viewer.stats();
    statVals.chips.textContent = formatCount(st.chips);
    statVals.quads.textContent = formatCount(st.quads);
    statVals.tris.textContent = formatCount(st.triangles);
    statVals.verts.textContent = formatCount(st.vertices);
    statVals.time.textContent = app.status.lastMs ? `${Math.round(app.status.lastMs)} ms` : '—';
    const att = app.meshes.length ? app.meshes.reduce((a, m) => a + m.info.microAttenuation, 0) / app.meshes.length : 0;
    statVals.micro.textContent = att < 0.02 ? 'complets' : `lissés à ${Math.round(att * 100)} %`;
    statVals.micro.classList.toggle('text-amber-300', att >= 0.02);
    const contacts = app.meshes.map((m) => m.info.selfContacts);
    const unchecked = contacts.some((c) => c === null);
    const residual = contacts.reduce((a, c) => a + (c?.residual ?? 0), 0);
    const resolved = contacts.reduce((a, c) => a + (c ? c.initial - c.residual : 0), 0);
    statVals.contacts.textContent = unchecked
      ? 'non contrôlées'
      : residual > 0
        ? `${formatCount(residual)} restante(s)`
        : resolved > 0
          ? `aucune (${formatCount(resolved)} corrigée(s))`
          : 'aucune';
    statVals.contacts.classList.toggle('text-amber-300', unchecked || residual > 0);
    unit.refresh();
    uvMode.refresh();
    uvScale.refresh();
    uvScaleWrap.hidden = app.state.exp.uvMode !== 'reel';
    meshDetail.refresh();
    stepDetail.refresh();
    nameInput.placeholder = app.defaultBaseName();
    if (document.activeElement !== nameInput) nameInput.value = app.state.exp.baseName;
    objBtn.toggleAttribute('disabled', app.exporting);
    stepBtn.toggleAttribute('disabled', app.exporting);
  };
  app.on(refresh);
  refresh();
}

// ---------------------------------------------------------------------------- viewport

export function buildViewportOverlay(app: App, root: HTMLElement): void {
  const tool = (name: string, title: string, on: () => void) => {
    const b = h('button', { class: 'cf-tool', title, attrs: { type: 'button', 'aria-label': title } }, [icon(name)]);
    b.addEventListener('click', on);
    return b;
  };
  const v = () => app.state.view;
  const bFrame = tool('frame', 'Recadrer la vue (F)', () => app.frame());
  const bGrid = tool('grid', 'Grille d’usinage', () => app.setView({ grid: !v().grid }));
  const bAxes = tool('axes', 'Axes XYZ', () => app.setView({ axes: !v().axes }));
  const bWire = tool('wire', 'Filaire (W)', () => app.setView({ wireframe: !v().wireframe }));
  const bUv = tool('checker', 'Damier UV (U)', () => app.setView({ uvChecker: !v().uvChecker }));
  const matcap = h(
    'select',
    { class: 'cf-select cf-select-sm', title: 'Ombrage MatCap', attrs: { 'aria-label': 'MatCap' } },
    MATCAPS.map((m) => h('option', { text: m.label, attrs: { value: m.id } })),
  );
  matcap.addEventListener('change', () => app.setView({ matcap: matcap.value }));
  const tier = segmented(
    [
      { value: 'rapide', label: 'Rapide', title: 'Aperçu fluide (micro-reliefs simplifiés)' },
      { value: 'detaille', label: 'Détaillé', title: 'Aperçu dense avec micro-reliefs' },
    ],
    () => app.state.view.tier,
    (t) => app.setView({ tier: t }),
    'cf-seg-sm',
  );

  const toolbar = h('div', { class: 'cf-toolbar' }, [bFrame, h('span', { class: 'cf-sep' }), bGrid, bAxes, bWire, bUv, h('span', { class: 'cf-sep' }), matcap, tier.el]);

  const qBadge = h('div', { class: 'cf-vp-badge' });
  const progress = h('div', { class: 'cf-progress' }, [h('div', { class: 'cf-progress-bar' })]);
  const statusText = h('span', { class: 'cf-status-text' });
  const spinner = h('span', { class: 'cf-spinner' });
  const gridText = h('span', { class: 'cf-grid-text' });
  const statusBar = h('div', { class: 'cf-statusbar' }, [gridText, h('span', { class: 'cf-status' }, [spinner, statusText])]);
  root.append(progress, toolbar, qBadge, statusBar);

  app.viewer.onGridStep = (minor, major) => {
    const f = (x: number) => (x >= 1 ? `${+x.toFixed(2)} mm` : `${+(x * 1000).toFixed(1)} µm`);
    gridText.textContent = `Grille ${f(minor)} · ${f(major)}`;
  };
  app.viewer.frame(false);

  const refresh = () => {
    const view = app.state.view;
    bGrid.classList.toggle('is-active', view.grid);
    bAxes.classList.toggle('is-active', view.axes);
    bWire.classList.toggle('is-active', view.wireframe);
    bUv.classList.toggle('is-active', view.uvChecker);
    matcap.value = view.matcap;
    tier.refresh();
    const d = app.describeSelection();
    qBadge.replaceChildren(badge(d.quality), h('span', { class: 'cf-vp-badge-t', text: app.state.mode === 'tas' ? `${d.title} · tas de ${app.state.pile.count}` : d.title }));
    const st = app.status;
    const busy = st.phase === 'generation' || st.phase === 'simulation' || st.phase === 'export';
    progress.classList.toggle('is-on', busy);
    (progress.firstChild as HTMLElement).style.width = `${Math.round((busy ? Math.max(0.04, st.progress) : 1) * 100)}%`;
    spinner.hidden = !busy;
    statusText.textContent = st.phase === 'erreur' ? st.message : busy ? st.message : 'Prêt';
    statusText.classList.toggle('text-rose-300', st.phase === 'erreur');
  };
  app.on(refresh);
  refresh();
}

/** Raccourcis clavier (hors champs de saisie). */
export function bindShortcuts(app: App): void {
  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'r') app.rerollSeed();
    else if (k === 'f') app.frame();
    else if (k === 'w') app.setView({ wireframe: !app.state.view.wireframe });
    else if (k === 'u') app.setView({ uvChecker: !app.state.view.uvChecker });
    else if (k === 'escape') document.body.classList.remove('show-left', 'show-right');
  });
}
