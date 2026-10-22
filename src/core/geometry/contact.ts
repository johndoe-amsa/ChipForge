/**
 * Détection de contact entre portions d'un même copeau (option « Éviter les auto-intersections »).
 *
 * La fibre est découpée en éléments ; chaque élément est englobé par un pavé orienté selon son
 * repère de section : demi-largeur (W), demi-épaisseur (H, cambrure et reliefs compris) et
 * demi-longueur d'élément (T). Deux pavés se recouvrent s'il n'existe aucun axe séparateur parmi
 * l'axe des centres, les faces des deux pavés et leur normale commune (test SAT). L'axe de moindre pénétration donne la
 * direction d'écartement : l'épaisseur pour deux rubans posés à plat l'un sur l'autre, la largeur
 * pour deux spires côte à côte.
 */

export interface ContactSettings {
  halfW: number;
  halfT: number;
  /** Demi-longueur d'un élément le long de la fibre. */
  tExt: number;
  /** Espacement des éléments (mm) et nombre de pas d'intégration par élément. */
  h: number;
  stride: number;
  /** Jeu minimal visé entre deux portions. */
  margin: number;
  /** Portions plus proches que cette longueur le long de la fibre : jamais testées entre elles. */
  exclArc: number;
  /** Distance entre centres au-delà de laquelle aucun contact n'est possible. */
  reach: number;
}

export function contactSettings(halfW: number, halfT: number, ds: number): ContactSettings {
  // Éléments ≈ 0,35 × demi-largeur : assez fins pour couvrir la section, assez gros pour rester rapides.
  const hTarget = Math.min(0.5, Math.max(ds, 0.35 * Math.max(halfW, 2 * halfT)));
  const stride = Math.max(1, Math.round(hTarget / ds));
  const h = stride * ds;
  // Les pavés se chevauchent le long de la fibre (0,75 h > h / 2) : aucune tranche non couverte,
  // même sur le bord extérieur d'un virage où la matière s'écarte.
  const tExt = 0.75 * h;
  const margin = 0.12 * halfT + 0.002;
  return {
    halfW,
    halfT,
    tExt,
    h,
    stride,
    margin,
    exclArc: 2.2 * halfW + 2 * h,
    reach: 2 * Math.sqrt(halfW * halfW + halfT * halfT + tExt * tExt) + margin,
  };
}

/** Repère d'un élément : W (3), H (3), T (3) à l'offset o. */
type Frames = ArrayLike<number>;
/** Demi-étendues d'un pavé le long de W, H, T (3 valeurs à l'offset e). */
type Extents = ArrayLike<number>;

function support(F: Frames, o: number, E: Extents, e: number, nx: number, ny: number, nz: number): number {
  return (
    E[e] * Math.abs(F[o] * nx + F[o + 1] * ny + F[o + 2] * nz) +
    E[e + 1] * Math.abs(F[o + 3] * nx + F[o + 4] * ny + F[o + 5] * nz) +
    E[e + 2] * Math.abs(F[o + 6] * nx + F[o + 7] * ny + F[o + 8] * nz)
  );
}

/**
 * Pénétration entre les pavés A et B (e = centre B − centre A). Renvoie 0 s'ils sont séparés ;
 * sinon la profondeur, et l'axe de moindre pénétration orienté de A vers B dans out[0..2]. Si out
 * a 4 composantes, out[3] reçoit le plus petit recouvrement sur tous les axes (jeu compris) :
 * les pavés restent en contact pour un jeu g' tant que out[3] − gap + g' > 0.
 *
 * Axes testés : axe des centres, faces des deux pavés et normale commune T_A × T_B de deux
 * portions qui se croisent. Les axes de fibre T_A, T_B servent à la séparation mais jamais à
 * l'écartement quand `across` est vrai : la fibre se prolonge au-delà du pavé, la pousser dans
 * sa propre direction la tasserait en accordéon au lieu de l'écarter.
 */
export function penetration(
  ex: number,
  ey: number,
  ez: number,
  FA: Frames,
  oa: number,
  EA: Extents,
  ea: number,
  FB: Frames,
  ob: number,
  EB: Extents,
  eb: number,
  gap: number,
  out: Float64Array,
  across = false,
): number {
  const dist = Math.sqrt(ex * ex + ey * ey + ez * ez);
  const ra = Math.sqrt(EA[ea] * EA[ea] + EA[ea + 1] * EA[ea + 1] + EA[ea + 2] * EA[ea + 2]);
  const rb = Math.sqrt(EB[eb] * EB[eb] + EB[eb + 1] * EB[eb + 1] + EB[eb + 2] * EB[eb + 2]);
  if (dist >= ra + rb + gap) return 0;
  let best = Infinity;
  let least = Infinity;
  for (let ax = 0; ax < 8; ax++) {
    let nx: number;
    let ny: number;
    let nz: number;
    if (ax === 0) {
      if (dist <= 1e-9) continue;
      nx = ex / dist;
      ny = ey / dist;
      nz = ez / dist;
    } else if (ax === 7) {
      nx = FA[oa + 7] * FB[ob + 8] - FA[oa + 8] * FB[ob + 7];
      ny = FA[oa + 8] * FB[ob + 6] - FA[oa + 6] * FB[ob + 8];
      nz = FA[oa + 6] * FB[ob + 7] - FA[oa + 7] * FB[ob + 6];
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (nl < 0.2) continue;
      nx /= nl;
      ny /= nl;
      nz /= nl;
    } else {
      const F = ax <= 3 ? FA : FB;
      const o = (ax <= 3 ? oa : ob) + ((ax - 1) % 3) * 3;
      nx = F[o];
      ny = F[o + 1];
      nz = F[o + 2];
    }
    const proj = ex * nx + ey * ny + ez * nz;
    const overlap = support(FA, oa, EA, ea, nx, ny, nz) + support(FB, ob, EB, eb, nx, ny, nz) + gap - Math.abs(proj);
    if (overlap <= 0) return 0;
    if (overlap < least) least = overlap;
    if (across && (ax === 3 || ax === 6)) continue;
    if (overlap < best) {
      best = overlap;
      const sg = proj >= 0 ? 1 : -1;
      out[0] = sg * nx;
      out[1] = sg * ny;
      out[2] = sg * nz;
    }
  }
  if (out.length > 3) out[3] = least;
  return Number.isFinite(best) ? best : 0;
}

export function cellKey(x: number, y: number, z: number): number {
  // Clé exacte (sans collision) pour |indices| < 65 536.
  return ((x + 65536) * 131072 + (y + 65536)) * 131072 + (z + 65536);
}

/**
 * Champ de contact pour la croissance de la fibre : mémorise les éléments déjà formés (pavés
 * calculés sur leurs sections réelles) et indique de combien déplacer un nouvel élément pour
 * qu'il ne pénètre aucun d'eux.
 */
export class ContactField {
  pos = new Float64Array(3 * 1024);
  frames = new Float64Array(9 * 1024);
  ext = new Float64Array(3 * 1024);
  private rad = new Float64Array(1024);
  private arc = new Float64Array(1024);
  private readonly tipR: number;
  private count = 0;
  private readonly grid = new Map<number, number[]>();
  private readonly inv: number;
  private readonly cand: number[] = [];
  private readonly axis = new Float64Array(3);
  /** Pavé de la pointe (section unique, un peu étirée le long de la fibre). */
  private readonly tip: Float64Array;

  constructor(readonly c: ContactSettings) {
    this.tip = Float64Array.of(c.halfW, c.halfT, c.tExt);
    this.tipR = Math.hypot(c.halfW, c.halfT, c.tExt);
    // Tout coin d'un élément est à moins de ρ de son centre : chaque demi-étendue est ≤ ρ.
    const rho = c.h + Math.hypot(c.halfW, c.halfT);
    this.inv = 1 / (Math.hypot(c.halfW, c.halfT, c.tExt) + Math.sqrt(3) * rho + c.margin + 0.5 * c.halfW);
  }

  add(x: number, y: number, z: number, F: Frames, o: number, s: number, E: Extents, e: number): void {
    if (this.count === this.arc.length) {
      const grow = (a: Float64Array) => {
        const b = new Float64Array(a.length * 2);
        b.set(a);
        return b;
      };
      this.pos = grow(this.pos);
      this.frames = grow(this.frames);
      this.ext = grow(this.ext);
      this.rad = grow(this.rad);
      this.arc = grow(this.arc);
    }
    const k = this.count++;
    this.pos[k * 3] = x;
    this.pos[k * 3 + 1] = y;
    this.pos[k * 3 + 2] = z;
    for (let a = 0; a < 9; a++) this.frames[k * 9 + a] = F[o + a];
    for (let a = 0; a < 3; a++) this.ext[k * 3 + a] = E[e + a];
    this.rad[k] = Math.hypot(E[e], E[e + 1], E[e + 2]);
    this.arc[k] = s;
    const key = cellKey(Math.floor(x * this.inv), Math.floor(y * this.inv), Math.floor(z * this.inv));
    const b = this.grid.get(key);
    if (b) b.push(k);
    else this.grid.set(key, [k]);
  }

  /** Éléments formés avant l'abscisse s − exclArc qui peuvent toucher la pointe en (x, y, z). */
  private gather(x: number, y: number, z: number, s: number, gap: number): number[] {
    const cand = this.cand;
    cand.length = 0;
    const gx = Math.floor(x * this.inv);
    const gy = Math.floor(y * this.inv);
    const gz = Math.floor(z * this.inv);
    const limit = s - this.c.exclArc;
    // La pointe peut être déplacée (resolve) d'au plus quelques épaisseurs : marge de tri.
    const slack = this.c.halfW;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const b = this.grid.get(cellKey(gx + dx, gy + dy, gz + dz));
          if (!b) continue;
          for (const k of b) {
            if (this.arc[k] >= limit) continue;
            const ex = this.pos[k * 3] - x;
            const ey = this.pos[k * 3 + 1] - y;
            const ez = this.pos[k * 3 + 2] - z;
            const rr = this.tipR + this.rad[k] + gap + slack;
            if (ex * ex + ey * ey + ez * ez < rr * rr) cand.push(k);
          }
        }
    return cand;
  }

  /**
   * Déplacement (écrit dans out) qui sort le pavé de pointe (x, y, z, F) de tous les éléments
   * formés avant l'abscisse s − exclArc, perpendiculairement à sa fibre. Renvoie le nombre de
   * contacts rencontrés.
   */
  resolve(x: number, y: number, z: number, F: Frames, o: number, s: number, gap: number, out: Float64Array): number {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    const cand = this.gather(x, y, z, s, gap);
    if (cand.length === 0) return 0;
    let contacts = 0;
    for (let pass = 0; pass < 3; pass++) {
      let any = false;
      for (const k of cand) {
        const ex = this.pos[k * 3] - (x + out[0]);
        const ey = this.pos[k * 3 + 1] - (y + out[1]);
        const ez = this.pos[k * 3 + 2] - (z + out[2]);
        const d = penetration(ex, ey, ez, F, o, this.tip, 0, this.frames, k * 9, this.ext, k * 3, gap, this.axis, true);
        if (d <= 0) continue;
        any = true;
        contacts++;
        out[0] -= d * this.axis[0];
        out[1] -= d * this.axis[1];
        out[2] -= d * this.axis[2];
      }
      if (!any) break;
    }
    return contacts;
  }

  /** Élément formé le plus profondément pénétré par le pavé de pointe, ou −1. */
  deepest(x: number, y: number, z: number, F: Frames, o: number, s: number, gap: number): number {
    const cand = this.gather(x, y, z, s, gap);
    let best = -1;
    let depth = 0;
    for (const k of cand) {
      const d = penetration(
        this.pos[k * 3] - x,
        this.pos[k * 3 + 1] - y,
        this.pos[k * 3 + 2] - z,
        F,
        o,
        this.tip,
        0,
        this.frames,
        k * 9,
        this.ext,
        k * 3,
        gap,
        this.axis,
        true,
      );
      if (d > depth) {
        depth = d;
        best = k;
      }
    }
    return best;
  }
}

/**
 * Échelle du tube (copeaux hélicoïdaux enchevêtrés) : mémorise l'axe de l'hélice déjà formée et
 * calcule la poussée qui écarte un point d'axe des portions de tube plus anciennes que `limit`.
 */
export class TubeField {
  private pos: number[] = [];
  private rad: number[] = [];
  private arc: number[] = [];
  private readonly grid = new Map<number, number[]>();
  private readonly inv: number;

  constructor(maxRadius: number) {
    this.inv = 1 / (2.2 * maxRadius);
  }

  add(x: number, y: number, z: number, r: number, s: number): void {
    const k = this.arc.length;
    this.pos.push(x, y, z);
    this.rad.push(r);
    this.arc.push(s);
    const key = cellKey(Math.floor(x * this.inv), Math.floor(y * this.inv), Math.floor(z * this.inv));
    const b = this.grid.get(key);
    if (b) b.push(k);
    else this.grid.set(key, [k]);
  }

  /** Somme des recouvrements relatifs (vecteur écrit dans out), tube de rayon r en (x, y, z). */
  repel(x: number, y: number, z: number, r: number, limit: number, out: Float64Array): number {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    let n = 0;
    const gx = Math.floor(x * this.inv);
    const gy = Math.floor(y * this.inv);
    const gz = Math.floor(z * this.inv);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const b = this.grid.get(cellKey(gx + dx, gy + dy, gz + dz));
          if (!b) continue;
          for (const k of b) {
            if (this.arc[k] >= limit) continue;
            const ex = x - this.pos[k * 3];
            const ey = y - this.pos[k * 3 + 1];
            const ez = z - this.pos[k * 3 + 2];
            const d = Math.sqrt(ex * ex + ey * ey + ez * ez);
            const reach = 1.1 * (r + this.rad[k]);
            if (d >= reach || d < 1e-9) continue;
            const w = (reach - d) / (r + this.rad[k]) / d;
            out[0] += w * ex;
            out[1] += w * ey;
            out[2] += w * ez;
            n++;
          }
        }
    return n;
  }
}

/**
 * Grille spatiale réutilisable (hachage des cellules + tri par comptage, sans allocation) :
 * cellules de taille 1 / inv. `neighbours(k)` donne les plages de `order` couvrant les 27
 * cellules voisines de celle de k. Deux cellules peuvent partager une case de la table : les
 * éléments en trop sont éliminés par le test de distance de l'appelant, et chaque case n'est
 * renvoyée qu'une fois par requête.
 */
export class CellGrid {
  private mask = 0;
  private start = new Int32Array(1);
  private cursor = new Int32Array(0);
  private slot = new Int32Array(0);
  private cx = new Int32Array(0);
  private cy = new Int32Array(0);
  private cz = new Int32Array(0);
  order = new Int32Array(0);
  /** Plages [lo, hi) de la dernière requête (ranges[2q], ranges[2q + 1]). */
  readonly ranges = new Int32Array(54);

  private hash(x: number, y: number, z: number): number {
    return (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & this.mask;
  }

  build(P: ArrayLike<number>, m: number, inv: number): void {
    if (this.order.length < m) {
      this.order = new Int32Array(m);
      this.slot = new Int32Array(m);
      this.cx = new Int32Array(m);
      this.cy = new Int32Array(m);
      this.cz = new Int32Array(m);
    }
    let size = 64;
    while (size < 2 * m) size *= 2;
    if (size !== this.mask + 1) {
      this.mask = size - 1;
      this.start = new Int32Array(size + 1);
      this.cursor = new Int32Array(size);
    } else this.start.fill(0);
    for (let k = 0; k < m; k++) {
      const x = Math.floor(P[k * 3] * inv);
      const y = Math.floor(P[k * 3 + 1] * inv);
      const z = Math.floor(P[k * 3 + 2] * inv);
      this.cx[k] = x;
      this.cy[k] = y;
      this.cz[k] = z;
      const h = this.hash(x, y, z);
      this.slot[k] = h;
      this.start[h + 1]++;
    }
    for (let h = 0; h < size; h++) this.start[h + 1] += this.start[h];
    this.cursor.set(this.start.subarray(0, size));
    for (let k = 0; k < m; k++) this.order[this.cursor[this.slot[k]]++] = k;
  }

  /** Plages des 27 cellules voisines de celle de l'élément k ; renvoie leur nombre. */
  neighbours(k: number): number {
    let n = 0;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const h = this.hash(this.cx[k] + dx, this.cy[k] + dy, this.cz[k] + dz);
          const lo = this.start[h];
          const hi = this.start[h + 1];
          if (lo === hi) continue;
          let dup = false;
          for (let q = 0; q < n; q++)
            if (this.ranges[2 * q] === lo) {
              dup = true;
              break;
            }
          if (dup) continue;
          this.ranges[2 * n] = lo;
          this.ranges[2 * n + 1] = hi;
          n++;
        }
    return n;
  }
}
