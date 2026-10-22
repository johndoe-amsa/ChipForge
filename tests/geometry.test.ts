import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, EXPORT_QUALITY, PREVIEW_QUALITY, type ChipParams } from '../src/core/params';
import { buildChipGrid, type ChipGrid } from '../src/core/geometry/chip';
import { gridToMesh } from '../src/core/geometry/mesh';
import { composePreset, varyParams } from '../src/core/presets/presets';
import { hashSeed } from '../src/core/rng';
import { allFinite, checkClosedManifold, countFolds, countSelfPenetrations, meshVolume } from './helpers';

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

describe('éviter les auto-intersections', () => {
  const exclusion = (p: ChipParams) => 2.5 * p.width + 1;
  // Cas du signalement : aluminium, tubulaire enchevêtré (L 350, R 2.08, pas 1.49, enchevêtrement 0.6)
  const reported = composePreset({ material: 'aluminium', process: 'tournage', form: '2.3' });

  it('le contrôle indépendant détecte bien les traversées quand l’option est désactivée', () => {
    const g = buildChipGrid({ ...reported, avoidOverlap: false }, 1, PREVIEW_QUALITY);
    expect(g.info.selfContacts).toBeNull();
    expect(countSelfPenetrations(g, exclusion(reported))).toBeGreaterThan(0);
    // … et une pliure franche (anneau qui recule le long de la fibre).
    const ring = (z: number) => [0, 0, z, 1, 0, z, 1, 1, z, 0, 1, z];
    const folded = { rings: 4, M: 4, nW: 1, nE: 1, pos: Float64Array.from([...ring(0), ...ring(1), ...ring(0.4), ...ring(2)]) };
    expect(countFolds(folded as unknown as ChipGrid)).toBeGreaterThan(0);
  });

  it('supprime toutes les traversées du cas signalé', () => {
    expect(reported.length).toBe(350);
    expect(reported.tangle).toBeCloseTo(0.6, 6);
    const g = buildChipGrid(reported, 1, PREVIEW_QUALITY);
    expect(g.info.selfContacts!.initial).toBeGreaterThan(0);
    expect(g.info.selfContacts!.residual).toBe(0);
    expect(countSelfPenetrations(g, exclusion(reported))).toBe(0);
    expect(countFolds(g)).toBe(0);
    expect(checkClosedManifold(gridToMesh(g)).ok).toBe(true);
  });

  it('supprime les traversées des formes à risque, quels que soient la seed et le procédé', { timeout: 300000 }, () => {
    const cases = [
      ['tournage', 'inox', '1.3'],
      ['tournage', 'acier', '2.1'],
      ['tournage', 'acier', '2.3'],
      ['tournage', 'titane', '4.3'],
      ['tournage', 'cuivre', '5.3'],
      ['tournage', 'laiton', '6.1'],
      ['tournage', 'superalliage', '2.3'],
      ['gorge', 'superalliage', '2.3'],
      ['percage', 'aluminium', '2.3'],
    ] as const;
    for (const [process, material, form] of cases) {
      const base = composePreset({ material, process, form });
      for (const seed of [1, 3, 7, 42]) {
        const p = varyParams(base, seed, 0, 0.5);
        const g = buildChipGrid(p, hashSeed(seed, 0), PREVIEW_QUALITY);
        const label = `${process} ${material} ISO ${form} seed ${seed}`;
        expect(g.info.selfContacts!.residual, label).toBe(0);
        expect(countSelfPenetrations(g, exclusion(p)), label).toBe(0);
        // Aucune pliure ajoutée : la fibre s'écarte sans se replier (les liaisons ISO 6.1 sont
        // des pliures voulues, présentes aussi sans l'option).
        const off = buildChipGrid({ ...p, avoidOverlap: false }, hashSeed(seed, 0), PREVIEW_QUALITY);
        const folds0 = countFolds(off);
        expect(countFolds(g), label).toBeLessThanOrEqual(folds0 + Math.max(2, 0.05 * folds0));
      }
    }
  });

  it('ne modifie pas un copeau qui ne se traverse pas', () => {
    const p = composePreset({ material: 'acier', process: 'tournage', form: '5.2' });
    const g = buildChipGrid(p, 1, PREVIEW_QUALITY);
    expect(g.info.selfContacts).toEqual({ initial: 0, residual: 0 });
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
