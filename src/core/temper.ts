import type { ChipParams } from './params';
import { Noise } from './noise';

/**
 * Couleurs de revenu : teintes d'oxydation que prend un copeau échauffé par la coupe.
 *
 * Une fine couche d'oxyde se forme à chaud ; son épaisseur (donc la température atteinte)
 * fixe la couleur par interférence : paille → or → bronze → pourpre → bleu → gris pour les
 * aciers (nuancier classique des « couleurs de revenu »), suite voisine pour le titane, teintes
 * rouges puis brunes pour le cuivre, ternissement pour le laiton et l'aluminium.
 *
 * Le niveau de teinte (0 = métal nu, 1 = fin du nuancier) varie sur le copeau : lentement le
 * long de la fibre (conditions de coupe), d'une face à l'autre (la face de coupe, frottée sur
 * l'outil, est la plus chaude) et un peu vers les bords. Les faces de rupture, cassées à froid,
 * restent presque nues. Couleurs exprimées en sRGB (0–1) : couleur de base d'un matériau
 * métallique (Blender : Base Color, Metallic = 1).
 */

export type TemperChart = 'aucune' | 'fer' | 'titane' | 'cuivre' | 'laiton' | 'aluminium';

export const TEMPER_CHART_OPTIONS: { value: TemperChart; label: string }[] = [
  { value: 'fer', label: 'Aciers, inox, superalliages' },
  { value: 'titane', label: 'Titane' },
  { value: 'cuivre', label: 'Cuivre' },
  { value: 'laiton', label: 'Laiton' },
  { value: 'aluminium', label: 'Aluminium' },
  { value: 'aucune', label: 'Aucune (pas de teinte)' },
];

export type RGB = [number, number, number];

interface Stop {
  at: number;
  name: string;
  rgb: RGB;
}

/** Nuanciers : niveau 0 = métal nu (réflectance du métal), puis teintes d'oxyde croissantes. */
const CHARTS: Record<Exclude<TemperChart, 'aucune'>, Stop[]> = {
  fer: [
    { at: 0, name: 'nu', rgb: [0.77, 0.78, 0.79] },
    { at: 0.12, name: 'paille_clair', rgb: [0.9, 0.86, 0.68] },
    { at: 0.22, name: 'paille', rgb: [0.88, 0.76, 0.46] },
    { at: 0.32, name: 'or', rgb: [0.82, 0.62, 0.3] },
    { at: 0.42, name: 'bronze', rgb: [0.68, 0.44, 0.24] },
    { at: 0.52, name: 'pourpre', rgb: [0.56, 0.3, 0.36] },
    { at: 0.6, name: 'violet', rgb: [0.42, 0.26, 0.52] },
    { at: 0.68, name: 'bleu_fonce', rgb: [0.22, 0.26, 0.6] },
    { at: 0.76, name: 'bleu', rgb: [0.24, 0.44, 0.76] },
    { at: 0.86, name: 'bleu_clair', rgb: [0.5, 0.66, 0.84] },
    { at: 1, name: 'gris_bleu', rgb: [0.56, 0.62, 0.68] },
  ],
  titane: [
    { at: 0, name: 'nu', rgb: [0.76, 0.73, 0.7] },
    { at: 0.15, name: 'paille', rgb: [0.86, 0.78, 0.52] },
    { at: 0.28, name: 'or', rgb: [0.82, 0.64, 0.3] },
    { at: 0.4, name: 'bronze', rgb: [0.64, 0.42, 0.26] },
    { at: 0.52, name: 'pourpre', rgb: [0.52, 0.3, 0.5] },
    { at: 0.64, name: 'bleu', rgb: [0.26, 0.36, 0.74] },
    { at: 0.76, name: 'bleu_clair', rgb: [0.46, 0.64, 0.84] },
    { at: 0.88, name: 'gris_bleu', rgb: [0.62, 0.68, 0.74] },
    { at: 1, name: 'gris', rgb: [0.58, 0.58, 0.58] },
  ],
  cuivre: [
    { at: 0, name: 'nu', rgb: [0.98, 0.82, 0.75] },
    { at: 0.15, name: 'dore', rgb: [0.95, 0.7, 0.45] },
    { at: 0.3, name: 'orange', rgb: [0.88, 0.5, 0.28] },
    { at: 0.45, name: 'rouge', rgb: [0.66, 0.28, 0.22] },
    { at: 0.58, name: 'pourpre', rgb: [0.48, 0.24, 0.38] },
    { at: 0.7, name: 'bleu_gris', rgb: [0.36, 0.4, 0.52] },
    { at: 0.85, name: 'brun', rgb: [0.36, 0.24, 0.18] },
    { at: 1, name: 'noir', rgb: [0.16, 0.13, 0.12] },
  ],
  laiton: [
    { at: 0, name: 'nu', rgb: [0.96, 0.89, 0.66] },
    { at: 0.2, name: 'dore', rgb: [0.9, 0.74, 0.42] },
    { at: 0.4, name: 'brun_or', rgb: [0.72, 0.52, 0.3] },
    { at: 0.6, name: 'pourpre', rgb: [0.5, 0.32, 0.36] },
    { at: 0.8, name: 'brun', rgb: [0.36, 0.28, 0.22] },
    { at: 1, name: 'sombre', rgb: [0.2, 0.17, 0.15] },
  ],
  aluminium: [
    { at: 0, name: 'nu', rgb: [0.96, 0.96, 0.97] },
    { at: 0.35, name: 'terne', rgb: [0.8, 0.8, 0.78] },
    { at: 0.7, name: 'gris', rgb: [0.62, 0.62, 0.61] },
    { at: 1, name: 'sombre', rgb: [0.4, 0.4, 0.4] },
  ],
};

/** Vrai si le copeau porte des couleurs de revenu. */
export function temperActive(p: ChipParams): boolean {
  return p.temperChart !== 'aucune' && p.temperLevel > 0;
}

/** Couleur (sRGB 0–1) du nuancier au niveau donné, écrite dans out[o..o+2]. */
export function temperColor(chart: TemperChart, level: number, out: ArrayLike<number> & { [i: number]: number }, o = 0): void {
  const stops = CHARTS[chart === 'aucune' ? 'fer' : chart];
  const x = Math.min(1, Math.max(0, level));
  let k = 1;
  while (k < stops.length - 1 && stops[k].at < x) k++;
  const a = stops[k - 1];
  const b = stops[k];
  const t = b.at > a.at ? Math.min(1, Math.max(0, (x - a.at) / (b.at - a.at))) : 0;
  for (let c = 0; c < 3; c++) out[o + c] = a.rgb[c] + (b.rgb[c] - a.rgb[c]) * t;
}

/** Couleur du métal nu (niveau 0). */
export function temperBase(chart: TemperChart): RGB {
  return [...CHARTS[chart === 'aucune' ? 'fer' : chart][0].rgb];
}

/** Teinte nommée la plus proche d'un niveau (nom et couleur de l'étape du nuancier). */
export function temperShade(chart: TemperChart, level: number): { name: string; rgb: RGB } {
  const stops = CHARTS[chart === 'aucune' ? 'fer' : chart];
  let best = stops[0];
  for (const s of stops) if (Math.abs(s.at - level) < Math.abs(best.at - level)) best = s;
  return { name: best.name, rgb: [...best.rgb] };
}

/**
 * Champ de niveau de teinte d'un copeau : fonction déterministe de l'abscisse s et de la
 * position j sur le périmètre de la section (même découpage que la grille du copeau).
 */
export class TemperField {
  private readonly noise: Noise;
  private readonly zone: Float64Array;
  private readonly edge: Float64Array;

  constructor(
    private readonly p: ChipParams,
    seed: number,
    nW: number,
    nE: number,
  ) {
    this.noise = new Noise(seed ^ 0x7e3a91c5);
    const M = 2 * nW + 2 * nE;
    this.zone = new Float64Array(M);
    this.edge = new Float64Array(M);
    for (let j = 0; j < M; j++) {
      let xi: number;
      if (j < nW) {
        xi = -1 + (2 * j) / nW;
        this.zone[j] = 1;
      } else if (j < nW + nE) {
        xi = 1;
      } else if (j < 2 * nW + nE) {
        xi = 1 - (2 * (j - nW - nE)) / nW;
        this.zone[j] = -1;
      } else {
        xi = -1;
      }
      this.edge[j] = xi * xi * xi * xi;
    }
  }

  /** Niveau de teinte (0–1) au point (s, j). */
  level(s: number, j: number): number {
    const p = this.p;
    const sc = Math.max(0.5, p.temperScale);
    const sp = p.temperSpread;
    const n = this.noise;
    // Variations lentes le long de la fibre (conditions de coupe), plus fines superposées.
    const along = 0.75 * n.vfbm1(s / sc + 31.7, 3) + 0.25 * n.noise1(s / (0.22 * sc) + 7.1);
    const v = p.temperLevel + sp * along + 0.5 * p.temperFaceBias * this.zone[j] + 0.12 * sp * this.edge[j];
    return Math.min(1, Math.max(0, v));
  }
}

export interface TemperFace {
  /** Niveau moyen de la face. */
  level: number;
  /** Couleur moyenne de la face (sRGB 0–1). */
  rgb: RGB;
  /** Teinte nommée la plus proche (matériaux MTL). */
  shade: string;
  shadeRgb: RGB;
}

/** Les faces de rupture, cassées à froid, ne gardent qu'une trace de la teinte. */
export const FRACTURE_TINT = 0.25;

/**
 * Niveau moyen par groupe de faces (ordre : face_coupe, face_libre, flancs, extremites),
 * pour une grille de `rings` anneaux de `M = 2 nW + 2 nE` sommets.
 */
export function temperFaces(chart: TemperChart, level: Float32Array, rings: number, nW: number, nE: number): TemperFace[] {
  const M = 2 * nW + 2 * nE;
  const sum = [0, 0, 0];
  const cnt = [0, 0, 0];
  const col = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const tmp: number[] = [0, 0, 0];
  let ends = 0;
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < M; j++) {
      const g = j < nW ? 0 : j < nW + nE ? 2 : j < 2 * nW + nE ? 1 : 2;
      const v = level[i * M + j];
      sum[g] += v;
      cnt[g]++;
      temperColor(chart, v, tmp);
      for (let c = 0; c < 3; c++) col[g][c] += tmp[c];
      if (i === 0 || i === rings - 1) ends += v;
    }
  const faces: TemperFace[] = [0, 1, 2].map((g) => {
    const lv = cnt[g] ? sum[g] / cnt[g] : 0;
    const sh = temperShade(chart, lv);
    return { level: lv, rgb: col[g].map((c) => c / Math.max(1, cnt[g])) as RGB, shade: sh.name, shadeRgb: sh.rgb };
  });
  const capLv = (FRACTURE_TINT * ends) / Math.max(1, 2 * M);
  const capRgb: RGB = [0, 0, 0];
  temperColor(chart, capLv, capRgb);
  const capShade = temperShade(chart, capLv);
  faces.push({ level: capLv, rgb: capRgb, shade: capShade.name, shadeRgb: capShade.rgb });
  return faces;
}
