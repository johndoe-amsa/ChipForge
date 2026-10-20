import type { ChipParams, QualitySettings } from '../params';
import { Noise } from '../noise';
import { Rng } from '../rng';
import { buildSpine, deriveShape, len3, newFrame, sampleSpine, smoothstep, type FrameSample, type ShapeDerived, type Spine } from './spine';

/**
 * Construction d'un copeau sous forme de grille structurée :
 *  - les anneaux suivent la fibre (abscisse s),
 *  - le périmètre de chaque section est découpé en 4 zones nommées :
 *    face de coupe (frottée sur l'outil, convexe), flanc B, face libre (lamellaire, concave), flanc A,
 *  - les deux extrémités sont fermées par des carreaux de Coons.
 *
 * Cette topologie « boîte » (6 carreaux) sert à la fois au maillage quad (OBJ) et aux
 * surfaces B-spline du STEP, ce qui garantit des arêtes partagées exactes.
 */

export const GROUP_NAMES = ['face_coupe', 'face_libre', 'flancs', 'extremites'] as const;
export type GroupName = (typeof GROUP_NAMES)[number];

export interface ChipInfo {
  rings: number;
  widthSegments: number;
  thicknessSegments: number;
  turns: number;
  effectivePitch: number;
  effectiveGrowth: number;
  effectiveRadius: number;
  /** Atténuation appliquée aux micro-reliefs faute de résolution (0 = aucune, 1 = totalement lissés). */
  microAttenuation: number;
}

export interface ChipGrid {
  rings: number;
  nW: number;
  nE: number;
  M: number;
  /** Positions finales (repère local, mm) : rings × M × 3. */
  pos: Float64Array;
  /** Positions sans micro-reliefs, pour un dépliage UV propre. */
  base: Float64Array;
  /** Carreaux d'extrémité (grille de Coons) : (nW + 1) × (nE + 1) × 3. */
  cap0: Float64Array;
  cap1: Float64Array;
  /** Coordonnées de section (x, y en mm) des carreaux d'extrémité, pour les UVs. */
  capSec0: Float64Array;
  capSec1: Float64Array;
  /** Vrai si l'ordre naturel des quads est orienté vers l'intérieur. */
  flip: boolean;
  /** Boîtes de collision le long de la fibre : centre(3) quaternion(4) demi-tailles(3). */
  colliders: Float32Array;
  info: ChipInfo;
}

const TAU = Math.PI * 2;

interface Longi {
  s: number;
  halfW: number;
  crackA: number;
  crackB: number;
  tBase: number;
  wav: number;
  burrA: number;
  burrB: number;
  segPhase: number;
}

interface Edges {
  xAin: number;
  xBin: number;
  dA: number;
  dB: number;
  ycA: number;
  ylA: number;
  ycB: number;
  ylB: number;
}

function newLongi(): Longi {
  return { s: 0, halfW: 0, crackA: 0, crackB: 0, tBase: 0, wav: 0, burrA: 0, burrB: 0, segPhase: 0 };
}

function newEdges(): Edges {
  return { xAin: 0, xBin: 0, dA: 0, dB: 0, ycA: 0, ylA: 0, ycB: 0, ylB: 0 };
}

/** Liste triée d'entailles en V le long d'un bord. */
class CrackLine {
  readonly pos: Float64Array;
  readonly depth: Float64Array;
  readonly hw: Float64Array;

  constructor(rng: Rng, L: number, density: number, depth: number, irr: number) {
    const ps: number[] = [];
    const ds: number[] = [];
    const hs: number[] = [];
    if (density > 0 && depth > 0) {
      const spacing = 1 / density;
      let s = rng.next() * spacing;
      while (s < L && ps.length < 20000) {
        const d = depth * (1 - irr * 0.85 * rng.next());
        ps.push(s);
        ds.push(d);
        hs.push(Math.max(d * (0.45 + 0.5 * rng.next()), 0.01));
        s += spacing * (1 + irr * (rng.next() - 0.5) * 1.6);
      }
    }
    this.pos = Float64Array.from(ps);
    this.depth = Float64Array.from(ds);
    this.hw = Float64Array.from(hs);
  }

  get meanHalfWidth(): number {
    if (this.hw.length === 0) return 0;
    let t = 0;
    for (const v of this.hw) t += v;
    return t / this.hw.length;
  }

  at(s: number): number {
    const n = this.pos.length;
    if (n === 0) return 0;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.pos[mid] <= s) lo = mid;
      else hi = mid - 1;
    }
    let c = 0;
    for (let k = Math.max(0, lo - 2); k <= Math.min(n - 1, lo + 2); k++) {
      const t = 1 - Math.abs(s - this.pos[k]) / this.hw[k];
      if (t > 0) c = Math.max(c, this.depth[k] * Math.pow(t, 1.3));
    }
    return c;
  }
}

/** Évaluation de la section transversale (coordonnées x largeur / y épaisseur). */
class SectionEval {
  readonly cracksA: CrackLine;
  readonly cracksB: CrackLine;
  private readonly noise: Noise;
  private readonly links: number[];
  private readonly linkSigma: number;
  private readonly wavPhase: number;
  // Atténuations anti-repliement (résolution insuffisante)
  attLam = 1;
  attSeg = 1;
  attStr = 1;
  attWav = 1;
  attNoise = 1;
  sppLam = 99;
  sppSeg = 99;

  constructor(
    private readonly p: ChipParams,
    seed: number,
    links: number[],
    private readonly nW: number,
    private readonly nE: number,
  ) {
    const rng = new Rng(seed ^ 0x6c8e9cf5);
    this.noise = new Noise(seed ^ 0x1b56c4e9);
    const sides = p.crackSide;
    this.cracksA = new CrackLine(rng, p.length, sides === 'B' ? 0 : p.crackDensity, p.crackDepth, p.crackIrregularity);
    this.cracksB = new CrackLine(rng, p.length, sides === 'A' ? 0 : p.crackDensity, p.crackDepth, p.crackIrregularity);
    this.links = links;
    this.linkSigma = 0.35 * p.width + (0.06 * p.length) / Math.max(1, p.linkedSegments);
    this.wavPhase = rng.next() * TAU;
  }

  setResolution(hs: number, hw: number): void {
    const p = this.p;
    const spp = (f: number, h: number) => (f > 0 ? 1 / (f * h) : 99);
    this.sppLam = spp(p.lamellaFreq, hs);
    this.sppSeg = spp(p.segmentFreq, hs);
    this.attLam = smoothstep(2, 4, this.sppLam);
    this.attSeg = smoothstep(2, 4, this.sppSeg);
    this.attWav = smoothstep(2, 4, spp(p.wavinessFreq, hs));
    this.attStr = smoothstep(2, 4, spp(p.striationFreq, hw));
    const ns = Math.max(1e-4, p.microNoiseScale);
    this.attNoise = smoothstep(1.2, 2.5, ns / Math.max(hs, hw));
  }

  /** Atténuation moyenne pondérée des micro-reliefs, pour information. */
  microAttenuation(): number {
    const p = this.p;
    const items: [number, number][] = [
      [p.lamellaAmp * (p.lamellaFreq > 0 ? 1 : 0), this.attLam],
      [p.segmentDepth * p.thickness * 1000 * (p.segmentFreq > 0 ? 1 : 0), this.attSeg],
      [p.striationAmp * (p.striationFreq > 0 ? 1 : 0), this.attStr],
      [p.microNoise, this.attNoise],
    ];
    let wsum = 0;
    let lost = 0;
    for (const [w, a] of items) {
      wsum += w;
      lost += w * (1 - a);
    }
    return wsum > 0 ? lost / wsum : 0;
  }

  longi(s: number, micro: boolean, out: Longi): Longi {
    const p = this.p;
    const L = p.length;
    const u = Math.min(1, Math.max(0, s / L));
    const mW = p.widthStart + (p.widthEnd - p.widthStart) * u;
    const mT = p.thicknessStart + (p.thicknessEnd - p.thicknessStart) * u;
    let neckF = 1;
    if (p.neck > 0 && this.links.length > 0) {
      let acc = 0;
      for (const sk of this.links) {
        const z = (s - sk) / this.linkSigma;
        acc += Math.exp(-z * z);
      }
      neckF = Math.max(0.08, 1 - p.neck * Math.min(1, acc));
    }
    let halfW = 0.5 * p.width * mW * neckF;
    if (micro && p.macroNoise > 0) halfW *= 1 + 0.05 * p.macroNoise * this.noise.noise1(s / Math.max(0.1, p.macroNoiseScale) + 901.3);
    out.s = s;
    out.halfW = halfW;
    out.tBase = p.thickness * mT * Math.sqrt(neckF);
    if (micro) {
      let cA = this.cracksA.at(s);
      let cB = this.cracksB.at(s);
      const lim = 0.42 * 2 * halfW;
      cA = Math.min(cA, lim);
      cB = Math.min(cB, lim);
      out.crackA = cA;
      out.crackB = cB;
      out.wav =
        p.wavinessFreq > 0
          ? (p.wavinessAmp / 1000) *
            this.attWav *
            Math.sin(TAU * p.wavinessFreq * s + this.wavPhase) *
            (0.7 + 0.3 * this.noise.noise1(s * p.wavinessFreq * 0.5 + 21.7))
          : 0;
      const burr = p.burr / 1000;
      out.burrA = burr > 0 && (p.burrSide === 'A' || p.burrSide === 'deux') ? burr * (0.55 + 0.45 * this.noise.noise1(s / 0.35 + 31.1)) : 0;
      out.burrB = burr > 0 && (p.burrSide === 'B' || p.burrSide === 'deux') ? burr * (0.55 + 0.45 * this.noise.noise1(s / 0.35 + 57.9)) : 0;
      out.segPhase = p.segmentFreq > 0 ? s * p.segmentFreq + 0.3 * this.noise.noise1(s * p.segmentFreq * 0.23 + 3.3) : 0;
    } else {
      out.crackA = 0;
      out.crackB = 0;
      out.wav = 0;
      out.burrA = 0;
      out.burrB = 0;
      out.segPhase = 0;
    }
    return out;
  }

  /** Ordonnée d'une face au paramètre latéral ξ ∈ [-1, 1]. */
  faceY(l: Longi, xi: number, libre: boolean, micro: boolean): number {
    const p = this.p;
    const ax = Math.abs(xi);
    let t = l.tBase * (1 + p.taper * xi) * (1 - p.edgeThinning * ax * ax * ax * ax);
    if (micro && p.thicknessNoise > 0) {
      t *= 1 + p.thicknessNoise * this.noise.noise2(l.s / Math.max(0.2, 2 * p.width) + 13.7, xi * 0.9 + 33.3);
    }
    t = Math.max(t, 1e-4);
    // Cambrure : mélange arc / V, nulle aux bords
    let mid = 0;
    if (p.camber !== 0) {
      const arc = 1 - xi * xi;
      const eps = 0.08;
      const v1 = 1 + eps - Math.sqrt(1 + eps * eps);
      const v = (1 + eps - Math.sqrt(xi * xi + eps * eps) - v1) / (1 - v1);
      mid = p.camber * (arc + (v - arc) * p.camberShape);
    }
    if (!micro) return libre ? mid + t / 2 : mid - t / 2;
    mid += l.wav * (1 + 0.2 * xi);
    const x = xi * l.halfW;
    if (!libre) {
      let dc = 0;
      if (p.striationAmp > 0 && p.striationFreq > 0 && this.attStr > 0) {
        const v = x * p.striationFreq + 0.35 * this.noise.noise1(x * p.striationFreq * 0.21 + 5.5);
        dc +=
          (p.striationAmp / 1000) *
          this.attStr *
          (0.65 * Math.sin(TAU * v) + 0.35 * Math.sin(TAU * 2.1 * v + 1.3)) *
          (0.65 + 0.35 * this.noise.noise2(l.s * 0.15 + 9.1, x * p.striationFreq * 0.4));
      }
      dc += this.surfNoise(l.s, x, 0);
      dc = Math.max(-0.25 * t, Math.min(0.25 * t, dc));
      return mid - t / 2 - dc;
    }
    let y = mid + t / 2;
    if (p.segmentDepth > 0 && p.segmentFreq > 0 && this.attSeg > 0) {
      const u = l.segPhase + 0.12 * xi;
      const fr = u - Math.floor(u);
      const a = 0.55 + 0.4 * p.segmentSharpness;
      const tri = fr < a ? fr / a : (1 - fr) / (1 - a);
      const sine = 0.5 - 0.5 * Math.cos(TAU * fr);
      const blend = Math.min(1, Math.max(0, (this.sppSeg - 3) / 6));
      const prof = sine + (tri - sine) * blend;
      y -= p.segmentDepth * this.attSeg * t * (1 - prof);
    }
    let dl = 0;
    if (p.lamellaAmp > 0 && p.lamellaFreq > 0 && this.attLam > 0) {
      const irr = p.lamellaIrregularity;
      const u =
        l.s * p.lamellaFreq + irr * (0.9 * this.noise.noise2(l.s * p.lamellaFreq * 0.11 + 3.1, xi * 1.3 + 71.3) + 0.35 * xi);
      const fr = u - Math.floor(u);
      const a = 0.78;
      const tri = fr < a ? fr / a : (1 - fr) / (1 - a);
      const sine = 0.5 - 0.5 * Math.cos(TAU * fr);
      const blend = Math.min(1, Math.max(0, (this.sppLam - 3) / 6));
      const prof = sine + (tri - sine) * blend;
      const mod = 1 + 0.6 * irr * this.noise.noise1(l.s * p.lamellaFreq * 0.07 + 77.7);
      dl += (p.lamellaAmp / 1000) * this.attLam * (prof - 0.5) * mod;
    }
    dl += this.surfNoise(l.s, x, 1);
    if (l.burrB > 0 && xi > 0.6) {
      const k = smoothstep(0.65, 1, xi);
      dl += l.burrB * k * k;
    }
    if (l.burrA > 0 && xi < -0.6) {
      const k = smoothstep(0.65, 1, -xi);
      dl += l.burrA * k * k;
    }
    dl = Math.max(-0.3 * t, dl);
    y += dl;
    // Épaisseur minimale garantie
    return Math.max(y, mid - t / 2 + 0.35 * t);
  }

  private surfNoise(s: number, x: number, face: number): number {
    const p = this.p;
    if (p.microNoise <= 0 || this.attNoise <= 0) return 0;
    const sc = Math.max(1e-3, p.microNoiseScale);
    const a = s / sc;
    const b = x / sc;
    const off = face * 173.3;
    return (
      (p.microNoise / 1000) *
      this.attNoise *
      this.noise.fbm2(0.8 * a + 0.6 * b + off, -0.6 * a + 0.8 * b + 41.7 + off, 2)
    );
  }

  edges(l: Longi, micro: boolean, out: Edges): Edges {
    const p = this.p;
    const xA = -l.halfW + l.crackA;
    const xB = l.halfW - l.crackB;
    out.ycA = this.faceY(l, -1, false, micro);
    out.ylA = this.faceY(l, -1, true, micro);
    out.ycB = this.faceY(l, 1, false, micro);
    out.ylB = this.faceY(l, 1, true, micro);
    const hhA = Math.max((out.ylA - out.ycA) / 2, 1e-5);
    const hhB = Math.max((out.ylB - out.ycB) / 2, 1e-5);
    const k = 0.04 + 0.96 * p.edgeRoundness;
    const lim = 0.45 * Math.max(1e-4, (xB - xA) / 2);
    out.dA = Math.min(k * hhA, lim);
    out.dB = Math.min(k * hhB, lim);
    out.xAin = xA + out.dA;
    out.xBin = xB - out.dB;
    return out;
  }

  /** Point j du périmètre → (x, y). Écrit dans out[o], out[o + 1]. */
  point(l: Longi, e: Edges, j: number, micro: boolean, out: Float64Array, o: number): void {
    const nW = this.nW;
    const nE = this.nE;
    if (j < nW) {
      if (j === 0) {
        out[o] = e.xAin;
        out[o + 1] = e.ycA;
        return;
      }
      const xi = -1 + (2 * j) / nW;
      out[o] = e.xAin + (e.xBin - e.xAin) * (j / nW);
      out[o + 1] = this.faceY(l, xi, false, micro);
      return;
    }
    if (j < nW + nE) {
      const b = j - nW;
      const a = -Math.PI / 2 + (Math.PI * b) / nE;
      out[o] = e.xBin + e.dB * Math.cos(a);
      out[o + 1] = (e.ycB + e.ylB) / 2 + ((e.ylB - e.ycB) / 2) * Math.sin(a);
      return;
    }
    if (j < 2 * nW + nE) {
      const k = j - nW - nE;
      if (k === 0) {
        out[o] = e.xBin;
        out[o + 1] = e.ylB;
        return;
      }
      const xi = 1 - (2 * k) / nW;
      out[o] = e.xAin + (e.xBin - e.xAin) * ((xi + 1) / 2);
      out[o + 1] = this.faceY(l, xi, true, micro);
      return;
    }
    const b = j - 2 * nW - nE;
    const a = Math.PI / 2 - (Math.PI * b) / nE;
    out[o] = e.xAin - e.dA * Math.cos(a);
    out[o + 1] = (e.ycA + e.ylA) / 2 + ((e.ylA - e.ycA) / 2) * Math.sin(a);
  }

  /** Paramètre latéral d'un point du périmètre (pour la cassure des extrémités). */
  lateral(j: number): number {
    const nW = this.nW;
    const nE = this.nE;
    if (j < nW) return -1 + (2 * j) / nW;
    if (j < nW + nE) return 1;
    if (j < 2 * nW + nE) return 1 - (2 * (j - nW - nE)) / nW;
    return -1;
  }
}

/** Détermine la discrétisation (anneaux, segments) selon la qualité et le budget. */
function resolveResolution(p: ChipParams, d: ShapeDerived, q: QualitySettings, crackHw: number) {
  const L = p.length;
  const turns = L / (TAU * Math.sqrt(d.R0 * d.R0 + d.c * d.c));
  let Ns = Math.max(8, Math.ceil(L * q.densityAlong), Math.ceil(turns * q.ringsPerTurn));
  if (d.kappaTangle > 0) Ns = Math.max(Ns, Math.ceil(L * d.kappaTangle * 10));
  if (p.linkedSegments > 1) Ns = Math.max(Ns, Math.round(p.linkedSegments) * 16);
  const NsMacro = Ns;
  let nW = Math.max(4, q.widthSegments);
  const nE = Math.min(24, Math.max(3, q.thicknessSegments));
  if (q.resolveMicro) {
    let fAlong = 0;
    if (p.lamellaAmp > 0) fAlong = Math.max(fAlong, p.lamellaFreq);
    if (p.segmentDepth > 0) fAlong = Math.max(fAlong, p.segmentFreq);
    if (p.wavinessAmp > 0) fAlong = Math.max(fAlong, p.wavinessFreq);
    if (p.microNoise > 0) fAlong = Math.max(fAlong, 0.5 / Math.max(1e-3, p.microNoiseScale));
    let NsMicro = Math.ceil(L * fAlong * q.microSamples);
    if (crackHw > 0) NsMicro = Math.max(NsMicro, Math.ceil((L / crackHw) * 1.5));
    Ns = Math.max(Ns, NsMicro);
    let fAcross = 0;
    if (p.striationAmp > 0) fAcross = Math.max(fAcross, p.striationFreq);
    if (p.microNoise > 0) fAcross = Math.max(fAcross, 0.5 / Math.max(1e-3, p.microNoiseScale));
    nW = Math.max(nW, Math.ceil(p.width * Math.max(p.widthStart, p.widthEnd, 1) * fAcross * (q.microSamples - 1)));
  }
  nW = Math.min(160, nW + (nW % 2));
  let M = 2 * nW + 2 * nE;
  let ringsMax = Math.floor(q.maxVertices / M) - 1;
  if (Ns > ringsMax) {
    // Priorité à la macro-forme : on réduit d'abord la largeur si nécessaire.
    if (ringsMax < NsMacro && nW > q.widthSegments) {
      nW = Math.max(4, q.widthSegments + (q.widthSegments % 2));
      M = 2 * nW + 2 * nE;
      ringsMax = Math.floor(q.maxVertices / M) - 1;
    }
    Ns = Math.max(8, Math.min(Ns, ringsMax));
  }
  return { Ns, nW, nE, M, turns };
}

/** Décomposition propre d'une matrice 3×3 symétrique (Jacobi). Retourne valeurs et vecteurs (colonnes). */
function eigenSym3(a: number[]): { values: number[]; vectors: number[] } {
  const A = a.slice();
  const V = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 30; sweep++) {
    const off = Math.abs(A[1]) + Math.abs(A[2]) + Math.abs(A[5]);
    if (off < 1e-14) break;
    for (const [pI, qI] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      const apq = A[pI * 3 + qI];
      if (Math.abs(apq) < 1e-18) continue;
      const app = A[pI * 3 + pI];
      const aqq = A[qI * 3 + qI];
      const theta = (aqq - app) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = A[k * 3 + pI];
        const akq = A[k * 3 + qI];
        A[k * 3 + pI] = c * akp - s * akq;
        A[k * 3 + qI] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = A[pI * 3 + k];
        const aqk = A[qI * 3 + k];
        A[pI * 3 + k] = c * apk - s * aqk;
        A[qI * 3 + k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = V[k * 3 + pI];
        const vkq = V[k * 3 + qI];
        V[k * 3 + pI] = c * vkp - s * vkq;
        V[k * 3 + qI] = s * vkp + c * vkq;
      }
    }
  }
  return { values: [A[0], A[4], A[8]], vectors: V };
}

/**
 * Repère local « posé » : centroïde à l'origine, plus grande dimension sur X,
 * plus petite sur Y (le copeau repose à plat sur la grille).
 */
function computePlacement(sp: Spine): { c: number[]; R: number[] } {
  const n = sp.n + 1;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < n; i++) {
    cx += sp.X[i * 3];
    cy += sp.X[i * 3 + 1];
    cz += sp.X[i * 3 + 2];
  }
  cx /= n;
  cy /= n;
  cz /= n;
  const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const x = sp.X[i * 3] - cx;
    const y = sp.X[i * 3 + 1] - cy;
    const z = sp.X[i * 3 + 2] - cz;
    C[0] += x * x;
    C[1] += x * y;
    C[2] += x * z;
    C[4] += y * y;
    C[5] += y * z;
    C[8] += z * z;
  }
  C[3] = C[1];
  C[6] = C[2];
  C[7] = C[5];
  const { values, vectors } = eigenSym3(C);
  const order = [0, 1, 2].sort((a, b) => values[b] - values[a]);
  const col = (k: number) => [vectors[k], vectors[3 + k], vectors[6 + k]];
  const ex = col(order[0]);
  const ey = col(order[2]);
  // Signe déterministe : le début de la fibre côté -X, la normale initiale vers +Y.
  const x0 = sp.X[0] - cx;
  const y0 = sp.X[1] - cy;
  const z0 = sp.X[2] - cz;
  if (ex[0] * x0 + ex[1] * y0 + ex[2] * z0 > 0) for (let k = 0; k < 3; k++) ex[k] = -ex[k];
  if (ey[0] * sp.N[0] + ey[1] * sp.N[1] + ey[2] * sp.N[2] < 0) for (let k = 0; k < 3; k++) ey[k] = -ey[k];
  // ez = ex × ey (repère direct)
  const ez = [ex[1] * ey[2] - ex[2] * ey[1], ex[2] * ey[0] - ex[0] * ey[2], ex[0] * ey[1] - ex[1] * ey[0]];
  // Lignes de la matrice : coordonnées locales = R · (p - c)
  return { c: [cx, cy, cz], R: [...ex, ...ey, ...ez] };
}

function applyPlacement(arr: Float64Array, pl: { c: number[]; R: number[] }): void {
  const R = pl.R;
  for (let i = 0; i < arr.length; i += 3) {
    const x = arr[i] - pl.c[0];
    const y = arr[i + 1] - pl.c[1];
    const z = arr[i + 2] - pl.c[2];
    arr[i] = R[0] * x + R[1] * y + R[2] * z;
    arr[i + 1] = R[3] * x + R[4] * y + R[5] * z;
    arr[i + 2] = R[6] * x + R[7] * y + R[8] * z;
  }
}

/** Grille de Coons (nW + 1) × (nE + 1) bordée par le périmètre d'un anneau (stride `dim`). */
function coons(ring: Float64Array, ro: number, nW: number, nE: number, dim: number): Float64Array {
  const M = 2 * nW + 2 * nE;
  const g = new Float64Array((nW + 1) * (nE + 1) * dim);
  const P = (j: number, k: number) => ring[ro + (((j % M) + M) % M) * dim + k];
  const bottom = (a: number, k: number) => P(a, k);
  const right = (b: number, k: number) => P(nW + b, k);
  const top = (a: number, k: number) => P(2 * nW + nE - a, k);
  const left = (b: number, k: number) => P(M - b, k);
  for (let a = 0; a <= nW; a++) {
    const u = a / nW;
    for (let b = 0; b <= nE; b++) {
      const v = b / nE;
      const o = (a * (nE + 1) + b) * dim;
      for (let k = 0; k < dim; k++) {
        let val: number;
        if (b === 0) val = bottom(a, k);
        else if (b === nE) val = top(a, k);
        else if (a === 0) val = left(b, k);
        else if (a === nW) val = right(b, k);
        else {
          val =
            (1 - v) * bottom(a, k) +
            v * top(a, k) +
            (1 - u) * left(b, k) +
            u * right(b, k) -
            ((1 - u) * (1 - v) * bottom(0, k) + u * (1 - v) * bottom(nW, k) + (1 - u) * v * top(0, k) + u * v * top(nW, k));
        }
        g[o + k] = val;
      }
    }
  }
  return g;
}

function signedVolume(grid: Omit<ChipGrid, 'flip' | 'colliders' | 'info'>): number {
  const { rings, nW, nE, M, pos, cap0, cap1 } = grid;
  let vol = 0;
  const tri = (a: Float64Array, ia: number, b: Float64Array, ib: number, c: Float64Array, ic: number) => {
    vol +=
      a[ia] * (b[ib + 1] * c[ic + 2] - b[ib + 2] * c[ic + 1]) -
      a[ia + 1] * (b[ib] * c[ic + 2] - b[ib + 2] * c[ic]) +
      a[ia + 2] * (b[ib] * c[ic + 1] - b[ib + 1] * c[ic]);
  };
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < M; j++) {
      const j1 = (j + 1) % M;
      const a = (i * M + j) * 3;
      const b = ((i + 1) * M + j) * 3;
      const c = ((i + 1) * M + j1) * 3;
      const d = (i * M + j1) * 3;
      tri(pos, a, pos, b, pos, c);
      tri(pos, a, pos, c, pos, d);
    }
  }
  const capVol = (g: Float64Array, reverse: boolean) => {
    for (let a = 0; a < nW; a++) {
      for (let b = 0; b < nE; b++) {
        const i00 = (a * (nE + 1) + b) * 3;
        const i10 = ((a + 1) * (nE + 1) + b) * 3;
        const i11 = ((a + 1) * (nE + 1) + b + 1) * 3;
        const i01 = (a * (nE + 1) + b + 1) * 3;
        if (!reverse) {
          tri(g, i00, g, i10, g, i11);
          tri(g, i00, g, i11, g, i01);
        } else {
          tri(g, i00, g, i01, g, i11);
          tri(g, i00, g, i11, g, i10);
        }
      }
    }
  };
  capVol(cap0, false);
  capVol(cap1, true);
  return vol / 6;
}

/** Génère la grille complète d'un copeau. */
export function buildChipGrid(p: ChipParams, seed: number, q: QualitySettings): ChipGrid {
  const d = deriveShape(p);
  const L = p.length;

  // Entailles générées avant la résolution (leur largeur impose la densité)
  const probe = new SectionEval(p, seed, [], 4, 3);
  const crackHw = Math.min(
    probe.cracksA.meanHalfWidth || Infinity,
    probe.cracksB.meanHalfWidth || Infinity,
  );
  const res = resolveResolution(p, d, q, Number.isFinite(crackHw) ? crackHw : 0);
  const { Ns, nW, nE, M } = res;
  const rings = Ns + 1;

  const spineSteps = Math.min(600_000, Math.max(Ns * 2, Math.ceil((L / d.Rmin) * 8)));
  const spine = buildSpine(p, d, seed, spineSteps);
  const sec = new SectionEval(p, seed, spine.links, nW, nE);
  const hs = L / Ns;
  sec.setResolution(hs, (p.width * Math.max(p.widthStart, p.widthEnd, 1)) / nW);

  // Cassure des extrémités : décalages longitudinaux dépendant de la position latérale.
  const breakNoise = new Noise(seed ^ 0x3c6ef372);
  const brk = p.endBreak * p.width;
  const slant0 = (breakNoise.noise1(0.37) > 0 ? 1 : -1) * 0.12;
  const slant1 = (breakNoise.noise1(5.71) > 0 ? 1 : -1) * 0.12;
  const zone = Math.min(0.35 * L, Math.max(4 * 0.42 * brk, 1.5 * p.width));
  const dMax = zone / 2;
  const delta0 = new Float64Array(M);
  const delta1 = new Float64Array(M);
  for (let j = 0; j < M; j++) {
    const xi = sec.lateral(j);
    delta0[j] = Math.min(dMax, brk * (0.18 * (1 + breakNoise.fbm1(xi * 1.7 + 11.1, 2)) + slant0 * (1 + xi)));
    delta1[j] = Math.min(dMax, brk * (0.18 * (1 + breakNoise.fbm1(xi * 1.7 + 47.3, 2)) + slant1 * (1 - xi)));
    delta0[j] = Math.max(0, delta0[j]);
    delta1[j] = Math.max(0, delta1[j]);
  }

  const pos = new Float64Array(rings * M * 3);
  const base = new Float64Array(rings * M * 3);
  const sec0 = new Float64Array(M * 2);
  const sec1 = new Float64Array(M * 2);
  const xy = new Float64Array(2);
  const xyb = new Float64Array(2);
  const fr: FrameSample = newFrame();
  const l = newLongi();
  const lb = newLongi();
  const e = newEdges();
  const eb = newEdges();

  for (let i = 0; i < rings; i++) {
    const si = (i / Ns) * L;
    const inZone = brk > 0 && (si < zone || si > L - zone);
    if (!inZone) {
      sec.longi(si, true, l);
      sec.longi(si, false, lb);
      sec.edges(l, true, e);
      sec.edges(lb, false, eb);
      sampleSpine(spine, si, fr);
    }
    for (let j = 0; j < M; j++) {
      if (inZone) {
        const s = si + delta0[j] * (1 - smoothstep(0, zone, si)) - delta1[j] * smoothstep(L - zone, L, si);
        sec.longi(s, true, l);
        sec.longi(s, false, lb);
        sec.edges(l, true, e);
        sec.edges(lb, false, eb);
        sampleSpine(spine, s, fr);
      }
      sec.point(l, e, j, true, xy, 0);
      sec.point(lb, eb, j, false, xyb, 0);
      const o = (i * M + j) * 3;
      pos[o] = fr.x + xy[0] * fr.wx + xy[1] * fr.hx;
      pos[o + 1] = fr.y + xy[0] * fr.wy + xy[1] * fr.hy;
      pos[o + 2] = fr.z + xy[0] * fr.wz + xy[1] * fr.hz;
      base[o] = fr.x + xyb[0] * fr.wx + xyb[1] * fr.hx;
      base[o + 1] = fr.y + xyb[0] * fr.wy + xyb[1] * fr.hy;
      base[o + 2] = fr.z + xyb[0] * fr.wz + xyb[1] * fr.hz;
      if (i === 0) {
        sec0[j * 2] = xyb[0];
        sec0[j * 2 + 1] = xyb[1];
      } else if (i === Ns) {
        sec1[j * 2] = xyb[0];
        sec1[j * 2 + 1] = xyb[1];
      }
    }
  }

  const colliders = buildColliders(p, spine, sec);
  const placement = computePlacement(spine);
  applyPlacement(pos, placement);
  applyPlacement(base, placement);
  placeColliders(colliders, placement);

  const cap0 = coons(pos, 0, nW, nE, 3);
  const cap1 = coons(pos, Ns * M * 3, nW, nE, 3);
  const capSec0 = coons(sec0, 0, nW, nE, 2);
  const capSec1 = coons(sec1, 0, nW, nE, 2);

  const partial = { rings, nW, nE, M, pos, base, cap0, cap1, capSec0, capSec1 };
  const vol = signedVolume(partial);

  return {
    ...partial,
    flip: vol < 0,
    colliders,
    info: {
      rings,
      widthSegments: nW,
      thicknessSegments: nE,
      turns: res.turns,
      effectivePitch: d.c * TAU,
      effectiveGrowth: d.growth,
      effectiveRadius: d.R0,
      microAttenuation: sec.microAttenuation(),
    },
  };
}

function buildColliders(p: ChipParams, sp: Spine, sec: SectionEval): Float32Array {
  const d = deriveShape(p);
  const L = p.length;
  const segLen = Math.max(p.width * 1.2, 0.8 * d.Rmin, L / 64, 0.05);
  const nb = Math.max(1, Math.min(64, Math.ceil(L / segLen)));
  const out = new Float32Array(nb * 10);
  const fa = newFrame();
  const fb = newFrame();
  const fm = newFrame();
  const l = newLongi();
  for (let k = 0; k < nb; k++) {
    const sa = (k / nb) * L;
    const sb = ((k + 1) / nb) * L;
    sampleSpine(sp, sa, fa);
    sampleSpine(sp, sb, fb);
    sampleSpine(sp, (sa + sb) / 2, fm);
    sec.longi((sa + sb) / 2, false, l);
    const len = len3(fb.x - fa.x, fb.y - fa.y, fb.z - fa.z);
    const o = k * 10;
    out[o] = (fa.x + fb.x) / 2;
    out[o + 1] = (fa.y + fb.y) / 2;
    out[o + 2] = (fa.z + fb.z) / 2;
    // Axes : T, W, T × W
    let tx = fb.x - fa.x;
    let ty = fb.y - fa.y;
    let tz = fb.z - fa.z;
    const tl = len3(tx, ty, tz) || 1;
    tx /= tl;
    ty /= tl;
    tz /= tl;
    let wx = fm.wx;
    let wy = fm.wy;
    let wz = fm.wz;
    const dot = wx * tx + wy * ty + wz * tz;
    wx -= dot * tx;
    wy -= dot * ty;
    wz -= dot * tz;
    const wl = len3(wx, wy, wz) || 1;
    wx /= wl;
    wy /= wl;
    wz /= wl;
    const zx = ty * wz - tz * wy;
    const zy = tz * wx - tx * wz;
    const zz = tx * wy - ty * wx;
    const q = quatFromBasis(tx, ty, tz, wx, wy, wz, zx, zy, zz);
    out[o + 3] = q[0];
    out[o + 4] = q[1];
    out[o + 5] = q[2];
    out[o + 6] = q[3];
    out[o + 7] = len / 2 + 0.25 * l.tBase;
    out[o + 8] = l.halfW;
    out[o + 9] = l.tBase / 2 + Math.abs(p.camber) * 0.5;
  }
  return out;
}

function placeColliders(col: Float32Array, pl: { c: number[]; R: number[] }): void {
  const R = pl.R;
  const qr = quatFromBasis(R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]);
  for (let o = 0; o < col.length; o += 10) {
    const x = col[o] - pl.c[0];
    const y = col[o + 1] - pl.c[1];
    const z = col[o + 2] - pl.c[2];
    col[o] = R[0] * x + R[1] * y + R[2] * z;
    col[o + 1] = R[3] * x + R[4] * y + R[5] * z;
    col[o + 2] = R[6] * x + R[7] * y + R[8] * z;
    const q = quatMul(qr, [col[o + 3], col[o + 4], col[o + 5], col[o + 6]]);
    col[o + 3] = q[0];
    col[o + 4] = q[1];
    col[o + 5] = q[2];
    col[o + 6] = q[3];
  }
}

/** Quaternion (x, y, z, w) d'une matrice de rotation donnée par ses colonnes. */
export function quatFromBasis(
  m00: number, m10: number, m20: number,
  m01: number, m11: number, m21: number,
  m02: number, m12: number, m22: number,
): [number, number, number, number] {
  const tr = m00 + m11 + m22;
  let x: number, y: number, z: number, w: number;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    w = 0.25 / s;
    x = (m21 - m12) * s;
    y = (m02 - m20) * s;
    z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  const n = Math.sqrt(x * x + y * y + z * z + w * w) || 1;
  return [x / n, y / n, z / n, w / n];
}

export function quatMul(a: number[], b: number[]): [number, number, number, number] {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}
