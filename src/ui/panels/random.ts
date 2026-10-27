import type { App } from '../../app/app';
import { PARAM_DEF_MAP, type NumberDef, type ParamKey } from '../../core/params';
import { rangeCount, type ParamRange } from '../../core/random';
import { formatValue, numberControl, segmented } from '../controls';
import { h, icon } from '../dom';
import { button, kbd, section } from '../widgets';
import type { PanelDef } from './panel';
import { SECTION_ICON } from './params';

const MODE_HINT = {
  globale: 'Tous les paramètres varient autour du preset selon la variabilité ; les paramètres en plage suivent leur plage.',
  ciblee: 'Seuls les paramètres en plage varient ; tous les autres restent exactement à la valeur réglée.',
};

function fmt(def: NumberDef, v: number): string {
  return `${formatValue(def, v)}${def.unit ? ` ${def.unit}` : ''}`;
}

function optionLabel(key: ParamKey, value: string): string {
  const def = PARAM_DEF_MAP[key];
  return def.kind === 'select' ? (def.options.find((o) => o.value === value)?.label ?? value) : value;
}

function describeRange(key: ParamKey, r: ParamRange): string {
  const def = PARAM_DEF_MAP[key];
  if (r.kind === 'number' && def.kind === 'number') return r.min === r.max ? fmt(def, r.min) : `${formatValue(def, r.min)} – ${fmt(def, r.max)}`;
  if (r.kind === 'choice') return r.options.map((o) => optionLabel(key, o)).join(', ');
  return '';
}

/**
 * Onglet Aléatoire : mode de variation (globale / ciblée), variabilité, tirage du copeau
 * unique, et récapitulatif des plages actives avec les valeurs obtenues.
 */
export function buildRandomPanel(app: App, locate: (key: ParamKey) => void): PanelDef {
  // --- Variation
  const mode = segmented(
    [
      { value: 'globale', label: 'Globale', icon: 'waves', title: MODE_HINT.globale },
      { value: 'ciblee', label: 'Ciblée', icon: 'frame', title: MODE_HINT.ciblee },
    ],
    () => app.state.random.mode,
    (v) => app.setRandom({ mode: v }),
    'cf-seg-block',
  );
  const modeHint = h('p', { class: 'cf-hint cf-hint-after' });
  const defVar: NumberDef = {
    kind: 'number',
    key: 'length',
    label: 'Variabilité',
    section: 'macro',
    hint: 'Dispersion de tous les paramètres autour du preset (variation globale).',
    unit: '%',
    min: 0,
    max: 100,
    step: 1,
    hardMin: 0,
    hardMax: 100,
    integer: true,
  };
  const variab = numberControl(
    defVar,
    () => Math.round(app.state.random.variability * 100),
    (v) => app.setRandom({ variability: Math.min(100, Math.max(0, v)) / 100 }),
    () => app.state.random.variability !== 0.5,
    () => app.setRandom({ variability: 0.5 }),
    'random-variability',
  );
  const variation = section({ icon: 'waves', title: 'Variation', body: [mode.el, modeHint, variab.el] });

  // --- Tirage
  const drawState = h('div', { class: 'cf-draw-state' });
  const drawBtn = h('button', { class: 'cf-btn cf-btn-primary cf-btn-block', title: 'Nouvelle seed : nouveau tirage (R)', attrs: { type: 'button' } }, [icon('dice'), h('span'), kbd('R')]);
  drawBtn.addEventListener('click', () => app.rerollSeed());
  const adopt = button({ label: 'Adopter', icon: 'check', size: 'sm', title: 'Les valeurs tirées deviennent les valeurs réglées (le copeau affiché ne change pas)', onClick: () => app.adoptDraw() });
  const back = button({ label: 'Valeurs réglées', icon: 'reset', size: 'sm', variant: 'ghost', title: 'Afficher le copeau aux valeurs réglées, sans tirage', onClick: () => app.clearDraw() });
  const drawActions = h('div', { class: 'cf-foot-row' }, [adopt, back]);
  const tirage = section({ icon: 'dice', title: 'Tirage', body: [drawState, drawBtn, drawActions] });

  // --- Plages actives
  const list = h('div', { class: 'cf-ranges' });
  const empty = h('div', { class: 'cf-ranges-empty' }, [
    icon('dice', 'w-5 h-5'),
    h('p', { text: 'Aucune plage. Cliquez sur l’icône 🎲 à côté d’un paramètre (Géométrie, Surface, Couleurs) pour le faire varier entre deux valeurs.' }),
  ]);
  const clearAll = button({ label: 'Tout effacer', icon: 'close', size: 'sm', variant: 'ghost', title: 'Retirer toutes les plages', onClick: () => app.clearRanges() });
  const plages = section({ icon: 'sliders', title: 'Plages', body: [empty, list, h('div', { class: 'cf-ranges-foot' }, [clearAll])] });

  const body = h('div', {}, [variation.el, tirage.el, plages.el]);

  const renderList = () => {
    const entries = (Object.entries(app.state.random.ranges) as [ParamKey, ParamRange][]).filter(([, r]) => r);
    const tas = app.state.mode === 'tas';
    list.replaceChildren(
      ...entries.map(([key, r]) => {
        const def = PARAM_DEF_MAP[key];
        // Valeurs obtenues : min / max du lot (tas) ou valeur tirée (copeau unique).
        let got = '';
        if (tas && !app.stale) {
          const ext = app.drawnExtent(key);
          if (ext && 'min' in ext && def.kind === 'number') got = `obtenu : ${formatValue(def, ext.min)} – ${fmt(def, ext.max)}`;
          else if (ext && 'values' in ext) got = `obtenu : ${ext.values.map((v) => optionLabel(key, v)).join(', ')}`;
        } else if (!tas && app.state.drawn) {
          const d = app.drawnParams[0]?.[key];
          if (typeof d === 'number' && def.kind === 'number') got = `tiré : ${fmt(def, d)}`;
          else if (typeof d === 'string') got = `tiré : ${optionLabel(key, d)}`;
        }
        const go = h('button', { class: 'cf-range-item-main', title: 'Afficher ce paramètre', attrs: { type: 'button' } }, [
          icon(SECTION_ICON[def.section], 'w-4 h-4 shrink-0'),
          h('span', { class: 'cf-range-item-text' }, [
            h('span', { class: 'cf-range-item-name', text: def.label }),
            h('span', { class: 'cf-range-item-range', text: describeRange(key, r) }),
            got ? h('span', { class: 'cf-range-item-got', text: got }) : null,
          ]),
        ]);
        go.addEventListener('click', () => locate(key));
        const rm = h('button', { class: 'cf-range-item-rm', title: 'Retirer la plage', attrs: { type: 'button', 'aria-label': `Retirer la plage : ${def.label}` } }, [icon('close', 'w-3.5 h-3.5')]);
        rm.addEventListener('click', () => app.setRange(key, undefined));
        return h('div', { class: 'cf-range-item' }, [go, rm]);
      }),
    );
    const n = entries.length;
    empty.hidden = n > 0;
    clearAll.hidden = n === 0;
    plages.setCount(n);
  };

  const refresh = () => {
    const r = app.state.random;
    const tas = app.state.mode === 'tas';
    mode.refresh();
    variab.refresh();
    modeHint.textContent = MODE_HINT[r.mode];
    variab.el.hidden = r.mode !== 'globale';
    const n = rangeCount(r.ranges);
    if (tas) {
      drawState.textContent = app.stale ? 'Réglages modifiés : générez le tas pour appliquer les tirages.' : `Chaque copeau du tas est tiré (seed ${app.state.seed}).`;
    } else {
      drawState.textContent = app.state.drawn
        ? `Copeau tiré (seed ${app.state.seed}).`
        : r.mode === 'ciblee' && n === 0
          ? 'Aucune plage : un tirage ciblé ne changerait que le bruit de la seed.'
          : 'Copeau aux valeurs réglées. R tire un copeau selon ces réglages.';
    }
    drawState.classList.toggle('is-active', tas || app.state.drawn);
    (drawBtn.children[1] as HTMLElement).textContent = tas ? 'Nouvelle chute' : 'Nouveau tirage';
    drawActions.hidden = tas;
    adopt.disabled = !app.state.drawn;
    back.disabled = !app.state.drawn;
    renderList();
  };
  app.on((what) => {
    if (what.has('random') || what.has('meshes') || what.has('mode') || what.has('seed') || what.has('stale') || what.has('preset')) refresh();
  });
  refresh();

  return {
    id: 'aleatoire',
    icon: 'dice',
    label: 'Aléatoire',
    title: 'Aléatoire',
    subtitle: 'Variation globale ou plages ciblées',
    body,
    modified: () => rangeCount(app.state.random.ranges),
  };
}
