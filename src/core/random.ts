/**
 * Aléatoire des paramètres : variation globale autour du preset et plages ciblées.
 *
 *  - Variation « globale » : tous les paramètres varient autour du preset (varyParams),
 *    selon la variabilité.
 *  - Variation « ciblée » : seuls les paramètres dotés d'une plage varient.
 *  - Dans les deux cas, un paramètre en plage est tiré uniformément dans sa plage
 *    (bornes en unités réelles) ou parmi les options retenues pour une liste.
 *
 * Tout dérive de la seed et de l'indice du copeau : même seed + mêmes réglages = mêmes valeurs.
 * Chaque paramètre en plage a son propre flux aléatoire, si bien qu'ajouter ou retirer une
 * plage ne change pas le tirage des autres.
 */

import { PARAM_DEF_MAP, PARAM_DEFS, type ChipParams, type NumberDef, type ParamDef, type ParamKey } from './params';
import { varyParams } from './presets/presets';
import { hashSeed, Rng } from './rng';

export type VariationMode = 'globale' | 'ciblee';

export interface NumberRange {
  kind: 'number';
  min: number;
  max: number;
  /** Sel du tirage : le changer retire ce seul paramètre, sans toucher aux autres. */
  salt?: number;
}

export interface ChoiceRange {
  kind: 'choice';
  options: string[];
  salt?: number;
}

export type ParamRange = NumberRange | ChoiceRange;
export type ParamRanges = Partial<Record<ParamKey, ParamRange>>;

export interface RandomSettings {
  mode: VariationMode;
  /** Variation globale : 0 = aucune, 1 = forte dispersion autour du preset. */
  variability: number;
  ranges: ParamRanges;
}

export const DEFAULT_RANDOM: RandomSettings = { mode: 'globale', variability: 0.5, ranges: {} };

/** Paramètres pouvant recevoir une plage (les interrupteurs restent fixes). */
export function isRandomizable(def: ParamDef): boolean {
  return def.kind === 'number' || def.kind === 'select';
}

/** Plage numérique bornée aux limites absolues du paramètre, bornes remises dans l'ordre. */
export function normalizeNumberRange(def: NumberDef, a: number, b: number): NumberRange {
  const clamp = (v: number) => {
    const x = Math.min(def.hardMax, Math.max(def.hardMin, v));
    return def.integer ? Math.round(x) : x;
  };
  const lo = clamp(Math.min(a, b));
  const hi = clamp(Math.max(a, b));
  return { kind: 'number', min: lo, max: hi };
}

/** Options retenues valides, dans l'ordre de la liste ; null si aucune. */
export function normalizeChoiceRange(def: ParamDef, options: readonly unknown[]): ChoiceRange | null {
  if (def.kind !== 'select') return null;
  const kept = def.options.map((o) => o.value).filter((v) => options.includes(v));
  return kept.length ? { kind: 'choice', options: kept } : null;
}

function cleanSalt(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 4294967296 ? v : undefined;
}

/** Valide des plages d'origine non fiable (import de preset) : clés et valeurs connues uniquement. */
export function sanitizeRanges(input: unknown): ParamRanges {
  const out: ParamRanges = {};
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return out;
  const src = input as Record<string, unknown>;
  for (const def of PARAM_DEFS) {
    if (!isRandomizable(def) || !Object.prototype.hasOwnProperty.call(src, def.key)) continue;
    const r = src[def.key];
    if (typeof r !== 'object' || r === null || Array.isArray(r)) continue;
    const o = r as Record<string, unknown>;
    if (def.kind === 'number') {
      const { min, max } = o;
      if (typeof min === 'number' && typeof max === 'number' && Number.isFinite(min) && Number.isFinite(max)) out[def.key] = withSalt(normalizeNumberRange(def, min, max), cleanSalt(o.salt));
    } else if (Array.isArray(o.options)) {
      const c = normalizeChoiceRange(def, o.options);
      if (c) out[def.key] = withSalt(c, cleanSalt(o.salt));
    }
  }
  return out;
}

export function withSalt<R extends ParamRange>(r: R, salt: number | undefined): R {
  return salt ? { ...r, salt } : r;
}

/** Tire une valeur dans une plage. */
function drawInRange(def: ParamDef, range: ParamRange, r: Rng): number | string | undefined {
  if (range.kind === 'number' && def.kind === 'number') {
    if (range.max <= range.min) return range.min;
    return def.integer ? r.int(Math.ceil(range.min), Math.floor(range.max)) : r.range(range.min, range.max);
  }
  if (range.kind === 'choice' && def.kind === 'select' && range.options.length) return r.pick(range.options);
  return undefined;
}

/** Paramètres du copeau `index`, tirés selon les réglages d'aléatoire. */
export function drawParams(base: ChipParams, seed: number, index: number, settings: RandomSettings): ChipParams {
  const p: ChipParams = settings.mode === 'globale' ? varyParams(base, seed, index, settings.variability) : { ...base };
  const out = p as unknown as Record<string, number | string | boolean>;
  for (const [key, range] of Object.entries(settings.ranges) as [ParamKey, ParamRange][]) {
    const def = PARAM_DEF_MAP[key];
    if (!def || !range) continue;
    const v = drawInRange(def, range, new Rng(hashSeed(seed, index, `plage:${key}`, range.salt ?? 0)));
    if (v !== undefined) out[key] = v;
  }
  return p;
}

/** Nombre de plages actives. */
export function rangeCount(ranges: ParamRanges): number {
  return Object.values(ranges).filter(Boolean).length;
}
