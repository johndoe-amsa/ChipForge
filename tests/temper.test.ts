import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, PREVIEW_QUALITY, STEP_QUALITY, type ChipParams } from '../src/core/params';
import { buildChipGrid } from '../src/core/geometry/chip';
import { gridToMesh } from '../src/core/geometry/mesh';
import { writeMTL, writeOBJ, ObjWriter } from '../src/core/export/obj';
import { writeSTEP } from '../src/core/export/step';
import { IDENTITY } from '../src/core/export/transform';
import { composePreset, varyParams } from '../src/core/presets/presets';
import { temperColor, temperFaces, temperShade, TEMPER_CHART_OPTIONS, type TemperChart } from '../src/core/temper';

interface OcctResult {
  success: boolean;
  meshes: { brep_faces: { color: number[] | null }[] }[];
}
let occt: { ReadStepFile(content: Uint8Array, params: unknown): OcctResult };

beforeAll(async () => {
  occt = await createRequire(import.meta.url)('occt-import-js')();
});

const blued: ChipParams = { ...DEFAULT_PARAMS, temperLevel: 0.7, temperSpread: 0.2, temperChart: 'fer' };
const charts = TEMPER_CHART_OPTIONS.map((o) => o.value).filter((c) => c !== 'aucune') as TemperChart[];

describe('couleurs de revenu : nuanciers', () => {
  it('donnent des couleurs valides, le métal nu au niveau 0 et une teinte nommée', () => {
    const c = [0, 0, 0];
    for (const chart of charts) {
      for (let l = 0; l <= 1.0001; l += 0.05) {
        temperColor(chart, l, c);
        for (const v of c) expect(v >= 0 && v <= 1).toBe(true);
      }
      expect(temperShade(chart, 0).name).toBe('nu');
    }
    // Aciers : le bleu du nuancier est bien bleu, la paille bien jaune.
    temperColor('fer', 0.76, c);
    expect(c[2]).toBeGreaterThan(c[0] + 0.3);
    temperColor('fer', 0.22, c);
    expect(c[0]).toBeGreaterThan(c[2] + 0.3);
    expect(temperShade('fer', 0.75).name).toBe('bleu');
  });
});

describe('couleurs de revenu : géométrie et aperçu', () => {
  it("n'ajoutent rien quand l'option est inactive", () => {
    expect(gridToMesh(buildChipGrid(DEFAULT_PARAMS, 3, PREVIEW_QUALITY)).colors).toBeNull();
    const none = gridToMesh(buildChipGrid({ ...blued, temperChart: 'aucune' }, 3, PREVIEW_QUALITY));
    expect(none.colors).toBeNull();
    expect(none.temper).toBeNull();
  });

  it('colorent chaque sommet, de façon déterministe, avec des variations le long du copeau', () => {
    const a = gridToMesh(buildChipGrid(blued, 3, PREVIEW_QUALITY));
    const b = gridToMesh(buildChipGrid(blued, 3, PREVIEW_QUALITY));
    expect(a.colors).not.toBeNull();
    expect(a.colors!.length).toBe(a.positions.length);
    expect(Array.from(a.colors!)).toEqual(Array.from(b.colors!));
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 2; k < a.colors!.length; k += 3) {
      lo = Math.min(lo, a.colors![k]);
      hi = Math.max(hi, a.colors![k]);
    }
    expect(hi - lo).toBeGreaterThan(0.05);
    // Face de coupe en avance sur la face libre ; faces de rupture presque nues.
    const [coupe, libre, , ext] = a.temper!.faces;
    expect(coupe.level).toBeGreaterThan(libre.level);
    expect(ext.level).toBeLessThan(0.3 * coupe.level);
  });

  it('ne dépendent pas de la résolution (aperçu = export)', () => {
    const g1 = buildChipGrid(blued, 9, PREVIEW_QUALITY);
    const g2 = buildChipGrid(blued, 9, STEP_QUALITY);
    const f1 = temperFaces('fer', g1.temper!.level, g1.rings, g1.nW, g1.nE);
    const f2 = temperFaces('fer', g2.temper!.level, g2.rings, g2.nW, g2.nE);
    for (let g = 0; g < 3; g++) expect(Math.abs(f1[g].level - f2[g].level)).toBeLessThan(0.03);
  });
});

describe('couleurs de revenu : exports', () => {
  it('OBJ : un bloc #MRGB par tranche de 64 sommets, couleurs dans l’ordre des sommets', () => {
    const m = gridToMesh(buildChipGrid(blued, 4, PREVIEW_QUALITY));
    const txt = new TextDecoder().decode(writeOBJ([{ name: 'c', mesh: m, transform: IDENTITY }], { unit: 'mm', uvMode: 'reel', uvScaleMM: 10, mtlName: 'x.mtl' }));
    const lines = txt.split('\n');
    const nv = m.positions.length / 3;
    const mrgb = lines.filter((l) => l.startsWith('#MRGB '));
    expect(mrgb.length).toBe(Math.ceil(nv / 64));
    const hex = mrgb.map((l) => l.slice(6)).join('');
    expect(hex.length).toBe(nv * 8);
    expect(/^[0-9a-f]+$/.test(hex)).toBe(true);
    for (const k of [0, Math.floor(nv / 2), nv - 1]) {
      const e = hex.slice(k * 8, k * 8 + 8);
      expect(e.slice(0, 2)).toBe('ff');
      for (let c = 0; c < 3; c++) expect(Math.abs(parseInt(e.slice(2 + 2 * c, 4 + 2 * c), 16) / 255 - m.colors![k * 3 + c])).toBeLessThan(1 / 255 + 1e-6);
    }
    // Les « v » restent à 3 coordonnées : aucun logiciel ne peut les mal lire.
    expect(lines.filter((l) => l.startsWith('v ')).every((l) => l.split(' ').length === 4)).toBe(true);
  });

  it('OBJ sans couleurs de revenu : aucun bloc #MRGB, matériaux neutres', () => {
    const m = gridToMesh(buildChipGrid(DEFAULT_PARAMS, 4, PREVIEW_QUALITY));
    const txt = new TextDecoder().decode(writeOBJ([{ name: 'c', mesh: m, transform: IDENTITY }], { unit: 'mm', uvMode: 'reel', uvScaleMM: 10, mtlName: 'x.mtl' }));
    expect(txt.split('\n').some((l) => l.startsWith('#MRGB'))).toBe(false);
    expect(txt).toContain('usemtl face_coupe\n');
  });

  it('MTL : un matériau par groupe de faces et par teinte utilisée', () => {
    const parts: Uint8Array[] = [];
    const w = new ObjWriter({ unit: 'mm', uvMode: 'reel', uvScaleMM: 10, mtlName: 'x.mtl' }, (c) => parts.push(c));
    w.add({ name: 'c', mesh: gridToMesh(buildChipGrid(blued, 4, PREVIEW_QUALITY)), transform: IDENTITY });
    w.finish();
    const txt = new TextDecoder().decode(parts.reduce((a, p) => new Uint8Array([...a, ...p]), new Uint8Array()));
    const used = [...new Set(txt.split('\n').filter((l) => l.startsWith('usemtl ')).map((l) => l.slice(7)))];
    expect(used.length).toBe(4);
    const mtl = writeMTL(w.temperMaterials.values());
    for (const name of used) {
      expect(name).toMatch(/^(face_coupe|face_libre|flancs|extremites)_fer_[a-z_]+$/);
      expect(mtl).toContain(`newmtl ${name}\n`);
    }
  });

  it('STEP : chaque face prend la teinte moyenne de son groupe (relu par OpenCascade)', () => {
    const p: ChipParams = { ...blued, lamellaAmp: 0, microNoise: 0, striationAmp: 0, crackDensity: 0, length: 20 };
    // OpenCascade restitue les couleurs STEP (sRGB) en RVB linéaire.
    const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const order = [0, 2, 1, 2, 3, 3]; // coupe, flanc B, libre, flanc A, deux extrémités
    const read = (q: ChipParams, seed: number) => {
      const g = buildChipGrid(q, seed, STEP_QUALITY);
      const res = occt.ReadStepFile(writeSTEP([{ name: 'a', grid: g, transform: IDENTITY }], 'x.stp'), {
        linearDeflectionType: 'bounding_box_ratio',
        linearDeflection: 0.01,
        angularDeflection: 0.5,
      });
      expect(res.success).toBe(true);
      const faces = temperFaces('fer', g.temper!.level, g.rings, g.nW, g.nE);
      const got = res.meshes[0].brep_faces.map((f) => f.color!);
      got.forEach((col, i) => {
        for (let c = 0; c < 3; c++) expect(Math.abs(col[c] - lin(faces[order[i]].rgb[c]))).toBeLessThan(2e-3);
      });
      return got;
    };
    const a = read(p, 11);
    const b = read({ ...p, temperLevel: 0.3 }, 12);
    // Deux copeaux de teintes différentes : couleurs différentes.
    expect(a[0]).not.toEqual(b[0]);
  });
});

describe('couleurs de revenu : presets', () => {
  it('le superalliage (tournage dur à sec) est bleui, le plastique jamais', () => {
    const sup = composePreset({ material: 'superalliage', process: 'tournage', form: '6.2' });
    expect(sup.temperLevel).toBeGreaterThan(0.5);
    expect(gridToMesh(buildChipGrid(sup, 1, PREVIEW_QUALITY)).colors).not.toBeNull();
    const pl = composePreset({ material: 'plastique', process: 'tournage', form: '6.2' });
    expect(pl.temperChart).toBe('aucune');
    expect(composePreset({ material: 'titane', process: 'tournage', form: '6.2' }).temperChart).toBe('titane');
  });

  it('en mode tas, chaque copeau a sa propre teinte', () => {
    const base = composePreset({ material: 'superalliage', process: 'tournage', form: '6.2' });
    const levels = new Set([0, 1, 2, 3, 4].map((i) => varyParams(base, 7, i, 0.5).temperLevel.toFixed(3)));
    expect(levels.size).toBeGreaterThan(3);
    // Les autres paramètres tirés au sort ne changent pas avec l'ajout de la teinte.
    expect(varyParams({ ...base, temperLevel: 0 }, 7, 2, 0.5).length).toBe(varyParams(base, 7, 2, 0.5).length);
  });
});
