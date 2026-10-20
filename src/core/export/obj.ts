import { GROUP_NAMES, type ChipMesh } from '../geometry/mesh';
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

  constructor(private readonly opt: ObjOptions, out: (chunk: Uint8Array) => void) {
    this.sink = new TextSink(out);
    this.scale = opt.unit === 'm' ? 0.001 : 1;
    this.pd = opt.unit === 'm' ? 8 : 5;
    const sink = this.sink;
    sink.push(`# ChipForge — géométrie de copeaux d'usinage\n`);
    sink.push(`# Unité : ${opt.unit === 'm' ? 'mètre' : 'millimètre'} ; axe vertical : +Y ; UV : ${opt.uvMode === 'reel' ? `échelle réelle (1 unité UV = ${opt.uvScaleMM} mm)` : 'normalisées 0–1 par copeau'}\n`);
    sink.push(`# Groupes : ${GROUP_NAMES.join(', ')}\n`);
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
    const uv = opt.uvMode === 'reel' ? m.uvMM : m.uv01;
    const us = opt.uvMode === 'reel' ? 1 / Math.max(1e-6, opt.uvScaleMM) : 1;
    for (let i = 0; i < uv.length; i += 2) sink.push(`vt ${fmt(uv[i] * us, 6)} ${fmt(uv[i + 1] * us, 6)}\n`);
    for (let i = 0; i < N.length; i += 3) sink.push(`vn ${fmt(N[i], 4)} ${fmt(N[i + 1], 4)} ${fmt(N[i + 2], 4)}\n`);
    sink.push('s 1\n');
    for (let g = 0; g < GROUP_NAMES.length; g++) {
      const start = m.groups[g * 2];
      const count = m.groups[g * 2 + 1];
      if (count === 0) continue;
      sink.push(`g ${item.name}_${GROUP_NAMES[g]}\nusemtl ${GROUP_NAMES[g]}\n`);
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

export function writeMTL(): string {
  const mats: [string, number, string][] = [
    ['face_coupe', 0.82, "Face de coupe : frottée sur l'outil, brillante"],
    ['face_libre', 0.55, 'Face libre : lamellaire, mate'],
    ['flancs', 0.68, 'Flancs / bords du copeau'],
    ['extremites', 0.4, 'Faces de rupture aux extrémités'],
  ];
  let s = '# ChipForge — matériaux neutres, à remplacer dans Blender / KeyShot\n';
  for (const [name, k, comment] of mats) {
    s += `\n# ${comment}\nnewmtl ${name}\nKa 0 0 0\nKd ${k} ${k} ${k}\nKs 0.5 0.5 0.5\nNs 250\nd 1\nillum 2\n`;
  }
  return s;
}
