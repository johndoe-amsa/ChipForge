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
}

/** Aléatoire d'une liste : tirage parmi les options retenues. */
export interface ChoiceRandom {
  options(): string[] | undefined;
  setOptions(o: string[] | undefined): void;
  drawn(): string | undefined;
  freeze(): void;
}

function diceButton(label: string): HTMLButtonElement {
  return h('button', { class: 'cf-dice', attrs: { type: 'button', 'aria-label': `Plage aléatoire : ${label}` } }, [icon('dice', 'w-3.5 h-3.5')]);
}

/** Ligne « tiré : valeur » sous un paramètre en plage, avec bouton Figer. */
function drawnLine(onFreeze: () => void): { el: HTMLElement; set(text: string | undefined, canFreeze: boolean): void } {
  const text = h('span', { class: 'cf-drawn-v' });
  const freeze = h('button', { class: 'cf-drawn-freeze', title: 'Garder cette valeur comme valeur fixe (retire la plage)', attrs: { type: 'button' } }, [icon('check', 'w-3 h-3'), h('span', { text: 'Figer' })]);
  freeze.addEventListener('click', onFreeze);
  const el = h('div', { class: 'cf-drawn' }, [icon('dice', 'w-3 h-3 shrink-0'), h('span', { text: 'tiré :' }), text, freeze]);
  return {
    el,
    set(t, canFreeze) {
      el.hidden = t === undefined;
      text.textContent = t ?? '';
      freeze.hidden = !canFreeze;
    },
  };
}

/** Plage par défaut autour d'une valeur : ±10 % de la course du curseur. */
export function defaultRange(def: NumberDef, v: number): { min: number; max: number } {
  const s = toSlider(def, v);
  let min = fromSlider(def, Math.max(0, s - SLIDER_STEPS / 10));
  let max = fromSlider(def, Math.min(SLIDER_STEPS, s + SLIDER_STEPS / 10));
  if (def.integer && min === max) {
    min = Math.max(def.min, Math.round(v) - 1);
    max = Math.min(def.max, Math.round(v) + 1);
  }
  return { min, max };
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
  const el = h('div', { class: 'cf-row', title: def.hint, attrs: { 'data-label': def.label } }, [head, range]);

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
    // Curseur à deux poignées
    const lo = h('input', { class: 'cf-dual-input', attrs: { type: 'range', min: '0', max: String(SLIDER_STEPS), step: '1', 'aria-label': `${def.label} (minimum)` } });
    const hi = h('input', { class: 'cf-dual-input', attrs: { type: 'range', min: '0', max: String(SLIDER_STEPS), step: '1', 'aria-label': `${def.label} (maximum)` } });
    const fill = h('div', { class: 'cf-dual-fill' });
    const dual = h('div', { class: 'cf-dual' }, [h('div', { class: 'cf-dual-track' }), fill, lo, hi]);
    el.append(dual);
    const drawn = drawnLine(() => random.freeze());
    el.append(drawn.el);

    const commitRange = (min: number, max: number) => random.setRange({ min, max });
    dice.addEventListener('click', () => {
      random.setRange(random.range() ? undefined : defaultRange(def, get()));
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
      commitRange(fromSlider(def, a), fromSlider(def, b));
      rangeRefresh();
    };
    lo.addEventListener('input', () => onSlide('lo'));
    hi.addEventListener('input', () => onSlide('hi'));
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
      dice.title = r ? 'Retirer la plage : revenir à une valeur fixe' : 'Faire varier ce paramètre dans une plage (aléatoire ciblé)';
      dice.setAttribute('aria-pressed', String(!!r));
      numWrap.hidden = !!r;
      range.hidden = !!r;
      rangeFields.hidden = !r;
      dual.hidden = !r;
      if (r) {
        const a = toSlider(def, r.min);
        const b = toSlider(def, r.max);
        if (document.activeElement !== lo) lo.value = String(a);
        if (document.activeElement !== hi) hi.value = String(b);
        fill.style.left = `${(a / SLIDER_STEPS) * 100}%`;
        fill.style.right = `${100 - (b / SLIDER_STEPS) * 100}%`;
        if (document.activeElement !== minIn) minIn.value = formatValue(def, r.min);
        if (document.activeElement !== maxIn) maxIn.value = formatValue(def, r.max);
      }
      const d = random.drawn();
      drawn.set(!r || d === undefined ? undefined : `${formatValue(def, d)}${def.unit ? ` ${def.unit}` : ''}`, true);
    };
  }

  const refresh = () => {
    const v = get();
    range.value = String(toSlider(def, v));
    if (document.activeElement !== num) num.value = formatValue(def, v);
    el.classList.toggle('is-modified', isModified());
    rangeRefresh();
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
    const drawn = drawnLine(() => random.freeze());
    el.append(chipRow, drawn.el);
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
      const d = random.drawn();
      drawn.set(!r || d === undefined ? undefined : (options.find((o) => o.value === d)?.label ?? d), true);
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
