import { describe, expect, it } from 'vitest';
import { buildChipGrid } from '../src/core/geometry/chip';
import { gridToMesh } from '../src/core/geometry/mesh';
import { PREVIEW_QUALITY, sanitizeParams } from '../src/core/params';
import { DEFAULT_SELECTION, composePreset, varyParams } from '../src/core/presets/presets';
import { hashSeed } from '../src/core/rng';
import { simulatePile, type PileEnd } from '../src/physics/pile';

(globalThis as { requestAnimationFrame?: (f: () => void) => unknown }).requestAnimationFrame ??= (f) => setTimeout(f, 0);

describe('chute physique : la simulation ne s’arrête pas avant que tout soit tombé', () => {
  const base = composePreset(DEFAULT_SELECTION);
  const meshes = Array.from({ length: 300 }, (_, i) =>
    gridToMesh(buildChipGrid(sanitizeParams(varyParams(base, 2, i, 0.5)), hashSeed(2, i), { ...PREVIEW_QUALITY, maxVertices: 2500 })),
  );

  it('colonne de chute très haute (zone de chute étroite) : aucun copeau en l’air à la fin', async () => {
    let end: PileEnd | undefined;
    // Étalement de 1 mm : les 300 copeaux partent empilés en une colonne très haute.
    await simulatePile(meshes, { seed: 5, spread: 1, onEnd: (e) => (end = e) });
    expect(end?.falling).toBe(0);
    expect(end?.airborne).toBe(0);
  }, 300_000);
});
