import type { ChipParams } from '../params';
import { CellGrid, contactSettings, penetration } from './contact';
import { newFrame, orthonormalize, rotate, sampleSpine, sectionExtents, type Spine } from './spine';

/**
 * Nettoyage final des auto-intersections (option « Éviter les auto-intersections »).
 *
 * La fibre est déjà construite en évitant les portions formées (spine.ts) ; il peut rester des
 * contacts quand la pointe s'est retrouvée coincée. Ils sont résolus par relaxation : chaque
 * paire d'éléments en recouvrement est écartée le long de son axe de moindre pénétration,
 * perpendiculairement à sa fibre, jusqu'à ce qu'aucune paire ne se recouvre.
 *
 * Le déplacement de la fibre n'est pas libre point par point : c'est une B-spline cubique
 * uniforme le long de l'abscisse, de pas ≈ 1,6 × la demi-largeur. La fibre s'écarte donc d'un
 * seul tenant, sans pli, sans accordéon ni cassure. Deux contraintes l'accompagnent :
 *   - fibre (quasi) inextensible : la longueur de chaque élément reste à ±10 % ; une portion
 *     écartée tire la matière voisine au lieu de se tasser,
 *   - courbure ajoutée bornée : la section ne peut pas se replier sur elle-même.
 * Le repère de section suit la fibre par rotation minimale (roulis, torsion et angle d'éjection
 * conservés).
 *
 * Chaque élément est englobé par un pavé calculé sur les sections réellement maillées
 * (courbure et torsion comprises) ; après report sur la fibre complète, le contrôle est refait
 * sur ces pavés exacts et la relaxation reprise si nécessaire. Calcul déterministe.
 */

export interface RelaxResult {
  /** Paires d'éléments en recouvrement avant nettoyage. */
  initial: number;
  /** Paires restant en recouvrement (0 = aucune auto-intersection). */
  residual: number;
  iterations: number;
}

const MAX_POINTS = 6000;
const ROUNDS = 4;
/** Pas des points de contrôle du déplacement, en multiples de la plus grande demi-étendue. */
const SPAN = 1.6;
/** Courbure que le déplacement peut ajouter, en fraction de 1 / (plus grande demi-étendue). */
const BEND_ADD = 0.3;
/** Allongement admissible de chaque élément. */
const STRAIN_LO = 0.9;
const STRAIN_HI = 1.1;

export function relaxSpine(sp: Spine, p: ChipParams, maxIterations = 400): RelaxResult {
  const { halfW, halfT } = sectionExtents(p);
  const nFine = sp.n + 1;
  const ds = sp.ds;
  const L = sp.n * ds;
  const cs = contactSettings(halfW, halfT, ds);
  const stride = Math.max(cs.stride, Math.ceil(nFine / MAX_POINTS));
  const h = stride * ds;
  const margin = cs.margin;
  const idx: number[] = [];
  for (let i = 0; i < nFine; i += stride) idx.push(i);
  if (idx[idx.length - 1] !== nFine - 1) idx.push(nFine - 1);
  const m = idx.length;

  // Points de contrôle du déplacement (B-spline cubique uniforme, pas S).
  const ext = Math.max(halfW, 2 * halfT);
  const S = Math.max(2 * h, SPAN * ext);
  const nc = Math.ceil(L / S) + 3;
  const C = new Float64Array(nc * 3);
  const cb = new Int32Array(m);
  const wb = new Float64Array(m * 4);
  const wn = new Float64Array(m);
  const basis = (s: number, out: Float64Array, o: number): number => {
    const u = Math.min(nc - 3 - 1e-9, Math.max(0, s / S));
    const j = Math.floor(u);
    const t = u - j;
    const t2 = t * t;
    const t3 = t2 * t;
    out[o] = ((1 - t) * (1 - t) * (1 - t)) / 6;
    out[o + 1] = (3 * t3 - 6 * t2 + 4) / 6;
    out[o + 2] = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6;
    out[o + 3] = t3 / 6;
    return j;
  };
  for (let k = 0; k < m; k++) {
    cb[k] = basis(idx[k] * ds, wb, k * 4);
    let n2 = 0;
    for (let i = 0; i < 4; i++) n2 += wb[k * 4 + i] ** 2;
    wn[k] = 1 / n2;
  }
  // Éléments portés par chaque point de contrôle : [cFirst, cLast].
  const cFirst = new Int32Array(nc).fill(m);
  const cLast = new Int32Array(nc).fill(-1);
  for (let k = 0; k < m; k++)
    for (let i = 0; i < 4; i++) {
      const c = cb[k] + i;
      cFirst[c] = Math.min(cFirst[c], k);
      cLast[c] = Math.max(cLast[c], k);
    }

  const P = new Float64Array(m * 3);
  const P0 = new Float64Array(m * 3);
  const F = new Float64Array(m * 9);
  const F0 = new Float64Array(m * 9);
  const E = new Float64Array(m * 3);
  /** Rayon englobant de chaque pavé (|E|), pour le rejet rapide. */
  const rE = new Float64Array(m);
  let reach = 0;
  const fr = newFrame();
  const fq = newFrame();

  /**
   * Éléments relus sur la fibre fine : centre, repère de section (celui du maillage) et pavé
   * englobant les quatre coins de toutes les sections de sa portion de fibre.
   */
  const load = () => {
    reach = 0;
    for (let k = 0; k < m; k++) {
      sampleSpine(sp, idx[k] * ds, fr);
      const q = k * 3;
      P[q] = fr.x;
      P[q + 1] = fr.y;
      P[q + 2] = fr.z;
      F.set([fr.wx, fr.wy, fr.wz, fr.hx, fr.hy, fr.hz, fr.tx, fr.ty, fr.tz], k * 9);
      const s0 = k > 0 ? 0.5 * (idx[k - 1] + idx[k]) * ds : 0;
      const s1 = k < m - 1 ? 0.5 * (idx[k] + idx[k + 1]) * ds : idx[k] * ds;
      const ns = Math.max(1, Math.ceil((s1 - s0) / (0.5 * ds)));
      let eW = 0;
      let eH = 0;
      let eT = 0;
      for (let t = 0; t <= ns; t++) {
        sampleSpine(sp, s0 + ((s1 - s0) * t) / ns, fq);
        for (let c = 0; c < 4; c++) {
          const a = c & 1 ? halfW : -halfW;
          const b = c & 2 ? halfT : -halfT;
          const dx = fq.x + a * fq.wx + b * fq.hx - fr.x;
          const dy = fq.y + a * fq.wy + b * fq.hy - fr.y;
          const dz = fq.z + a * fq.wz + b * fq.hz - fr.z;
          eW = Math.max(eW, Math.abs(dx * fr.wx + dy * fr.wy + dz * fr.wz));
          eH = Math.max(eH, Math.abs(dx * fr.hx + dy * fr.hy + dz * fr.hz));
          eT = Math.max(eT, Math.abs(dx * fr.tx + dy * fr.ty + dz * fr.tz));
        }
      }
      E[q] = eW;
      E[q + 1] = eH;
      E[q + 2] = eT;
      rE[k] = Math.hypot(eW, eH, eT);
      reach = Math.max(reach, rE[k]);
    }
    reach = 2 * reach;
    P0.set(P);
    F0.set(F);
    C.fill(0);
  };

  /** Position courante de l'élément k (calculée sur les points de contrôle), écrite dans out[o..o+2]. */
  const at = (k: number, out: Float64Array, o: number) => {
    const c = cb[k] * 3;
    const w = k * 4;
    for (let a = 0; a < 3; a++)
      out[o + a] =
        P0[k * 3 + a] + wb[w] * C[c + a] + wb[w + 1] * C[c + 3 + a] + wb[w + 2] * C[c + 6 + a] + wb[w + 3] * C[c + 9 + a];
  };
  /** Positions de tous les éléments, recalculées sur les points de contrôle. */
  const place = () => {
    for (let k = 0; k < m; k++) at(k, P, k * 3);
  };

  const pk = new Float64Array(6);
  const dp = new Float64Array(3);
  /**
   * Déplace l'élément k de `d` le long de `n`, perpendiculairement à sa fibre (la fibre se
   * prolonge au-delà de l'élément : la pousser dans sa direction l'étirerait), en modifiant
   * les quatre points de contrôle qui le portent (correction de norme minimale).
   */
  const nudge = (k: number, n: Float64Array, d: number) => {
    const o = k * 9 + 6;
    const t = n[0] * F[o] + n[1] * F[o + 1] + n[2] * F[o + 2];
    dp[0] = d * (n[0] - t * F[o]);
    dp[1] = d * (n[1] - t * F[o + 1]);
    dp[2] = d * (n[2] - t * F[o + 2]);
    const c = cb[k];
    for (let i = 0; i < 4; i++) {
      const f = wb[k * 4 + i] * wn[k];
      for (let a = 0; a < 3; a++) C[(c + i) * 3 + a] += f * dp[a];
    }
    // Positions à jour (Gauss-Seidel) pour les éléments portés par ces points de contrôle.
    for (let j = cFirst[c]; j <= cLast[c + 3]; j++) at(j, P, j * 3);
  };

  const axis = new Float64Array(4);
  const excl = Math.ceil((2.2 * halfW + 2 * h) / h) + 2;

  // Ensemble actif : seuls les éléments en contact (et leur voisinage) sont retraités à chaque
  // itération ; un contrôle complet périodique réactive les zones touchées par ricochet.
  const active = new Uint8Array(m);
  const touched = new Uint8Array(m);
  let all = true;
  /** Paires en recouvrement avec le jeu `gap2` lors du dernier passage. */
  let count2 = 0;

  /**
   * Compte (et corrige si `apply`) les paires en recouvrement avec le jeu `gap`, ainsi que
   * celles qui le restent avec le jeu plus faible `gap2` (count2).
   */
  const grid = new CellGrid();
  const collide = (apply: boolean, gap: number, gap2 = gap): number => {
    grid.build(P, m, 1 / (reach + gap));
    const order = grid.order;
    const ranges = grid.ranges;
    touched.fill(0);
    let count = 0;
    count2 = 0;
    // La grille est construite sur les positions de début de passage : les corrections du
    // passage (quelques dixièmes de mm au plus) restent couvertes par la marge des cellules.
    for (let k = 0; k < m; k++) {
      if (!all && !active[k]) continue;
      const nr = grid.neighbours(k);
      for (let r = 0; r < nr; r++)
        for (let q = ranges[2 * r]; q < ranges[2 * r + 1]; q++) {
          const j = order[q];
          if (Math.abs(j - k) <= excl) continue;
          // Chaque paire une seule fois : (k < j), ou j hors de l'ensemble actif.
          if (j < k && (all || active[j])) continue;
          const rr = rE[k] + rE[j] + gap;
          const ex = P[j * 3] - P[k * 3];
          const ey = P[j * 3 + 1] - P[k * 3 + 1];
          const ez = P[j * 3 + 2] - P[k * 3 + 2];
          if (ex * ex + ey * ey + ez * ez >= rr * rr) continue;
          const d = penetration(ex, ey, ez, F, k * 9, E, k * 3, F, j * 9, E, j * 3, gap, axis, true);
          if (d <= 0) continue;
          count++;
          if (axis[3] - gap + gap2 > 0) count2++;
          touched[k] = 1;
          touched[j] = 1;
          if (!apply) continue;
          const corr = 0.5 * d + 1e-5;
          nudge(k, axis, -corr);
          nudge(j, axis, corr);
        }
    }
    return count;
  };

  /**
   * Les repères des éléments suivent la fibre déformée : rotation minimale de la tangente
   * initiale vers la tangente actuelle, appliquée au repère initial, exactement comme le fera
   * le maillage final (followFrames) ; le test de contact porte sur l'orientation réelle.
   */
  const updateFrames = () => {
    for (let k = 0; k < m; k++) {
      const a = Math.max(0, k - 1) * 3;
      const b = Math.min(m - 1, k + 1) * 3;
      let ox = P0[b] - P0[a];
      let oy = P0[b + 1] - P0[a + 1];
      let oz = P0[b + 2] - P0[a + 2];
      let nx = P[b] - P[a];
      let ny = P[b + 1] - P[a + 1];
      let nz = P[b + 2] - P[a + 2];
      const ol = Math.hypot(ox, oy, oz);
      const nl = Math.hypot(nx, ny, nz);
      if (ol < 1e-12 || nl < 1e-12) continue;
      ox /= ol;
      oy /= ol;
      oz /= ol;
      nx /= nl;
      ny /= nl;
      nz /= nl;
      const o = k * 9;
      for (let t = 0; t < 9; t++) F[o + t] = F0[o + t];
      let ax = oy * nz - oz * ny;
      let ay = oz * nx - ox * nz;
      let az = ox * ny - oy * nx;
      const s = Math.hypot(ax, ay, az);
      if (s < 1e-10) continue;
      ax /= s;
      ay /= s;
      az /= s;
      const c = ox * nx + oy * ny + oz * nz;
      rotate(F, o, ax, ay, az, c, s);
      rotate(F, o + 3, ax, ay, az, c, s);
      rotate(F, o + 6, ax, ay, az, c, s);
    }
  };

  /** Ensemble actif = éléments touchés lors du dernier passage et leur voisinage. */
  const refreshActive = () => {
    active.fill(0);
    const r = Math.ceil(S / h) + 2;
    for (let k = 0; k < m; k++) {
      if (!touched[k]) continue;
      for (let d = Math.max(0, k - r); d <= Math.min(m - 1, k + r); d++) active[d] = 1;
    }
  };

  /** Contrôle complet (tous les éléments). */
  const fullCheck = (gap: number, gap2 = gap) => {
    all = true;
    const n = collide(false, gap, gap2);
    all = false;
    return n;
  };

  /**
   * Fibre quasi inextensible : la longueur de chaque élément est ramenée dans [0,9 ; 1,1] ×
   * sa longueur d'origine en agissant sur les points de contrôle (projection de norme minimale
   * dans l'espace des B-splines), dans les deux sens de parcours. Une portion écartée tire la
   * matière voisine au lieu de se tasser (un tassement courberait la fibre au-delà du pli).
   */
  const rest = new Float64Array(Math.max(0, m - 1));
  const dw = new Float64Array(5);
  const stretch = () => {
    let moved = false;
    for (let pass = 0; pass < 2; pass++)
      for (let q = 0; q < m - 1; q++) {
        const k = pass === 0 ? q : m - 2 - q;
        at(k, pk, 0);
        at(k + 1, pk, 3);
        const ex = pk[3] - pk[0];
        const ey = pk[4] - pk[1];
        const ez = pk[5] - pk[2];
        const len = Math.sqrt(ex * ex + ey * ey + ez * ez) || 1e-12;
        const lo = STRAIN_LO * rest[k];
        const hi = STRAIN_HI * rest[k];
        const err = len < lo ? len - lo : len > hi ? len - hi : 0;
        if (err === 0) continue;
        const c0 = cb[k];
        const sh = cb[k + 1] - c0;
        dw.fill(0);
        for (let i = 0; i < 4; i++) {
          dw[i] -= wb[k * 4 + i];
          dw[i + sh] += wb[(k + 1) * 4 + i];
        }
        let den = 0;
        for (let i = 0; i < 5; i++) den += dw[i] * dw[i];
        if (den < 1e-12) continue;
        const lam = err / (den * len);
        for (let i = 0; i < 5; i++) {
          if (c0 + i >= nc || dw[i] === 0) continue;
          const f = lam * dw[i];
          C[(c0 + i) * 3] -= f * ex;
          C[(c0 + i) * 3 + 1] -= f * ey;
          C[(c0 + i) * 3 + 2] -= f * ez;
        }
        moved = true;
      }
    if (moved) place();
  };

  /**
   * Courbure ajoutée bornée : |c(j−1) − 2 c(j) + c(j+1)| ≤ κ S², donc la courbure du déplacement
   * (B-spline) reste ≤ κ partout et la section ne peut pas se replier.
   */
  const bendMax = (BEND_ADD / ext) * S * S;
  const bend = () => {
    let any = false;
    for (let j = 1; j < nc - 1; j++) {
      const a = (j - 1) * 3;
      const vx = C[a] - 2 * C[a + 3] + C[a + 6];
      const vy = C[a + 1] - 2 * C[a + 4] + C[a + 7];
      const vz = C[a + 2] - 2 * C[a + 5] + C[a + 8];
      const vl = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (vl <= bendMax) continue;
      const f = (vl - bendMax) / (6 * vl);
      C[a] -= f * vx;
      C[a + 1] -= f * vy;
      C[a + 2] -= f * vz;
      C[a + 3] += 2 * f * vx;
      C[a + 4] += 2 * f * vy;
      C[a + 5] += 2 * f * vz;
      C[a + 6] -= f * vx;
      C[a + 7] -= f * vy;
      C[a + 8] -= f * vz;
      any = true;
    }
    if (any) place();
  };

  /** Relaxation jusqu'à disparition des recouvrements (avec un léger jeu). */
  const solve = (budget: number): number => {
    const stopGap = 0.25 * margin;
    let it = 0;
    for (; it < budget; it++) {
      const v = collide(true, margin);
      refreshActive();
      stretch();
      bend();
      updateFrames();
      // Contrôle complet périodique, en un seul passage : contacts avec le jeu de travail
      // (réactivation des zones touchées par ricochet) et arrêt dès qu'il n'en reste aucun
      // avec le jeu d'arrêt.
      if (v === 0 || it % 6 === 5) {
        fullCheck(margin, stopGap);
        if (count2 === 0) return it + 1;
        refreshActive();
      }
    }
    return it;
  };

  /** Report du déplacement (B-spline, continu jusqu'à la courbure) sur la fibre complète. */
  const wf = new Float64Array(4);
  const transfer = () => {
    const oldX = sp.X.slice();
    for (let i = 0; i < nFine; i++) {
      const c = basis(i * ds, wf, 0) * 3;
      for (let a = 0; a < 3; a++)
        sp.X[i * 3 + a] += wf[0] * C[c + a] + wf[1] * C[c + 3 + a] + wf[2] * C[c + 6 + a] + wf[3] * C[c + 9 + a];
    }
    followFrames(sp, oldX);
  };

  load();
  for (let k = 0; k < m - 1; k++) {
    const q = k * 3;
    rest[k] = Math.hypot(P[q + 3] - P[q], P[q + 4] - P[q + 1], P[q + 5] - P[q + 2]);
  }
  const initial = fullCheck(margin);
  if (initial === 0) return { initial: 0, residual: 0, iterations: 0 };

  let iterations = 0;
  let residual = initial;
  for (let round = 0; round < ROUNDS && iterations < maxIterations; round++) {
    refreshActive();
    iterations += solve(maxIterations - iterations);
    transfer();
    load();
    // Contrôle strict sur la fibre réelle (repères et pavés du maillage).
    residual = fullCheck(0);
    if (residual === 0) break;
    fullCheck(margin);
  }
  return { initial, residual, iterations };
}

/** Rotation minimale du repère de l'ancienne tangente (oldX) vers la nouvelle (sp.X). */
export function followFrames(sp: Spine, oldX: Float64Array): void {
  const nFine = sp.n + 1;
  for (let i = 0; i < nFine; i++) {
    const a = Math.max(0, i - 1) * 3;
    const b = Math.min(nFine - 1, i + 1) * 3;
    let ox = oldX[b] - oldX[a];
    let oy = oldX[b + 1] - oldX[a + 1];
    let oz = oldX[b + 2] - oldX[a + 2];
    let nx = sp.X[b] - sp.X[a];
    let ny = sp.X[b + 1] - sp.X[a + 1];
    let nz = sp.X[b + 2] - sp.X[a + 2];
    const ol = Math.hypot(ox, oy, oz);
    const nl = Math.hypot(nx, ny, nz);
    if (ol < 1e-12 || nl < 1e-12) continue;
    ox /= ol;
    oy /= ol;
    oz /= ol;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    let ax = oy * nz - oz * ny;
    let ay = oz * nx - ox * nz;
    let az = ox * ny - oy * nx;
    const s = Math.hypot(ax, ay, az);
    if (s < 1e-10) continue;
    ax /= s;
    ay /= s;
    az /= s;
    const cs = ox * nx + oy * ny + oz * nz;
    const o = i * 3;
    rotate(sp.T, o, ax, ay, az, cs, s);
    rotate(sp.N, o, ax, ay, az, cs, s);
    rotate(sp.B, o, ax, ay, az, cs, s);
    orthonormalize(sp.T, sp.N, sp.B, o);
  }
}
