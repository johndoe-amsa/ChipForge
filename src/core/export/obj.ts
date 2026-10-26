import { GROUP_NAMES, type ChipMesh } from '../geometry/mesh';
import type { RGB } from '../temper';
import { BOX_FACES, boxCorners, type Box } from '../bin';
import { rotateVectors, transformPoints, type RigidTransform } from './transform';

export type LengthUnit = 'mm' | 'm';
export type UvMode = 'reel' | 'normalise';

export interface ObjOptions {
  unit: LengthUnit;
  uvMode: UvMode;
  /** Échelle réelle : nombre de mm représentés par une unité UV. */
  uvScaleMM: number;
  /** Nom de la bibliothèque de matériaux référencée. */
  mtlName: string;
}

export interface ExportItem {
  name: string;
  mesh: ChipMesh;
  transform: RigidTransform;
}

/** Accumulateur de texte encodé en UTF-8, vidé par blocs vers un puits (export en flux). */
export class TextSink {
  private buf: string[] = [];
  private len = 0;
  private readonly enc = new TextEncoder();
  size = 0;

  constructor(private readonly sink: (chunk: Uint8Array) => void) {}

  push(s: string): void {
    this.buf.push(s);
    this.len += s.length;
    if (this.len > 1 << 20) this.flush();
  }

  flush(): void {
    if (this.buf.length === 0) return;
    const u = this.enc.encode(this.buf.join(''));
    this.size += u.length;
    this.buf = [];
    this.len = 0;
    this.sink(u);
  }
}

export function concatChunks(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Matériau MTL d'une teinte de revenu, partagé par toutes les faces d'un groupe de cette teinte. */
export interface TemperMaterial {
  name: string;
  group: string;
  rgb: RGB;
}

const hex2 = (c: number) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0');

function fmt(v: number, digits: number): string {
  const s = v.toFixed(digits);
  // Supprime les zéros non significatifs pour alléger le fichier.
  if (s.indexOf('.') < 0) return s;
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 48) end--;
  if (s.charCodeAt(end - 1) === 46) end--;
  const r = s.slice(0, end);
  return r === '-0' ? '0' : r;
}

/**
 * Écrit un OBJ en flux (quads, UV, normales lisses, un objet par copeau, groupes de faces nommés).
 * Chaque copeau est sérialisé puis libéré : la mémoire reste bornée même pour un gros tas.
 */
export class ObjWriter {
  private readonly sink: TextSink;
  private vBase = 1;
  private tBase = 1;
  private nBase = 1;
  private readonly scale: number;
  private readonly pd: number;
  /** Matériaux de teinte de revenu utilisés (à écrire dans le MTL). */
  readonly temperMaterials = new Map<string, TemperMaterial>();

  constructor(private readonly opt: ObjOptions, out: (chunk: Uint8Array) => void) {
    this.sink = new TextSink(out);
    this.scale = opt.unit === 'm' ? 0.001 : 1;
    this.pd = opt.unit === 'm' ? 8 : 5;
    const sink = this.sink;
    sink.push(`# ChipForge — géométrie de copeaux d'usinage\n`);
    sink.push(`# Unité : ${opt.unit === 'm' ? 'mètre' : 'millimètre'} ; axe vertical : +Y ; UV : ${opt.uvMode === 'reel' ? `échelle réelle (1 unité UV = ${opt.uvScaleMM} mm)` : 'normalisées 0–1 par copeau'}\n`);
    sink.push(`# Groupes : ${GROUP_NAMES.join(', ')}\n`);
    sink.push(`# Couleurs de revenu éventuelles : blocs #MRGB (couleurs de sommets sRGB, lues par Blender ; commentaires ignorés ailleurs)\n`);
    sink.push(`mtllib ${opt.mtlName}\n`);
  }

  get bytesWritten(): number {
    return this.sink.size;
  }

  add(item: ExportItem): void {
    const { opt, sink, pd } = this;
    const m = item.mesh;
    const P = transformPoints(m.positions, item.transform, this.scale);
    const N = rotateVectors(m.normals, item.transform);
    sink.push(`o ${item.name}\n`);
    for (let i = 0; i < P.length; i += 3) sink.push(`v ${fmt(P[i], pd)} ${fmt(P[i + 1], pd)} ${fmt(P[i + 2], pd)}\n`);
    if (m.colors) {
      // Couleurs de sommets au format ZBrush (#MRGB, 64 sommets par ligne, dans l'ordre des « v ») :
      // un commentaire pour l'OBJ standard, donc sans risque pour les autres logiciels.
      const C = m.colors;
      const nv = C.length / 3;
      for (let a = 0; a < nv; a += 64) {
        let line = '#MRGB ';
        for (let k = a; k < Math.min(nv, a + 64); k++) line += `ff${hex2(C[k * 3])}${hex2(C[k * 3 + 1])}${hex2(C[k * 3 + 2])}`;
        sink.push(line + '\n');
      }
    }
    const uv = opt.uvMode === 'reel' ? m.uvMM : m.uv01;
    const us = opt.uvMode === 'reel' ? 1 / Math.max(1e-6, opt.uvScaleMM) : 1;
    for (let i = 0; i < uv.length; i += 2) sink.push(`vt ${fmt(uv[i] * us, 6)} ${fmt(uv[i + 1] * us, 6)}\n`);
    for (let i = 0; i < N.length; i += 3) sink.push(`vn ${fmt(N[i], 4)} ${fmt(N[i + 1], 4)} ${fmt(N[i + 2], 4)}\n`);
    sink.push('s 1\n');
    for (let g = 0; g < GROUP_NAMES.length; g++) {
      const start = m.groups[g * 2];
      const count = m.groups[g * 2 + 1];
      if (count === 0) continue;
      let mtl: string = GROUP_NAMES[g];
      if (m.temper) {
        const f = m.temper.faces[g];
        mtl = `${GROUP_NAMES[g]}_${m.temper.chart}_${f.shade}`;
        if (!this.temperMaterials.has(mtl)) this.temperMaterials.set(mtl, { name: mtl, group: GROUP_NAMES[g], rgb: f.shadeRgb });
      }
      sink.push(`g ${item.name}_${GROUP_NAMES[g]}\nusemtl ${mtl}\n`);
      for (let q = start; q < start + count; q++) {
        let line = 'f';
        for (let k = 0; k < 4; k++) {
          const v = m.quads[q * 4 + k];
          line += ` ${m.vPos[v] + this.vBase}/${v + this.tBase}/${m.vNrm[v] + this.nBase}`;
        }
        sink.push(line + '\n');
      }
    }
    this.vBase += m.positions.length / 3;
    this.tBase += m.vPos.length;
    this.nBase += m.normals.length / 3;
  }

  /** Ajoute un objet fait de pavés (bac à copeaux) : faces planes, normales franches, UV par face. */
  addBoxes(name: string, boxes: Box[]): void {
    const { opt, sink, pd } = this;
    const s = this.scale;
    const us = opt.uvMode === 'reel' ? 1 / Math.max(1e-6, opt.uvScaleMM) : 0;
    sink.push(`o ${name}\n`);
    for (const box of boxes) for (const [x, y, z] of boxCorners(box)) sink.push(`v ${fmt(x * s, pd)} ${fmt(y * s, pd)} ${fmt(z * s, pd)}\n`);
    for (const box of boxes) {
      const P = boxCorners(box);
      for (const { v } of BOX_FACES) {
        const lu = Math.hypot(...P[v[1]].map((c, k) => c - P[v[0]][k]));
        const lv = Math.hypot(...P[v[3]].map((c, k) => c - P[v[0]][k]));
        const [u1, v1] = us > 0 ? [lu * us, lv * us] : [1, 1];
        sink.push(`vt 0 0\nvt ${fmt(u1, 6)} 0\nvt ${fmt(u1, 6)} ${fmt(v1, 6)}\nvt 0 ${fmt(v1, 6)}\n`);
      }
    }
    for (let b = 0; b < boxes.length; b++) for (const { n } of BOX_FACES) sink.push(`vn ${n[0]} ${n[1]} ${n[2]}\n`);
    sink.push(`s off\ng ${name}\nusemtl bac\n`);
    boxes.forEach((_, b) => {
      BOX_FACES.forEach(({ v }, f) => {
        const t0 = this.tBase + (b * 6 + f) * 4;
        const n = this.nBase + b * 6 + f;
        sink.push(`f ${v.map((c, k) => `${this.vBase + b * 8 + c}/${t0 + k}/${n}`).join(' ')}\n`);
      });
    });
    this.vBase += boxes.length * 8;
    this.tBase += boxes.length * 24;
    this.nBase += boxes.length * 6;
    this.hasBin = true;
  }

  /** Vrai si un bac a été écrit (matériau « bac » à inclure dans le MTL). */
  hasBin = false;

  finish(): void {
    this.sink.flush();
  }
}

/** Variante en mémoire (tests, petits exports). */
export function writeOBJ(items: ExportItem[], opt: ObjOptions): Uint8Array {
  const parts: Uint8Array[] = [];
  const w = new ObjWriter(opt, (c) => parts.push(c));
  for (const it of items) w.add(it);
  w.finish();
  return concatChunks(parts);
}

const GROUP_MTL: Record<string, { k: number; ks: number; ns: number; comment: string }> = {
  face_coupe: { k: 0.82, ks: 0.5, ns: 250, comment: "Face de coupe : frottée sur l'outil, brillante" },
  face_libre: { k: 0.55, ks: 0.5, ns: 250, comment: 'Face libre : lamellaire, mate' },
  flancs: { k: 0.68, ks: 0.5, ns: 250, comment: 'Flancs / bords du copeau' },
  extremites: { k: 0.4, ks: 0.5, ns: 250, comment: 'Faces de rupture aux extrémités' },
};

/**
 * Bibliothèque de matériaux : un matériau neutre par groupe de faces, plus un matériau par
 * groupe et par teinte de revenu utilisée (Kd = couleur de la teinte, sRGB).
 */
export function writeMTL(temper: Iterable<TemperMaterial> = [], withBin = false): string {
  let s = '# ChipForge — matériaux neutres, à remplacer dans Blender / KeyShot\n';
  for (const name of GROUP_NAMES) {
    const g = GROUP_MTL[name];
    s += `\n# ${g.comment}\nnewmtl ${name}\nKa 0 0 0\nKd ${g.k} ${g.k} ${g.k}\nKs ${g.ks} ${g.ks} ${g.ks}\nNs ${g.ns}\nd 1\nillum 2\n`;
  }
  const list = [...temper].sort((a, b) => a.name.localeCompare(b.name));
  if (list.length) s += '\n# Couleurs de revenu : un matériau par groupe de faces et par teinte (couleur de base métallique)\n';
  for (const t of list) {
    const g = GROUP_MTL[t.group] ?? GROUP_MTL.flancs;
    s += `\nnewmtl ${t.name}\nKa 0 0 0\nKd ${fmt(t.rgb[0], 4)} ${fmt(t.rgb[1], 4)} ${fmt(t.rgb[2], 4)}\nKs ${g.ks} ${g.ks} ${g.ks}\nNs ${g.ns}\nd 1\nillum 2\n`;
  }
  if (withBin) s += '\n# Bac à copeaux (tôle)\nnewmtl bac\nKa 0 0 0\nKd 0.45 0.47 0.5\nKs 0.3 0.3 0.3\nNs 60\nd 1\nillum 2\n';
  return s;
}
