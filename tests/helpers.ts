import type { ChipMesh } from '../src/core/geometry/mesh';

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
