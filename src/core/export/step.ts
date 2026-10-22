import type { ChipGrid } from '../geometry/chip';
import { GROUP_NAMES } from '../geometry/chip';
import { temperFaces, type RGB } from '../temper';
import { BOX_FACES, boxCorners, type Box } from '../bin';
import { transformPoints, type RigidTransform } from './transform';

/**
 * Exporteur STEP AP214 (ISO 10303-21) en B-Rep NURBS, écrit sans dépendance.
 *
 * Chaque copeau devient un MANIFOLD_SOLID_BREP fermé de 6 faces :
 *   face_coupe, flanc B, face_libre, flanc A (B-splines bicubiques le long de la fibre)
 *   + 2 faces de rupture (carreaux de Coons B-spline).
 * Les surfaces adjacentes partagent exactement leurs points de contrôle de bord et leurs
 * vecteurs de nœuds : les arêtes (B_SPLINE_CURVE_WITH_KNOTS) sont donc rigoureusement
 * communes et le solide est étanche. Les points de la grille servent de polygone de
 * contrôle (approximation B-spline, sans dépassement).
 *
 * Plusieurs copeaux → assemblage (un produit nommé par copeau). Chaque groupe de faces
 * porte une couleur distincte pour faciliter l'affectation de matériaux dans KeyShot ; avec
 * les couleurs de revenu, chaque face prend la teinte moyenne de cette face du copeau.
 * Repère : Z vertical (convention CAO), unité : mm.
 */

export interface ChipStepItem {
  name: string;
  grid: ChipGrid;
  transform: RigidTransform;
}

/** Objet fait de pavés (bac à copeaux), déjà placé dans le repère de la scène. */
export interface BoxStepItem {
  name: string;
  boxes: Box[];
}

export type StepItem = ChipStepItem | BoxStepItem;

const BIN_COLOR: RGB = [0.45, 0.47, 0.5];

const FACE_COLORS: Record<string, [number, number, number]> = {
  face_coupe: [0.82, 0.82, 0.82],
  face_libre: [0.55, 0.55, 0.55],
  flancs: [0.68, 0.68, 0.68],
  extremites: [0.4, 0.4, 0.4],
};

function real(v: number): string {
  if (!Number.isFinite(v)) return '0.';
  const s = v.toFixed(6);
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 48) end--;
  let r = s.slice(0, end);
  if (r === '-0.' || r === '-0') r = '0.';
  if (r.indexOf('.') < 0) r += '.';
  return r;
}

/** Chaîne STEP : ASCII uniquement, apostrophes doublées. */
function str(s: string): string {
  const ascii = s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/\\/g, '_');
  return `'${ascii.replace(/'/g, "''")}'`;
}

const refs = (ids: number[]) => `(${ids.map((i) => `#${i}`).join(',')})`;

function knots(n: number, d: number): { mults: string; knots: string } {
  // n + 1 points de contrôle, degré d, nœuds uniformes bloqués aux extrémités.
  const distinct = n - d + 2;
  const mults: number[] = [];
  const ks: string[] = [];
  for (let k = 0; k < distinct; k++) {
    mults.push(k === 0 || k === distinct - 1 ? d + 1 : 1);
    ks.push(real(k));
  }
  return { mults: `(${mults.join(',')})`, knots: `(${ks.join(',')})` };
}

class Writer {
  private id = 0;
  private chunks: string[] = [];
  private len = 0;
  private readonly enc = new TextEncoder();
  size = 0;

  constructor(private readonly out: (chunk: Uint8Array) => void) {}

  add(body: string): number {
    const i = ++this.id;
    this.raw(`#${i}=${body};\n`);
    return i;
  }

  raw(s: string): void {
    this.chunks.push(s);
    this.len += s.length;
    if (this.len > 1 << 20) this.flush();
  }

  flush(): void {
    if (!this.chunks.length) return;
    const u = this.enc.encode(this.chunks.join(''));
    this.size += u.length;
    this.chunks = [];
    this.len = 0;
    this.out(u);
  }
}

interface Ctx {
  w: Writer;
  geomCtx: number;
  productCtx: number;
  pdCtx: number;
  styles: Record<string, number>;
  styled: number[];
  /** Styles de couleur créés à la demande (couleurs de revenu), par couleur arrondie. */
  colorStyles: Map<string, number>;
}

/** Style de surface d'une couleur (COLOUR_RGB → PRESENTATION_STYLE_ASSIGNMENT). */
function writeStyle(w: Writer, name: string, [r, g, b]: RGB): number {
  const col = w.add(`COLOUR_RGB(${str(name)},${real(r)},${real(g)},${real(b)})`);
  const fac = w.add(`FILL_AREA_STYLE_COLOUR('',#${col})`);
  const fas = w.add(`FILL_AREA_STYLE('',(#${fac}))`);
  const ssfa = w.add(`SURFACE_STYLE_FILL_AREA(#${fas})`);
  const sss = w.add(`SURFACE_SIDE_STYLE('',(#${ssfa}))`);
  const ssu = w.add(`SURFACE_STYLE_USAGE(.BOTH.,#${sss})`);
  return w.add(`PRESENTATION_STYLE_ASSIGNMENT((#${ssu}))`);
}

function colorStyle(c: Ctx, name: string, rgb: RGB): number {
  const q = rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000) as RGB;
  const key = `${name}|${q.join(',')}`;
  let id = c.colorStyles.get(key);
  if (id === undefined) {
    id = writeStyle(c.w, name, q);
    c.colorStyles.set(key, id);
  }
  return id;
}

function writeProduct(c: Ctx, name: string): { pd: number; pds: number } {
  const w = c.w;
  const prod = w.add(`PRODUCT(${str(name)},${str(name)},'',(#${c.productCtx}))`);
  w.add(`PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,(#${prod}))`);
  const pdf = w.add(`PRODUCT_DEFINITION_FORMATION('','',#${prod})`);
  const pd = w.add(`PRODUCT_DEFINITION('design','',#${pdf},#${c.pdCtx})`);
  const pds = w.add(`PRODUCT_DEFINITION_SHAPE('','',#${pd})`);
  return { pd, pds };
}

function writeAxis(w: Writer): number {
  const o = w.add(`CARTESIAN_POINT('',(0.,0.,0.))`);
  const z = w.add(`DIRECTION('',(0.,0.,1.))`);
  const x = w.add(`DIRECTION('',(1.,0.,0.))`);
  return w.add(`AXIS2_PLACEMENT_3D('',#${o},#${z},#${x})`);
}

/**
 * Pavé fermé de 6 faces planes (B-splines de degré 1, comme le reste du fichier) ; arêtes
 * partagées entre faces voisines. Renvoie l'identifiant du MANIFOLD_SOLID_BREP.
 */
function writeBox(c: Ctx, name: string, box: Box): number {
  const w = c.w;
  const pt = boxCorners(box).map(([x, y, z]) => w.add(`CARTESIAN_POINT('',(${real(x)},${real(-z)},${real(y)}))`));
  const vx = pt.map((p) => w.add(`VERTEX_POINT('',#${p})`));
  const edges = new Map<number, number>();
  const oriented = (a: number, b: number) => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    let e = edges.get(lo * 8 + hi);
    if (e === undefined) {
      const crv = w.add(`B_SPLINE_CURVE_WITH_KNOTS('',1,(#${pt[lo]},#${pt[hi]}),.UNSPECIFIED.,.F.,.F.,(2,2),(0.,1.),.UNSPECIFIED.)`);
      e = w.add(`EDGE_CURVE('',#${vx[lo]},#${vx[hi]},#${crv},.T.)`);
      edges.set(lo * 8 + hi, e);
    }
    return w.add(`ORIENTED_EDGE('',*,*,#${e},${a === lo ? '.T.' : '.F.'})`);
  };
  const style = colorStyle(c, name, BIN_COLOR);
  const faces = BOX_FACES.map(({ v: [a, b, cc, d] }) => {
    // u : a → b, v : a → d ; (b − a) × (d − a) est la normale sortante.
    const surf = w.add(
      `B_SPLINE_SURFACE_WITH_KNOTS('',1,1,((#${pt[a]},#${pt[d]}),(#${pt[b]},#${pt[cc]})),.UNSPECIFIED.,.F.,.F.,.F.,(2,2),(2,2),(0.,1.),(0.,1.),.UNSPECIFIED.)`,
    );
    const loop = w.add(`EDGE_LOOP('',${refs([oriented(a, b), oriented(b, cc), oriented(cc, d), oriented(d, a)])})`);
    const bound = w.add(`FACE_OUTER_BOUND('',#${loop},.T.)`);
    const f = w.add(`ADVANCED_FACE(${str(name)},(#${bound}),#${surf},.T.)`);
    c.styled.push(w.add(`STYLED_ITEM('color',(#${style}),#${f})`));
    return f;
  });
  const shell = w.add(`CLOSED_SHELL('',${refs(faces)})`);
  return w.add(`MANIFOLD_SOLID_BREP(${str(name)},#${shell})`);
}

/** Solides d'un élément : un copeau, ou les pavés d'un bac. */
function writeSolids(c: Ctx, item: StepItem): number[] {
  return 'grid' in item ? [writeSolid(c, item)] : item.boxes.map((b) => writeBox(c, item.name, b));
}

/** Écrit le solide d'un copeau ; renvoie l'identifiant du MANIFOLD_SOLID_BREP. */
function writeSolid(c: Ctx, item: ChipStepItem): number {
  const w = c.w;
  const { grid } = item;
  const { rings, nW, nE, M, flip } = grid;
  const P = transformPoints(grid.pos, item.transform);
  // Couleurs de revenu : teinte moyenne de chaque groupe de faces de ce copeau.
  const tf = grid.temper ? temperFaces(grid.temper.chart, grid.temper.level, rings, nW, nE) : null;
  const styleOf = (name: string) => {
    if (!tf) return c.styles[name];
    const g = GROUP_NAMES.indexOf(name as (typeof GROUP_NAMES)[number]);
    return colorStyle(c, name, tf[g].rgb);
  };
  const C0 = transformPoints(grid.cap0, item.transform);
  const C1 = transformPoints(grid.cap1, item.transform);

  // Repère CAO : Z vertical. (x, y, z)_Y-up → (x, -z, y)_Z-up
  const point = (arr: Float64Array, k: number) =>
    w.add(`CARTESIAN_POINT('',(${real(arr[k])},${real(-arr[k + 2])},${real(arr[k + 1])}))`);

  const pid = new Int32Array(rings * M);
  for (let k = 0; k < rings * M; k++) pid[k] = point(P, k * 3);
  const gridId = (i: number, j: number) => pid[i * M + (((j % M) + M) % M)];

  const capIds = (C: Float64Array, ring: number) => {
    const ids = new Int32Array((nW + 1) * (nE + 1));
    for (let a = 0; a <= nW; a++) {
      for (let b = 0; b <= nE; b++) {
        const g = a * (nE + 1) + b;
        let j = -1;
        if (b === 0) j = a;
        else if (a === nW) j = nW + b;
        else if (b === nE) j = 2 * nW + nE - a;
        else if (a === 0) j = M - b;
        ids[g] = j >= 0 ? gridId(ring, j) : point(C, g * 3);
      }
    }
    return ids;
  };
  const last = rings - 1;
  const cap0 = capIds(C0, 0);
  const cap1 = capIds(C1, last);

  const du = Math.min(3, rings - 1);
  const dW = Math.min(3, nW);
  const dE = Math.min(3, nE);
  const ku = knots(rings - 1, du);
  const kW = knots(nW, dW);
  const kE = knots(nE, dE);

  const curve = (ids: number[], d: number, k: { mults: string; knots: string }) =>
    w.add(`B_SPLINE_CURVE_WITH_KNOTS('',${d},${refs(ids)},.UNSPECIFIED.,.F.,.F.,${k.mults},${k.knots},.UNSPECIFIED.)`);

  // Sommets (4 coins par extrémité)
  const corners = [0, nW, nW + nE, 2 * nW + nE];
  const vtx = new Map<number, number>();
  const vertex = (i: number, j: number) => {
    const key = i * M + (j % M);
    let v = vtx.get(key);
    if (v === undefined) {
      v = w.add(`VERTEX_POINT('',#${gridId(i, j)})`);
      vtx.set(key, v);
    }
    return v;
  };
  const edge = (v0: number, v1: number, crv: number) => w.add(`EDGE_CURVE('',#${v0},#${v1},#${crv},.T.)`);

  // Arêtes longitudinales aux 4 coins
  const longEdge = corners.map((j) => {
    const ids: number[] = [];
    for (let i = 0; i < rings; i++) ids.push(gridId(i, j));
    return edge(vertex(0, j), vertex(last, j), curve(ids, du, ku));
  });
  // Arêtes de section aux deux extrémités : coupe, flanc B, libre, flanc A
  const ringEdges = (i: number) => {
    const spans: [number, number, number, { mults: string; knots: string }][] = [
      [0, nW, dW, kW],
      [nW, nE, dE, kE],
      [nW + nE, nW, dW, kW],
      [2 * nW + nE, nE, dE, kE],
    ];
    return spans.map(([j0, n, d, k]) => {
      const ids: number[] = [];
      for (let c = 0; c <= n; c++) ids.push(gridId(i, j0 + c));
      return edge(vertex(i, j0), vertex(i, j0 + n), curve(ids, d, k));
    });
  };
  const startE = ringEdges(0);
  const endE = ringEdges(last);

  const oe = (e: number, sense: boolean) => w.add(`ORIENTED_EDGE('',*,*,#${e},${sense ? '.T.' : '.F.'})`);

  const faces: number[] = [];
  const face = (name: string, surf: number, loopEdges: [number, boolean][], outward: boolean) => {
    const loop = w.add(`EDGE_LOOP('',${refs(loopEdges.map(([e, s]) => oe(e, s)))})`);
    const s = outward ? '.T.' : '.F.';
    const bound = w.add(`FACE_OUTER_BOUND('',#${loop},${s})`);
    const f = w.add(`ADVANCED_FACE(${str(name)},(#${bound}),#${surf},${s})`);
    c.styled.push(w.add(`STYLED_ITEM('color',(#${styleOf(name)}),#${f})`));
    faces.push(f);
  };

  // Surfaces latérales : u = anneaux, v = travers du périmètre
  const sideSurface = (j0: number, n: number, d: number, k: { mults: string; knots: string }) => {
    const rows: string[] = [];
    for (let i = 0; i < rings; i++) {
      const ids: number[] = [];
      for (let c = 0; c <= n; c++) ids.push(gridId(i, j0 + c));
      rows.push(refs(ids));
    }
    return w.add(
      `B_SPLINE_SURFACE_WITH_KNOTS('',${du},${d},(${rows.join(',')}),.UNSPECIFIED.,.F.,.F.,.F.,${ku.mults},${k.mults},${ku.knots},${k.knots},.UNSPECIFIED.)`,
    );
  };
  const sides: [string, number, number, number, { mults: string; knots: string }][] = [
    ['face_coupe', 0, nW, dW, kW],
    ['flancs', nW, nE, dE, kE],
    ['face_libre', nW + nE, nW, dW, kW],
    ['flancs', 2 * nW + nE, nE, dE, kE],
  ];
  const outwardSide = !flip;
  sides.forEach(([name, j0, n, d, k], s) => {
    const surf = sideSurface(j0, n, d, k);
    // Boucle anti-horaire dans l'espace (u, v)
    face(
      name,
      surf,
      [
        [longEdge[s], true],
        [endE[s], true],
        [longEdge[(s + 1) % 4], false],
        [startE[s], false],
      ],
      outwardSide,
    );
  });

  const capSurface = (ids: Int32Array) => {
    const rows: string[] = [];
    for (let a = 0; a <= nW; a++) {
      const r: number[] = [];
      for (let b = 0; b <= nE; b++) r.push(ids[a * (nE + 1) + b]);
      rows.push(refs(r));
    }
    return w.add(
      `B_SPLINE_SURFACE_WITH_KNOTS('',${dW},${dE},(${rows.join(',')}),.UNSPECIFIED.,.F.,.F.,.F.,${kW.mults},${kE.mults},${kW.knots},${kE.knots},.UNSPECIFIED.)`,
    );
  };
  const capLoop = (E: number[]): [number, boolean][] => [
    [E[0], true],
    [E[1], true],
    [E[2], true],
    [E[3], true],
  ];
  face('extremites', capSurface(cap0), capLoop(startE), !flip);
  face('extremites', capSurface(cap1), capLoop(endE), flip);

  const shell = w.add(`CLOSED_SHELL('',${refs(faces)})`);
  return w.add(`MANIFOLD_SOLID_BREP(${str(item.name)},#${shell})`);
}

/**
 * Écrit un fichier STEP en flux : un copeau (pièce) ou plusieurs (assemblage).
 * `getItem(i)` est appelé une seule fois par copeau, au moment de l'écrire : la géométrie
 * peut être générée à la demande et libérée aussitôt.
 */
export function writeSTEPStream(
  count: number,
  getItem: (i: number) => StepItem,
  fileName: string,
  out: (chunk: Uint8Array) => void,
  date = new Date(),
): number {
  const w = new Writer(out);
  const stamp = date.toISOString().slice(0, 19);
  w.raw('ISO-10303-21;\nHEADER;\n');
  w.raw(`FILE_DESCRIPTION(('ChipForge - geometrie de copeaux d''usinage (B-Rep NURBS)'),'2;1');\n`);
  w.raw(`FILE_NAME(${str(fileName)},'${stamp}',('ChipForge'),(''),'ChipForge STEP writer','ChipForge 1.0','');\n`);
  w.raw(`FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));\nENDSEC;\nDATA;\n`);

  const appCtx = w.add(`APPLICATION_CONTEXT('core data for automotive mechanical design processes')`);
  w.add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#${appCtx})`);
  const productCtx = w.add(`PRODUCT_CONTEXT('',#${appCtx},'mechanical')`);
  const pdCtx = w.add(`PRODUCT_DEFINITION_CONTEXT('part definition',#${appCtx},'design')`);
  const mm = w.add(`(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))`);
  const rad = w.add(`(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))`);
  const sr = w.add(`(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())`);
  const unc = w.add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-05),#${mm},'distance_accuracy_value','confusion accuracy')`);
  const geomCtx = w.add(
    `(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${unc}))GLOBAL_UNIT_ASSIGNED_CONTEXT((#${mm},#${rad},#${sr}))REPRESENTATION_CONTEXT('Context3D','3D Context with UNIT and UNCERTAINTY'))`,
  );

  // Styles de couleur par groupe de faces
  const styles: Record<string, number> = {};
  for (const [name, rgb] of Object.entries(FACE_COLORS)) styles[name] = writeStyle(w, name, rgb);

  const c: Ctx = { w, geomCtx, productCtx, pdCtx, styles, styled: [], colorStyles: new Map() };

  if (count === 1) {
    const it = getItem(0);
    const { pds } = writeProduct(c, it.name);
    const axis = writeAxis(w);
    const solids = writeSolids(c, it);
    const rep = w.add(`ADVANCED_BREP_SHAPE_REPRESENTATION(${str(it.name)},${refs([axis, ...solids])},#${geomCtx})`);
    w.add(`SHAPE_DEFINITION_REPRESENTATION(#${pds},#${rep})`);
  } else {
    const rootName = fileName.replace(/\.(stp|step)$/i, '') || 'tas_copeaux';
    const root = writeProduct(c, rootName);
    const rootAxis = writeAxis(w);
    const childAxes: number[] = [];
    const children: { pd: number; rep: number; axis: number; name: string }[] = [];
    for (let i = 0; i < count; i++) {
      const it = getItem(i);
      const prod = writeProduct(c, it.name);
      const axis = writeAxis(w);
      const solids = writeSolids(c, it);
      const rep = w.add(`ADVANCED_BREP_SHAPE_REPRESENTATION(${str(it.name)},${refs([axis, ...solids])},#${geomCtx})`);
      w.add(`SHAPE_DEFINITION_REPRESENTATION(#${prod.pds},#${rep})`);
      children.push({ pd: prod.pd, rep, axis, name: it.name });
      childAxes.push(writeAxis(w));
    }
    const rootRep = w.add(`SHAPE_REPRESENTATION(${str(rootName)},${refs([rootAxis, ...childAxes])},#${geomCtx})`);
    w.add(`SHAPE_DEFINITION_REPRESENTATION(#${root.pds},#${rootRep})`);
    children.forEach((ch, k) => {
      const nauo = w.add(`NEXT_ASSEMBLY_USAGE_OCCURRENCE('${k + 1}',${str(ch.name)},'',#${root.pd},#${ch.pd},$)`);
      const pds = w.add(`PRODUCT_DEFINITION_SHAPE('Placement','Placement of an item',#${nauo})`);
      const idt = w.add(`ITEM_DEFINED_TRANSFORMATION('','',#${childAxes[k]},#${ch.axis})`);
      const rel = w.add(
        `(REPRESENTATION_RELATIONSHIP('','',#${ch.rep},#${rootRep})REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#${idt})SHAPE_REPRESENTATION_RELATIONSHIP())`,
      );
      w.add(`CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#${rel},#${pds})`);
    });
  }

  w.add(`MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION('',${refs(c.styled)},#${geomCtx})`);
  w.raw('ENDSEC;\nEND-ISO-10303-21;\n');
  w.flush();
  return w.size;
}

/** Variante en mémoire (tests, petits exports). */
export function writeSTEP(items: StepItem[], fileName: string, date = new Date()): Uint8Array {
  const parts: Uint8Array[] = [];
  writeSTEPStream(items.length, (i) => items[i], fileName, (c) => parts.push(c), date);
  const total = parts.reduce((a, p) => a + p.length, 0);
  const res = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    res.set(p, o);
    o += p.length;
  }
  return res;
}
