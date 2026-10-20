import { DETAILED_QUALITY, EXPORT_QUALITY, PREVIEW_QUALITY, STEP_QUALITY, type QualitySettings } from '../core/params';

export type PreviewTier = 'rapide' | 'detaille';
export type MeshDetail = 'standard' | 'fin' | 'ultra';
export type StepDetail = 'leger' | 'standard' | 'fin';

/** Répartit un budget de sommets total entre les copeaux d'un tas. */
function share(q: QualitySettings, n: number, total: number, floor: number): QualitySettings {
  if (n <= 1) return q;
  return { ...q, maxVertices: Math.max(floor, Math.min(q.maxVertices, Math.floor(total / n))) };
}

export function previewQuality(tier: PreviewTier, n: number): QualitySettings {
  return tier === 'detaille' ? share(DETAILED_QUALITY, n, 3_000_000, 8_000) : share(PREVIEW_QUALITY, n, 700_000, 4_000);
}

const MESH: Record<MeshDetail, { q: QualitySettings; total: number }> = {
  standard: { q: { ...EXPORT_QUALITY, maxVertices: 400_000 }, total: 2_000_000 },
  fin: { q: { ...EXPORT_QUALITY, maxVertices: 1_200_000 }, total: 4_000_000 },
  ultra: {
    q: { ...EXPORT_QUALITY, densityAlong: 20, widthSegments: 32, thicknessSegments: 8, ringsPerTurn: 96, maxVertices: 3_000_000, microSamples: 8 },
    total: 8_000_000,
  },
};

export function meshExportQuality(d: MeshDetail, n: number): QualitySettings {
  return share(MESH[d].q, n, MESH[d].total, 20_000);
}

const STEP: Record<StepDetail, { q: QualitySettings; total: number }> = {
  leger: { q: STEP_QUALITY, total: 800_000 },
  standard: { q: { ...STEP_QUALITY, densityAlong: 6, widthSegments: 12, thicknessSegments: 4, ringsPerTurn: 36, maxVertices: 200_000 }, total: 1_500_000 },
  fin: {
    q: { ...STEP_QUALITY, densityAlong: 10, widthSegments: 18, thicknessSegments: 5, ringsPerTurn: 48, maxVertices: 600_000, resolveMicro: true, microSamples: 3 },
    total: 3_000_000,
  },
};

export function stepExportQuality(d: StepDetail, n: number): QualitySettings {
  return share(STEP[d].q, n, STEP[d].total, 4_000);
}
