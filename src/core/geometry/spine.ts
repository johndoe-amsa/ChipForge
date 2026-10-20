import type { ChipParams } from '../params';
import { Noise } from '../noise';
import { Rng } from '../rng';
import { ContactField, contactSettings, TubeField, type ContactSettings } from './contact';

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

/** Demi-étendues maximales de la section (largeur, épaisseur), tous reliefs compris. */
export function sectionExtents(p: ChipParams): { halfW: number; halfT: number } {
  const halfW = 0.5 * p.width * Math.max(1, p.widthStart, p.widthEnd) * (1 + 0.05 * p.macroNoise);
  const halfT =
    0.5 * p.thickness * Math.max(1, p.thicknessStart, p.thicknessEnd) * (1 + Math.abs(p.taper)) * (1 + p.thicknessNoise) +
    Math.abs(p.camber) +
    p.burr / 1000 +
    (p.lamellaAmp + p.striationAmp + p.microNoise + p.wavinessAmp) / 1000;
  return { halfW, halfT };
}

/** Réglages de l'option « Éviter les auto-intersections » (réserve de pas, densité des pelotes). */
export const OVERLAP_TUNING = { clearance: 0.6, packing: 0.012 };

/** Sondes d'anticipation : trajectoire prévue intégrée en PROBE_STEPS pas, une sonde tous les PROBE_EVERY pas. */
const PROBE_STEPS = 8;
const PROBE_EVERY = 2;
/** Évitement à l'échelle du tube (hélices) : vitesse de virage de l'axe (rad/mm) et visée (× rayon du tube). */
const TUBE_STEER = 0.2;
const TUBE_LOOK = 1.2;

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

  // Hélice nominale sans recouvrement, avec une réserve proportionnelle au désordre (le bruit
  // et l'enchevêtrement déforment les spires) ; les contacts restants sont ensuite résolus
  // par relaxSpine (relax.ts).
  if (p.avoidOverlap && turns > 0.85) {
    const slack = 1.04 + OVERLAP_TUNING.clearance * p.tangle + 0.3 * p.macroNoise;
    const okPitch = pitch >= axialExt * slack;
    const okGrowth = Math.abs(growth) >= radialExt * slack;
    if (!okPitch && !okGrowth) {
      const rp = pitch / axialExt;
      const rg = Math.abs(growth) / radialExt;
      if (rp >= rg) pitch = axialExt * (slack + 0.04);
      else growth = (growth < 0 ? -1 : 1) * radialExt * (slack + 0.04);
    }
  }

  const kappaTangle = (p.tangle * 1.3) / (2 * p.width + 1.5);
  const tangleScale = 1.2 * p.width + 1.5;
  const volume = p.length * p.width * p.thickness;
  // Taux de remplissage de la pelote : un peu plus lâche quand les auto-intersections doivent
  // être évitées (l'aspect « nid » est conservé et la résolution reste rapide).
  const packing = p.avoidOverlap ? OVERLAP_TUNING.packing : 0.02;
  const confineRadius = Math.max(3 * p.width, Math.cbrt((3 * volume) / (4 * Math.PI * packing)));

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

export function rotate(v: Float64Array, o: number, ax: number, ay: number, az: number, c: number, s: number): void {
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

/**
 * `variant` (option « Éviter les auto-intersections ») : réglage alternatif et déterministe de
 * l'évitement pendant la croissance, essayé quand la relaxation ne parvient pas à tout résoudre.
 */
export function buildSpine(p: ChipParams, d: ShapeDerived, seed: number, steps: number, variant = 0): Spine {
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
  // Errance absolue de la fibre (1/mm) : serpentement des rubans, axe des hélices qui dérive.
  const kappaWander = (0.7 / (4 + 3 * p.width)) * mn;
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

  // Évitement des auto-intersections pendant la croissance : comme un vrai copeau, la matière
  // nouvellement formée anticipe et contourne les portions déjà formées, ou glisse dessus,
  // au lieu de les traverser ; pour une hélice, le tube entier contourne les passages
  // précédents. Les contacts restants sont résolus par relaxSpine (relax.ts).
  let field: ContactField | null = null;
  let cs: ContactSettings | null = null;
  const F9 = new Float64Array(9);
  const Fe = new Float64Array(9);
  const Fj = new Float64Array(9);
  const Fp = new Float64Array(9);
  const Fq = new Float64Array(9);
  const Ee = new Float64Array(3);
  const push = new Float64Array(3);
  let halfW = 0;
  let halfT = 0;
  let lookAhead = 0;
  let softGap = 0;
  let steerCap = 0;
  let capIn = 0;
  let capOut = 0;
  let halfStride = 0;
  let nextElem = 0;
  let tube: TubeField | null = null;
  let nExt = 0;
  let nextTube = 0;
  let tubeSteer = TUBE_STEER;
  const tubePush = new Float64Array(3);
  if (p.avoidOverlap) {
    ({ halfW, halfT } = sectionExtents(p));
    cs = contactSettings(halfW, halfT, ds);
    field = new ContactField(cs);
    lookAhead = Math.max(3 * halfW, 4 * cs.h) * (1 + 0.15 * variant);
    tubeSteer = TUBE_STEER * (1 + 0.5 * variant);
    softGap = cs.margin + 0.3 * halfT + 0.05 * halfW;
    // Flexion maximale de la fibre, jamais inférieure à celle de l'hélice nominale (bruit compris)
    // sur toute sa plage de rayons : seule la flexion ajoutée par l'évitement est bornée.
    const kh = (r: number) => r / (r * r + d.c * d.c);
    const kBase = 1.3 * Math.min(0.95 / d.Rmin, Math.max(kh(radiusAt(d, 0)), kh(radiusAt(d, L))));
    // Dans le plan du ruban (sur sa largeur), la section se replierait au-delà de
    // 1 / demi-largeur : réserve pour la relaxation qui suit.
    capIn = Math.max(0.6 / halfW, kBase);
    // Hors plan, la limite physique (0,93 / demi-épaisseur) permettrait des boucles serrées qui se
    // referment sur elles-mêmes en quelques millimètres : bornée à l'échelle de la largeur.
    capOut = Math.min(0.93 / halfT, Math.max(1 / halfW, kBase));
    steerCap = Math.min(capOut, 1.6 / halfW);
    halfStride = Math.ceil(cs.stride / 2);
    if (d.c > 0 && d.turns > 2) {
      nExt = d.Rmin / 1.08;
      tube = new TubeField(1.3 * Math.max(radiusAt(d, 0), radiusAt(d, L)) + nExt);
    }
  }

  for (let i = 0; i < n; i++) {
    const s = i * ds;
    const o = i * 3;
    const o2 = o + 3;
    // Courbure et torsion locales de l'hélice nominale
    const R = radiusAt(d, s + ds * 0.5);
    let c = d.c;
    if (mn > 0) c *= 1 + 0.25 * mn * noise.vfbm1(s / ms + 11.3, 2);
    let kappa = R / (R * R + c * c);
    const tau = c / (R * R + c * c);
    if (mn > 0) kappa *= 1 + 0.2 * mn * noise.vfbm1(s / ms + 47.9, 2);
    kappa = Math.min(kappa, 0.95 / d.Rmin);
    const om = Math.sqrt(kappa * kappa + tau * tau);

    const tx = T[o];
    const ty = T[o + 1];
    const tz = T[o + 2];
    // Vecteur de Darboux (repère monde) : τ T + κ B
    let wx = tau * tx + kappa * B[o];
    let wy = tau * ty + kappa * B[o + 1];
    let wz = tau * tz + kappa * B[o + 2];

    if (kappaWander > 0) {
      wx += kappaWander * noise.vfbm1(s / ms + 101.1, 2);
      wy += kappaWander * noise.vfbm1(s / ms + 211.7, 2);
      wz += kappaWander * noise.vfbm1(s / ms + 307.3, 2);
    }
    if (d.kappaTangle > 0) {
      const ts = d.tangleScale;
      wx += d.kappaTangle * noise.vfbm1(s / ts + 401.9, 3);
      wy += d.kappaTangle * noise.vfbm1(s / ts + 503.3, 3);
      wz += d.kappaTangle * noise.vfbm1(s / ts + 607.1, 3);
      // Direction d'avance moyenne : axe de l'hélice si le copeau est enroulé, tangente sinon.
      if (om > 1e-9 && (2 * Math.PI) / om < 3 * conf && tau > 1e-6) {
        Dx = (tau * tx + kappa * B[o]) / om;
        Dy = (tau * ty + kappa * B[o + 1]) / om;
        Dz = (tau * tz + kappa * B[o + 2]) / om;
      }
      // Confinement : ramène la direction moyenne vers le centre de la pelote.
      const rx = Cx - X[o];
      const ry = Cy - X[o + 1];
      const rz = Cz - X[o + 2];
      const r = len3(rx, ry, rz);
      if (r > 0.3 * conf) {
        const k = ((p.tangle * 4) / conf) * smoothstep(0.3 * conf, 1.0 * conf, r);
        const ux = rx / r;
        const uy = ry / r;
        const uz = rz / r;
        wx += k * (Dy * uz - Dz * uy);
        wy += k * (Dz * ux - Dx * uz);
        wz += k * (Dx * uy - Dy * ux);
      }
    }

    // Tube : l'axe de l'hélice contourne les portions de tube déjà formées (les spires de deux
    // passages successifs ne s'interpénètrent pas, le tube glisse le long des précédents).
    if (tube && om > 1e-9 && tau > 1e-6) {
      // Axe local de l'hélice, rayon du tube et point de l'axe.
      const hx = (tau * tx + kappa * B[o]) / om;
      const hy = (tau * ty + kappa * B[o + 1]) / om;
      const hz = (tau * tz + kappa * B[o + 2]) / om;
      const Rh = kappa / (om * om);
      const rt = Rh + nExt;
      const ax = X[o] + Rh * N[o];
      const ay = X[o + 1] + Rh * N[o + 1];
      const az = X[o + 2] + Rh * N[o + 2];
      if (s >= nextTube) {
        tube.add(ax, ay, az, rt, s);
        nextTube = s + 0.5 * rt;
      }
      // Portions de tube récentes (l'axe n'a pas encore avancé de 2,5 rayons) : ignorées.
      const vAx = Math.max(0.03, tau / om);
      const look = TUBE_LOOK * rt;
      const hits = tube.repel(ax + hx * look, ay + hy * look, az + hz * look, rt, s - (2.5 * rt) / vAx, tubePush);
      if (hits > 0) {
        const along = tubePush[0] * hx + tubePush[1] * hy + tubePush[2] * hz;
        const px = tubePush[0] - along * hx;
        const py = tubePush[1] - along * hy;
        const pz = tubePush[2] - along * hz;
        const pl = len3(px, py, pz);
        if (pl > 1e-9) {
          // Rotation de tout le repère autour de axe × poussée : l'axe de l'hélice s'incline.
          const k = Math.min(tubeSteer, tubeSteer * pl) / pl;
          wx += k * (hy * pz - hz * py);
          wy += k * (hz * px - hx * pz);
          wz += k * (hx * py - hy * px);
        }
      }
    }

    // Anticipation : des pavés sondes placés devant la pointe ; à la première portion déjà
    // formée rencontrée, la fibre s'infléchit progressivement pour glisser sur la face de cette
    // portion tournée vers elle (sa largeur ou son épaisseur), au lieu de la traverser.
    if (field) {
      frameAt(i, F9);
      // Trajectoire prévue : la rotation courante (spire, enchevêtrement) est intégrée sur la
      // distance de visée ; les sondes sont placées et orientées le long de cette trajectoire.
      Fp.set(F9);
      let qx = X[o];
      let qy = X[o + 1];
      let qz = X[o + 2];
      const wl0 = len3(wx, wy, wz);
      const dsub = lookAhead / PROBE_STEPS;
      const cr = Math.cos(wl0 * dsub);
      const sr = Math.sin(wl0 * dsub);
      let ux = tx;
      let uy = ty;
      let uz = tz;
      let dNear = 0;
      for (let sub = 1; sub <= PROBE_STEPS; sub++) {
        if (wl0 > 1e-9) {
          // Pas de longueur dsub, tangente au milieu du pas.
          const hx = Math.cos(0.5 * wl0 * dsub);
          const hs = Math.sin(0.5 * wl0 * dsub);
          Fq.set(Fp);
          rotate(Fq, 6, wx / wl0, wy / wl0, wz / wl0, hx, hs);
          qx += dsub * Fq[6];
          qy += dsub * Fq[7];
          qz += dsub * Fq[8];
          for (let v = 0; v < 9; v += 3) rotate(Fp, v, wx / wl0, wy / wl0, wz / wl0, cr, sr);
        } else {
          qx += dsub * Fp[6];
          qy += dsub * Fp[7];
          qz += dsub * Fp[8];
        }
        if (sub % PROBE_EVERY !== 0) continue;
        const dist = sub * dsub;
        const k = field.deepest(qx, qy, qz, Fp, 0, s, softGap);
        if (k < 0) continue;
        // Face de l'obstacle tournée vers la pointe (largeur ou épaisseur, jamais sa fibre).
        const fo = k * 9;
        const rx = X[o] - field.pos[k * 3];
        const ry = X[o + 1] - field.pos[k * 3 + 1];
        const rz = X[o + 2] - field.pos[k * 3 + 2];
        const rw = (rx * field.frames[fo] + ry * field.frames[fo + 1] + rz * field.frames[fo + 2]) / (field.ext[k * 3] + halfW);
        const rh = (rx * field.frames[fo + 3] + ry * field.frames[fo + 4] + rz * field.frames[fo + 5]) / (field.ext[k * 3 + 1] + halfT);
        const fa = Math.abs(rw) > Math.abs(rh) ? fo : fo + 3;
        const sg = (Math.abs(rw) > Math.abs(rh) ? rw : rh) >= 0 ? 1 : -1;
        const nx = sg * field.frames[fa];
        const ny = sg * field.frames[fa + 1];
        const nz = sg * field.frames[fa + 2];
        // Glissement : la composante d'approche vers chaque face rencontrée est retirée, avec
        // un léger écartement ; entre deux couches, la pointe file entre elles.
        const tn = ux * nx + uy * ny + uz * nz;
        if (tn < 0.15) {
          ux += (0.3 - tn) * nx;
          uy += (0.3 - tn) * ny;
          uz += (0.3 - tn) * nz;
          if (dNear === 0) dNear = dist;
        }
      }
      if (dNear > 0) {
        const ul = len3(ux, uy, uz) || 1;
        ux /= ul;
        uy /= ul;
        uz /= ul;
        const ax = ty * uz - tz * uy;
        const ay = tz * ux - tx * uz;
        const az = tx * uy - ty * ux;
        const sn = len3(ax, ay, az);
        if (sn > 1e-9) {
          const rate = Math.min(steerCap, (2 * Math.atan2(sn, tx * ux + ty * uy + tz * uz)) / dNear);
          wx += (rate * ax) / sn;
          wy += (rate * ay) / sn;
          wz += (rate * az) / sn;
        }
      }
      // Flexion bornée (pas de pliure de la section).
      const wW = wx * F9[0] + wy * F9[1] + wz * F9[2];
      const wH = wx * F9[3] + wy * F9[4] + wz * F9[5];
      const dW = wW - Math.max(-capOut, Math.min(capOut, wW));
      const dH = wH - Math.max(-capIn, Math.min(capIn, wH));
      wx -= dW * F9[0] + dH * F9[3];
      wy -= dW * F9[1] + dH * F9[4];
      wz -= dW * F9[2] + dH * F9[5];
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
    roll[i + 1] = rollAt(s + ds);

    // Contact : la pointe glisse sur la portion touchée (virage limité, longueur conservée).
    if (field && cs) {
      // Flexion déjà engagée sur ce pas (dans le plan, hors plan), pour la borne totale.
      frameAt(i, Fj);
      let bW = 0;
      let bH = 0;
      {
        const cx = ty * T[o2 + 2] - tz * T[o2 + 1];
        const cy = tz * T[o2] - tx * T[o2 + 2];
        const cz = tx * T[o2 + 1] - ty * T[o2];
        bW = (cx * Fj[0] + cy * Fj[1] + cz * Fj[2]) / ds;
        bH = (cx * Fj[3] + cy * Fj[4] + cz * Fj[5]) / ds;
      }
      frameAt(i + 1, F9);
      const hits = field.resolve(X[o2], X[o2 + 1], X[o2 + 2], F9, 0, s + ds, cs.margin, push);
      if (hits > 0) {
        let dx = X[o2] + push[0] - X[o];
        let dy = X[o2 + 1] + push[1] - X[o + 1];
        let dz = X[o2 + 2] + push[2] - X[o + 2];
        const dl = len3(dx, dy, dz);
        if (dl > 1e-12) {
          dx /= dl;
          dy /= dl;
          dz /= dl;
          const ux = T[o2];
          const uy = T[o2 + 1];
          const uz = T[o2 + 2];
          let ax = uy * dz - uz * dy;
          let ay = uz * dx - ux * dz;
          let az = ux * dy - uy * dx;
          const sn = len3(ax, ay, az);
          let ang = Math.min(Math.atan2(sn, ux * dx + uy * dy + uz * dz), steerCap * ds);
          if (sn > 1e-12 && ang > 0) {
            ax /= sn;
            ay /= sn;
            az /= sn;
            // Rotation bornée pour que la flexion totale du pas reste sans pliure.
            let rW = ang * (ax * Fj[0] + ay * Fj[1] + az * Fj[2]);
            let rH = ang * (ax * Fj[3] + ay * Fj[4] + az * Fj[5]);
            rW = Math.max(-capOut * ds - bW * ds, Math.min(capOut * ds - bW * ds, rW));
            rH = Math.max(-capIn * ds - bH * ds, Math.min(capIn * ds - bH * ds, rH));
            ax = rW * Fj[0] + rH * Fj[3];
            ay = rW * Fj[1] + rH * Fj[4];
            az = rW * Fj[2] + rH * Fj[5];
            ang = len3(ax, ay, az);
            ax /= ang || 1;
            ay /= ang || 1;
            az /= ang || 1;
            const c1 = Math.cos(ang);
            const s1 = Math.sin(ang);
            rotate(T, o2, ax, ay, az, c1, s1);
            rotate(N, o2, ax, ay, az, c1, s1);
            rotate(B, o2, ax, ay, az, c1, s1);
            orthonormalize(T, N, B, o2);
            X[o2] = X[o] + 0.5 * ds * (tx + T[o2]);
            X[o2 + 1] = X[o + 1] + 0.5 * ds * (ty + T[o2 + 1]);
            X[o2 + 2] = X[o + 2] + 0.5 * ds * (tz + T[o2 + 2]);
          }
        }
      }
      // Éléments formés : enregistrés dès que toute leur portion de fibre existe, avec un pavé
      // englobant les coins de toutes ses sections (courbure et torsion comprises).
      while (nextElem + halfStride <= i + 1) {
        addElement(nextElem, i + 1);
        nextElem += cs.stride;
      }
    }

    // Moyenne glissante de la tangente sur ~ une spire
    // Fenêtre ≈ une spire, bornée par la taille de la pelote (un ruban n'a pas de spires).
    const lam = Math.max(ds, Math.min(2 * Math.PI * Math.sqrt(R * R + c * c), 0.5 * conf));
    const a = Math.min(1, ds / lam);
    Dx += (T[o2] - Dx) * a;
    Dy += (T[o2 + 1] - Dy) * a;
    Dz += (T[o2 + 2] - Dz) * a;
    const dl = len3(Dx, Dy, Dz) || 1;
    Dx /= dl;
    Dy /= dl;
    Dz /= dl;
  }

  return { n, ds, length: L, X, T, N, B, roll, links };

  function addElement(c: number, last: number): void {
    frameAt(c, Fe);
    const oc = c * 3;
    let eW = 0;
    let eH = 0;
    let eT = 0;
    for (let j = Math.max(0, c - halfStride); j <= Math.min(last, c + halfStride); j++) {
      frameAt(j, Fj);
      for (let q = 0; q < 4; q++) {
        const a = q & 1 ? halfW : -halfW;
        const b = q & 2 ? halfT : -halfT;
        const dx = X[j * 3] + a * Fj[0] + b * Fj[3] - X[oc];
        const dy = X[j * 3 + 1] + a * Fj[1] + b * Fj[4] - X[oc + 1];
        const dz = X[j * 3 + 2] + a * Fj[2] + b * Fj[5] - X[oc + 2];
        eW = Math.max(eW, Math.abs(dx * Fe[0] + dy * Fe[1] + dz * Fe[2]));
        eH = Math.max(eH, Math.abs(dx * Fe[3] + dy * Fe[4] + dz * Fe[5]));
        eT = Math.max(eT, Math.abs(dx * Fe[6] + dy * Fe[7] + dz * Fe[8]));
      }
    }
    Ee[0] = eW;
    Ee[1] = eH;
    Ee[2] = eT;
    field!.add(X[oc], X[oc + 1], X[oc + 2], Fe, 0, c * ds, Ee, 0);
  }

  /** Repère de section (W, H, T) de l'échantillon i, écrit dans out[0..8]. */
  function frameAt(i: number, out: Float64Array): void {
    const o = i * 3;
    const c = Math.cos(roll[i]);
    const sn = Math.sin(roll[i]);
    for (let a = 0; a < 3; a++) {
      out[a] = c * B[o + a] + sn * N[o + a];
      out[3 + a] = -sn * B[o + a] + c * N[o + a];
      out[6 + a] = T[o + a];
    }
  }

  function rollAt(s: number): number {
    let r = d.phi0 + twistRad * s;
    if (mn > 0) r += 0.3 * mn * noise.vfbm1(s / ms + 709.7, 2);
    if (p.tangle > 0) r += 0.8 * p.tangle * noise.vfbm1(s / d.tangleScale + 811.3, 2);
    return r;
  }
}

export function orthonormalize(T: Float64Array, N: Float64Array, B: Float64Array, o: number): void {
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
