import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, STEP_QUALITY, PREVIEW_QUALITY, type ChipParams } from '../src/core/params';
import { buildChipGrid } from '../src/core/geometry/chip';
import { gridToMesh } from '../src/core/geometry/mesh';
import { writeOBJ, writeMTL } from '../src/core/export/obj';
import { writeSTEP } from '../src/core/export/step';
import { IDENTITY, type RigidTransform } from '../src/core/export/transform';
import { composePreset, FORMS } from '../src/core/presets/presets';
import { meshVolume } from './helpers';

interface OcctMesh {
  name: string;
  brep_faces: { first: number; last: number; color: number[] | null }[];
  attributes: { position: { array: number[] } };
  index: { array: number[] };
}
interface OcctResult {
  success: boolean;
  root: { name: string; meshes: number[]; children: { name: string; meshes: number[] }[] };
  meshes: OcctMesh[];
}
interface Occt {
  ReadStepFile(content: Uint8Array, params: unknown): OcctResult;
}

let occt: Occt;

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  occt = await require('occt-import-js')();
});

function triVolume(m: OcctMesh): number {
  const p = m.attributes.position.array;
  const ix = m.index.array;
  let v = 0;
  for (let k = 0; k < ix.length; k += 3) {
    const a = ix[k] * 3;
    const b = ix[k + 1] * 3;
    const c = ix[k + 2] * 3;
    v +=
      p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
      p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
      p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return v / 6;
}

const readStep = (bytes: Uint8Array) =>
  occt.ReadStepFile(bytes, { linearUnit: 'millimeter', linearDeflectionType: 'absolute_value', linearDeflection: 0.002, angularDeflection: 0.1 });

describe('export OBJ', () => {
  it('écrit des indices valides, des groupes nommés et une référence MTL', () => {
    const m = gridToMesh(buildChipGrid(DEFAULT_PARAMS, 5, PREVIEW_QUALITY));
    const txt = new TextDecoder().decode(
      writeOBJ([{ name: 'copeau_001', mesh: m, transform: IDENTITY }], { unit: 'mm', uvMode: 'reel', uvScaleMM: 10, mtlName: 'chipforge.mtl' }),
    );
    const lines = txt.split('\n');
    const nv = lines.filter((l) => l.startsWith('v ')).length;
    const nt = lines.filter((l) => l.startsWith('vt ')).length;
    const nn = lines.filter((l) => l.startsWith('vn ')).length;
    const faces = lines.filter((l) => l.startsWith('f '));
    expect(nv).toBe(m.positions.length / 3);
    expect(nt).toBe(m.vPos.length);
    expect(nn).toBe(m.normals.length / 3);
    expect(faces.length).toBe(m.quads.length / 4);
    for (const f of faces) {
      const parts = f.split(' ').slice(1);
      expect(parts.length).toBe(4);
      for (const c of parts) {
        const [v, t, n] = c.split('/').map(Number);
        expect(v >= 1 && v <= nv && t >= 1 && t <= nt && n >= 1 && n <= nn).toBe(true);
      }
    }
    expect(txt).toContain('mtllib chipforge.mtl');
    for (const g of ['face_coupe', 'face_libre', 'flancs', 'extremites']) {
      expect(txt).toContain(`usemtl ${g}`);
      expect(writeMTL()).toContain(`newmtl ${g}`);
    }
  });

  it('convertit en mètres', () => {
    const m = gridToMesh(buildChipGrid({ ...DEFAULT_PARAMS, length: 10 }, 5, PREVIEW_QUALITY));
    const mm = new TextDecoder().decode(writeOBJ([{ name: 'a', mesh: m, transform: IDENTITY }], { unit: 'mm', uvMode: 'reel', uvScaleMM: 10, mtlName: 'x.mtl' }));
    const me = new TextDecoder().decode(writeOBJ([{ name: 'a', mesh: m, transform: IDENTITY }], { unit: 'm', uvMode: 'reel', uvScaleMM: 10, mtlName: 'x.mtl' }));
    const first = (t: string) => t.split('\n').find((l) => l.startsWith('v '))!.split(' ').slice(1).map(Number);
    const a = first(mm);
    const b = first(me);
    for (let k = 0; k < 3; k++) expect(b[k]).toBeCloseTo(a[k] / 1000, 7);
  });
});

describe('export STEP (relu par OpenCascade)', () => {
  it('produit un solide fermé de 6 faces dont le volume correspond au maillage', () => {
    const p: ChipParams = { ...DEFAULT_PARAMS, lamellaAmp: 0, microNoise: 0, striationAmp: 0, crackDensity: 0 };
    const grid = buildChipGrid(p, 11, STEP_QUALITY);
    const bytes = writeSTEP([{ name: 'copeau_001', grid, transform: IDENTITY }], 'copeau.stp');
    const res = readStep(bytes);
    expect(res.success).toBe(true);
    expect(res.meshes.length).toBe(1);
    expect(res.meshes[0].brep_faces.length).toBe(6);
    const vStep = Math.abs(triVolume(res.meshes[0]));
    const vMesh = meshVolume(gridToMesh(grid));
    // L'approximation B-spline (points de grille = pôles) lisse très légèrement la forme.
    expect(Math.abs(vStep - vMesh) / vMesh).toBeLessThan(0.03);
    // Orientation : volume positif = normales sortantes
    expect(triVolume(res.meshes[0])).toBeGreaterThan(0);
    // Couleurs par groupe de faces
    const colors = new Set(res.meshes[0].brep_faces.map((f) => (f.color ?? []).map((c) => c.toFixed(2)).join(',')));
    expect(colors.size).toBe(4);
  });

  it('écrit un assemblage nommé pour un tas', () => {
    const items = [0, 1, 2].map((k) => {
      const grid = buildChipGrid(composePreset({ material: 'titane', process: 'tournage', form: '6.2' }), 100 + k, STEP_QUALITY);
      const t: RigidTransform = { q: [0, 0, Math.sin(k / 2), Math.cos(k / 2)], t: [k * 10, 0, 0] };
      return { name: `copeau_${String(k + 1).padStart(3, '0')}`, grid, transform: t };
    });
    const res = readStep(writeSTEP(items, 'tas.stp'));
    expect(res.success).toBe(true);
    expect(res.meshes.length).toBe(3);
    const names = JSON.stringify(res.root);
    for (const it of items) expect(names).toContain(it.name);
    for (const m of res.meshes) expect(triVolume(m)).toBeGreaterThan(0);
  });

  it('reste lisible par OpenCascade pour toutes les formes ISO', { timeout: 300000 }, () => {
    for (const f of FORMS) {
      // Longueur plafonnée pour garder une tessellation OpenCascade rapide dans les tests.
      const p = composePreset({ material: 'inox', process: 'tournage', form: f.id });
      p.length = Math.min(p.length, 40);
      const grid = buildChipGrid(p, 7, STEP_QUALITY);
      const res = occt.ReadStepFile(writeSTEP([{ name: `iso_${f.id}`, grid, transform: IDENTITY }], 'x.stp'), {
        linearDeflectionType: 'bounding_box_ratio',
        linearDeflection: 0.003,
        angularDeflection: 0.4,
      });
      expect(res.success, `forme ${f.id}`).toBe(true);
      expect(res.meshes[0]?.brep_faces.length, `forme ${f.id}`).toBe(6);
      expect(triVolume(res.meshes[0]), `forme ${f.id}`).toBeGreaterThan(0);
    }
  });
});
