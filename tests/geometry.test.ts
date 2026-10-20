import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, EXPORT_QUALITY, PREVIEW_QUALITY, type ChipParams } from '../src/core/params';
import { buildChipGrid } from '../src/core/geometry/chip';
import { gridToMesh } from '../src/core/geometry/mesh';
import { allFinite, checkClosedManifold, meshVolume } from './helpers';

const smooth: Partial<ChipParams> = {
  lamellaAmp: 0,
  striationAmp: 0,
  wavinessAmp: 0,
  segmentDepth: 0,
  microNoise: 0,
  thicknessNoise: 0,
  crackDensity: 0,
  burr: 0,
  macroNoise: 0,
  endBreak: 0,
  taper: 0,
  camber: 0,
  edgeThinning: 0,
  edgeRoundness: 0,
};

describe('géométrie du copeau', () => {
  it('produit un solide fermé, orienté et fini (preset par défaut)', () => {
    const m = gridToMesh(buildChipGrid(DEFAULT_PARAMS, 1234, PREVIEW_QUALITY));
    expect(allFinite(m.positions)).toBe(true);
    expect(allFinite(m.normals)).toBe(true);
    expect(allFinite(m.uvMM)).toBe(true);
    expect(allFinite(m.uv01)).toBe(true);
    const mf = checkClosedManifold(m);
    expect(mf).toEqual({ ok: true, boundary: 0, nonManifold: 0 });
    expect(meshVolume(m)).toBeGreaterThan(0);
  });

  it('respecte le volume nominal L × w × e pour un ruban lisse', () => {
    const p: ChipParams = { ...DEFAULT_PARAMS, ...smooth, length: 20, radius: 400, pitch: 0, width: 2, thickness: 0.2 };
    const m = gridToMesh(buildChipGrid(p, 7, EXPORT_QUALITY));
    const vol = meshVolume(m);
    expect(vol).toBeGreaterThan(20 * 2 * 0.2 * 0.95);
    expect(vol).toBeLessThan(20 * 2 * 0.2 * 1.03);
  });

  it('respecte le rayon et le pas demandés pour une hélice', () => {
    const p: ChipParams = { ...DEFAULT_PARAMS, ...smooth, length: 100, radius: 3, pitch: 4, width: 1, thickness: 0.1 };
    const g = buildChipGrid(p, 3, PREVIEW_QUALITY);
    expect(g.info.effectiveRadius).toBeCloseTo(3, 6);
    expect(g.info.effectivePitch).toBeCloseTo(4, 6);
    // Spires : L / (2π √(R² + c²))
    const c = 4 / (2 * Math.PI);
    expect(g.info.turns).toBeCloseTo(100 / (2 * Math.PI * Math.sqrt(9 + c * c)), 6);
    const m = gridToMesh(g);
    // Étendue : plus grande dimension ≈ pas × spires, plus petite ≈ diamètre
    const ext = [m.bounds[3] - m.bounds[0], m.bounds[4] - m.bounds[1], m.bounds[5] - m.bounds[2]];
    expect(ext[0]).toBeGreaterThan(4 * g.info.turns * 0.9);
    expect(ext[1]).toBeLessThan(2 * 3 + 1.2);
  });

  it('est déterministe pour une même seed et varie avec la seed', () => {
    const a = gridToMesh(buildChipGrid(DEFAULT_PARAMS, 42, PREVIEW_QUALITY));
    const b = gridToMesh(buildChipGrid(DEFAULT_PARAMS, 42, PREVIEW_QUALITY));
    const c = gridToMesh(buildChipGrid(DEFAULT_PARAMS, 43, PREVIEW_QUALITY));
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.positions.slice(0, 300))).not.toEqual(Array.from(c.positions.slice(0, 300)));
  });

  it("évite l'interpénétration des spires quand l'option est active", () => {
    const p: ChipParams = { ...DEFAULT_PARAMS, ...smooth, pitch: 0.1, radiusGrowth: 0, width: 1.5, radius: 2, length: 60 };
    const g = buildChipGrid(p, 1, PREVIEW_QUALITY);
    expect(g.info.effectivePitch).toBeGreaterThanOrEqual(1.5);
  });

  it('reste valide avec tous les micro-reliefs au maximum', () => {
    const p: ChipParams = {
      ...DEFAULT_PARAMS,
      lamellaAmp: 50,
      lamellaFreq: 40,
      striationAmp: 20,
      striationFreq: 40,
      segmentDepth: 0.8,
      segmentFreq: 30,
      crackDensity: 20,
      crackDepth: 1,
      burr: 100,
      burrSide: 'deux',
      microNoise: 30,
      thicknessNoise: 0.5,
      endBreak: 1,
      macroNoise: 1,
      tangle: 1,
      twist: 60,
      linkedSegments: 4,
      neck: 0.9,
    };
    const m = gridToMesh(buildChipGrid(p, 99, PREVIEW_QUALITY));
    expect(allFinite(m.positions)).toBe(true);
    expect(checkClosedManifold(m).ok).toBe(true);
    expect(m.positions.length / 3).toBeLessThanOrEqual(PREVIEW_QUALITY.maxVertices + 2 * 200 * 30);
  });
});

describe('cohérence aperçu / export', () => {
  it("place le copeau exactement au même endroit quelle que soit la résolution", () => {
    const a = buildChipGrid(DEFAULT_PARAMS, 9, PREVIEW_QUALITY);
    const b = buildChipGrid(DEFAULT_PARAMS, 9, EXPORT_QUALITY);
    expect(Array.from(a.colliders)).toEqual(Array.from(b.colliders));
    const ma = gridToMesh(a);
    const mb = gridToMesh(b);
    for (let k = 0; k < 6; k++) expect(Math.abs(ma.bounds[k] - mb.bounds[k])).toBeLessThan(0.05);
  });
});
