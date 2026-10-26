import type { ChipMesh } from '../core/geometry/mesh';
import type { RigidTransform } from '../core/export/transform';
import { Rng, hashSeed } from '../core/rng';
import { binBoxes, type BinGeometry } from '../core/bin';
import { pyramidGeometry, pyramidPoint, type PyramidGeometry } from '../core/pyramid';

/**
 * Chute physique d'un lot de copeaux sur un plan, dans un bac ou moulé en pyramide (Rapier, WebAssembly chargé à la demande).
 * Chaque copeau est un corps rigide composé de boîtes minces le long de sa fibre.
 * Pas de temps fixe et nombre de pas indépendant de l'affichage : même seed → même tas.
 */

export interface PileOptions {
  seed: number;
  /** Rayon de la zone de chute (mm) ; 0 = automatique. Ignoré avec un bac. */
  spread: number;
  /** Bac à copeaux (parois fixes), ou null pour une chute sur la grille. */
  bin?: BinGeometry | null;
  /** Tas en pyramide : pente des faces (degrés), ou null. Ignoré avec un bac. */
  pyramid?: number | null;
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

export function chipRadius(m: ChipMesh): number {
  const b = m.bounds;
  let r = 0;
  for (const x of [b[0], b[3]]) for (const y of [b[1], b[4]]) for (const z of [b[2], b[5]]) r = Math.max(r, Math.hypot(x, y, z));
  return Math.max(r, 1e-3);
}

/** Volume de la boîte englobante d'un copeau (mm³). */
export function boxVolume(m: ChipMesh): number {
  const b = m.bounds;
  return Math.max(0, b[3] - b[0]) * Math.max(0, b[4] - b[1]) * Math.max(0, b[5] - b[2]);
}

/** Pyramide d'un tas moulé en pyramide (pente en degrés), dimensionnée selon le volume des copeaux. */
export function pilePyramid(meshes: ChipMesh[], slope: number): PyramidGeometry {
  return pyramidGeometry(meshes.map(boxVolume), slope);
}

/**
 * Point de chute dans le disque de rayon R (les copeaux forment un monticule) ; avec un bac,
 * ramené à l'intérieur du fond (marge r aux parois). La suite aléatoire ne dépend pas du
 * réceptacle.
 */
function dropPoint(rng: Rng, R: number, bin: BinGeometry | null | undefined, r: number): [number, number] {
  const a = rng.next() * Math.PI * 2;
  const d = Math.sqrt(rng.next()) * R;
  let x = Math.cos(a) * d;
  let z = Math.sin(a) * d;
  if (bin) {
    const ax = Math.max(0, bin.length / 2 - r);
    const az = Math.max(0, bin.width / 2 - r);
    x = Math.max(-ax, Math.min(ax, x));
    z = Math.max(-az, Math.min(az, z));
  }
  return [x, z];
}

/** Dispersion sans physique : copeaux posés à plat, orientations aléatoires autour de Y. */
export function scatterPile(meshes: ChipMesh[], seed: number, spread: number, bin?: BinGeometry | null, pyramid?: number | null): RigidTransform[] {
  const rng = new Rng(hashSeed(seed, 'scatter'));
  const radii = meshes.map(chipRadius);
  if (pyramid && !bin) {
    // Copeaux tirés au hasard dans le volume de la pyramide.
    const g = pilePyramid(meshes, pyramid);
    return meshes.map(() => ({ t: pyramidPoint(rng, g), q: rng.quaternion() }));
  }
  const mean = radii.reduce((a, b) => a + b, 0) / Math.max(1, radii.length);
  const R = spread > 0 ? spread : mean * Math.sqrt(meshes.length) * 1.1;
  return meshes.map((m, i) => {
    const [x, z] = dropPoint(rng, R, bin, radii[i]);
    const ang = rng.next() * Math.PI * 2;
    const q: [number, number, number, number] = [0, Math.sin(ang / 2), 0, Math.cos(ang / 2)];
    return { q, t: [x, -m.bounds[1], z] };
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
  if (opt.bin) {
    // Parois du bac (le fond est le sol). Épaisseur portée à 0,1 unité au moins pour la
    // stabilité du solveur, sans déplacer la face intérieure.
    const walls = world.createRigidBody(R.RigidBodyDesc.fixed());
    for (const box of binBoxes(opt.bin).slice(1)) {
      const half = box.half.map((h) => h * k) as [number, number, number];
      const c = box.center.map((v) => v * k) as [number, number, number];
      for (const a of [0, 2]) {
        if (box.half[a] !== opt.bin.wall / 2) continue;
        const grow = Math.max(0, 0.05 - half[a]);
        half[a] += grow;
        c[a] += Math.sign(c[a]) * grow;
      }
      world.createCollider(R.ColliderDesc.cuboid(...half).setTranslation(...c).setFriction(0.6), walls);
    }
  }

  // Placement initial sans recouvrement : empilement en colonne dans un disque.
  const meanR = radii.reduce((a, b) => a + b, 0) / Math.max(1, n);
  // Zone de chute étroite par défaut : les copeaux s'empilent en monticule.
  const spreadN = opt.spread > 0 ? opt.spread * k : Math.max(0.8, meanR * k * Math.sqrt(n) * 0.38);
  const binN = opt.bin ? { ...opt.bin, length: opt.bin.length * k, width: opt.bin.width * k } : null;
  const placed: { x: number; y: number; z: number; r: number }[] = [];
  // Tas en pyramide, moulé comme un pâté de sable : les copeaux remplissent d'abord une trémie
  // pyramidale (moule tête en bas), puis le contenu est retourné d'un demi-tour autour de X
  // (rotation, pas symétrie : les copeaux ne changent pas de sens d'enroulement), se tasse contre
  // le moule à l'endroit, et le moule est retiré.
  const pyr = opt.pyramid && !opt.bin ? pilePyramid(meshes, opt.pyramid) : null;
  const tan = pyr ? Math.tan((pyr.slope * Math.PI) / 180) : 1;
  let mold = pyr ? createMold(R, world, 0, tan, 1, 3 * Math.hypot(pyr.half, pyr.height) * k) : null;
  // Colonne de chute au-dessus de la trémie, dans son ouverture (évasée vers le haut).
  const fillY0 = pyr ? 1.1 * pyr.height * k : 0;
  const fillR = pyr ? Math.max(0.3, 0.85 * pyr.half * k) : 0;
  const bodies = meshes.map((m, i) => {
    const r = radii[i] * k;
    const [x, z] = dropPoint(rng, pyr ? fillR : spreadN, binN, r);
    let y = (pyr ? fillY0 : 0) + r + 0.05;
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

  // Pyramide : remplissage de la trémie, retournement et tassement dans le moule, démoulage.
  let phase: 'tremie' | 'moule' | 'libre' = pyr ? 'tremie' : 'libre';
  const fillSteps = 1500;
  const moldSteps = 600;
  const freeSteps = 450;
  let phaseEnd = pyr ? fillSteps : 1500;
  const maxSteps = pyr ? fillSteps + moldSteps + freeSteps : 1500;
  const flip = () => {
    // Le point le plus haut du remplissage devient la base, posée sur la grille.
    let top = 0;
    bodies.forEach((b, i) => (top = Math.max(top, b.translation().y + radii[i] * k)));
    for (const b of bodies) {
      const t = b.translation();
      const q = b.rotation();
      b.setTranslation({ x: t.x, y: top - t.y, z: -t.z }, false);
      b.setRotation({ x: q.w, y: -q.z, z: q.y, w: -q.x }, false);
      b.setLinvel({ x: 0, y: 0, z: 0 }, false);
      b.setAngvel({ x: 0, y: 0, z: 0 }, false);
      b.wakeUp();
    }
    world.removeRigidBody(mold!);
    mold = createMold(R, world, top, tan, -1, 1.15 * Math.hypot(top, top / tan));
  };
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
      let steps = 0;
      while (step < maxSteps && (steps < 6 || performance.now() - t0 < budget)) {
        world.step();
        step++;
        steps++;
        if (step >= nextCheck || step >= phaseEnd) break;
      }
      if (opt.signal?.cancelled) break;
      let settled = false;
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
        settled = !moving;
      }
      if (phase !== 'libre' && (settled || step >= phaseEnd)) {
        if (phase === 'tremie') {
          flip();
          phase = 'moule';
          phaseEnd = step + moldSteps;
        } else {
          // Démoulage : le tas tient seul, ses bords se tassent.
          world.removeRigidBody(mold!);
          for (const b of bodies) b.wakeUp();
          phase = 'libre';
          phaseEnd = step + freeSteps;
        }
        nextCheck = step + 120;
      } else if (settled || step >= phaseEnd) break;
      opt.onFrame?.(read(), step / maxSteps);
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    }
    return read();
  } finally {
    world.free();
  }
}

/**
 * Moule pyramidal (unités normalisées) : 4 plaques fixes, sommet en (0, apexY, 0), faces de pente
 * tan, partant du sommet vers le haut (dir = 1 : trémie, tête en bas) ou vers le bas (dir = −1 :
 * pyramide à l'endroit) sur une longueur L, posées contre les faces côté extérieur.
 */
function createMold(R: RapierModule, world: InstanceType<RapierModule['World']>, apexY: number, tan: number, dir: 1 | -1, L: number) {
  const body = world.createRigidBody(R.RigidBodyDesc.fixed());
  const cos = 1 / Math.hypot(1, tan);
  const sin = tan * cos;
  const t = 0.1;
  // Face +X : direction (cos, dir·sin) depuis le sommet, normale sortante (sin, −dir·cos).
  const alpha = Math.atan2(-dir * cos, sin);
  const sz = Math.sin(alpha / 2);
  const cz = Math.cos(alpha / 2);
  const cx = (L / 2) * cos + sin * t;
  const cy = apexY + dir * (L / 2) * sin - dir * cos * t;
  const depth = L * cos + 4 * t;
  for (let f = 0; f < 4; f++) {
    const beta = (f * Math.PI) / 2;
    const sy = Math.sin(beta / 2);
    const cyq = Math.cos(beta / 2);
    world.createCollider(
      R.ColliderDesc.cuboid(t, L / 2, depth)
        .setTranslation(cx * Math.cos(beta), cy, -cx * Math.sin(beta))
        .setRotation({ x: sy * sz, y: cz * sy, z: cyq * sz, w: cyq * cz })
        .setFriction(0.3),
      body,
    );
  }
  return body;
}
