/** Transformation rigide d'un copeau : rotation (quaternion x, y, z, w) puis translation (mm). */
export interface RigidTransform {
  q: [number, number, number, number];
  t: [number, number, number];
}

export const IDENTITY: RigidTransform = { q: [0, 0, 0, 1], t: [0, 0, 0] };

/** Matrice de rotation 3×3 (lignes) d'un quaternion unitaire. */
export function quatToMatrix(q: readonly number[]): number[] {
  const [x, y, z, w] = q;
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  const xy = x * y;
  const xz = x * z;
  const yz = y * z;
  const wx = w * x;
  const wy = w * y;
  const wz = w * z;
  return [
    1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy),
    2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx),
    2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy),
  ];
}

/** Applique la transformation aux positions (stride 3) et renvoie un nouveau tableau. */
export function transformPoints(src: ArrayLike<number>, tr: RigidTransform, scale = 1): Float64Array {
  const R = quatToMatrix(tr.q);
  const out = new Float64Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i];
    const y = src[i + 1];
    const z = src[i + 2];
    out[i] = (R[0] * x + R[1] * y + R[2] * z + tr.t[0]) * scale;
    out[i + 1] = (R[3] * x + R[4] * y + R[5] * z + tr.t[1]) * scale;
    out[i + 2] = (R[6] * x + R[7] * y + R[8] * z + tr.t[2]) * scale;
  }
  return out;
}

export function rotateVectors(src: ArrayLike<number>, tr: RigidTransform): Float64Array {
  return transformPoints(src, { q: tr.q, t: [0, 0, 0] });
}

/** Nom de fichier sûr (ASCII, sans séparateurs de chemin). */
export function safeFileName(name: string, fallback = 'chipforge'): string {
  const s = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._]+/, '')
    .slice(0, 80);
  return s || fallback;
}
