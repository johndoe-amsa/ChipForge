import type { ChipParams } from '../params';
import { Noise } from '../noise';
import { Rng } from '../rng';

/**
 * Fibre neutre du copeau : courbe intégrée à partir de sa courbure et de sa torsion
 * (vecteur de Darboux), plus un repère orthonormé transporté le long de la courbe.
 *
 * Une hélice de rayon R et de pas p a une courbure κ = R / (R² + c²) et une torsion
 * τ = c / (R² + c²) avec c = p / 2π. En intégrant (κ, τ) variables + bruit, on obtient
 * spirales, hélices coniques, rubans ondulés et pelotes enchevêtrées dans un même modèle.
 */
export interface Spine {
  /** Nombre d'intervalles (n + 1 échantillons). */
  n: number;
  ds: number;
  length: number;
  X: Float64Array;
  T: Float64Array;
  N: Float64Array;
  B: Float64Array;
  /** Roulis de la section (rad) : angle d'éjection + torsion + bruit. */
  roll: Float64Array;
  /** Abscisses des liaisons entre segments (ISO 6.1). */
  links: number[];
}

export interface ShapeDerived {
  R0: number;
  Rmin: number;
  growth: number;
  c: number;
  phi0: number;
  turns: number;
  kappaTangle: number;
  tangleScale: number;
  confineRadius: number;
}

export function sectionExtents(p: ChipParams): { halfW: number; halfT: number } {
  const halfW = 0.5 * p.width * Math.max(1, p.widthStart, p.widthEnd);
  const halfT =
    0.5 * p.thickness * Math.max(1, p.thicknessStart, p.thicknessEnd) * (1 + Math.abs(p.taper)) * (1 + p.thicknessNoise) +
    Math.abs(p.camber) +
    p.burr / 1000 +
    (p.lamellaAmp + p.microNoise + p.wavinessAmp) / 1000;
  return { halfW, halfT };
}

/** Paramètres d'enroulement effectifs (avec garde-fous anti auto-intersection). */
export function deriveShape(p: ChipParams): ShapeDerived {
  const { halfW, halfT } = sectionExtents(p);
  const phi0 = (p.ejectionAngle * Math.PI) / 180;
  const twistTotal = Math.abs((p.twist * Math.PI) / 180) * p.length;
  const twisting = twistTotal > 0.35;
  const sinP = Math.abs(Math.sin(phi0));
  const cosP = Math.abs(Math.cos(phi0));
  // Encombrement de la section dans la direction du centre de courbure et le long de l'axe.
  const nExt = twisting ? Math.max(halfW, halfT) : halfW * sinP + halfT * cosP;
  const axialExt = 2 * (twisting ? Math.max(halfW, halfT) : halfW * cosP + halfT * sinP);
  const radialExt = 2 * nExt;

  const Rmin = Math.max(nExt * 1.08, 0.05);
  const R0 = Math.max(p.radius, Rmin);
  let pitch = Math.max(0, p.pitch);
  let growth = p.radiusGrowth;
  const turns = p.length / (2 * Math.PI * Math.sqrt(R0 * R0 + (pitch / (2 * Math.PI)) ** 2));

  if (p.avoidOverlap && turns > 0.85 && p.tangle < 0.5) {
    const okPitch = pitch >= axialExt * 1.04;
    const okGrowth = Math.abs(growth) >= radialExt * 1.04;
    if (!okPitch && !okGrowth) {
      const rp = pitch / axialExt;
      const rg = Math.abs(growth) / radialExt;
      if (rp >= rg) pitch = axialExt * 1.08;
      else growth = (growth < 0 ? -1 : 1) * radialExt * 1.08;
    }
  }

  const kappaTangle = (p.tangle * 1.2) / (2 * p.width + 1.5);
  const tangleScale = 1.5 * p.width + 2;
  const volume = p.length * p.width * p.thickness;
  const confineRadius = Math.max(3 * p.width, Math.cbrt((3 * volume) / (4 * Math.PI * 0.02)));

  return {
    R0,
    Rmin,
    growth,
    c: pitch / (2 * Math.PI),
    phi0,
    turns,
    kappaTangle,
    tangleScale,
    confineRadius,
  };
}

/** Rayon instantané d'une spirale d'Archimède paramétrée en abscisse curviligne. */
function radiusAt(d: ShapeDerived, s: number): number {
  if (d.growth === 0) return d.R0;
  const r2 = d.R0 * d.R0 + (d.growth * s) / Math.PI;
  return Math.sqrt(Math.max(r2, d.Rmin * d.Rmin));
}

function rotate(v: Float64Array, o: number, ax: number, ay: number, az: number, c: number, s: number): void {
  // Rodrigues : v' = v cos + (a × v) sin + a (a·v)(1 - cos)
  const vx = v[o];
  const vy = v[o + 1];
  const vz = v[o + 2];
  const dot = ax * vx + ay * vy + az * vz;
  const cx = ay * vz - az * vy;
  const cy = az * vx - ax * vz;
  const cz = ax * vy - ay * vx;
  const k = dot * (1 - c);
  v[o] = vx * c + cx * s + ax * k;
  v[o + 1] = vy * c + cy * s + ay * k;
  v[o + 2] = vz * c + cz * s + az * k;
}

export function buildSpine(p: ChipParams, d: ShapeDerived, seed: number, steps: number): Spine {
  const L = p.length;
  const n = Math.max(4, steps);
  const ds = L / n;
  const X = new Float64Array((n + 1) * 3);
  const T = new Float64Array((n + 1) * 3);
  const N = new Float64Array((n + 1) * 3);
  const B = new Float64Array((n + 1) * 3);
  const roll = new Float64Array(n + 1);
  const noise = new Noise(seed ^ 0x51ed27);
  const rng = new Rng(seed ^ 0x2f7a1b);

  const mn = p.macroNoise;
  const ms = Math.max(0.05, p.macroNoiseScale);
  const kappaWander = (0.6 / (d.R0 + 4)) * mn;
  const twistRad = (p.twist * Math.PI) / 180;

  // Liaisons entre arcs (ISO 6.1) : pliure inverse + léger vrillage.
  const links: number[] = [];
  const linkKinks: { s: number; bend: number; twist: number }[] = [];
  const nSeg = Math.max(1, Math.round(p.linkedSegments));
  for (let k = 1; k < nSeg; k++) {
    const s = (k * L) / nSeg;
    links.push(s);
    linkKinks.push({
      s,
      bend: -((p.linkAngle * Math.PI) / 180) * rng.range(0.75, 1.25),
      twist: rng.range(-0.35, 0.35),
    });
  }
  let nextKink = 0;

  // Repère initial
  T[0] = 1;
  N[1] = 1;
  B[2] = 1;
  // Direction moyenne lissée (pour le confinement des pelotes)
  let Dx = 1;
  let Dy = 0;
  let Dz = 0;
  const conf = d.confineRadius;
  const Cx = conf * 0.7;
  const Cy = 0;
  const Cz = 0;

  roll[0] = rollAt(0);

  for (let i = 0; i < n; i++) {
    const s = i * ds;
    const o = i * 3;
    const o2 = o + 3;
    // Courbure et torsion locales de l'hélice nominale
    const R = radiusAt(d, s + ds * 0.5);
    let c = d.c;
    if (mn > 0) c *= 1 + 0.35 * mn * noise.fbm1(s / ms + 11.3, 2);
    let kappa = R / (R * R + c * c);
    const tau = c / (R * R + c * c);
    if (mn > 0) kappa *= 1 + 0.3 * mn * noise.fbm1(s / ms + 47.9, 2);
    kappa = Math.min(kappa, 0.95 / d.Rmin);

    const tx = T[o];
    const ty = T[o + 1];
    const tz = T[o + 2];
    // Vecteur de Darboux (repère monde) : τ T + κ B
    let wx = tau * tx + kappa * B[o];
    let wy = tau * ty + kappa * B[o + 1];
    let wz = tau * tz + kappa * B[o + 2];

    if (kappaWander > 0) {
      wx += kappaWander * noise.fbm1(s / ms + 101.1, 2);
      wy += kappaWander * noise.fbm1(s / ms + 211.7, 2);
      wz += kappaWander * noise.fbm1(s / ms + 307.3, 2);
    }
    if (d.kappaTangle > 0) {
      const ts = d.tangleScale;
      wx += d.kappaTangle * noise.fbm1(s / ts + 401.9, 3);
      wy += d.kappaTangle * noise.fbm1(s / ts + 503.3, 3);
      wz += d.kappaTangle * noise.fbm1(s / ts + 607.1, 3);
      // Confinement : ramène la direction moyenne vers le centre de la pelote.
      const rx = Cx - X[o];
      const ry = Cy - X[o + 1];
      const rz = Cz - X[o + 2];
      const r = len3(rx, ry, rz);
      if (r > 0.4 * conf) {
        const k = ((p.tangle * 2.5) / conf) * smoothstep(0.4 * conf, 1.1 * conf, r);
        const ux = rx / r;
        const uy = ry / r;
        const uz = rz / r;
        wx += k * (Dy * uz - Dz * uy);
        wy += k * (Dz * ux - Dx * uz);
        wz += k * (Dx * uy - Dy * ux);
      }
    }

    const wl = len3(wx, wy, wz);
    if (wl > 1e-12) {
      const ang = wl * ds;
      const ax = wx / wl;
      const ay = wy / wl;
      const az = wz / wl;
      const cs = Math.cos(ang);
      const sn = Math.sin(ang);
      T.copyWithin(o2, o, o + 3);
      N.copyWithin(o2, o, o + 3);
      B.copyWithin(o2, o, o + 3);
      rotate(T, o2, ax, ay, az, cs, sn);
      rotate(N, o2, ax, ay, az, cs, sn);
      rotate(B, o2, ax, ay, az, cs, sn);
    } else {
      T.copyWithin(o2, o, o + 3);
      N.copyWithin(o2, o, o + 3);
      B.copyWithin(o2, o, o + 3);
    }

    // Pliures aux liaisons
    while (nextKink < linkKinks.length && linkKinks[nextKink].s <= s + ds) {
      const kk = linkKinks[nextKink++];
      const bx = B[o2];
      const by = B[o2 + 1];
      const bz = B[o2 + 2];
      rotate(T, o2, bx, by, bz, Math.cos(kk.bend), Math.sin(kk.bend));
      rotate(N, o2, bx, by, bz, Math.cos(kk.bend), Math.sin(kk.bend));
      const ttx = T[o2];
      const tty = T[o2 + 1];
      const ttz = T[o2 + 2];
      rotate(N, o2, ttx, tty, ttz, Math.cos(kk.twist), Math.sin(kk.twist));
      rotate(B, o2, ttx, tty, ttz, Math.cos(kk.twist), Math.sin(kk.twist));
    }

    orthonormalize(T, N, B, o2);

    X[o2] = X[o] + 0.5 * ds * (tx + T[o2]);
    X[o2 + 1] = X[o + 1] + 0.5 * ds * (ty + T[o2 + 1]);
    X[o2 + 2] = X[o + 2] + 0.5 * ds * (tz + T[o2 + 2]);

    // Moyenne glissante de la tangente sur ~ une spire
    const lam = Math.max(ds, 2 * Math.PI * Math.sqrt(R * R + c * c));
    const a = Math.min(1, ds / lam);
    Dx += (T[o2] - Dx) * a;
    Dy += (T[o2 + 1] - Dy) * a;
    Dz += (T[o2 + 2] - Dz) * a;
    const dl = len3(Dx, Dy, Dz) || 1;
    Dx /= dl;
    Dy /= dl;
    Dz /= dl;

    roll[i + 1] = rollAt(s + ds);
  }

  return { n, ds, length: L, X, T, N, B, roll, links };

  function rollAt(s: number): number {
    let r = d.phi0 + twistRad * s;
    if (mn > 0) r += 0.5 * mn * noise.fbm1(s / ms + 709.7, 2);
    if (p.tangle > 0) r += 1.2 * p.tangle * noise.fbm1(s / d.tangleScale + 811.3, 2);
    return r;
  }
}

function orthonormalize(T: Float64Array, N: Float64Array, B: Float64Array, o: number): void {
  let tl = len3(T[o], T[o + 1], T[o + 2]) || 1;
  T[o] /= tl;
  T[o + 1] /= tl;
  T[o + 2] /= tl;
  const dot = N[o] * T[o] + N[o + 1] * T[o + 1] + N[o + 2] * T[o + 2];
  N[o] -= dot * T[o];
  N[o + 1] -= dot * T[o + 1];
  N[o + 2] -= dot * T[o + 2];
  tl = len3(N[o], N[o + 1], N[o + 2]) || 1;
  N[o] /= tl;
  N[o + 1] /= tl;
  N[o + 2] /= tl;
  B[o] = T[o + 1] * N[o + 2] - T[o + 2] * N[o + 1];
  B[o + 1] = T[o + 2] * N[o] - T[o] * N[o + 2];
  B[o + 2] = T[o] * N[o + 1] - T[o + 1] * N[o];
}

export interface FrameSample {
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
  tz: number;
  /** Direction de la largeur. */
  wx: number;
  wy: number;
  wz: number;
  /** Direction de l'épaisseur (vers la face libre). */
  hx: number;
  hy: number;
  hz: number;
}

/** Repère de section interpolé à l'abscisse s. */
export function sampleSpine(sp: Spine, s: number, out: FrameSample): FrameSample {
  const u = Math.min(sp.n, Math.max(0, s / sp.ds));
  let i = Math.floor(u);
  if (i >= sp.n) i = sp.n - 1;
  const f = u - i;
  const a = i * 3;
  const b = a + 3;
  const g = 1 - f;
  out.x = sp.X[a] * g + sp.X[b] * f;
  out.y = sp.X[a + 1] * g + sp.X[b + 1] * f;
  out.z = sp.X[a + 2] * g + sp.X[b + 2] * f;
  let tx = sp.T[a] * g + sp.T[b] * f;
  let ty = sp.T[a + 1] * g + sp.T[b + 1] * f;
  let tz = sp.T[a + 2] * g + sp.T[b + 2] * f;
  let tl = len3(tx, ty, tz) || 1;
  tx /= tl;
  ty /= tl;
  tz /= tl;
  let nx = sp.N[a] * g + sp.N[b] * f;
  let ny = sp.N[a + 1] * g + sp.N[b + 1] * f;
  let nz = sp.N[a + 2] * g + sp.N[b + 2] * f;
  const dot = nx * tx + ny * ty + nz * tz;
  nx -= dot * tx;
  ny -= dot * ty;
  nz -= dot * tz;
  tl = len3(nx, ny, nz) || 1;
  nx /= tl;
  ny /= tl;
  nz /= tl;
  const bx = ty * nz - tz * ny;
  const by = tz * nx - tx * nz;
  const bz = tx * ny - ty * nx;
  const r = sp.roll[i] * g + sp.roll[i + 1] * f;
  const c = Math.cos(r);
  const sn = Math.sin(r);
  out.tx = tx;
  out.ty = ty;
  out.tz = tz;
  out.wx = c * bx + sn * nx;
  out.wy = c * by + sn * ny;
  out.wz = c * bz + sn * nz;
  out.hx = -sn * bx + c * nx;
  out.hy = -sn * by + c * ny;
  out.hz = -sn * bz + c * nz;
  return out;
}

export function len3(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function newFrame(): FrameSample {
  return { x: 0, y: 0, z: 0, tx: 1, ty: 0, tz: 0, wx: 0, wy: 0, wz: 1, hx: 0, hy: 1, hz: 0 };
}
