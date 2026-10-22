import { GROUP_NAMES, type ChipGrid, type ChipInfo } from './chip';
import { len3 } from './spine';
import { FRACTURE_TINT, temperColor, temperFaces, type TemperChart, type TemperFace } from '../temper';

/**
 * Maillage quad indexé prêt pour l'affichage et l'export.
 *  - `positions` : sommets uniques (soudés : le solide est étanche),
 *  - sommets de rendu : (position, normale, UV) → coutures UV entre les zones,
 *  - normales lisses sur le pourtour, séparées aux extrémités (arête vive à la rupture).
 */
export interface ChipMesh {
  positions: Float32Array;
  /** Normales indexées par identifiant de normale. */
  normals: Float32Array;
  vPos: Uint32Array;
  vNrm: Uint32Array;
  /** UV à l'échelle réelle (mm). */
  uvMM: Float32Array;
  /** UV normalisées 0–1 par copeau. */
  uv01: Float32Array;
  /** Quads (4 indices de sommets de rendu), ordonnés par groupe. */
  quads: Uint32Array;
  /** Plages de quads par groupe : [début, nombre] × GROUP_NAMES. */
  groups: Uint32Array;
  colliders: Float32Array;
  /** min xyz, max xyz. */
  bounds: Float32Array;
  /** Couleurs de revenu (sRGB 0–1) par sommet unique, ou null. */
  colors: Float32Array | null;
  /** Couleurs de revenu par groupe de faces (ordre GROUP_NAMES), ou null. */
  temper: { chart: TemperChart; faces: TemperFace[] } | null;
  info: ChipInfo;
}

const BANDS: Record<'coupe' | 'libre' | 'flancB' | 'flancA' | 'caps', [number, number]> = {
  coupe: [0, 0.36],
  libre: [0.38, 0.74],
  flancB: [0.76, 0.84],
  flancA: [0.86, 0.94],
  caps: [0.96, 1],
};

export function gridToMesh(grid: ChipGrid): ChipMesh {
  const { rings, nW, nE, M, pos, base, cap0, cap1, capSec0, capSec1, flip } = grid;
  const capInterior = (nW - 1) * (nE - 1);
  const P = rings * M + 2 * capInterior;
  const positions = new Float32Array(P * 3);
  for (let k = 0; k < rings * M * 3; k++) positions[k] = pos[k];

  // Indices de position des carreaux d'extrémité
  const capPosIndex = (cap: 0 | 1) => {
    const idx = new Uint32Array((nW + 1) * (nE + 1));
    const ringBase = cap === 0 ? 0 : (rings - 1) * M;
    let next = rings * M + cap * capInterior;
    const g = cap === 0 ? cap0 : cap1;
    for (let a = 0; a <= nW; a++) {
      for (let b = 0; b <= nE; b++) {
        const gi = a * (nE + 1) + b;
        let j = -1;
        if (b === 0) j = a;
        else if (a === nW) j = nW + b;
        else if (b === nE) j = 2 * nW + nE - a;
        else if (a === 0) j = (M - b) % M;
        if (j >= 0) idx[gi] = ringBase + j;
        else {
          idx[gi] = next;
          positions[next * 3] = g[gi * 3];
          positions[next * 3 + 1] = g[gi * 3 + 1];
          positions[next * 3 + 2] = g[gi * 3 + 2];
          next++;
        }
      }
    }
    return idx;
  };
  const cap0Idx = capPosIndex(0);
  const cap1Idx = capPosIndex(1);

  // --- Coordonnée U : longueur cumulée le long de chaque colonne (géométrie de base)
  const uCol = new Float64Array(rings * M);
  let uMax = 0;
  for (let j = 0; j < M; j++) {
    let acc = 0;
    for (let i = 1; i < rings; i++) {
      const a = ((i - 1) * M + j) * 3;
      const b = (i * M + j) * 3;
      acc += len3(base[b] - base[a], base[b + 1] - base[a + 1], base[b + 2] - base[a + 2]);
      uCol[i * M + j] = acc;
    }
    uMax = Math.max(uMax, acc);
  }

  // --- Îlots latéraux : [premier j, nombre de segments]
  const islands = [
    { key: 'coupe' as const, j0: 0, n: nW },
    { key: 'libre' as const, j0: nW + nE, n: nW },
    { key: 'flancB' as const, j0: nW, n: nE },
    { key: 'flancA' as const, j0: 2 * nW + nE, n: nE },
  ];
  // Longueur de périmètre de chaque îlot, par anneau
  const islandV = islands.map((isl) => {
    const v = new Float64Array(rings * (isl.n + 1));
    let half = 0;
    for (let i = 0; i < rings; i++) {
      let acc = 0;
      v[i * (isl.n + 1)] = 0;
      for (let c = 1; c <= isl.n; c++) {
        const ja = (isl.j0 + c - 1) % M;
        const jb = (isl.j0 + c) % M;
        const a = (i * M + ja) * 3;
        const b = (i * M + jb) * 3;
        acc += len3(base[b] - base[a], base[b + 1] - base[a + 1], base[b + 2] - base[a + 2]);
        v[i * (isl.n + 1) + c] = acc;
      }
      for (let c = 0; c <= isl.n; c++) v[i * (isl.n + 1) + c] -= acc / 2;
      half = Math.max(half, acc / 2);
    }
    return { v, half: Math.max(half, 1e-6) };
  });

  // Mise en page à l'échelle réelle (mm)
  const maxHalf = Math.max(...islandV.map((x) => x.half));
  const gap = Math.max(0.2, 0.25 * maxHalf);
  let vCursor = 0;
  const islandOffset = islandV.map((x) => {
    const off = vCursor + x.half;
    vCursor += 2 * x.half + gap;
    return off;
  });

  // Extrémités : coordonnées de section
  const secBounds = (s: Float64Array) => {
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (let k = 0; k < s.length; k += 2) {
      x0 = Math.min(x0, s[k]);
      x1 = Math.max(x1, s[k]);
      y0 = Math.min(y0, s[k + 1]);
      y1 = Math.max(y1, s[k + 1]);
    }
    return { x0, x1, y0, y1 };
  };
  const sb0 = secBounds(capSec0);
  const sb1 = secBounds(capSec1);
  const capVBase = vCursor;

  const sideVerts = islands.reduce((acc, isl) => acc + rings * (isl.n + 1), 0);
  const capVerts = (nW + 1) * (nE + 1);
  const V = sideVerts + 2 * capVerts;
  const vPos = new Uint32Array(V);
  const vNrm = new Uint32Array(V);
  const uvMM = new Float32Array(V * 2);
  const uv01 = new Float32Array(V * 2);

  // Identifiants de normales : [0, rings·M) lisses sur le pourtour, puis une normale par sommet d'extrémité.
  const NN = rings * M + 2 * capVerts;
  const normals = new Float32Array(NN * 3);

  let vi = 0;
  const islandStart: number[] = [];
  islands.forEach((isl, k) => {
    islandStart.push(vi);
    const band = BANDS[isl.key];
    const { v, half } = islandV[k];
    for (let i = 0; i < rings; i++) {
      for (let c = 0; c <= isl.n; c++) {
        const j = (isl.j0 + c) % M;
        const pIdx = i * M + j;
        vPos[vi] = pIdx;
        vNrm[vi] = pIdx;
        const u = uCol[pIdx];
        const vv = v[i * (isl.n + 1) + c];
        uvMM[vi * 2] = u;
        uvMM[vi * 2 + 1] = islandOffset[k] + vv;
        uv01[vi * 2] = uMax > 0 ? u / uMax : 0;
        uv01[vi * 2 + 1] = band[0] + ((vv + half) / (2 * half)) * (band[1] - band[0]);
        vi++;
      }
    }
  });
  const capStart = [vi, vi + capVerts];
  const capSecs = [capSec0, capSec1];
  const capBounds = [sb0, sb1];
  const capIdx = [cap0Idx, cap1Idx];
  const capW0 = sb0.x1 - sb0.x0;
  for (let c = 0; c < 2; c++) {
    const sec = capSecs[c];
    const bb = capBounds[c];
    const uOff = c === 0 ? 0 : capW0 + gap;
    for (let g = 0; g < capVerts; g++) {
      vPos[vi] = capIdx[c][g];
      vNrm[vi] = rings * M + c * capVerts + g;
      const x = sec[g * 2] - bb.x0;
      const y = sec[g * 2 + 1] - bb.y0;
      uvMM[vi * 2] = uOff + x;
      uvMM[vi * 2 + 1] = capVBase + y;
      const w = Math.max(bb.x1 - bb.x0, 1e-6);
      const h = Math.max(bb.y1 - bb.y0, 1e-6);
      uv01[vi * 2] = (c === 0 ? 0 : 0.52) + (x / w) * 0.48;
      uv01[vi * 2 + 1] = BANDS.caps[0] + (y / h) * (BANDS.caps[1] - BANDS.caps[0]);
      vi++;
    }
  }

  // --- Quads par groupe
  const sideQuads = (rings - 1) * (2 * nW + 2 * nE);
  const capQuads = 2 * nW * nE;
  const quads = new Uint32Array((sideQuads + capQuads) * 4);
  let qi = 0;
  const push = (a: number, b: number, c: number, d: number) => {
    if (flip) {
      quads[qi++] = a;
      quads[qi++] = d;
      quads[qi++] = c;
      quads[qi++] = b;
    } else {
      quads[qi++] = a;
      quads[qi++] = b;
      quads[qi++] = c;
      quads[qi++] = d;
    }
  };
  const groupRanges: number[] = [];
  const sideIsland = (k: number) => {
    const isl = islands[k];
    const s0 = islandStart[k];
    const w = isl.n + 1;
    for (let i = 0; i < rings - 1; i++) {
      for (let c = 0; c < isl.n; c++) {
        push(s0 + i * w + c, s0 + (i + 1) * w + c, s0 + (i + 1) * w + c + 1, s0 + i * w + c + 1);
      }
    }
  };
  // face_coupe
  let start = qi / 4;
  sideIsland(0);
  groupRanges.push(start, qi / 4 - start);
  // face_libre
  start = qi / 4;
  sideIsland(1);
  groupRanges.push(start, qi / 4 - start);
  // flancs
  start = qi / 4;
  sideIsland(2);
  sideIsland(3);
  groupRanges.push(start, qi / 4 - start);
  // extremites
  start = qi / 4;
  for (let c = 0; c < 2; c++) {
    const s0 = capStart[c];
    for (let a = 0; a < nW; a++) {
      for (let b = 0; b < nE; b++) {
        const v00 = s0 + a * (nE + 1) + b;
        const v10 = s0 + (a + 1) * (nE + 1) + b;
        const v11 = s0 + (a + 1) * (nE + 1) + b + 1;
        const v01 = s0 + a * (nE + 1) + b + 1;
        if (c === 0) push(v00, v10, v11, v01);
        else push(v00, v01, v11, v10);
      }
    }
  }
  groupRanges.push(start, qi / 4 - start);

  // --- Normales (pondérées par l'aire)
  const nq = qi / 4;
  const capQuadStart = groupRanges[6];
  for (let q = 0; q < nq; q++) {
    const a = quads[q * 4];
    const b = quads[q * 4 + 1];
    const c = quads[q * 4 + 2];
    const d = quads[q * 4 + 3];
    const pa = vPos[a] * 3;
    const pb = vPos[b] * 3;
    const pc = vPos[c] * 3;
    const pd = vPos[d] * 3;
    // Produit vectoriel des diagonales = 2 × aire × normale
    const d1x = positions[pc] - positions[pa];
    const d1y = positions[pc + 1] - positions[pa + 1];
    const d1z = positions[pc + 2] - positions[pa + 2];
    const d2x = positions[pd] - positions[pb];
    const d2y = positions[pd + 1] - positions[pb + 1];
    const d2z = positions[pd + 2] - positions[pb + 2];
    const nx = d1y * d2z - d1z * d2y;
    const ny = d1z * d2x - d1x * d2z;
    const nz = d1x * d2y - d1y * d2x;
    const isCap = q >= capQuadStart;
    for (let k = 0; k < 4; k++) {
      const v = quads[q * 4 + k];
      const id = (isCap ? vNrm[v] : vPos[v]) * 3;
      normals[id] += nx;
      normals[id + 1] += ny;
      normals[id + 2] += nz;
    }
  }
  for (let k = 0; k < NN; k++) {
    const o = k * 3;
    const len = len3(normals[o], normals[o + 1], normals[o + 2]);
    if (len > 0) {
      normals[o] /= len;
      normals[o + 1] /= len;
      normals[o + 2] /= len;
    } else {
      normals[o + 1] = 1;
    }
  }

  // --- Couleurs de revenu : anneaux, puis intérieur des faces de rupture (presque nues)
  let colors: Float32Array | null = null;
  let temper: ChipMesh['temper'] = null;
  if (grid.temper) {
    const { chart, level } = grid.temper;
    colors = new Float32Array(P * 3);
    for (let k = 0; k < rings * M; k++) temperColor(chart, level[k], colors, k * 3);
    for (let c = 0; c < 2; c++) {
      let mean = 0;
      const ring = c === 0 ? 0 : rings - 1;
      for (let j = 0; j < M; j++) mean += level[ring * M + j] / M;
      const idx = c === 0 ? cap0Idx : cap1Idx;
      for (let g = 0; g < idx.length; g++) if (idx[g] >= rings * M) temperColor(chart, FRACTURE_TINT * mean, colors, idx[g] * 3);
    }
    temper = { chart, faces: temperFaces(chart, level, rings, nW, nE) };
  }

  const bounds = new Float32Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
  for (let k = 0; k < P; k++) {
    for (let c = 0; c < 3; c++) {
      const v = positions[k * 3 + c];
      if (v < bounds[c]) bounds[c] = v;
      if (v > bounds[3 + c]) bounds[3 + c] = v;
    }
  }

  return {
    positions,
    normals,
    vPos,
    vNrm,
    uvMM,
    uv01,
    quads,
    groups: Uint32Array.from(groupRanges),
    colliders: grid.colliders,
    bounds,
    colors,
    temper,
    info: grid.info,
  };
}

export function meshStats(m: ChipMesh): { quads: number; triangles: number; vertices: number } {
  const quads = m.quads.length / 4;
  return { quads, triangles: quads * 2, vertices: m.positions.length / 3 };
}

export { GROUP_NAMES };
