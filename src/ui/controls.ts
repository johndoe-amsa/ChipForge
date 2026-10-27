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

export function numberControl(
  def: NumberDef,
  get: () => number,
  set: (v: number) => void,
  isModified: () => boolean,
  reset: () => void,
  idOverride?: string,
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
  const el = h('div', { class: 'cf-row', title: def.hint, attrs: { 'data-label': def.label } }, [
    h('div', { class: 'cf-row-head' }, [label, resetBtn, h('div', { class: 'cf-num-wrap' }, [num, unit])]),
    range,
  ]);

  const refresh = () => {
    const v = get();
    range.value = String(toSlider(def, v));
    if (document.activeElement !== num) num.value = formatValue(def, v);
    el.classList.toggle('is-modified', isModified());
  };

  range.addEventListener('input', () => {
    set(fromSlider(def, Number(range.value)));
    num.value = formatValue(def, get());
    el.classList.toggle('is-modified', isModified());
  });
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
): Control {
  const sel = h('select', { class: 'cf-select', attrs: { 'aria-label': label } }, options.map((o) => h('option', { text: o.label, attrs: { value: o.value } })));
  const el = h('div', { class: 'cf-row cf-row-inline', title: hint, attrs: { 'data-label': label } }, [h('span', { class: 'cf-label', text: label }), sel]);
  const refresh = () => {
    sel.value = get();
    el.classList.toggle('is-modified', isModified());
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
