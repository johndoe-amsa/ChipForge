import { describe, expect, it } from 'vitest';
import { parsePreset, serializePreset } from '../src/app/presetFile';
import { DEFAULT_PARAMS, PARAM_DEF_MAP, PARAM_DEFS, type NumberDef } from '../src/core/params';
import { DEFAULT_PILE, DEFAULT_SELECTION, composePreset, varyParams } from '../src/core/presets/presets';
import { drawParams, normalizeNumberRange, sanitizeRanges, type RandomSettings } from '../src/core/random';
import { sliderExtent } from '../src/ui/controls';

const base = composePreset(DEFAULT_SELECTION);
const ranged = (mode: RandomSettings['mode'], variability = 0.5): RandomSettings => ({
  mode,
  variability,
  ranges: {
    length: { kind: 'number', min: 15, max: 40 },
    thickness: { kind: 'number', min: 0.08, max: 0.2 },
    burrSide: { kind: 'choice', options: ['A', 'deux'] },
    linkedSegments: { kind: 'number', min: 2, max: 4 },
  },
});

describe('aléatoire par plages', () => {
  it('les valeurs tirées restent dans leurs plages, sur de nombreux copeaux', () => {
    const lengths: number[] = [];
    for (const mode of ['globale', 'ciblee'] as const) {
      for (let i = 0; i < 300; i++) {
        const p = drawParams(base, 11, i, ranged(mode));
        expect(p.length).toBeGreaterThanOrEqual(15);
        expect(p.length).toBeLessThanOrEqual(40);
        expect(p.thickness).toBeGreaterThanOrEqual(0.08);
        expect(p.thickness).toBeLessThanOrEqual(0.2);
        expect(['A', 'deux']).toContain(p.burrSide);
        expect([2, 3, 4]).toContain(p.linkedSegments);
        lengths.push(p.length);
      }
    }
    // Tirage uniforme : toute la plage est couverte, extrémités comprises.
    expect(Math.min(...lengths)).toBeLessThan(16);
    expect(Math.max(...lengths)).toBeGreaterThan(39);
    const lowHalf = lengths.filter((l) => l < 27.5).length / lengths.length;
    expect(lowHalf).toBeGreaterThan(0.4);
    expect(lowHalf).toBeLessThan(0.6);
  });

  it('même seed et mêmes réglages : mêmes valeurs ; autre seed : autres valeurs', () => {
    const s = ranged('ciblee');
    expect(drawParams(base, 5, 3, s)).toEqual(drawParams(base, 5, 3, s));
    expect(drawParams(base, 6, 3, s).length).not.toBe(drawParams(base, 5, 3, s).length);
  });

  it('variation ciblée : rien ne bouge hors des plages', () => {
    const p = drawParams(base, 9, 2, ranged('ciblee'));
    for (const def of PARAM_DEFS) {
      if (['length', 'thickness', 'burrSide', 'linkedSegments'].includes(def.key)) continue;
      expect(p[def.key], def.key).toBe(base[def.key]);
    }
    // Sans plage, le mode ciblé ne change rien.
    expect(drawParams(base, 9, 2, { mode: 'ciblee', variability: 1, ranges: {} })).toEqual(base);
  });

  it('variation globale : les autres paramètres varient comme avant, les plages priment', () => {
    const s = ranged('globale');
    const p = drawParams(base, 9, 2, s);
    const v = varyParams(base, 9, 2, 0.5);
    expect(p.radius).toBe(v.radius);
    expect(p.width).toBe(v.width);
    expect(p.length).not.toBe(v.length);
    // Sans plage, identique à l'ancienne variabilité du tas.
    expect(drawParams(base, 9, 2, { mode: 'globale', variability: 0.5, ranges: {} })).toEqual(v);
  });

  it('ajouter une plage ne change pas le tirage des autres', () => {
    const a = drawParams(base, 3, 0, { mode: 'ciblee', variability: 0, ranges: { length: { kind: 'number', min: 10, max: 20 } } });
    const b = drawParams(base, 3, 0, { mode: 'ciblee', variability: 0, ranges: { length: { kind: 'number', min: 10, max: 20 }, width: { kind: 'number', min: 1, max: 2 } } });
    expect(b.length).toBe(a.length);
  });

  it('bornes : inversées remises dans l’ordre, égales = valeur fixe, limites absolues respectées', () => {
    const def = PARAM_DEF_MAP.length as NumberDef;
    expect(normalizeNumberRange(def, 40, 15)).toEqual({ kind: 'number', min: 15, max: 40 });
    expect(normalizeNumberRange(def, -5, 1e9)).toEqual({ kind: 'number', min: def.hardMin, max: def.hardMax });
    const p = drawParams(base, 1, 0, { mode: 'ciblee', variability: 0, ranges: { length: { kind: 'number', min: 22, max: 22 } } });
    expect(p.length).toBe(22);
  });
});

describe('plages dans les presets personnels', () => {
  it('sont enregistrées puis relues', () => {
    const random = ranged('ciblee', 0.3);
    const text = serializePreset({ name: 'r', selection: DEFAULT_SELECTION, params: DEFAULT_PARAMS, seed: 4, mode: 'unique', pile: DEFAULT_PILE, random, drawn: true, solo: ['length'] });
    const p = parsePreset(text, DEFAULT_PARAMS, DEFAULT_SELECTION);
    expect(p.random).toEqual(random);
    expect(p.drawn).toBe(true);
    expect(p.solo).toEqual(['length']);
  });

  it('un preset v1 reprend la variabilité du tas, sans plage', () => {
    const v1 = JSON.stringify({ format: 'chipforge-preset', version: 1, name: 'ancien', pile: { count: 10, variability: 0.2 } });
    const p = parsePreset(v1, DEFAULT_PARAMS, DEFAULT_SELECTION);
    expect(p.random).toEqual({ mode: 'globale', variability: 0.2, ranges: {} });
    expect(p.drawn).toBe(false);
  });

  it('les plages importées sont validées (clés, types, bornes, options)', () => {
    const r = sanitizeRanges(
      JSON.parse(`{
        "length": { "kind": "number", "min": 50, "max": -3 },
        "thickness": { "min": "0.1", "max": 0.2 },
        "avoidOverlap": { "options": [true] },
        "burrSide": { "options": ["A", "<script>", "B"] },
        "crackSide": { "options": ["x"] },
        "__proto__": { "polluted": true },
        "inconnu": { "min": 1, "max": 2 }
      }`),
    );
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(r).toEqual({
      length: { kind: 'number', min: (PARAM_DEF_MAP.length as NumberDef).hardMin, max: 50 },
      burrSide: { kind: 'choice', options: ['A', 'B'] },
    });
    expect(sanitizeRanges('n’importe quoi')).toEqual({});
  });
});

describe('tirage d’un seul paramètre (sel de la plage)', () => {
  it('changer le sel ne change que ce paramètre', () => {
    const ranges = {
      length: { kind: 'number' as const, min: 15, max: 40 },
      width: { kind: 'number' as const, min: 1, max: 2 },
    };
    for (const mode of ['globale', 'ciblee'] as const) {
      const a = drawParams(base, 8, 0, { mode, variability: 0.5, ranges });
      const b = drawParams(base, 8, 0, { mode, variability: 0.5, ranges: { ...ranges, length: { ...ranges.length, salt: 12345 } } });
      expect(b.length).not.toBe(a.length);
      expect({ ...b, length: 0 }).toEqual({ ...a, length: 0 });
    }
  });

  it('le sel est relu à l’import, et ignoré s’il est invalide', () => {
    expect(sanitizeRanges({ length: { min: 1, max: 2, salt: 77 } }).length).toEqual({ kind: 'number', min: 1, max: 2, salt: 77 });
    expect(sanitizeRanges({ length: { min: 1, max: 2, salt: -3.5 } }).length).toEqual({ kind: 'number', min: 1, max: 2 });
  });
});

describe('curseurs adaptés aux valeurs', () => {
  const twist = PARAM_DEF_MAP.twist as NumberDef; // curseur −60…60 °/mm, saisie jusqu’à ±720
  const span = (d: NumberDef) => d.max - d.min;

  it('une valeur saisie au-delà élargit le curseur, sans dépasser les limites absolues', () => {
    const e = sliderExtent(twist, [500]);
    expect(e.max).toBeGreaterThan(500);
    expect(e.max).toBeLessThanOrEqual(twist.hardMax);
    expect(e.min).toBe(twist.min);
    expect(sliderExtent(twist, [720]).max).toBe(twist.hardMax);
    expect(sliderExtent(twist, [10])).toEqual(twist);
  });

  it('une plage au-delà des bornes garde deux poignées bien distinctes', () => {
    const e = sliderExtent(twist, [700, 720], true);
    expect(e.min).toBeLessThanOrEqual(700);
    expect(e.max).toBeGreaterThanOrEqual(720);
    expect((720 - 700) / span(e)).toBeGreaterThanOrEqual(0.12);
  });

  it('plage étroite sur un curseur logarithmique : zoom autour de la plage', () => {
    const length = PARAM_DEF_MAP.length as NumberDef;
    const e = sliderExtent(length, [20, 22], true);
    expect(e.min).toBeLessThan(20);
    expect(e.max).toBeGreaterThan(22);
    expect(Math.log(22 / 20) / Math.log(e.max / e.min)).toBeGreaterThanOrEqual(0.12);
    // Plage assez large : bornes par défaut conservées.
    expect(sliderExtent(length, [5, 200], true)).toEqual(length);
  });
});
