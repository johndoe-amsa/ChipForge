/**
 * Bac à copeaux du mode tas : bac rectangulaire ouvert (fond + 4 parois), posé sur la grille,
 * centré sur l'origine, dessus du fond à y = 0 (repère Y vertical, mm).
 * Sert à la fois à la simulation physique (parois fixes), à l'aperçu et à l'export.
 */

export type Container = 'sol' | 'bac';

export interface BinGeometry {
  /** Dimensions intérieures (mm) : longueur (X), largeur (Z), hauteur des parois (Y). */
  length: number;
  width: number;
  height: number;
  /** Épaisseur des parois et du fond (mm). */
  wall: number;
}

/** Pavé : centre et demi-dimensions (mm, repère Y vertical). */
export interface Box {
  center: [number, number, number];
  half: [number, number, number];
}

/**
 * Dimensions du bac : celles demandées (mm, 0 = automatique), sinon déduites de la taille et du
 * nombre de copeaux (rayon englobant de chacun) : le monticule touche les parois sans les noyer.
 */
export function binGeometry(request: { length: number; width: number; height: number }, radii: number[]): BinGeometry {
  const n = Math.max(1, radii.length);
  const mean = radii.reduce((a, b) => a + b, 0) / n || 1;
  const max = Math.max(...radii, mean);
  const autoL = Math.max(3.2 * max, 1.9 * mean * Math.sqrt(n));
  const length = request.length > 0 ? request.length : autoL;
  const width = request.width > 0 ? request.width : Math.max(2.2 * max, 0.62 * length);
  const height = request.height > 0 ? request.height : Math.max(1.4 * mean, 0.28 * length);
  const wall = Math.max(0.6, 0.012 * Math.max(length, width));
  return { length, width, height, wall };
}

/** Fond et parois du bac (les parois recouvrent le fond aux angles : solide sans jour). */
export function binBoxes(b: BinGeometry): Box[] {
  const hx = b.length / 2;
  const hz = b.width / 2;
  const t = b.wall;
  const hy = b.height / 2;
  return [
    { center: [0, -t / 2, 0], half: [hx + t, t / 2, hz + t] },
    { center: [-hx - t / 2, hy, 0], half: [t / 2, hy, hz + t] },
    { center: [hx + t / 2, hy, 0], half: [t / 2, hy, hz + t] },
    { center: [0, hy, -hz - t / 2], half: [hx, hy, t / 2] },
    { center: [0, hy, hz + t / 2], half: [hx, hy, t / 2] },
  ];
}

/** Sommets d'un pavé : bit 0 → +x, bit 1 → +y, bit 2 → +z. */
export function boxCorners(box: Box): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < 8; i++) {
    out.push([
      box.center[0] + (i & 1 ? 1 : -1) * box.half[0],
      box.center[1] + (i & 2 ? 1 : -1) * box.half[1],
      box.center[2] + (i & 4 ? 1 : -1) * box.half[2],
    ]);
  }
  return out;
}

/**
 * Faces d'un pavé : 4 indices de sommets (boxCorners) dans l'ordre anti-horaire vu de
 * l'extérieur, et normale sortante.
 */
export const BOX_FACES: { v: [number, number, number, number]; n: [number, number, number] }[] = [
  { v: [0, 4, 6, 2], n: [-1, 0, 0] },
  { v: [1, 3, 7, 5], n: [1, 0, 0] },
  { v: [0, 1, 5, 4], n: [0, -1, 0] },
  { v: [2, 6, 7, 3], n: [0, 1, 0] },
  { v: [0, 2, 3, 1], n: [0, 0, -1] },
  { v: [4, 5, 7, 6], n: [0, 0, 1] },
];
