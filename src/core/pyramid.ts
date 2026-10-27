import type { Rng } from './rng';

/**
 * Tas en pyramide du mode tas : pyramide à base carrée posée sur la grille, centrée sur
 * l'origine (repère Y vertical, mm). Avec la simulation physique, les copeaux sont versés dans
 * un moule pyramidal invisible, là où la pyramide est la plus haute ; le moule est ensuite retiré
 * et le tas se tasse encore un peu (comme un pâté de sable démoulé).
 */

export interface PyramidGeometry {
  /** Demi-côté de la base (mm). */
  half: number;
  /** Hauteur du sommet (mm). */
  height: number;
  /** Pente des faces (degrés). */
  slope: number;
}

/** Pente bornée à ce que la pile peut tenir (degrés). */
export const PYRAMID_SLOPE_RANGE: [number, number] = [15, 65];

/**
 * Part du volume de la boîte englobante d'un copeau qu'il occupe une fois tassé dans un tas
 * (vide compris) : les copeaux, minces et creux, s'emboîtent.
 */
export const PILE_BULK_FACTOR = 0.35;

export function clampSlope(slopeDeg: number): number {
  return Math.min(PYRAMID_SLOPE_RANGE[1], Math.max(PYRAMID_SLOPE_RANGE[0], Number.isFinite(slopeDeg) ? slopeDeg : 40));
}

/**
 * Pyramide dont le volume accueille les copeaux tassés : volumes de leurs boîtes englobantes (mm³),
 * pente des faces (degrés). Volume = 4/3 · a² · H avec H = a · tan(pente).
 */
export function pyramidGeometry(boxVolumes: number[], slopeDeg: number): PyramidGeometry {
  const slope = clampSlope(slopeDeg);
  const tan = Math.tan((slope * Math.PI) / 180);
  const V = PILE_BULK_FACTOR * boxVolumes.reduce((s, v) => s + (Number.isFinite(v) && v > 0 ? v : 0), 0);
  const half = Math.max(1e-3, Math.cbrt((3 * V) / (4 * tan)));
  return { half, height: half * tan, slope };
}

/**
 * Point tiré uniformément dans le volume de la pyramide. Sa projection (x, z) sert de point de
 * chute : densité proportionnelle à la hauteur de la pyramide à sa verticale, si bien que les
 * copeaux versés en dessinent la forme.
 */
export function pyramidPoint(rng: Rng, g: PyramidGeometry): [number, number, number] {
  // Section à la hauteur relative h : carré de demi-côté a(1 − h), d'aire ∝ (1 − h)².
  const h = 1 - Math.cbrt(1 - rng.next());
  const a = g.half * (1 - h);
  return [rng.range(-a, a), h * g.height, rng.range(-a, a)];
}
