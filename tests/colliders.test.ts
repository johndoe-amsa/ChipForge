import { describe, expect, it } from 'vitest';
import { buildChipGrid } from '../src/core/geometry/chip';
import { DEFAULT_PARAMS, PREVIEW_QUALITY, sanitizeParams } from '../src/core/params';
import { coarsenColliders, colliderGroup } from '../src/physics/pile';

function rotate(q: ArrayLike<number>, o: number, v: number[]): number[] {
  const [x, y, z, w] = [q[o], q[o + 1], q[o + 2], q[o + 3]];
  const c = [y * v[2] - z * v[1], z * v[0] - x * v[2], x * v[1] - y * v[0]];
  const cc = [y * c[2] - z * c[1], z * c[0] - x * c[2], x * c[1] - y * c[0]];
  return [0, 1, 2].map((i) => v[i] + 2 * (w * c[i] + cc[i]));
}

/** Coordonnées d'un point dans le repère d'un pavé (pour tester l'appartenance). */
function local(col: Float32Array, o: number, p: number[]): number[] {
  const d = [p[0] - col[o], p[1] - col[o + 1], p[2] - col[o + 2]];
  const inv = [-col[o + 3], -col[o + 4], -col[o + 5], col[o + 6]];
  return rotate(inv, 0, d);
}

describe('pavés de collision regroupés (grands tas)', () => {
  const p = sanitizeParams({ ...DEFAULT_PARAMS, length: 60 });
  const col = buildChipGrid(p, 4, PREVIEW_QUALITY).colliders;

  it.each([2, 3, 5])('par %i : moins de pavés, chacun contenant tous les sommets de ses pavés d’origine', (g) => {
    const nb = col.length / 10;
    const out = coarsenColliders(col, g);
    expect(out.length / 10).toBe(Math.ceil(nb / g));
    for (let i = 0; i < nb; i++) {
      const o = i * 10;
      const go = Math.floor(i / g) * 10;
      const qn = Math.hypot(out[go + 3], out[go + 4], out[go + 5], out[go + 6]);
      expect(qn).toBeCloseTo(1, 5);
      for (let c = 0; c < 8; c++) {
        const v = rotate(col, o + 3, [c & 1 ? col[o + 7] : -col[o + 7], c & 2 ? col[o + 8] : -col[o + 8], c & 4 ? col[o + 9] : -col[o + 9]]);
        const l = local(out, go, [col[o] + v[0], col[o + 1] + v[1], col[o + 2] + v[2]]);
        for (let a = 0; a < 3; a++) expect(Math.abs(l[a])).toBeLessThanOrEqual(out[go + 7 + a] * (1 + 1e-4) + 1e-5);
      }
    }
  });

  it('ne regroupe rien pour les petits lots', () => {
    expect(coarsenColliders(col, 1)).toBe(col);
    expect(colliderGroup(40)).toBe(1);
    expect(colliderGroup(1000)).toBeGreaterThan(1);
  });
});
