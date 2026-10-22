import { describe, expect, it } from 'vitest';
import { buildChipGrid } from '../src/core/geometry/chip';
import { gridToMesh, type ChipMesh } from '../src/core/geometry/mesh';
import { PREVIEW_QUALITY } from '../src/core/params';
import { composePreset, FORMS } from '../src/core/presets/presets';

/** Rapports longueur UV / longueur réelle des arêtes des quads latéraux, le long et en travers de la fibre. */
function stretch(m: ChipMesh): { along: number[]; across: number[] } {
  const along: number[] = [];
  const across: number[] = [];
  const side = m.groups[4] + m.groups[5]; // quads hors extrémités
  for (let q = 0; q < side; q++) {
    const v = [0, 1, 2, 3].map((c) => m.quads[q * 4 + c]);
    for (const [a, b] of [
      [v[0], v[1]],
      [v[1], v[2]],
    ]) {
      const pa = m.vPos[a] * 3;
      const pb = m.vPos[b] * 3;
      const l = Math.hypot(m.positions[pb] - m.positions[pa], m.positions[pb + 1] - m.positions[pa + 1], m.positions[pb + 2] - m.positions[pa + 2]);
      if (l < 1e-6) continue;
      const du = Math.abs(m.uvMM[b * 2] - m.uvMM[a * 2]);
      const dv = Math.abs(m.uvMM[b * 2 + 1] - m.uvMM[a * 2 + 1]);
      if (du > dv) along.push(du / l);
      else across.push(dv / l);
    }
  }
  return { along: along.sort((x, y) => x - y), across: across.sort((x, y) => x - y) };
}

const pct = (a: number[], f: number) => a[Math.min(a.length - 1, Math.floor(f * a.length))];

describe('coordonnées UV', () => {
  it('ne cisaillent jamais la texture : U est le même pour tous les sommets d’un anneau, sur chaque face', () => {
    for (const form of ['4.3', '2.3', '1.3', '4.2']) {
      const g = buildChipGrid(composePreset({ material: 'titane', process: 'tournage', form }), 1, PREVIEW_QUALITY);
      const m = gridToMesh(g);
      // Îlots latéraux : face de coupe, face libre (nW + 1 colonnes), flancs (nE + 1 colonnes)
      let start = 0;
      for (const n of [g.nW, g.nW, g.nE, g.nE]) {
        for (let i = 0; i < g.rings; i++) {
          const u0 = m.uvMM[(start + i * (n + 1)) * 2];
          for (let c = 1; c <= n; c++) expect(m.uvMM[(start + i * (n + 1) + c) * 2], `ISO ${form}`).toBe(u0);
        }
        start += g.rings * (n + 1);
      }
    }
  });

  it('gardent une densité de texels réelle sur toutes les formes ISO (échelle réelle)', { timeout: 120000 }, () => {
    for (const f of FORMS) {
      const p = composePreset({ material: 'acier', process: 'tournage', form: f.id });
      const m = gridToMesh(buildChipGrid(p, 3, PREVIEW_QUALITY));
      const { along, across } = stretch(m);
      const label = `ISO ${f.id}`;
      // Copeaux segmentés en dents de scie : la surface réelle des dents est plus longue que la fibre moyenne.
      const rough = p.segmentDepth > 0.2;
      // Densité médiane exacte, le long comme en travers de la fibre.
      expect(Math.abs(pct(along, 0.5) - 1), label).toBeLessThan(rough ? 0.2 : 0.05);
      expect(Math.abs(pct(across, 0.5) - 1), label).toBeLessThan(0.1);
      // Écarts locaux bornés (bord intérieur des virages serrés), jamais cumulés le long du copeau.
      expect(pct(along, 0.01), label).toBeGreaterThan(0.3);
      expect(pct(along, 0.99), label).toBeLessThan(3);
      expect(pct(across, 0.99), label).toBeLessThan(rough ? 1.8 : 1.3);
      // U total ≈ longueur du copeau (la face extérieure d'une spire serrée est un peu plus longue que la fibre neutre).
      let uMax = 0;
      for (let k = 0; k < m.uvMM.length; k += 2) uMax = Math.max(uMax, m.uvMM[k]);
      expect(uMax / p.length, label).toBeGreaterThan(0.8);
      expect(uMax / p.length, label).toBeLessThan(1.5);
    }
  });
});
