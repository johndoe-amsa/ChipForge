import type { ChipMesh } from '../core/geometry/mesh';
import type { RigidTransform } from '../core/export/transform';
import { Rng, hashSeed } from '../core/rng';

/**
 * Chute physique d'un lot de copeaux sur un plan (Rapier, WebAssembly chargé à la demande).
 * Chaque copeau est un corps rigide composé de boîtes minces le long de sa fibre.
 * Pas de temps fixe et nombre de pas indépendant de l'affichage : même seed → même tas.
 */

export interface PileOptions {
  seed: number;
  /** Rayon de la zone de chute (mm) ; 0 = automatique. */
  spread: number;
  onFrame?: (transforms: RigidTransform[], progress: number) => void;
  signal?: { cancelled: boolean };
}

type RapierModule = typeof import('@dimforge/rapier3d-compat');
let rapierPromise: Promise<RapierModule> | null = null;

async function loadRapier(): Promise<RapierModule> {
  rapierPromise ??= import('@dimforge/rapier3d-compat').then(async (m) => {
    const R = (m as unknown as { default?: RapierModule }).default ?? m;
    await R.init();
    return R;
  });
  return rapierPromise;
}

function chipRadius(m: ChipMesh): number {
  const b = m.bounds;
  let r = 0;
  for (const x of [b[0], b[3]]) for (const y of [b[1], b[4]]) for (const z of [b[2], b[5]]) r = Math.max(r, Math.hypot(x, y, z));
  return Math.max(r, 1e-3);
}

/** Dispersion sans physique : copeaux posés à plat, orientations aléatoires autour de Y. */
export function scatterPile(meshes: ChipMesh[], seed: number, spread: number): RigidTransform[] {
  const rng = new Rng(hashSeed(seed, 'scatter'));
  const radii = meshes.map(chipRadius);
  const mean = radii.reduce((a, b) => a + b, 0) / Math.max(1, radii.length);
  const R = spread > 0 ? spread : mean * Math.sqrt(meshes.length) * 1.1;
  return meshes.map((m) => {
    const a = rng.next() * Math.PI * 2;
    const d = Math.sqrt(rng.next()) * R;
    const ang = rng.next() * Math.PI * 2;
    const q: [number, number, number, number] = [0, Math.sin(ang / 2), 0, Math.cos(ang / 2)];
    return { q, t: [Math.cos(a) * d, -m.bounds[1], Math.sin(a) * d] };
  });
}

export async function simulatePile(meshes: ChipMesh[], opt: PileOptions): Promise<RigidTransform[]> {
  const R = await loadRapier();
  const rng = new Rng(hashSeed(opt.seed, 'pile'));
  const n = meshes.length;
  const radii = meshes.map(chipRadius);
  const sorted = [...radii].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 1;
  // Normalisation : un copeau médian mesure ~1 unité (zone de confort du solveur).
  const k = 0.5 / median;
  const minHalf = 0.012;

  const world = new R.World({ x: 0, y: -9.81, z: 0 });
  world.integrationParameters.dt = 1 / 120;
  world.integrationParameters.numSolverIterations = 6;

  const ground = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
  world.createCollider(R.ColliderDesc.cuboid(500, 0.5, 500).setFriction(0.8), ground);

  // Placement initial sans recouvrement : empilement en colonne dans un disque.
  const meanR = radii.reduce((a, b) => a + b, 0) / Math.max(1, n);
  // Zone de chute étroite par défaut : les copeaux s'empilent en monticule.
  const spreadN = opt.spread > 0 ? opt.spread * k : Math.max(0.8, meanR * k * Math.sqrt(n) * 0.38);
  const placed: { x: number; y: number; z: number; r: number }[] = [];
  const bodies = meshes.map((m, i) => {
    const r = radii[i] * k;
    const a = rng.next() * Math.PI * 2;
    const d = Math.sqrt(rng.next()) * spreadN;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    let y = r + 0.05;
    for (const p of placed) {
      if (Math.hypot(p.x - x, p.z - z) < p.r + r) y = Math.max(y, p.y + p.r + r + 0.02);
    }
    placed.push({ x, y, z, r });
    const [qx, qy, qz, qw] = rng.quaternion();
    const body = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(x, y, z)
        .setRotation({ x: qx, y: qy, z: qz, w: qw })
        .setLinearDamping(0.15)
        .setAngularDamping(1.4)
        .setCcdEnabled(true)
        .setAngvel({ x: rng.range(-0.5, 0.5), y: rng.range(-0.5, 0.5), z: rng.range(-0.5, 0.5) }),
    );
    const col = m.colliders;
    for (let o = 0; o < col.length; o += 10) {
      const desc = R.ColliderDesc.cuboid(
        Math.max(col[o + 7] * k, minHalf),
        Math.max(col[o + 8] * k, minHalf),
        Math.max(col[o + 9] * k, minHalf),
      )
        .setTranslation(col[o] * k, col[o + 1] * k, col[o + 2] * k)
        .setRotation({ x: col[o + 3], y: col[o + 4], z: col[o + 5], w: col[o + 6] })
        .setFriction(0.7)
        .setRestitution(0.05)
        .setDensity(1);
      world.createCollider(desc, body);
    }
    return body;
  });

  const read = (): RigidTransform[] =>
    bodies.map((b) => {
      const t = b.translation();
      const q = b.rotation();
      return { q: [q.x, q.y, q.z, q.w], t: [t.x / k, t.y / k, t.z / k] };
    });

  const maxSteps = 1500;
  let step = 0;
  let lastFrame = performance.now();
  let nextCheck = 180;
  try {
    while (step < maxSteps) {
      // Budget de calcul adaptatif : si l'affichage est lent, on avance plus de pas par image.
      // Le résultat ne dépend que du nombre total de pas (déterministe).
      const now = performance.now();
      const budget = Math.min(200, Math.max(10, 0.6 * (now - lastFrame)));
      lastFrame = now;
      const t0 = performance.now();
      let n = 0;
      while (step < maxSteps && (n < 6 || performance.now() - t0 < budget)) {
        world.step();
        step++;
        n++;
        if (step >= nextCheck) break;
      }
      if (opt.signal?.cancelled) break;
      if (step >= nextCheck) {
        nextCheck += 60;
        let moving = false;
        for (const b of bodies) {
          if (b.isSleeping()) continue;
          const v = b.linvel();
          const w = b.angvel();
          if (Math.hypot(v.x, v.y, v.z) > 0.01 || Math.hypot(w.x, w.y, w.z) > 0.05) {
            moving = true;
            break;
          }
        }
        if (!moving) break;
      }
      opt.onFrame?.(read(), step / maxSteps);
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    }
    return read();
  } finally {
    world.free();
  }
}
