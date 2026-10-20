import type { ChipMesh } from '../src/core/geometry/mesh';
import type { ChipGrid } from '../src/core/geometry/chip';

/**
 * Contrôle indépendant des auto-intersections, sur la géométrie finale (et non sur la fibre) :
 * aucun sommet d'un anneau éloigné le long du copeau ne doit tomber à l'intérieur de la
 * section d'un autre anneau (tranche dont l'épaisseur est l'écart entre anneaux).
 * Renvoie le nombre de sommets en pénétration.
 */
export function countSelfPenetrations(g: ChipGrid, exclusionArc: number): number {
  const { rings, M, nW, pos } = g;
  const C = new Float64Array(rings * 3);
  const Tv = new Float64Array(rings * 3);
  const Wv = new Float64Array(rings * 3);
  const Hv = new Float64Array(rings * 3);
  const R = new Float64Array(rings);
  const arc = new Float64Array(rings);
  const slab = new Float64Array(rings);
  const poly = new Float64Array(rings * M * 2);
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < M; j++) for (let a = 0; a < 3; a++) C[i * 3 + a] += pos[(i * M + j) * 3 + a] / M;
  }
  const dist = (a: number, b: number) => Math.hypot(C[a * 3] - C[b * 3], C[a * 3 + 1] - C[b * 3 + 1], C[a * 3 + 2] - C[b * 3 + 2]);
  for (let i = 0; i < rings; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(rings - 1, i + 1);
    let tx = C[b * 3] - C[a * 3];
    let ty = C[b * 3 + 1] - C[a * 3 + 1];
    let tz = C[b * 3 + 2] - C[a * 3 + 2];
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl;
    ty /= tl;
    tz /= tl;
    const o0 = (i * M) * 3;
    const o1 = (i * M + nW) * 3;
    let wx = pos[o1] - pos[o0];
    let wy = pos[o1 + 1] - pos[o0 + 1];
    let wz = pos[o1 + 2] - pos[o0 + 2];
    const d = wx * tx + wy * ty + wz * tz;
    wx -= d * tx;
    wy -= d * ty;
    wz -= d * tz;
    const wl = Math.hypot(wx, wy, wz) || 1;
    wx /= wl;
    wy /= wl;
    wz /= wl;
    const hx = ty * wz - tz * wy;
    const hy = tz * wx - tx * wz;
    const hz = tx * wy - ty * wx;
    Tv.set([tx, ty, tz], i * 3);
    Wv.set([wx, wy, wz], i * 3);
    Hv.set([hx, hy, hz], i * 3);
    for (let j = 0; j < M; j++) {
      const o = (i * M + j) * 3;
      const px = pos[o] - C[i * 3];
      const py = pos[o + 1] - C[i * 3 + 1];
      const pz = pos[o + 2] - C[i * 3 + 2];
      R[i] = Math.max(R[i], Math.hypot(px, py, pz));
      poly[(i * M + j) * 2] = px * wx + py * wy + pz * wz;
      poly[(i * M + j) * 2 + 1] = px * hx + py * hy + pz * hz;
    }
    if (i > 0) arc[i] = arc[i - 1] + dist(i, i - 1);
    slab[i] = 0.5 * Math.max(i > 0 ? dist(i, i - 1) : 0, i < rings - 1 ? dist(i, i + 1) : 0);
  }
  let maxR = 0;
  for (let i = 0; i < rings; i++) maxR = Math.max(maxR, R[i]);
  const cell = 2 * maxR + 1e-6;
  const grid = new Map<string, number[]>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  for (let i = 0; i < rings; i++) {
    const k = key(Math.floor(C[i * 3] / cell), Math.floor(C[i * 3 + 1] / cell), Math.floor(C[i * 3 + 2] / cell));
    const b = grid.get(k);
    if (b) b.push(i);
    else grid.set(k, [i]);
  }
  const inside = (i: number, x: number, y: number) => {
    let c = false;
    for (let j = 0, k = M - 1; j < M; k = j++) {
      const xj = poly[(i * M + j) * 2];
      const yj = poly[(i * M + j) * 2 + 1];
      const xk = poly[(i * M + k) * 2];
      const yk = poly[(i * M + k) * 2 + 1];
      if (yj > y !== yk > y && x < ((xk - xj) * (y - yj)) / (yk - yj) + xj) c = !c;
    }
    return c;
  };
  let count = 0;
  for (let i = 0; i < rings; i++) {
    const gx = Math.floor(C[i * 3] / cell);
    const gy = Math.floor(C[i * 3 + 1] / cell);
    const gz = Math.floor(C[i * 3 + 2] / cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          for (const j of grid.get(key(gx + dx, gy + dy, gz + dz)) ?? []) {
            if (Math.abs(arc[i] - arc[j]) <= exclusionArc || dist(i, j) > R[i] + R[j]) continue;
            for (let v = 0; v < M; v++) {
              const o = (j * M + v) * 3;
              const px = pos[o] - C[i * 3];
              const py = pos[o + 1] - C[i * 3 + 1];
              const pz = pos[o + 2] - C[i * 3 + 2];
              const t = px * Tv[i * 3] + py * Tv[i * 3 + 1] + pz * Tv[i * 3 + 2];
              if (Math.abs(t) > slab[i]) continue;
              const x = px * Wv[i * 3] + py * Wv[i * 3 + 1] + pz * Wv[i * 3 + 2];
              const y = px * Hv[i * 3] + py * Hv[i * 3 + 1] + pz * Hv[i * 3 + 2];
              if (inside(i, x, y)) count++;
            }
          }
        }
  }
  return count;
}

/**
 * Contrôle indépendant des pliures locales : entre deux anneaux consécutifs, chaque sommet doit
 * avancer dans le sens de la fibre (sinon la surface se retourne : le copeau se plie sur
 * lui-même, sur sa largeur ou son épaisseur). Les micro-reculs d'un bord d'entaille (fissure),
 * inférieurs à 20 % de l'écart entre anneaux, ne sont pas des pliures.
 * Renvoie le nombre de sommets qui reculent.
 */
export function countFolds(g: ChipGrid): number {
  const { rings, M, pos } = g;
  const C = new Float64Array(rings * 3);
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < M; j++) for (let a = 0; a < 3; a++) C[i * 3 + a] += pos[(i * M + j) * 3 + a] / M;
  let count = 0;
  for (let i = 0; i < rings - 1; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(rings - 1, i + 2);
    let tx = C[b * 3] - C[a * 3];
    let ty = C[b * 3 + 1] - C[a * 3 + 1];
    let tz = C[b * 3 + 2] - C[a * 3 + 2];
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl;
    ty /= tl;
    tz /= tl;
    const hs = Math.hypot(C[i * 3 + 3] - C[i * 3], C[i * 3 + 4] - C[i * 3 + 1], C[i * 3 + 5] - C[i * 3 + 2]);
    for (let j = 0; j < M; j++) {
      const o = (i * M + j) * 3;
      const q = o + M * 3;
      if ((pos[q] - pos[o]) * tx + (pos[q + 1] - pos[o + 1]) * ty + (pos[q + 2] - pos[o + 2]) * tz < -0.2 * hs) count++;
    }
  }
  return count;
}

/** Vérifie qu'un maillage quad est une 2-variété fermée orientée : chaque arête orientée apparaît une fois, et son opposée une fois. */
export function checkClosedManifold(m: ChipMesh): { ok: boolean; boundary: number; nonManifold: number } {
  const directed = new Map<number, number>();
  const P = m.positions.length / 3;
  const nq = m.quads.length / 4;
  for (let q = 0; q < nq; q++) {
    for (let k = 0; k < 4; k++) {
      const a = m.vPos[m.quads[q * 4 + k]];
      const b = m.vPos[m.quads[q * 4 + ((k + 1) % 4)]];
      if (a === b) continue;
      const key = a * P + b;
      directed.set(key, (directed.get(key) ?? 0) + 1);
    }
  }
  let boundary = 0;
  let nonManifold = 0;
  for (const [key, count] of directed) {
    if (count > 1) nonManifold++;
    const a = Math.floor(key / P);
    const b = key % P;
    if (!directed.has(b * P + a)) boundary++;
  }
  return { ok: boundary === 0 && nonManifold === 0, boundary, nonManifold };
}

export function meshVolume(m: ChipMesh): number {
  let vol = 0;
  const p = m.positions;
  const nq = m.quads.length / 4;
  const tri = (a: number, b: number, c: number) => {
    const ia = m.vPos[a] * 3;
    const ib = m.vPos[b] * 3;
    const ic = m.vPos[c] * 3;
    vol +=
      p[ia] * (p[ib + 1] * p[ic + 2] - p[ib + 2] * p[ic + 1]) -
      p[ia + 1] * (p[ib] * p[ic + 2] - p[ib + 2] * p[ic]) +
      p[ia + 2] * (p[ib] * p[ic + 1] - p[ib + 1] * p[ic]);
  };
  for (let q = 0; q < nq; q++) {
    const [a, b, c, d] = [m.quads[q * 4], m.quads[q * 4 + 1], m.quads[q * 4 + 2], m.quads[q * 4 + 3]];
    tri(a, b, c);
    tri(a, c, d);
  }
  return vol / 6;
}

export function allFinite(arr: ArrayLike<number>): boolean {
  for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) return false;
  return true;
}
