/**
 * Générateurs pseudo-aléatoires déterministes.
 * Toute la variabilité de ChipForge dérive d'une seed : même seed + mêmes paramètres = même géométrie.
 */

/** Mélange 32 bits (murmur3 finalizer) de plusieurs composantes en une seed. */
export function hashSeed(...parts: (number | string)[]): number {
  let h = 0x9e3779b9 ^ parts.length;
  for (const p of parts) {
    if (typeof p === 'string') {
      for (let i = 0; i < p.length; i++) {
        h = Math.imul(h ^ p.charCodeAt(i), 0x85ebca6b);
        h ^= h >>> 13;
      }
    } else {
      // Les nombres non entiers sont réduits à 32 bits via deux mots.
      const lo = (p | 0) >>> 0;
      const hi = Math.floor(p / 4294967296) >>> 0;
      h = Math.imul(h ^ lo, 0xcc9e2d51);
      h = (h << 15) | (h >>> 17);
      h = Math.imul(h ^ hi, 0x1b873593);
    }
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0 || 0x6d2b79f5;
  }

  /** Nombre uniforme dans [0, 1) (mulberry32). */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  /** Entier dans [a, b] inclus. */
  int(a: number, b: number): number {
    return a + Math.floor(this.next() * (b - a + 1));
  }

  /** Loi normale centrée réduite (Box-Muller). */
  normal(): number {
    const u = Math.max(this.next(), 1e-12);
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Variation symétrique : valeur * (1 + amount * N(0,1) borné). */
  jitter(value: number, amount: number): number {
    const n = Math.max(-2.5, Math.min(2.5, this.normal()));
    return value * (1 + amount * n * 0.5);
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Quaternion unitaire uniforme (x, y, z, w). */
  quaternion(): [number, number, number, number] {
    const u1 = this.next();
    const u2 = this.next() * 2 * Math.PI;
    const u3 = this.next() * 2 * Math.PI;
    const a = Math.sqrt(1 - u1);
    const b = Math.sqrt(u1);
    return [a * Math.sin(u2), a * Math.cos(u2), b * Math.sin(u3), b * Math.cos(u3)];
  }
}
