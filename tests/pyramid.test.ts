import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, PREVIEW_QUALITY, sanitizeParams } from '../src/core/params';
import { buildChipGrid } from '../src/core/geometry/chip';
import { gridToMesh } from '../src/core/geometry/mesh';
import { PILE_BULK_FACTOR, PYRAMID_SLOPE_RANGE, pyramidGeometry, pyramidPoint } from '../src/core/pyramid';
import { Rng, hashSeed } from '../src/core/rng';
import { DEFAULT_PILE, DEFAULT_SELECTION, MAX_PILE_COUNT, composePreset, varyParams } from '../src/core/presets/presets';
import { parsePreset, serializePreset } from '../src/app/presetFile';
import { scatterPile, simulatePile } from '../src/physics/pile';
import type { RigidTransform } from '../src/core/export/transform';

describe('tas en pyramide : géométrie', () => {
  it('a le volume des copeaux tassés et la pente demandée', () => {
    const g = pyramidGeometry([100, 200, 300], 40);
    expect(g.height / g.half).toBeCloseTo(Math.tan((40 * Math.PI) / 180), 9);
    expect((4 / 3) * g.half * g.half * g.height).toBeCloseTo(PILE_BULK_FACTOR * 600, 6);
    expect(pyramidGeometry([1], 89).slope).toBe(PYRAMID_SLOPE_RANGE[1]);
    expect(pyramidGeometry([1], Number.NaN).slope).toBe(40);
  });

  it('tire des points dans le volume, plus nombreux au centre', () => {
    const g = pyramidGeometry([1000], 45);
    const rng = new Rng(7);
    let center = 0;
    for (let i = 0; i < 4000; i++) {
      const [x, y, z] = pyramidPoint(rng, g);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(Math.max(Math.abs(x), Math.abs(z))).toBeLessThanOrEqual(g.half * (1 - y / g.height) + 1e-9);
      if (Math.max(Math.abs(x), Math.abs(z)) < g.half / 2) center++;
    }
    // Volume au-dessus du carré central de demi-côté a/2 : la moitié de la pyramide
    // (alors que ce carré ne couvre qu'un quart de la base).
    expect(center / 4000).toBeGreaterThan(0.45);
    expect(center / 4000).toBeLessThan(0.55);
  });
});

describe('tas en pyramide : chute physique', () => {
  (globalThis as { requestAnimationFrame?: (f: () => void) => unknown }).requestAnimationFrame ??= (f) => setTimeout(f, 0);
  const base = composePreset(DEFAULT_SELECTION);
  const meshes = Array.from({ length: 40 }, (_, i) =>
    gridToMesh(buildChipGrid(sanitizeParams(varyParams(base, 1, i, 0.5)), hashSeed(1, i), { ...PREVIEW_QUALITY, maxVertices: 3000 })),
  );
  /** Hauteur du tas rapportée à son demi-côté (90 % des copeaux). */
  const aspect = (tr: RigidTransform[]) => {
    const top = Math.max(...tr.map((t) => t.t[1]));
    const d = tr.map((t) => Math.max(Math.abs(t.t[0]), Math.abs(t.t[2]))).sort((a, b) => a - b);
    return top / d[Math.floor(0.9 * d.length)];
  };

  it('forme une pyramide nettement plus haute qu’un tas versé, de façon déterministe', async () => {
    const pyr = await simulatePile(meshes, { seed: 3, spread: 0, pyramid: 45 });
    const heap = await simulatePile(meshes, { seed: 3, spread: 0 });
    expect(aspect(pyr)).toBeGreaterThan(0.6);
    expect(aspect(pyr)).toBeGreaterThan(2 * aspect(heap));
    // Tout repose sur la grille ou sur d'autres copeaux (rien sous la grille).
    for (const t of pyr) expect(t.t[1]).toBeGreaterThan(-1e-3);
    const again = await simulatePile(meshes, { seed: 3, spread: 0, pyramid: 45 });
    expect(again).toEqual(pyr);
  }, 120000);

  it('sans physique, range les copeaux dans la pyramide', () => {
    const tr = scatterPile(meshes, 3, 0, null, 45);
    expect(tr.length).toBe(meshes.length);
    expect(aspect(tr)).toBeGreaterThan(0.5);
  });
});

describe('tas en pyramide : presets', () => {
  it('relit le réceptacle pyramide, sa pente et un grand lot', () => {
    const pile = { ...DEFAULT_PILE, container: 'pyramide' as const, pyramidSlope: 55, count: MAX_PILE_COUNT };
    const txt = serializePreset({ name: 'p', selection: DEFAULT_SELECTION, params: DEFAULT_PARAMS, seed: 3, mode: 'tas', pile });
    expect(parsePreset(txt, DEFAULT_PARAMS, DEFAULT_SELECTION).pile).toEqual(pile);
    const bad = JSON.parse(txt);
    bad.pile = { ...bad.pile, pyramidSlope: 500, count: 1e6 };
    const p = parsePreset(JSON.stringify(bad), DEFAULT_PARAMS, DEFAULT_SELECTION).pile;
    expect(p.pyramidSlope).toBe(PYRAMID_SLOPE_RANGE[1]);
    expect(p.count).toBe(MAX_PILE_COUNT);
  });
});
