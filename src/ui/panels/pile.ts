import type { App } from '../../app/app';
import type { NumberDef } from '../../core/params';
import { DEFAULT_PILE, MAX_PILE_COUNT } from '../../core/presets/presets';
import { PYRAMID_SLOPE_RANGE } from '../../core/pyramid';
import { numberControl, segmented, toggleControl } from '../controls';
import { h, icon } from '../dom';
import { button, field, kbd, section } from '../widgets';
import type { PanelDef } from './panel';

/** Onglet Tas : lot de copeaux, réceptacle, simulation physique et génération à la demande. */
export function buildPilePanel(app: App): PanelDef {
  // --- Mode copeau unique : invitation à passer en mode tas
  const empty = h('div', { class: 'cf-empty' }, [
    h('span', { class: 'cf-empty-icon' }, [icon('layers', 'w-6 h-6')]),
    h('h3', { class: 'cf-empty-title', text: 'Générer un tas de copeaux' }),
    h('p', {
      class: 'cf-empty-text',
      text: 'Un lot de copeaux variés autour du preset courant tombe sur la grille, dans un bac à copeaux ou en tas pyramidal (simulation physique).',
    }),
    button({ label: 'Passer en mode tas', icon: 'layers', variant: 'primary', onClick: () => app.setMode('tas') }),
  ]);

  // --- Lot
  const defCount: NumberDef = {
    kind: 'number',
    key: 'length',
    label: 'Nombre de copeaux',
    section: 'macro',
    hint: `Taille du lot (${MAX_PILE_COUNT} max). Au-delà de quelques centaines, la génération et la chute prennent du temps.`,
    min: 1,
    max: MAX_PILE_COUNT,
    step: 1,
    hardMin: 1,
    hardMax: MAX_PILE_COUNT,
    integer: true,
    log: true,
  };
  const defSpread: NumberDef = { ...defCount, log: false, label: 'Étalement', hint: 'Rayon de la zone de chute (0 = automatique).', unit: 'mm', min: 0, max: 200, step: 1, hardMin: 0, hardMax: 2000, integer: false };
  const pile = () => app.state.pile;
  const count = numberControl(defCount, () => pile().count, (v) => app.setPile({ count: Math.round(Math.min(MAX_PILE_COUNT, Math.max(1, v))) }), () => pile().count !== DEFAULT_PILE.count, () => app.setPile({ count: DEFAULT_PILE.count }), 'pile-count');
  const lot = section({ icon: 'layers', title: 'Lot', body: [count.el, h('p', { class: 'cf-hint cf-hint-after', text: 'Les écarts entre copeaux (variation globale, plages) se règlent dans le panneau Aléatoire.' })] });

  // --- Réceptacle
  const container = segmented(
    [
      { value: 'sol', label: 'Grille', icon: 'ground', title: 'Les copeaux tombent en monticule sur la grille' },
      { value: 'bac', label: 'Bac', icon: 'bin', title: 'Les copeaux tombent dans un bac à copeaux ouvert (parois et fond)' },
      { value: 'pyramide', label: 'Pyramide', icon: 'pyramid', title: 'Tas moulé en pyramide à base carrée, puis démoulé' },
    ],
    () => pile().container,
    (v) => app.setPile({ container: v }),
    'cf-seg-block',
  );
  const spread = numberControl(defSpread, () => pile().spread, (v) => app.setPile({ spread: Math.min(2000, Math.max(0, v)) }), () => pile().spread !== 0, () => app.setPile({ spread: 0 }), 'pile-spread');
  const binDef = (label: string, hint: string): NumberDef => ({ ...defCount, log: false, label, hint, unit: 'mm', min: 0, max: 300, step: 1, hardMin: 0, hardMax: 2000, integer: false });
  const binNum = (key: 'binLength' | 'binWidth' | 'binHeight', label: string, hint: string) =>
    numberControl(binDef(label, hint), () => pile()[key], (v) => app.setPile({ [key]: Math.min(2000, Math.max(0, v)) }), () => pile()[key] > 0, () => app.setPile({ [key]: 0 }), `pile-${key}`);
  const binL = binNum('binLength', 'Longueur intérieure', 'Longueur du bac (0 = automatique, selon la taille et le nombre de copeaux).');
  const binW = binNum('binWidth', 'Largeur intérieure', 'Largeur du bac (0 = automatique).');
  const binH = binNum('binHeight', 'Hauteur des parois', 'Hauteur intérieure du bac (0 = automatique).');
  const binInfo = h('p', { class: 'cf-info' });
  const binBody = h('div', {}, [h('p', { class: 'cf-hint', text: 'Dimensions à 0 : calculées selon la taille et le nombre de copeaux.' }), binL.el, binW.el, binH.el, binInfo]);
  const defSlope: NumberDef = {
    ...defCount,
    label: 'Pente des faces',
    hint: 'Inclinaison des faces de la pyramide. Après démoulage, les bords se tassent un peu.',
    unit: '°',
    min: PYRAMID_SLOPE_RANGE[0],
    max: PYRAMID_SLOPE_RANGE[1],
    step: 1,
    hardMin: PYRAMID_SLOPE_RANGE[0],
    hardMax: PYRAMID_SLOPE_RANGE[1],
    log: false,
  };
  const slope = numberControl(
    defSlope,
    () => pile().pyramidSlope,
    (v) => app.setPile({ pyramidSlope: Math.min(PYRAMID_SLOPE_RANGE[1], Math.max(PYRAMID_SLOPE_RANGE[0], v)) }),
    () => pile().pyramidSlope !== DEFAULT_PILE.pyramidSlope,
    () => app.setPile({ pyramidSlope: DEFAULT_PILE.pyramidSlope }),
    'pile-pyramid-slope',
  );
  const pyrInfo = h('p', { class: 'cf-info' });
  const pyrBody = h('div', {}, [slope.el, pyrInfo]);
  const spreadBody = h('div', {}, [spread.el]);
  const recept = section({ icon: 'bin', title: 'Réceptacle', body: [container.el, spreadBody, binBody, pyrBody] });

  // --- Simulation
  const physics = toggleControl('Simulation physique', 'Chute réaliste sans interpénétration (sinon dispersion simple sur la grille).', () => pile().physics, (v) => app.setPile({ physics: v }));
  const precision = segmented(
    [
      { value: 'rapide', label: 'Rapide', title: 'Grands lots : collisions simplifiées, arrêt dès que le tas est presque immobile' },
      { value: 'precise', label: 'Précise', title: 'Collisions complètes, arrêt quand tous les copeaux sont immobiles (plus lent)' },
    ],
    () => pile().precision,
    (v) => app.setPile({ precision: v }),
    'cf-seg-block',
  );
  const precisionWrap = field('Précision', precision.el);
  const sim = section({ icon: 'gauge', title: 'Simulation', body: [physics.el, precisionWrap] });

  const settings = h('div', {}, [lot.el, recept.el, sim.el]);
  const body = h('div', {}, [empty, settings]);

  // --- Pied : génération à la demande
  const staleNote = h('div', { class: 'cf-stale-note' }, [icon('alert', 'w-3.5 h-3.5 shrink-0'), h('span', { text: 'Réglages modifiés : le tas affiché ne les reflète pas encore.' })]);
  const generate = h('button', { class: 'cf-btn cf-btn-block', title: 'Génère le tas avec les réglages courants (G)', attrs: { type: 'button' } }, [icon('play'), h('span', { text: 'Générer le tas' }), kbd('G')]);
  generate.addEventListener('click', () => app.generatePile());
  const reroll = button({ icon: 'dice', title: 'Nouvelle seed et nouvelle chute (R)', onClick: () => app.rerollSeed() });
  const footer = h('div', { class: 'cf-panel-foot-inner' }, [staleNote, h('div', { class: 'cf-foot-row' }, [generate, reroll])]);

  const refresh = () => {
    const tas = app.state.mode === 'tas';
    empty.hidden = tas;
    settings.hidden = !tas;
    footer.hidden = !tas;
    for (const c of [count, spread, physics, precision, container, slope, binL, binW, binH]) c.refresh();
    precisionWrap.hidden = !pile().physics;
    const inBin = pile().container === 'bac';
    const inPyr = pile().container === 'pyramide';
    spreadBody.hidden = inBin || inPyr;
    binBody.hidden = !inBin;
    pyrBody.hidden = !inPyr;
    const p = app.pyramid;
    pyrInfo.textContent = p ? `Base ${(2 * p.half).toFixed(0)} mm, hauteur ${p.height.toFixed(0)} mm (estimées avant tassement).` : '';
    pyrInfo.hidden = !p;
    const b = app.bin;
    binInfo.textContent = b ? `Bac actuel : ${b.length.toFixed(0)} × ${b.width.toFixed(0)} × ${b.height.toFixed(0)} mm (intérieur), parois de ${b.wall.toFixed(1)} mm.` : '';
    binInfo.hidden = !b;
    staleNote.hidden = !app.stale;
    generate.classList.toggle('cf-btn-primary', app.stale);
  };
  app.on((what) => {
    if (what.has('pile') || what.has('mode') || what.has('stale') || what.has('meshes')) refresh();
  });
  refresh();

  return {
    id: 'tas',
    icon: 'layers',
    label: 'Tas',
    title: 'Tas de copeaux',
    subtitle: 'Lot, réceptacle et chute physique',
    body,
    footer,
  };
}
