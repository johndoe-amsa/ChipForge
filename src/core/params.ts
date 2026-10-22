/**
 * Paramètres de génération d'un copeau et métadonnées d'interface associées.
 * Unités : longueurs en mm, micro-reliefs en µm, angles en degrés.
 */

import { TEMPER_CHART_OPTIONS, type TemperChart } from './temper';

export type BurrSide = 'aucun' | 'A' | 'B' | 'deux';
export type CrackSide = 'A' | 'B' | 'deux';

export interface ChipParams {
  // Macro-géométrie
  length: number;
  radius: number;
  radiusGrowth: number;
  pitch: number;
  ejectionAngle: number;
  twist: number;
  linkedSegments: number;
  linkAngle: number;
  tangle: number;
  avoidOverlap: boolean;
  // Section transversale
  width: number;
  thickness: number;
  taper: number;
  camber: number;
  camberShape: number;
  edgeThinning: number;
  // Bords
  edgeRoundness: number;
  burr: number;
  burrSide: BurrSide;
  crackDensity: number;
  crackDepth: number;
  crackIrregularity: number;
  crackSide: CrackSide;
  // Profil longitudinal
  thicknessStart: number;
  thicknessEnd: number;
  widthStart: number;
  widthEnd: number;
  endBreak: number;
  neck: number;
  // Micro-géométrie
  lamellaFreq: number;
  lamellaAmp: number;
  lamellaIrregularity: number;
  striationFreq: number;
  striationAmp: number;
  wavinessFreq: number;
  wavinessAmp: number;
  segmentFreq: number;
  segmentDepth: number;
  segmentSharpness: number;
  // Bruit
  macroNoise: number;
  macroNoiseScale: number;
  microNoise: number;
  microNoiseScale: number;
  thicknessNoise: number;
  // Couleurs de revenu
  temperLevel: number;
  temperSpread: number;
  temperScale: number;
  temperFaceBias: number;
  temperChart: TemperChart;
}

export type ParamKey = keyof ChipParams;

export type SectionId = 'macro' | 'section' | 'bords' | 'profil' | 'micro' | 'bruit' | 'couleur';

export const SECTIONS: { id: SectionId; title: string; hint: string }[] = [
  { id: 'macro', title: 'Macro-géométrie', hint: 'Forme globale : longueur, enroulement, hélice, torsion.' },
  { id: 'section', title: 'Section transversale', hint: 'Largeur, épaisseur et déformation plastique du profil.' },
  { id: 'bords', title: 'Bords', hint: 'Arêtes, bavures et craquelures latérales.' },
  { id: 'profil', title: 'Profil longitudinal', hint: 'Effilement le long de la fibre et cassure des extrémités.' },
  { id: 'micro', title: 'Micro-reliefs', hint: 'Lamelles de cisaillement, stries, ondulation et segmentation.' },
  { id: 'bruit', title: 'Bruit & irrégularités', hint: "Irrégularités aléatoires pour casser l'aspect synthétique." },
  {
    id: 'couleur',
    title: 'Couleurs de revenu',
    hint: "Teintes d'oxydation dues à l'échauffement à la coupe. Exportées en couleurs de sommets (OBJ, lues par Blender) et en couleur par face (STEP, matériaux MTL).",
  },
];

interface BaseDef {
  key: ParamKey;
  label: string;
  section: SectionId;
  hint: string;
}

export interface NumberDef extends BaseDef {
  kind: 'number';
  unit?: string;
  /** Bornes du curseur. */
  min: number;
  max: number;
  step: number;
  /** Bornes absolues acceptées en saisie numérique. */
  hardMin: number;
  hardMax: number;
  log?: boolean;
  integer?: boolean;
}

export interface BoolDef extends BaseDef {
  kind: 'bool';
}

export interface SelectDef extends BaseDef {
  kind: 'select';
  options: { value: string; label: string }[];
}

export type ParamDef = NumberDef | BoolDef | SelectDef;

function num(
  key: ParamKey,
  label: string,
  section: SectionId,
  unit: string | undefined,
  range: [number, number, number],
  hard: [number, number],
  hint: string,
  extra: Partial<NumberDef> = {},
): NumberDef {
  return {
    kind: 'number',
    key,
    label,
    section,
    unit,
    min: range[0],
    max: range[1],
    step: range[2],
    hardMin: hard[0],
    hardMax: hard[1],
    hint,
    ...extra,
  };
}

export const PARAM_DEFS: ParamDef[] = [
  // --- Macro
  num('length', 'Longueur déroulée', 'macro', 'mm', [0.5, 1000, 0.1], [0.2, 5000], 'Longueur développée de la fibre du copeau.', { log: true }),
  num('radius', "Rayon d'enroulement", 'macro', 'mm', [0.3, 500, 0.01], [0.1, 10000], "Rayon de courbure principal (grand = copeau presque droit).", { log: true }),
  num('radiusGrowth', 'Évolution du rayon', 'macro', 'mm/tour', [-2, 6, 0.01], [-20, 50], "Variation du rayon à chaque tour : > 0 donne une spirale ou une hélice conique.", {}),
  num('pitch', "Pas de l'hélice", 'macro', 'mm/tour', [0, 30, 0.01], [0, 500], "Avance axiale par tour (écartement des spires). 0 = spirale plate.", {}),
  num('ejectionAngle', "Angle d'éjection", 'macro', '°', [-90, 90, 0.5], [-180, 180], "Inclinaison de la section par rapport à l'axe d'enroulement (liée à l'angle de fuite). 0° : ruban posé sur le cylindre (tubulaire), 90° : section radiale (rondelles).", {}),
  num('twist', 'Torsion le long de la fibre', 'macro', '°/mm', [-60, 60, 0.1], [-720, 720], 'Rotation de la section autour de la fibre.', {}),
  num('linkedSegments', 'Segments liés', 'macro', undefined, [1, 8, 1], [1, 32], "Nombre d'arcs encore attachés (ISO 6.1). 1 = copeau d'un seul tenant.", { integer: true }),
  num('linkAngle', 'Angle aux liaisons', 'macro', '°', [0, 180, 1], [0, 360], 'Pliure en sens inverse entre deux arcs liés.', {}),
  num('tangle', 'Enchevêtrement', 'macro', undefined, [0, 1, 0.01], [0, 1], 'Pelote désordonnée et confinée (copeaux enchevêtrés ISO x.3).', {}),
  { kind: 'bool', key: 'avoidOverlap', label: 'Éviter les auto-intersections', section: 'macro', hint: "Écarte automatiquement les parties du copeau qui se traverseraient (spires, pelotes enchevêtrées, liaisons) en conservant sa longueur et son allure." },
  // --- Section
  num('width', 'Largeur (w)', 'section', 'mm', [0.1, 5, 0.01], [0.02, 50], 'Largeur du copeau (≈ profondeur de passe / largeur de plaquette).', {}),
  num('thickness', 'Épaisseur moyenne (e)', 'section', 'mm', [0.01, 0.5, 0.001], [0.005, 5], 'Épaisseur du copeau (≈ avance × taux de compression).', {}),
  num('taper', 'Section trapézoïdale', 'section', undefined, [-0.9, 0.9, 0.01], [-0.95, 0.95], "Écart d'épaisseur entre les deux bords (déformation plastique asymétrique).", {}),
  num('camber', 'Cambrure (section en V)', 'section', 'mm', [-1, 1, 0.005], [-10, 10], 'Flèche de la section à travers la largeur (forme imposée par le brise-copeaux).', {}),
  num('camberShape', 'Forme de cambrure', 'section', undefined, [0, 1, 0.01], [0, 1], '0 = arc arrondi, 1 = V marqué.', {}),
  num('edgeThinning', 'Amincissement des bords', 'section', undefined, [0, 0.9, 0.01], [0, 0.95], 'Les bords du copeau sont plus fins que le centre (section lenticulaire).', {}),
  // --- Bords
  num('edgeRoundness', 'Arrondi des arêtes', 'bords', undefined, [0, 1, 0.01], [0, 1], '0 = arêtes franches, 1 = flancs arrondis. Un léger arrondi accroche mieux les reflets au rendu.', {}),
  num('burr', 'Bavure', 'bords', 'µm', [0, 100, 0.5], [0, 1000], 'Lèvre de matière refoulée sur le bord, côté face libre.', {}),
  {
    kind: 'select',
    key: 'burrSide',
    label: 'Côté de la bavure',
    section: 'bords',
    hint: 'Bord concerné par la bavure.',
    options: [
      { value: 'aucun', label: 'Aucun' },
      { value: 'A', label: 'Bord A' },
      { value: 'B', label: 'Bord B' },
      { value: 'deux', label: 'Les deux' },
    ],
  },
  num('crackDensity', 'Craquelures latérales', 'bords', '/mm', [0, 20, 0.1], [0, 100], 'Nombre de fissures en V par mm le long du bord (bords dentelés).', {}),
  num('crackDepth', 'Profondeur des craquelures', 'bords', 'mm', [0, 1, 0.005], [0, 10], 'Pénétration maximale des fissures vers le centre.', {}),
  num('crackIrregularity', 'Irrégularité des craquelures', 'bords', undefined, [0, 1, 0.01], [0, 1], 'Variabilité de l’espacement et de la profondeur.', {}),
  {
    kind: 'select',
    key: 'crackSide',
    label: 'Bord(s) fissuré(s)',
    section: 'bords',
    hint: 'Bord du copeau portant les craquelures.',
    options: [
      { value: 'A', label: 'Bord A' },
      { value: 'B', label: 'Bord B' },
      { value: 'deux', label: 'Les deux' },
    ],
  },
  // --- Profil longitudinal
  num('thicknessStart', 'Épaisseur au début', 'profil', '× e', [0.05, 2, 0.01], [0.02, 5], "Facteur d'épaisseur au début de la fibre (copeau en virgule : épaisseur variable).", {}),
  num('thicknessEnd', 'Épaisseur à la fin', 'profil', '× e', [0.05, 2, 0.01], [0.02, 5], "Facteur d'épaisseur en fin de fibre.", {}),
  num('widthStart', 'Largeur au début', 'profil', '× w', [0.1, 2, 0.01], [0.05, 5], 'Facteur de largeur au début de la fibre.', {}),
  num('widthEnd', 'Largeur à la fin', 'profil', '× w', [0.1, 2, 0.01], [0.05, 5], 'Facteur de largeur en fin de fibre.', {}),
  num('endBreak', 'Cassure des extrémités', 'profil', undefined, [0, 1, 0.01], [0, 1], 'Irrégularité des faces de rupture aux deux bouts.', {}),
  num('neck', 'Étranglement aux liaisons', 'profil', undefined, [0, 0.9, 0.01], [0, 0.95], 'Amincissement du copeau aux points de liaison entre segments.', {}),
  // --- Micro
  num('lamellaFreq', 'Lamelles : fréquence', 'micro', '/mm', [0, 40, 0.1], [0, 200], 'Ridules transverses de cisaillement sur la face libre (le long de la fibre).', {}),
  num('lamellaAmp', 'Lamelles : amplitude', 'micro', 'µm', [0, 50, 0.1], [0, 500], 'Hauteur des lamelles.', {}),
  num('lamellaIrregularity', 'Lamelles : irrégularité', 'micro', undefined, [0, 1, 0.01], [0, 1], 'Ondulation et dispersion des lignes de lamelles.', {}),
  num('striationFreq', 'Stries : fréquence', 'micro', '/mm', [0, 40, 0.1], [0, 200], "Stries longitudinales sur la face de coupe (à travers la largeur, traces d'usure de l'outil).", {}),
  num('striationAmp', 'Stries : amplitude', 'micro', 'µm', [0, 20, 0.1], [0, 200], 'Profondeur des stries.', {}),
  num('wavinessFreq', 'Ondulation : fréquence', 'micro', '/mm', [0, 5, 0.01], [0, 50], 'Ondulation globale du ruban le long de la fibre.', {}),
  num('wavinessAmp', 'Ondulation : amplitude', 'micro', 'µm', [0, 200, 1], [0, 2000], "Amplitude de l'ondulation.", {}),
  num('segmentFreq', 'Segmentation : fréquence', 'micro', '/mm', [0, 30, 0.1], [0, 200], 'Crans en dents de scie (copeaux segmentés : titane, aciers durs).', {}),
  num('segmentDepth', 'Segmentation : profondeur', 'micro', '× e', [0, 0.8, 0.01], [0, 0.9], "Profondeur des crans rapportée à l'épaisseur.", {}),
  num('segmentSharpness', 'Segmentation : netteté', 'micro', undefined, [0, 1, 0.01], [0, 1], 'Raideur du front de cisaillement de chaque dent.', {}),
  // --- Bruit
  num('macroNoise', 'Bruit macro', 'bruit', undefined, [0, 1, 0.01], [0, 2], "Irrégularités de l'enroulement (courbure, pas, axe).", {}),
  num('macroNoiseScale', 'Échelle du bruit macro', 'bruit', 'mm', [0.5, 50, 0.1], [0.1, 500], 'Longueur caractéristique des irrégularités macro.', { log: true }),
  num('microNoise', 'Bruit de surface', 'bruit', 'µm', [0, 30, 0.1], [0, 300], 'Rugosité aléatoire des faces.', {}),
  num('microNoiseScale', 'Échelle du bruit de surface', 'bruit', 'mm', [0.02, 2, 0.01], [0.005, 20], 'Taille du grain de la rugosité.', { log: true }),
  num('thicknessNoise', "Bruit d'épaisseur", 'bruit', undefined, [0, 0.5, 0.01], [0, 0.9], "Variation aléatoire de l'épaisseur.", {}),
  // --- Couleurs de revenu
  num('temperLevel', 'Teinte de revenu', 'couleur', undefined, [0, 1, 0.01], [0, 1], "Position dans le nuancier d'oxydation : 0 = métal nu, puis (aciers) paille → or → bronze → pourpre → bleu → gris. Plus le copeau a chauffé, plus la teinte avance.", {}),
  num('temperSpread', 'Variation de teinte', 'couleur', undefined, [0, 0.5, 0.01], [0, 1], 'Écart de teinte le long du copeau (conditions de coupe changeantes) et, en mode tas, entre copeaux.', {}),
  num('temperScale', 'Échelle des variations', 'couleur', 'mm', [1, 200, 0.5], [0.5, 2000], 'Longueur sur laquelle la teinte change le long de la fibre.', { log: true }),
  num('temperFaceBias', 'Écart face de coupe / face libre', 'couleur', undefined, [-0.3, 0.3, 0.01], [-0.5, 0.5], "La face de coupe, frottée sur l'outil, chauffe davantage : sa teinte est en avance sur celle de la face libre.", {}),
  {
    kind: 'select',
    key: 'temperChart',
    label: "Famille d'oxydes",
    section: 'couleur',
    hint: 'Nuancier selon la matière (fixé par le preset de matière).',
    options: TEMPER_CHART_OPTIONS,
  },
];

export const PARAM_DEF_MAP: Record<ParamKey, ParamDef> = Object.fromEntries(
  PARAM_DEFS.map((d) => [d.key, d]),
) as Record<ParamKey, ParamDef>;

export const DEFAULT_PARAMS: ChipParams = {
  length: 30,
  radius: 2.5,
  radiusGrowth: 0,
  pitch: 1.4,
  ejectionAngle: 0,
  twist: 0,
  linkedSegments: 1,
  linkAngle: 60,
  tangle: 0,
  avoidOverlap: true,
  width: 1.2,
  thickness: 0.12,
  taper: 0.1,
  camber: 0.05,
  camberShape: 0.3,
  edgeThinning: 0.3,
  edgeRoundness: 0.35,
  burr: 0,
  burrSide: 'aucun',
  crackDensity: 2,
  crackDepth: 0.06,
  crackIrregularity: 0.6,
  crackSide: 'B',
  thicknessStart: 1,
  thicknessEnd: 1,
  widthStart: 1,
  widthEnd: 1,
  endBreak: 0.5,
  neck: 0.4,
  lamellaFreq: 8,
  lamellaAmp: 4,
  lamellaIrregularity: 0.5,
  striationFreq: 6,
  striationAmp: 1,
  wavinessFreq: 0.3,
  wavinessAmp: 10,
  segmentFreq: 0,
  segmentDepth: 0,
  segmentSharpness: 0.6,
  macroNoise: 0.25,
  macroNoiseScale: 6,
  microNoise: 1.5,
  microNoiseScale: 0.15,
  thicknessNoise: 0.08,
  temperLevel: 0,
  temperSpread: 0.15,
  temperScale: 25,
  temperFaceBias: 0.06,
  temperChart: 'fer',
};

/**
 * Valide et normalise un objet de paramètres d'origine non fiable (import JSON).
 * Seules les clés connues sont lues ; toute valeur invalide retombe sur `fallback`.
 */
export function sanitizeParams(input: unknown, fallback: ChipParams = DEFAULT_PARAMS): ChipParams {
  const out: ChipParams = { ...fallback };
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return out;
  const src = input as Record<string, unknown>;
  for (const def of PARAM_DEFS) {
    if (!Object.prototype.hasOwnProperty.call(src, def.key)) continue;
    const v = src[def.key];
    if (def.kind === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      let x = Math.min(def.hardMax, Math.max(def.hardMin, v));
      if (def.integer) x = Math.round(x);
      (out as unknown as Record<string, number>)[def.key] = x;
    } else if (def.kind === 'bool') {
      if (typeof v === 'boolean') (out as unknown as Record<string, boolean>)[def.key] = v;
    } else if (typeof v === 'string' && def.options.some((o) => o.value === v)) {
      (out as unknown as Record<string, string>)[def.key] = v;
    }
  }
  return out;
}

/** Clamp numérique sur les bornes absolues, utilisé par l'interface. */
export function clampParam(def: NumberDef, v: number): number {
  let x = Math.min(def.hardMax, Math.max(def.hardMin, v));
  if (def.integer) x = Math.round(x);
  return x;
}

/** Réglages de discrétisation du maillage. */
export interface QualitySettings {
  /** Anneaux par mm le long de la fibre (minimum, augmenté automatiquement pour les micro-reliefs). */
  densityAlong: number;
  /** Segments à travers la largeur (par face). */
  widthSegments: number;
  /** Segments à travers l'épaisseur (par flanc). */
  thicknessSegments: number;
  /** Anneaux minimum par tour d'enroulement. */
  ringsPerTurn: number;
  /** Plafond de sommets pour un copeau. */
  maxVertices: number;
  /** Résoudre automatiquement les micro-reliefs dans la limite du budget. */
  resolveMicro: boolean;
  /** Échantillons par période de micro-relief visés lors de la résolution automatique. */
  microSamples: number;
}

/** Aperçu interactif : fluide pendant le réglage des curseurs. */
export const PREVIEW_QUALITY: QualitySettings = {
  densityAlong: 4,
  widthSegments: 12,
  thicknessSegments: 4,
  ringsPerTurn: 36,
  maxVertices: 70_000,
  resolveMicro: true,
  microSamples: 4,
};

/** Aperçu détaillé : micro-reliefs visibles, plus lent. */
export const DETAILED_QUALITY: QualitySettings = {
  densityAlong: 8,
  widthSegments: 20,
  thicknessSegments: 5,
  ringsPerTurn: 56,
  maxVertices: 400_000,
  resolveMicro: true,
  microSamples: 6,
};

export const EXPORT_QUALITY: QualitySettings = {
  densityAlong: 12,
  widthSegments: 24,
  thicknessSegments: 6,
  ringsPerTurn: 72,
  maxVertices: 1_500_000,
  resolveMicro: true,
  microSamples: 6,
};

export const STEP_QUALITY: QualitySettings = {
  densityAlong: 3,
  widthSegments: 8,
  thicknessSegments: 4,
  ringsPerTurn: 24,
  maxVertices: 120_000,
  resolveMicro: false,
  microSamples: 3,
};
