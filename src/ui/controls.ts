import type { NumberDef } from '../core/params';
import { h, icon } from './dom';

/**
 * Contrôles de paramètres : curseur + champ numérique synchronisés, listes, interrupteurs.
 * Les curseurs logarithmiques couvrent plusieurs décades (longueur, rayon…).
 */

const SLIDER_STEPS = 1000;

function toSlider(def: NumberDef, v: number): number {
  const x = Math.min(def.max, Math.max(def.min, v));
  if (def.log && def.min > 0) {
    return (Math.log(x / def.min) / Math.log(def.max / def.min)) * SLIDER_STEPS;
  }
  return ((x - def.min) / (def.max - def.min)) * SLIDER_STEPS;
}

function fromSlider(def: NumberDef, s: number): number {
  const t = s / SLIDER_STEPS;
  let v = def.log && def.min > 0 ? def.min * Math.pow(def.max / def.min, t) : def.min + (def.max - def.min) * t;
  // Arrondi au pas, avec un pas relatif en mode logarithmique
  const step = def.log ? Math.max(def.step, Math.pow(10, Math.floor(Math.log10(Math.max(v, 1e-9))) - 2)) : def.step;
  v = Math.round(v / step) * step;
  if (def.integer) v = Math.round(v);
  return Number(v.toFixed(6));
}

export function formatValue(def: NumberDef, v: number): string {
  if (def.integer) return String(Math.round(v));
  const decimals = Math.max(0, Math.min(4, -Math.floor(Math.log10(def.step) + 1e-9)));
  const d = def.log && v >= 10 ? Math.min(decimals, 1) : decimals;
  return v.toFixed(d);
}

export interface Control {
  el: HTMLElement;
  refresh(): void;
}

/** Aléatoire d'un paramètre numérique : plage min–max en unités réelles. */
export interface NumberRandom {
  range(): { min: number; max: number } | undefined;
  setRange(r: { min: number; max: number } | undefined): void;
  /** Valeur tirée pour le copeau affiché, si elle diffère de la valeur réglée. */
  drawn(): number | undefined;
  /** Fige la valeur tirée comme valeur fixe. */
  freeze(): void;
  /** Nouveau tirage de ce seul paramètre. */
  reroll(): void;
  /** Aperçu d'un extrême en transparence : actif, disponible (copeau unique), extrême montré. */
  preview(): { on: boolean; available: boolean; side: 'min' | 'max' };
  setPreview(on: boolean): void;
  setPreviewSide(side: 'min' | 'max'): void;
}

/** Aléatoire d'une liste : tirage parmi les options retenues. */
export interface ChoiceRandom {
  options(): string[] | undefined;
  setOptions(o: string[] | undefined): void;
  drawn(): string | undefined;
  freeze(): void;
  reroll(): void;
}

function diceButton(label: string): HTMLButtonElement {
  return h('button', { class: 'cf-dice', attrs: { type: 'button', 'aria-label': `Plage aléatoire : ${label}` } }, [icon('dice', 'w-3.5 h-3.5')]);
}

function chipButton(ic: string, text: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = h('button', { class: 'cf-range-act', title, attrs: { type: 'button' } }, [icon(ic, 'w-3 h-3'), h('span', { text })]);
  b.addEventListener('click', onClick);
  return b;
}

/**
 * Barre d'actions d'un paramètre en plage : Aperçu (fantômes), Tirer (ce seul paramètre),
 * puis la valeur tirée et Figer.
 */
function rangeActions(opts: { preview?: () => void; reroll: () => void; freeze: () => void }) {
  const preview = opts.preview ? chipButton('eye', 'Aperçu', '', opts.preview) : null;
  const reroll = chipButton('shuffle', 'Tirer', 'Nouveau tirage de ce seul paramètre dans sa plage ; les autres réglages ne bougent pas', opts.reroll);
  const text = h('span', { class: 'cf-drawn-v' });
  const freeze = chipButton('check', 'Figer', 'Garder cette valeur comme valeur fixe (retire la plage)', opts.freeze);
  const drawn = h('span', { class: 'cf-drawn' }, [h('span', { class: 'cf-drawn-k', text: 'tiré :' }), text, freeze]);
  const el = h('div', { class: 'cf-range-actions' }, [preview, reroll, drawn]);
  return {
    el,
    preview,
    setDrawn(t: string | undefined) {
      drawn.hidden = t === undefined;
      text.textContent = t ?? '';
    },
  };
}

/**
 * Bornes effectives d'un curseur : celles du paramètre, élargies pour inclure des valeurs
 * saisies au-delà (avec une marge), ou resserrées autour d'une plage trop étroite pour que
 * les deux poignées restent distinctes. Toujours dans les limites absolues du paramètre.
 */
export function sliderExtent(def: NumberDef, vals: number[], zoomRange = false): NumberDef {
  const log = !!def.log && def.min > 0;
  let lo = Math.min(def.min, ...vals);
  let hi = Math.max(def.max, ...vals);
  let zoomed = false;
  if (zoomRange && vals.length === 2 && vals[1] > vals[0]) {
    const [a, b] = vals;
    const frac = log ? Math.log(b / a) / Math.log(hi / lo) : (b - a) / (hi - lo);
    if (frac < 0.12) {
      if (log) {
        const k = Math.pow(b / a, 2);
        lo = a / k;
        hi = b * k;
      } else {
        const w = (b - a) * 2;
        lo = a - w;
        hi = b + w;
      }
      zoomed = true;
    }
  }
  if (!zoomed) {
    // Marge au-delà des bornes par défaut : la poignée n'est pas collée au bout.
    if (hi > def.max) hi = log ? hi * 1.25 : hi + 0.1 * (hi - lo);
    if (lo < def.min) lo = log ? lo / 1.25 : lo - 0.1 * (hi - lo);
  }
  lo = Math.max(def.hardMin, lo);
  hi = Math.min(def.hardMax, hi);
  if (log) lo = Math.max(lo, def.hardMin > 0 ? def.hardMin : 1e-6);
  if (!(hi > lo)) return def;
  return { ...def, min: lo, max: hi };
}

/** Plage par défaut autour d'une valeur : ±10 % de la course du curseur. */
export function defaultRange(def: NumberDef, v: number): { min: number; max: number } {
  const ext = sliderExtent(def, [v]);
  const s = toSlider(ext, v);
  let min = fromSlider(ext, Math.max(0, s - SLIDER_STEPS / 10));
  let max = fromSlider(ext, Math.min(SLIDER_STEPS, s + SLIDER_STEPS / 10));
  if (def.integer && min === max) {
    min = Math.max(def.hardMin, Math.round(v) - 1);
    max = Math.min(def.hardMax, Math.round(v) + 1);
  }
  return { min, max };
}

/** Repère des bornes d'un curseur élargi ou zoomé (masqué aux bornes par défaut). */
function scaleLabels(): { el: HTMLElement; set(def: NumberDef, ext: NumberDef): void } {
  const a = h('span');
  const b = h('span');
  const el = h('div', { class: 'cf-scale' }, [a, b]);
  return {
    el,
    set(def, ext) {
      const changed = ext.min !== def.min || ext.max !== def.max;
      el.hidden = !changed;
      if (changed) {
        a.textContent = formatValue(def, ext.min);
        b.textContent = formatValue(def, ext.max);
        el.title = 'Curseur adapté à vos valeurs (bornes par défaut dépassées ou plage étroite)';
      }
    },
  };
}

/** Vrai tant qu'un pointeur est enfoncé sur l'un des éléments (glisser une poignée). */
function trackDrag(els: HTMLElement[]): () => boolean {
  let down = false;
  for (const e of els) e.addEventListener('pointerdown', () => (down = true));
  window.addEventListener('pointerup', () => (down = false));
  window.addEventListener('pointercancel', () => (down = false));
  return () => down;
}

export function numberControl(
  def: NumberDef,
  get: () => number,
  set: (v: number) => void,
  isModified: () => boolean,
  reset: () => void,
  idOverride?: string,
  random?: NumberRandom,
): Control {
  const id = idOverride ?? `p-${def.key}`;
  const range = h('input', {
    class: 'cf-range',
    attrs: { type: 'range', min: '0', max: String(SLIDER_STEPS), step: '1', 'aria-label': def.label, id },
  });
  const num = h('input', {
    class: 'cf-num',
    attrs: { type: 'number', step: String(def.step), min: String(def.hardMin), max: String(def.hardMax), 'aria-label': `${def.label} (valeur)`, inputmode: 'decimal' },
  });
  const resetBtn = h('button', { class: 'cf-reset', title: 'Revenir à la valeur du preset', attrs: { type: 'button' } }, [icon('reset', 'w-3 h-3')]);
  const label = h('label', { class: 'cf-label', text: def.label, title: def.hint, attrs: { for: id } });
  const unit = h('span', { class: 'cf-unit', text: def.unit ?? '' });
  const numWrap = h('div', { class: 'cf-num-wrap' }, [num, unit]);
  const head = h('div', { class: 'cf-row-head' }, [label, resetBtn, numWrap]);
  const scale = scaleLabels();
  const el = h('div', { class: 'cf-row', title: def.hint, attrs: { 'data-label': def.label } }, [head, range, scale.el]);

  // Curseur simple : bornes élargies si la valeur saisie les dépasse (figées pendant le glisser).
  let ext = def;
  const dragging = trackDrag([range]);
  const singleExtent = () => {
    if (!dragging()) ext = sliderExtent(def, [get()]);
    return ext;
  };

  // --- Mode plage (aléatoire ciblé)
  let rangeRefresh = () => {};
  if (random) {
    const dice = diceButton(def.label);
    head.insertBefore(dice, resetBtn);
    const numInput = (which: string) =>
      h('input', { class: 'cf-num', attrs: { type: 'number', step: String(def.step), min: String(def.hardMin), max: String(def.hardMax), 'aria-label': `${def.label} (${which})`, inputmode: 'decimal' } });
    const minIn = numInput('minimum');
    const maxIn = numInput('maximum');
    const rangeFields = h('div', { class: 'cf-range-fields' }, [
      h('div', { class: 'cf-num-wrap cf-num-sm' }, [minIn]),
      h('span', { class: 'cf-range-dash', text: '–' }),
      h('div', { class: 'cf-num-wrap cf-num-sm' }, [maxIn]),
      h('span', { class: 'cf-unit', text: def.unit ?? '' }),
    ]);
    head.append(rangeFields);
    // Curseur à deux poignées (minimum en bleu, maximum en orange, comme les fantômes de l'aperçu)
    const lo = h('input', { class: 'cf-dual-input cf-dual-lo', attrs: { type: 'range', min: '0', max: String(SLIDER_STEPS), step: '1', 'aria-label': `${def.label} (minimum)` } });
    const hi = h('input', { class: 'cf-dual-input cf-dual-hi', attrs: { type: 'range', min: '0', max: String(SLIDER_STEPS), step: '1', 'aria-label': `${def.label} (maximum)` } });
    const fill = h('div', { class: 'cf-dual-fill' });
    const dual = h('div', { class: 'cf-dual' }, [h('div', { class: 'cf-dual-track' }), fill, lo, hi]);
    const dualScale = scaleLabels();
    const actions = rangeActions({
      preview: () => random.setPreview(!random.preview().on),
      reroll: () => random.reroll(),
      freeze: () => random.freeze(),
    });
    el.append(dual, dualScale.el, actions.el);
    let dext = def;
    const dualDragging = trackDrag([lo, hi]);

    const commitRange = (min: number, max: number) => random.setRange({ min, max });
    dice.addEventListener('click', () => {
      const had = !!random.range();
      random.setRange(had ? undefined : defaultRange(def, get()));
      // Nouvelle plage : l'aperçu en transparence aide à choisir les bornes.
      if (!had && random.preview().available) random.setPreview(true);
      refresh();
    });
    const onSlide = (which: 'lo' | 'hi') => {
      let a = Number(lo.value);
      let b = Number(hi.value);
      // Les poignées ne se croisent pas.
      if (a > b) {
        if (which === 'lo') a = b;
        else b = a;
        lo.value = String(a);
        hi.value = String(b);
      }
      commitRange(fromSlider(dext, a), fromSlider(dext, b));
      rangeRefresh();
    };
    lo.addEventListener('input', () => onSlide('lo'));
    hi.addEventListener('input', () => onSlide('hi'));
    // Fin du glisser : les bornes du curseur s'adaptent à la nouvelle plage.
    for (const inp of [lo, hi]) inp.addEventListener('change', () => queueMicrotask(() => rangeRefresh()));
    // L'aperçu montre l'extrême de la dernière poignée (ou du dernier champ) touché.
    for (const [els, side] of [[[lo, minIn], 'min'], [[hi, maxIn], 'max']] as const) {
      for (const e of els) {
        e.addEventListener('pointerdown', () => random.setPreviewSide(side));
        e.addEventListener('focus', () => random.setPreviewSide(side));
      }
    }
    const commitFields = () => {
      const a = Number(minIn.value.replace(',', '.'));
      const b = Number(maxIn.value.replace(',', '.'));
      const r = random.range();
      if (!r) return;
      commitRange(Number.isFinite(a) ? a : r.min, Number.isFinite(b) ? b : r.max);
      rangeRefresh();
    };
    for (const inp of [minIn, maxIn]) {
      inp.addEventListener('change', commitFields);
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          commitFields();
          inp.blur();
        }
      });
      inp.addEventListener('blur', () => rangeRefresh());
    }

    rangeRefresh = () => {
      const r = random.range();
      el.classList.toggle('is-ranged', !!r);
      dice.classList.toggle('is-active', !!r);
      dice.title = r ? 'Retirer la plage : revenir à une valeur fixe' : 'Faire varier ce paramètre dans une plage (aléatoire)';
      dice.setAttribute('aria-pressed', String(!!r));
      numWrap.hidden = !!r;
      range.hidden = !!r;
      rangeFields.hidden = !r;
      dual.hidden = !r;
      actions.el.hidden = !r;
      if (r) {
        if (!dualDragging()) dext = sliderExtent(def, [r.min, r.max], true);
        dualScale.set(def, dext);
        const a = toSlider(dext, r.min);
        const b = toSlider(dext, r.max);
        lo.value = String(a);
        hi.value = String(b);
        fill.style.left = `${(a / SLIDER_STEPS) * 100}%`;
        fill.style.right = `${100 - (b / SLIDER_STEPS) * 100}%`;
        if (document.activeElement !== minIn) minIn.value = formatValue(def, r.min);
        if (document.activeElement !== maxIn) maxIn.value = formatValue(def, r.max);
      } else dualScale.el.hidden = true;
      scale.el.hidden = scale.el.hidden || !!r;
      const pv = random.preview();
      el.classList.toggle('is-previewing', !!r && pv.on);
      el.classList.toggle('is-pv-min', !!r && pv.on && pv.side === 'min');
      el.classList.toggle('is-pv-max', !!r && pv.on && pv.side === 'max');
      if (actions.preview) {
        actions.preview.classList.toggle('is-active', pv.on);
        actions.preview.setAttribute('aria-pressed', String(pv.on));
        actions.preview.disabled = !pv.available;
        actions.preview.title = pv.available
          ? pv.on
            ? 'Masquer l’aperçu des extrêmes'
            : 'Montrer en transparence le copeau au minimum (bleu) ou au maximum (orange) de la plage, selon la poignée touchée'
          : 'Aperçu disponible en mode copeau unique';
      }
      const d = random.drawn();
      actions.setDrawn(!r || d === undefined ? undefined : `${formatValue(def, d)}${def.unit ? ` ${def.unit}` : ''}`);
    };
  }

  const refresh = () => {
    const v = get();
    const e = singleExtent();
    scale.set(def, e);
    range.value = String(toSlider(e, v));
    if (document.activeElement !== num) num.value = formatValue(def, v);
    el.classList.toggle('is-modified', isModified());
    rangeRefresh();
  };

  range.addEventListener('input', () => {
    set(fromSlider(ext, Number(range.value)));
    num.value = formatValue(def, get());
    el.classList.toggle('is-modified', isModified());
  });
  range.addEventListener('change', () => queueMicrotask(refresh));
  const commit = () => {
    const v = Number(num.value.replace(',', '.'));
    if (!Number.isFinite(v)) {
      refresh();
      return;
    }
    set(v);
    refresh();
  };
  num.addEventListener('change', commit);
  num.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      commit();
      num.blur();
    }
  });
  num.addEventListener('blur', () => refresh());
  resetBtn.addEventListener('click', () => {
    reset();
    refresh();
  });
  label.addEventListener('dblclick', () => {
    reset();
    refresh();
  });
  refresh();
  return { el, refresh };
}

export function selectControl(
  label: string,
  hint: string,
  options: { value: string; label: string }[],
  get: () => string,
  set: (v: string) => void,
  isModified: () => boolean = () => false,
  random?: ChoiceRandom,
): Control {
  const sel = h('select', { class: 'cf-select', attrs: { 'aria-label': label } }, options.map((o) => h('option', { text: o.label, attrs: { value: o.value } })));
  const lab = h('span', { class: 'cf-label', text: label });
  const head = h('div', { class: 'cf-row-head' }, [lab, sel]);
  const el = h('div', { class: 'cf-row cf-row-select', title: hint, attrs: { 'data-label': label } }, [head]);

  let rangeRefresh = () => {};
  if (random) {
    const dice = diceButton(label);
    head.insertBefore(dice, sel);
    const chips = options.map((o) => {
      const b = h('button', { class: 'cf-choice', text: o.label, attrs: { type: 'button' } });
      b.addEventListener('click', () => {
        const cur = random.options() ?? [];
        const next = cur.includes(o.value) ? cur.filter((v) => v !== o.value) : [...cur, o.value];
        // Au moins une option reste retenue.
        if (next.length) random.setOptions(next);
        rangeRefresh();
      });
      return { o, b };
    });
    const chipRow = h('div', { class: 'cf-choices', attrs: { role: 'group', 'aria-label': `${label} : options tirées` } }, chips.map((c) => c.b));
    const actions = rangeActions({ reroll: () => random.reroll(), freeze: () => random.freeze() });
    el.append(chipRow, actions.el);
    dice.addEventListener('click', () => {
      random.setOptions(random.options() ? undefined : options.map((o) => o.value));
      rangeRefresh();
    });
    rangeRefresh = () => {
      const r = random.options();
      el.classList.toggle('is-ranged', !!r);
      dice.classList.toggle('is-active', !!r);
      dice.title = r ? 'Retirer l’aléatoire : revenir à une valeur fixe' : 'Tirer ce paramètre parmi plusieurs options (aléatoire ciblé)';
      dice.setAttribute('aria-pressed', String(!!r));
      sel.hidden = !!r;
      chipRow.hidden = !r;
      for (const c of chips) {
        const on = !!r?.includes(c.o.value);
        c.b.classList.toggle('is-active', on);
        c.b.setAttribute('aria-pressed', String(on));
      }
      actions.el.hidden = !r;
      const d = random.drawn();
      actions.setDrawn(!r || d === undefined ? undefined : (options.find((o) => o.value === d)?.label ?? d));
    };
  }

  const refresh = () => {
    sel.value = get();
    el.classList.toggle('is-modified', isModified());
    rangeRefresh();
  };
  sel.addEventListener('change', () => {
    set(sel.value);
    refresh();
  });
  refresh();
  return { el, refresh };
}

export function toggleControl(label: string, hint: string, get: () => boolean, set: (v: boolean) => void): Control {
  const input = h('input', { class: 'cf-switch', attrs: { type: 'checkbox', role: 'switch', 'aria-label': label } });
  const el = h('label', { class: 'cf-row cf-row-inline cursor-pointer', title: hint, attrs: { 'data-label': label } }, [h('span', { class: 'cf-label', text: label }), input]);
  const refresh = () => {
    input.checked = get();
  };
  input.addEventListener('change', () => set(input.checked));
  refresh();
  return { el, refresh };
}

export interface SegOption<T extends string> {
  value: T;
  label: string;
  title?: string;
  icon?: string;
}

export function segmented<T extends string>(options: SegOption<T>[], get: () => T, set: (v: T) => void, cls = ''): Control {
  const buttons = options.map((o) =>
    h('button', { class: 'cf-seg-btn', title: o.title ?? o.label, attrs: { type: 'button', 'data-value': o.value } }, [
      o.icon ? icon(o.icon, 'w-3.5 h-3.5 shrink-0') : null,
      h('span', { class: 'cf-seg-text', text: o.label }),
    ]),
  );
  const el = h('div', { class: `cf-seg ${cls}`, attrs: { role: 'group' } }, buttons);
  const refresh = () => {
    const v = get();
    buttons.forEach((b, i) => {
      const on = options[i].value === v;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    });
  };
  buttons.forEach((b, i) =>
    b.addEventListener('click', () => {
      set(options[i].value);
      refresh();
    }),
  );
  refresh();
  return { el, refresh };
}
