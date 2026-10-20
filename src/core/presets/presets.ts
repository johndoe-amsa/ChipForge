import { DEFAULT_PARAMS, sanitizeParams, type ChipParams } from '../params';
import { Rng, hashSeed } from '../rng';

/**
 * Presets : Matière × Procédé × Forme ISO 3685.
 *  - la matière fixe les dimensions de base et la micro-géométrie (lamelles, crans, bords),
 *  - la forme ISO fixe la macro-géométrie (enroulement, longueur, enchevêtrement),
 *  - le procédé ajuste la section et le profil longitudinal (virgule de fraisage, cône de perçage…).
 */

export type ChipQuality = 'bon' | 'acceptable' | 'mauvais';

export interface FormPreset {
  id: string;
  family: number;
  familyName: string;
  variant: string;
  quality: ChipQuality;
  description: string;
  apply: (p: ChipParams) => void;
}

export interface MaterialPreset {
  id: string;
  name: string;
  grade: string;
  description: string;
  apply: (p: ChipParams) => void;
}

export interface ProcessPreset {
  id: string;
  name: string;
  description: string;
  apply: (p: ChipParams) => void;
}

export interface Shortcut {
  id: string;
  name: string;
  quality: ChipQuality;
  form: string;
  description: string;
  apply?: (p: ChipParams) => void;
}

// ---------------------------------------------------------------- Matières

export const MATERIALS: MaterialPreset[] = [
  {
    id: 'acier',
    name: 'Acier',
    grade: '11SMnPb30 / C45',
    description: 'Acier de décolletage : lamelles régulières, bords légèrement dentelés.',
    apply: (p) =>
      Object.assign(p, {
        width: 1.2, thickness: 0.12, taper: 0.1, camber: 0.04, camberShape: 0.3, edgeThinning: 0.3,
        edgeRoundness: 0.35, burr: 5, burrSide: 'B', crackDensity: 2, crackDepth: 0.05, crackIrregularity: 0.6, crackSide: 'B',
        lamellaFreq: 10, lamellaAmp: 3, lamellaIrregularity: 0.5, striationFreq: 8, striationAmp: 0.8,
        wavinessFreq: 0.3, wavinessAmp: 8, segmentFreq: 0, segmentDepth: 0, segmentSharpness: 0.6,
        macroNoise: 0.25, macroNoiseScale: 6, microNoise: 1.2, microNoiseScale: 0.12, thicknessNoise: 0.06,
      } satisfies Partial<ChipParams>),
  },
  {
    id: 'inox',
    name: 'Inox',
    grade: '1.4404 / 316L',
    description: 'Fort écrouissage : copeau épais, lamelles marquées, bords très dentelés et bavures.',
    apply: (p) =>
      Object.assign(p, {
        width: 1.2, thickness: 0.15, taper: 0.15, camber: 0.05, camberShape: 0.4, edgeThinning: 0.35,
        edgeRoundness: 0.25, burr: 12, burrSide: 'deux', crackDensity: 6, crackDepth: 0.12, crackIrregularity: 0.7, crackSide: 'deux',
        lamellaFreq: 12, lamellaAmp: 5, lamellaIrregularity: 0.6, striationFreq: 10, striationAmp: 1.2,
        wavinessFreq: 0.35, wavinessAmp: 10, segmentFreq: 2, segmentDepth: 0.1, segmentSharpness: 0.5,
        macroNoise: 0.3, macroNoiseScale: 6, microNoise: 1.6, microNoiseScale: 0.12, thicknessNoise: 0.1,
      } satisfies Partial<ChipParams>),
  },
  {
    id: 'titane',
    name: 'Titane',
    grade: 'Ti6Al4V (gr. 5)',
    description: 'Copeau segmenté en dents de scie (cisaillement adiabatique localisé).',
    apply: (p) =>
      Object.assign(p, {
        width: 1.1, thickness: 0.1, taper: 0.05, camber: 0.03, camberShape: 0.2, edgeThinning: 0.2,
        edgeRoundness: 0.2, burr: 3, burrSide: 'B', crackDensity: 8, crackDepth: 0.1, crackIrregularity: 0.5, crackSide: 'deux',
        lamellaFreq: 6, lamellaAmp: 2, lamellaIrregularity: 0.4, striationFreq: 6, striationAmp: 0.6,
        wavinessFreq: 0.2, wavinessAmp: 5, segmentFreq: 12, segmentDepth: 0.45, segmentSharpness: 0.8,
        macroNoise: 0.2, macroNoiseScale: 8, microNoise: 1, microNoiseScale: 0.1, thicknessNoise: 0.05,
      } satisfies Partial<ChipParams>),
  },
  {
    id: 'laiton',
    name: 'Laiton',
    grade: 'CuZn39Pb3',
    description: 'Laiton de décolletage : copeau friable et granuleux, fragmentation facile.',
    apply: (p) =>
      Object.assign(p, {
        width: 1.2, thickness: 0.1, taper: 0.08, camber: 0.03, camberShape: 0.3, edgeThinning: 0.25,
        edgeRoundness: 0.5, burr: 0, burrSide: 'aucun', crackDensity: 4, crackDepth: 0.08, crackIrregularity: 0.9, crackSide: 'deux',
        lamellaFreq: 14, lamellaAmp: 1.5, lamellaIrregularity: 0.3, striationFreq: 6, striationAmp: 0.5,
        wavinessFreq: 0.4, wavinessAmp: 6, segmentFreq: 4, segmentDepth: 0.15, segmentSharpness: 0.4,
        macroNoise: 0.4, macroNoiseScale: 4, microNoise: 2.5, microNoiseScale: 0.08, thicknessNoise: 0.12,
      } satisfies Partial<ChipParams>),
  },
  {
    id: 'plastique',
    name: 'Plastique',
    grade: 'POM / PEEK',
    description: 'Copeau lisse et souple, sans lamelles, bords arrondis et filandreux.',
    apply: (p) =>
      Object.assign(p, {
        width: 1.3, thickness: 0.18, taper: 0.05, camber: 0.02, camberShape: 0.1, edgeThinning: 0.15,
        edgeRoundness: 0.8, burr: 20, burrSide: 'A', crackDensity: 0, crackDepth: 0, crackIrregularity: 0.3, crackSide: 'B',
        lamellaFreq: 0, lamellaAmp: 0, lamellaIrregularity: 0.2, striationFreq: 3, striationAmp: 1.5,
        wavinessFreq: 0.4, wavinessAmp: 25, segmentFreq: 0, segmentDepth: 0, segmentSharpness: 0.5,
        macroNoise: 0.35, macroNoiseScale: 10, microNoise: 0.4, microNoiseScale: 0.3, thicknessNoise: 0.05,
      } satisfies Partial<ChipParams>),
  },
  {
    id: 'aluminium',
    name: 'Aluminium',
    grade: 'EN AW-6082 / 7075',
    description: 'Copeau épais et collant, lamelles grossières, bords effilochés (arête rapportée).',
    apply: (p) =>
      Object.assign(p, {
        width: 1.3, thickness: 0.2, taper: 0.12, camber: 0.05, camberShape: 0.3, edgeThinning: 0.35,
        edgeRoundness: 0.4, burr: 15, burrSide: 'deux', crackDensity: 3, crackDepth: 0.1, crackIrregularity: 0.8, crackSide: 'deux',
        lamellaFreq: 8, lamellaAmp: 6, lamellaIrregularity: 0.7, striationFreq: 5, striationAmp: 1.5,
        wavinessFreq: 0.3, wavinessAmp: 12, segmentFreq: 0, segmentDepth: 0, segmentSharpness: 0.5,
        macroNoise: 0.3, macroNoiseScale: 7, microNoise: 2, microNoiseScale: 0.15, thicknessNoise: 0.15,
      } satisfies Partial<ChipParams>),
  },
  {
    id: 'cuivre',
    name: 'Cuivre',
    grade: 'Cu-ETP / CuNi',
    description: 'Très ductile : copeau épais (fort taux de compression), lamelles prononcées.',
    apply: (p) =>
      Object.assign(p, {
        width: 1.2, thickness: 0.22, taper: 0.1, camber: 0.04, camberShape: 0.3, edgeThinning: 0.3,
        edgeRoundness: 0.6, burr: 8, burrSide: 'B', crackDensity: 1, crackDepth: 0.04, crackIrregularity: 0.5, crackSide: 'B',
        lamellaFreq: 10, lamellaAmp: 7, lamellaIrregularity: 0.5, striationFreq: 6, striationAmp: 1,
        wavinessFreq: 0.3, wavinessAmp: 10, segmentFreq: 0, segmentDepth: 0, segmentSharpness: 0.5,
        macroNoise: 0.3, macroNoiseScale: 7, microNoise: 1.2, microNoiseScale: 0.15, thicknessNoise: 0.08,
      } satisfies Partial<ChipParams>),
  },
  {
    id: 'superalliage',
    name: 'Superalliage / trempé',
    grade: 'Inconel 718 / acier > 50 HRC',
    description: 'Copeau mince et raide, fortement segmenté, bords fissurés.',
    apply: (p) =>
      Object.assign(p, {
        width: 1, thickness: 0.08, taper: 0.05, camber: 0.02, camberShape: 0.2, edgeThinning: 0.2,
        edgeRoundness: 0.15, burr: 0, burrSide: 'aucun', crackDensity: 10, crackDepth: 0.12, crackIrregularity: 0.5, crackSide: 'deux',
        lamellaFreq: 4, lamellaAmp: 1, lamellaIrregularity: 0.4, striationFreq: 6, striationAmp: 0.5,
        wavinessFreq: 0.2, wavinessAmp: 4, segmentFreq: 18, segmentDepth: 0.6, segmentSharpness: 0.9,
        macroNoise: 0.15, macroNoiseScale: 8, microNoise: 0.8, microNoiseScale: 0.1, thicknessNoise: 0.05,
      } satisfies Partial<ChipParams>),
  },
];

// ---------------------------------------------------------------- Formes ISO 3685

const macroReset: Partial<ChipParams> = {
  radiusGrowth: 0,
  pitch: 0,
  ejectionAngle: 0,
  twist: 0,
  linkedSegments: 1,
  linkAngle: 60,
  tangle: 0,
  neck: 0.4,
  thicknessStart: 1,
  thicknessEnd: 1,
  widthStart: 1,
  widthEnd: 1,
  endBreak: 0.5,
};

function form(p: ChipParams, values: Partial<ChipParams>): void {
  Object.assign(p, macroReset, values);
}

const tubeRadius = (p: ChipParams) => Math.max(1.6 * p.width, 1.4);

export const FORMS: FormPreset[] = [
  {
    id: '1.1', family: 1, familyName: 'Ruban', variant: 'long', quality: 'mauvais',
    description: "Long ruban continu peu enroulé : s'enroule autour de la pièce et de l'outil.",
    apply: (p) => form(p, { length: 180, radius: 35, twist: 1.5, macroNoise: Math.max(p.macroNoise, 0.55), macroNoiseScale: 12, endBreak: 0.4 }),
  },
  {
    id: '1.2', family: 1, familyName: 'Ruban', variant: 'court', quality: 'mauvais',
    description: 'Ruban court mal fragmenté.',
    apply: (p) => form(p, { length: 35, radius: 25, twist: 2, macroNoise: Math.max(p.macroNoise, 0.5), macroNoiseScale: 8 }),
  },
  {
    id: '1.3', family: 1, familyName: 'Ruban', variant: 'enchevêtré', quality: 'mauvais',
    description: 'Pelote de ruban enchevêtré : dangereux et difficile à évacuer.',
    apply: (p) => form(p, { length: 450, radius: 12, twist: 3, tangle: 0.85, macroNoise: Math.max(p.macroNoise, 0.6), macroNoiseScale: 6 }),
  },
  {
    id: '2.1', family: 2, familyName: 'Tubulaire', variant: 'long', quality: 'mauvais',
    description: 'Hélice serrée formant un tube continu.',
    apply: (p) => form(p, { length: 220, radius: tubeRadius(p), pitch: 1.08 * p.width, macroNoise: Math.min(p.macroNoise, 0.2), macroNoiseScale: 15 }),
  },
  {
    id: '2.2', family: 2, familyName: 'Tubulaire', variant: 'court', quality: 'acceptable',
    description: 'Tube court : acceptable si la longueur reste maîtrisée.',
    apply: (p) => form(p, { length: 30, radius: tubeRadius(p), pitch: 1.08 * p.width, macroNoise: Math.min(p.macroNoise, 0.2), macroNoiseScale: 10 }),
  },
  {
    id: '2.3', family: 2, familyName: 'Tubulaire', variant: 'enchevêtré', quality: 'mauvais',
    description: 'Tubes enchevêtrés en paquet.',
    apply: (p) => form(p, { length: 350, radius: tubeRadius(p), pitch: 1.15 * p.width, tangle: 0.6, macroNoise: 0.4, macroNoiseScale: 8 }),
  },
  {
    id: '3.1', family: 3, familyName: 'Spirale', variant: 'plate', quality: 'bon',
    description: 'Spirale plate en ressort de montre (typique des gorges et du tronçonnage).',
    apply: (p) => form(p, { length: 25, radius: 0.9, radiusGrowth: Math.max(2.4 * p.thickness, 0.25), pitch: 0, macroNoise: Math.min(p.macroNoise, 0.15), macroNoiseScale: 10 }),
  },
  {
    id: '3.2', family: 3, familyName: 'Spirale', variant: 'conique', quality: 'bon',
    description: 'Spirale conique compacte.',
    apply: (p) => form(p, { length: 25, radius: 1, radiusGrowth: Math.max(2.6 * p.thickness, 0.3), pitch: 0.35 * p.width, ejectionAngle: 20, macroNoise: Math.min(p.macroNoise, 0.2), macroNoiseScale: 10 }),
  },
  {
    id: '4.1', family: 4, familyName: 'Hélicoïdal en rondelle', variant: 'long', quality: 'mauvais',
    description: 'Hélice à section radiale (empilement de rondelles) très longue.',
    apply: (p) => form(p, { length: 200, radius: 0.6 * p.width + 0.7, pitch: 2.4 * p.thickness, ejectionAngle: 85, macroNoise: Math.min(p.macroNoise, 0.25), macroNoiseScale: 12 }),
  },
  {
    id: '4.2', family: 4, familyName: 'Hélicoïdal en rondelle', variant: 'court', quality: 'bon',
    description: 'Quelques spires en rondelles : bien évacué.',
    apply: (p) => form(p, { length: 35, radius: 0.6 * p.width + 0.7, pitch: 2.4 * p.thickness, ejectionAngle: 85, macroNoise: Math.min(p.macroNoise, 0.25), macroNoiseScale: 10 }),
  },
  {
    id: '4.3', family: 4, familyName: 'Hélicoïdal en rondelle', variant: 'enchevêtré', quality: 'mauvais',
    description: 'Hélices en rondelles enchevêtrées.',
    apply: (p) => form(p, { length: 300, radius: 0.6 * p.width + 0.7, pitch: 3 * p.thickness, ejectionAngle: 80, tangle: 0.55, macroNoise: 0.4, macroNoiseScale: 8 }),
  },
  {
    id: '5.1', family: 5, familyName: 'Hélicoïdal conique', variant: 'long', quality: 'mauvais',
    description: 'Longue hélice conique (perçage, chariotage) qui ne se fragmente pas.',
    apply: (p) => form(p, { length: 150, radius: 1.5, radiusGrowth: 0.12, pitch: 1.6 * p.width, ejectionAngle: 25, macroNoise: Math.min(p.macroNoise, 0.3), macroNoiseScale: 12 }),
  },
  {
    id: '5.2', family: 5, familyName: 'Hélicoïdal conique', variant: 'court', quality: 'bon',
    description: 'Hélice conique courte : copeau idéal, bien fragmenté.',
    apply: (p) => form(p, { length: 22, radius: 1.5, radiusGrowth: 0.35, pitch: 1.6 * p.width, ejectionAngle: 25, macroNoise: Math.min(p.macroNoise, 0.3), macroNoiseScale: 8 }),
  },
  {
    id: '5.3', family: 5, familyName: 'Hélicoïdal conique', variant: 'enchevêtré', quality: 'mauvais',
    description: 'Hélices coniques enchevêtrées.',
    apply: (p) => form(p, { length: 300, radius: 1.6, radiusGrowth: 0.1, pitch: 1.8 * p.width, ejectionAngle: 25, tangle: 0.5, macroNoise: 0.4, macroNoiseScale: 8 }),
  },
  {
    id: '6.1', family: 6, familyName: 'Arc', variant: 'attaché', quality: 'bon',
    description: 'Arcs encore liés entre eux : bonne fragmentation.',
    apply: (p) => form(p, { length: 14, radius: 2.2, pitch: 0.3 * p.width, ejectionAngle: 10, linkedSegments: 3, linkAngle: 70, neck: 0.55, endBreak: 0.6 }),
  },
  {
    id: '6.2', family: 6, familyName: 'Arc', variant: 'détaché', quality: 'bon',
    description: 'Arc isolé (copeau en virgule) : forme recherchée.',
    apply: (p) => form(p, { length: 5, radius: 2, pitch: 0.2 * p.width, ejectionAngle: 8, thicknessStart: 0.45, thicknessEnd: 1.05, widthStart: 0.85, endBreak: 0.7 }),
  },
  {
    id: '7', family: 7, familyName: 'Élémentaire', variant: 'fragmenté', quality: 'bon',
    description: 'Fragments élémentaires (fonte, laiton) : très courts, irréguliers.',
    apply: (p) => {
      form(p, { length: 1.6, radius: 1.2, pitch: 0.15 * p.width, endBreak: 1, macroNoise: 0.6, macroNoiseScale: 1 });
      p.thickness *= 1.6;
      p.width *= 0.8;
      p.thicknessNoise = Math.max(p.thicknessNoise, 0.2);
      p.segmentDepth = Math.max(p.segmentDepth, 0.25);
      p.segmentFreq = Math.max(p.segmentFreq, 3);
    },
  },
  {
    id: '8', family: 8, familyName: 'Aiguille', variant: 'aiguille', quality: 'bon',
    description: 'Fines aiguilles : bien fragmentées, mais peuvent colmater ou se piquer.',
    apply: (p) => {
      form(p, { length: 6, radius: 40, twist: 8, widthStart: 0.3, widthEnd: 0.45, thicknessStart: 0.5, thicknessEnd: 0.6, endBreak: 0.8 });
      p.width *= 0.35;
      p.thickness *= 0.8;
    },
  },
];

// ---------------------------------------------------------------- Procédés

export const PROCESSES: ProcessPreset[] = [
  {
    id: 'tournage',
    name: 'Tournage / décolletage',
    description: "Épaisseur constante le long du copeau ; section légèrement trapézoïdale (rayon de bec).",
    apply: () => {},
  },
  {
    id: 'gorge',
    name: 'Gorge / tronçonnage',
    description: 'Largeur = largeur de plaquette (rétrécie par le brise-copeaux), section creusée en V, bavures sur les deux flancs.',
    apply: (p) => {
      p.width = Math.max(p.width, 1.5) * 0.92;
      p.taper = 0;
      p.camber = Math.max(p.camber, 0.12 * p.width);
      p.camberShape = 0.7;
      p.edgeThinning = Math.max(p.edgeThinning, 0.35);
      p.burr = Math.max(p.burr, 8);
      p.burrSide = 'deux';
      p.striationAmp = Math.max(p.striationAmp, 1.2);
    },
  },
  {
    id: 'fraisage',
    name: 'Fraisage',
    description: "Épaisseur variable de 0 à hmax le long du copeau : virgules et croissants.",
    apply: (p) => {
      p.thicknessStart = 0.1;
      p.thicknessEnd = 1.15;
      p.widthStart = Math.min(p.widthStart, 0.9);
      p.length = Math.min(p.length, 40);
      p.edgeThinning = Math.max(p.edgeThinning, 0.35);
    },
  },
  {
    id: 'percage',
    name: 'Perçage',
    description: 'Copeau large à épaisseur variable sur la largeur (vitesse de coupe variable le long de la lèvre) : hélices coniques.',
    apply: (p) => {
      p.width *= 1.5;
      p.taper = 0.35;
      p.ejectionAngle = p.ejectionAngle + 15;
      if (p.radiusGrowth <= 0 && p.pitch > 0) p.radiusGrowth = 0.12;
      p.twist += 0.5;
    },
  },
];

// ---------------------------------------------------------------- Raccourcis (appellations atelier)

export const SHORTCUTS: Shortcut[] = [
  {
    id: 'virgule', name: 'Virgule', quality: 'bon', form: '6.2',
    description: 'Arc court à épaisseur croissante.',
    apply: (p) => Object.assign(p, { thicknessStart: 0.25, thicknessEnd: 1.1, widthStart: 0.7 }),
  },
  { id: 'aiguille', name: 'Aiguille', quality: 'bon', form: '8', description: 'Fines aiguilles fragmentées.' },
  {
    id: 'arc', name: 'Arc de cercle', quality: 'bon', form: '6.2',
    description: "Arc isolé d'épaisseur constante.",
    apply: (p) => Object.assign(p, { length: 7, radius: 2.4, thicknessStart: 1, thicknessEnd: 1, widthStart: 1 }),
  },
  { id: 'helice-courte', name: 'Hélice courte', quality: 'bon', form: '5.2', description: 'Hélice conique de quelques spires.' },
  { id: 'ruban', name: 'Ruban', quality: 'mauvais', form: '1.1', description: 'Ruban long continu.' },
  { id: 'enchevetre', name: 'Enchevêtré', quality: 'mauvais', form: '1.3', description: 'Pelote de ruban.' },
  {
    id: 'longue-helice', name: 'Longue hélice', quality: 'mauvais', form: '2.1',
    description: 'Longue hélice ouverte.',
    apply: (p) => Object.assign(p, { pitch: 3 * p.width, radius: 1.8 * p.width }),
  },
  {
    id: 'rondelles', name: 'Rondelles imbriquées', quality: 'mauvais', form: '4.1',
    description: 'Spires en rondelles serrées les unes contre les autres.',
    apply: (p) => Object.assign(p, { pitch: 1.35 * p.thickness }),
  },
];

export interface PresetSelection {
  material: string;
  process: string;
  form: string;
  shortcut?: string;
}

export const DEFAULT_SELECTION: PresetSelection = { material: 'acier', process: 'tournage', form: '5.2' };

export function findForm(id: string): FormPreset {
  return FORMS.find((f) => f.id === id) ?? FORMS.find((f) => f.id === DEFAULT_SELECTION.form)!;
}

export function findMaterial(id: string): MaterialPreset {
  return MATERIALS.find((m) => m.id === id) ?? MATERIALS[0];
}

export function findProcess(id: string): ProcessPreset {
  return PROCESSES.find((m) => m.id === id) ?? PROCESSES[0];
}

/** Compose les paramètres d'un preset : matière → forme → raccourci → procédé. */
export function composePreset(sel: PresetSelection): ChipParams {
  const p: ChipParams = { ...DEFAULT_PARAMS };
  findMaterial(sel.material).apply(p);
  findForm(sel.form).apply(p);
  const sc = sel.shortcut ? SHORTCUTS.find((s) => s.id === sel.shortcut) : undefined;
  if (sc?.apply) sc.apply(p);
  findProcess(sel.process).apply(p);
  return sanitizeParams(p, DEFAULT_PARAMS);
}

// ---------------------------------------------------------------- Variabilité (mode tas)

export interface PileSettings {
  count: number;
  /** 0 = copeaux identiques, 1 = forte dispersion autour du preset. */
  variability: number;
  /** Rayon de la zone de chute (mm). 0 = automatique. */
  spread: number;
  physics: boolean;
}

export const DEFAULT_PILE: PileSettings = { count: 40, variability: 0.5, spread: 0, physics: true };

/** Paramètres du copeau i d'un tas, dérivés de façon déterministe du preset et de la seed. */
export function varyParams(base: ChipParams, seed: number, index: number, variability: number): ChipParams {
  if (variability <= 0) return { ...base };
  const r = new Rng(hashSeed(seed, index, 'variation'));
  const v = variability;
  const p: ChipParams = { ...base };
  p.length = r.jitter(base.length, 0.7 * v);
  p.radius = r.jitter(base.radius, 0.35 * v);
  p.radiusGrowth = base.radiusGrowth === 0 ? 0 : r.jitter(base.radiusGrowth, 0.5 * v);
  p.pitch = r.jitter(base.pitch, 0.4 * v);
  p.ejectionAngle = base.ejectionAngle + r.normal() * 8 * v;
  p.twist = base.twist + r.normal() * (0.3 * Math.abs(base.twist) + 1) * v;
  p.width = r.jitter(base.width, 0.16 * v);
  p.thickness = r.jitter(base.thickness, 0.2 * v);
  p.taper = Math.max(-0.9, Math.min(0.9, base.taper + r.normal() * 0.1 * v));
  p.camber = r.jitter(base.camber, 0.4 * v);
  p.lamellaAmp = r.jitter(base.lamellaAmp, 0.4 * v);
  p.lamellaFreq = r.jitter(base.lamellaFreq, 0.25 * v);
  p.segmentFreq = r.jitter(base.segmentFreq, 0.25 * v);
  p.crackDensity = r.jitter(base.crackDensity, 0.5 * v);
  p.macroNoise = Math.max(0, r.jitter(base.macroNoise, 0.5 * v));
  p.tangle = Math.max(0, Math.min(1, base.tangle + r.normal() * 0.15 * v));
  if (base.linkedSegments > 1) p.linkedSegments = Math.max(1, Math.round(base.linkedSegments + r.normal() * 1.2 * v));
  if (r.next() < 0.5 * v && base.burrSide !== 'aucun') p.burrSide = r.pick(['A', 'B', 'deux'] as const);
  return sanitizeParams(p, base);
}
