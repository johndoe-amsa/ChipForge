import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import { binBoxes, binGeometry, BOX_FACES, boxCorners } from '../src/core/bin';
import { DEFAULT_PARAMS, STEP_QUALITY } from '../src/core/params';
import { buildChipGrid } from '../src/core/geometry/chip';
import { ObjWriter, writeMTL, concatChunks } from '../src/core/export/obj';
import { writeSTEP } from '../src/core/export/step';
import { IDENTITY } from '../src/core/export/transform';
import { parsePreset, serializePreset } from '../src/app/presetFile';
import { DEFAULT_PILE, DEFAULT_SELECTION } from '../src/core/presets/presets';

interface OcctMesh {
  attributes: { position: { array: number[] } };
  index: { array: number[] };
  brep_faces: unknown[];
}
let occt: { ReadStepFile(content: Uint8Array, params: unknown): { success: boolean; meshes: OcctMesh[] } };

beforeAll(async () => {
  occt = await createRequire(import.meta.url)('occt-import-js')();
});

function volume(m: OcctMesh): number {
  const p = m.attributes.position.array;
  const ix = m.index.array;
  let v = 0;
  for (let k = 0; k < ix.length; k += 3) {
    const [a, b, c] = [ix[k] * 3, ix[k + 1] * 3, ix[k + 2] * 3];
    v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return v / 6;
}

describe('bac à copeaux : géométrie', () => {
  it('respecte les dimensions demandées : intérieur centré, fond affleurant la grille', () => {
    const b = binGeometry({ length: 80, width: 50, height: 20 }, [5, 6]);
    expect(b).toMatchObject({ length: 80, width: 50, height: 20 });
    const boxes = binBoxes(b);
    expect(boxes.length).toBe(5);
    const [floor, ...walls] = boxes;
    expect(floor.center[1] + floor.half[1]).toBeCloseTo(0, 9);
    // Faces intérieures des parois à ± longueur / 2 et ± largeur / 2, parois de hauteur h.
    const inner = walls.map((w) => (w.half[0] < w.half[2] ? Math.abs(w.center[0]) - w.half[0] : Math.abs(w.center[2]) - w.half[2]));
    expect(inner.sort((a, c) => a - c)).toEqual([25, 25, 40, 40].map((x) => expect.closeTo(x, 9)));
    for (const w of walls) expect(w.center[1] + w.half[1]).toBeCloseTo(20, 9);
  });

  it('se dimensionne automatiquement selon la taille et le nombre de copeaux', () => {
    const small = binGeometry({ length: 0, width: 0, height: 0 }, Array(10).fill(3));
    const big = binGeometry({ length: 0, width: 0, height: 0 }, Array(80).fill(3));
    expect(big.length).toBeGreaterThan(small.length * 2);
    expect(small.length).toBeGreaterThan(2 * 3 * 2);
    expect(small.width).toBeLessThanOrEqual(small.length);
  });

  it('chaque face de pavé est orientée vers l’extérieur', () => {
    const box = binBoxes(binGeometry({ length: 30, width: 20, height: 10 }, [2]))[1];
    const P = boxCorners(box);
    for (const { v, n } of BOX_FACES) {
      const [a, b, , d] = v.map((i) => P[i]);
      const u = b.map((x, k) => x - a[k]);
      const w = d.map((x, k) => x - a[k]);
      const c = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      expect(c[0] * n[0] + c[1] * n[1] + c[2] * n[2]).toBeGreaterThan(0);
    }
  });
});

describe('bac à copeaux : exports', () => {
  const bin = binGeometry({ length: 60, width: 40, height: 15 }, [4]);

  it('OBJ : un objet « bac » aux indices valides, matériau dans le MTL', () => {
    const parts: Uint8Array[] = [];
    const w = new ObjWriter({ unit: 'mm', uvMode: 'reel', uvScaleMM: 10, mtlName: 'x.mtl' }, (c) => parts.push(c));
    w.addBoxes('bac', binBoxes(bin));
    w.finish();
    const lines = new TextDecoder().decode(concatChunks(parts)).split('\n');
    const nv = lines.filter((l) => l.startsWith('v ')).length;
    const nt = lines.filter((l) => l.startsWith('vt ')).length;
    const nn = lines.filter((l) => l.startsWith('vn ')).length;
    const faces = lines.filter((l) => l.startsWith('f '));
    expect([nv, nt, nn, faces.length]).toEqual([40, 120, 30, 30]);
    for (const f of faces)
      for (const c of f.split(' ').slice(1)) {
        const [v, t, n] = c.split('/').map(Number);
        expect(v >= 1 && v <= nv && t >= 1 && t <= nt && n >= 1 && n <= nn).toBe(true);
      }
    expect(lines).toContain('o bac');
    expect(lines).toContain('usemtl bac');
    expect(w.hasBin).toBe(true);
    expect(writeMTL([], true)).toContain('newmtl bac\n');
    expect(writeMTL()).not.toContain('newmtl bac');
  });

  it('STEP : un bac fait de solides fermés, relu par OpenCascade avec le bon volume', () => {
    const chip = { name: 'copeau_001', grid: buildChipGrid({ ...DEFAULT_PARAMS, length: 12 }, 3, STEP_QUALITY), transform: IDENTITY };
    const res = occt.ReadStepFile(writeSTEP([chip, { name: 'bac', boxes: binBoxes(bin) }], 'tas.stp'), {
      linearDeflectionType: 'bounding_box_ratio',
      linearDeflection: 0.01,
      angularDeflection: 0.5,
    });
    expect(res.success).toBe(true);
    const binMeshes = res.meshes.slice(1);
    const vol = binMeshes.reduce((a, m) => a + volume(m), 0);
    const t = bin.wall;
    const expected = (bin.length + 2 * t) * (bin.width + 2 * t) * t + 2 * t * bin.height * (bin.width + 2 * t) + 2 * t * bin.height * bin.length;
    expect(Math.abs(vol - expected) / expected).toBeLessThan(1e-3);
    for (const m of binMeshes) expect(volume(m)).toBeGreaterThan(0);
  });
});

describe('bac à copeaux : presets', () => {
  it('relit les réglages du bac et rejette les valeurs invalides', () => {
    const pile = { ...DEFAULT_PILE, container: 'bac' as const, binLength: 120, binWidth: 70, binHeight: 30, exportBin: true };
    const txt = serializePreset({ name: 'b', selection: DEFAULT_SELECTION, params: DEFAULT_PARAMS, seed: 3, mode: 'tas', pile });
    expect(parsePreset(txt, DEFAULT_PARAMS, DEFAULT_SELECTION).pile).toEqual(pile);
    const bad = JSON.parse(txt);
    bad.pile = { container: 'piscine', binLength: -5, binWidth: 1e9, binHeight: 'x', exportBin: 'oui' };
    const p = parsePreset(JSON.stringify(bad), DEFAULT_PARAMS, DEFAULT_SELECTION).pile;
    expect(p.container).toBe('sol');
    expect(p.binLength).toBe(0);
    expect(p.binWidth).toBe(2000);
    expect(p.binHeight).toBe(0);
    expect(p.exportBin).toBe(false);
  });
});
