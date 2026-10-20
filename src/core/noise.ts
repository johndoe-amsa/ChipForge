import { Rng } from './rng';

/**
 * Bruit de gradient (Perlin amélioré) 1D / 2D / 3D initialisé par seed, période 1024.
 * Sorties approximativement dans [-1, 1].
 */
export class Noise {
  private readonly perm = new Uint16Array(2048);
  private readonly grad1 = new Float32Array(1024);

  constructor(seed: number) {
    const rng = new Rng(seed);
    const p = new Uint16Array(1024);
    for (let i = 0; i < 1024; i++) p[i] = i;
    for (let i = 1023; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    for (let i = 0; i < 2048; i++) this.perm[i] = p[i & 1023];
    for (let i = 0; i < 1024; i++) this.grad1[i] = rng.next() * 2 - 1;
  }

  noise1(x: number): number {
    const xi = Math.floor(x);
    const xf = x - xi;
    const i = xi & 1023;
    const g0 = this.grad1[this.perm[i]];
    const g1 = this.grad1[this.perm[i + 1]];
    const u = fade(xf);
    return 2 * lerp(g0 * xf, g1 * (xf - 1), u);
  }

  noise2(x: number, y: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const X = xi & 1023;
    const Y = yi & 1023;
    const p = this.perm;
    const aa = p[p[X] + Y];
    const ab = p[p[X] + Y + 1];
    const ba = p[p[X + 1] + Y];
    const bb = p[p[X + 1] + Y + 1];
    const u = fade(xf);
    const v = fade(yf);
    const x1 = lerp(grad2(aa, xf, yf), grad2(ba, xf - 1, yf), u);
    const x2 = lerp(grad2(ab, xf, yf - 1), grad2(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v) * 1.414;
  }

  noise3(x: number, y: number, z: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const xf = x - xi;
    const yf = y - yi;
    const zf = z - zi;
    const X = xi & 1023;
    const Y = yi & 1023;
    const Z = zi & 1023;
    const p = this.perm;
    const A = p[X] + Y;
    const AA = p[A] + Z;
    const AB = p[A + 1] + Z;
    const B = p[X + 1] + Y;
    const BA = p[B] + Z;
    const BB = p[B + 1] + Z;
    const u = fade(xf);
    const v = fade(yf);
    const w = fade(zf);
    return lerp(
      lerp(
        lerp(grad3(p[AA], xf, yf, zf), grad3(p[BA], xf - 1, yf, zf), u),
        lerp(grad3(p[AB], xf, yf - 1, zf), grad3(p[BB], xf - 1, yf - 1, zf), u),
        v,
      ),
      lerp(
        lerp(grad3(p[AA + 1], xf, yf, zf - 1), grad3(p[BA + 1], xf - 1, yf, zf - 1), u),
        lerp(grad3(p[AB + 1], xf, yf - 1, zf - 1), grad3(p[BB + 1], xf - 1, yf - 1, zf - 1), u),
        v,
      ),
      w,
    );
  }

  /**
   * Bruit de valeur 1D lissé (valeurs aléatoires aux nœuds, interpolation quintique).
   * Contrairement au bruit de gradient, son intégrale ne s'annule pas : adapté aux
   * grandeurs intégrées (courbure, dérive d'axe) qui doivent produire une vraie marche aléatoire.
   */
  value1(x: number): number {
    const xi = Math.floor(x);
    const i = xi & 1023;
    const v0 = this.grad1[this.perm[i + 7]];
    const v1 = this.grad1[this.perm[i + 8]];
    return lerp(v0, v1, fade(x - xi));
  }

  vfbm1(x: number, octaves = 2): number {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let f = 1;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.value1(x * f + o * 23.7);
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return sum / norm;
  }

  /** Bruit fractal 1D (somme d'octaves normalisée). */
  fbm1(x: number, octaves = 3, lacunarity = 2, gain = 0.5): number {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let f = 1;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise1(x * f + o * 17.13);
      norm += amp;
      amp *= gain;
      f *= lacunarity;
    }
    return sum / norm;
  }

  fbm2(x: number, y: number, octaves = 3, lacunarity = 2, gain = 0.5): number {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let f = 1;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise2(x * f + o * 31.7, y * f - o * 11.3);
      norm += amp;
      amp *= gain;
      f *= lacunarity;
    }
    return sum / norm;
  }
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function grad2(h: number, x: number, y: number): number {
  switch (h & 7) {
    case 0: return x + y;
    case 1: return -x + y;
    case 2: return x - y;
    case 3: return -x - y;
    case 4: return x;
    case 5: return -x;
    case 6: return y;
    default: return -y;
  }
}

function grad3(h: number, x: number, y: number, z: number): number {
  const hh = h & 15;
  const u = hh < 8 ? x : y;
  const v = hh < 4 ? y : hh === 12 || hh === 14 ? x : z;
  return ((hh & 1) === 0 ? u : -u) + ((hh & 2) === 0 ? v : -v);
}
