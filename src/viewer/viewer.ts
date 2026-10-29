import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ViewHelper } from 'three/addons/helpers/ViewHelper.js';
import type { ChipMesh } from '../core/geometry/mesh';
import type { RigidTransform } from '../core/export/transform';
import { createMatcap, createUvChecker, MATCAPS } from './textures';
import { temperBase } from '../core/temper';
import { binBoxes, type BinGeometry } from '../core/bin';

/** Teintes des fantômes de l'aperçu de plage (minimum, maximum). */
export const GHOST_MIN = 0x4fb8ff;
export const GHOST_MAX = 0xffa94d;

export type UvPreview = { mode: 'reel' | 'normalise'; scaleMM: number };

interface ChipObject {
  mesh: THREE.Mesh;
  source: ChipMesh;
  wire?: THREE.LineSegments;
}

/** Viewport 3D : MatCap argile, grille d'usinage, axes, filaire et damier UV. */
export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private readonly helper: ViewHelper;
  private readonly root = new THREE.Group();
  /** Bac à copeaux (mode tas) : parois translucides et arêtes. */
  private readonly binGroup = new THREE.Group();
  private readonly binMaterial: THREE.MeshMatcapMaterial;
  private readonly binEdgeMaterial = new THREE.LineBasicMaterial({ color: 0xaab3c2, transparent: true, opacity: 0.55, depthWrite: false });
  private readonly gridGroup = new THREE.Group();
  private readonly axes: THREE.AxesHelper;
  private chips: ChipObject[] = [];
  /** Aperçu de plage : copeaux fantômes translucides (minimum, maximum). */
  private readonly ghostGroup = new THREE.Group();
  private readonly ghostMaterials: THREE.MeshMatcapMaterial[];
  private readonly matcaps = new Map<string, THREE.Texture>();
  private readonly material: THREE.MeshMatcapMaterial;
  /** Même ombrage, teinté par les couleurs de revenu (couleurs de sommets). */
  private readonly colorMaterial: THREE.MeshMatcapMaterial;
  private readonly checker: THREE.Texture;
  private readonly wireMaterial = new THREE.LineBasicMaterial({ color: 0x0b0d10, transparent: true, opacity: 0.45, depthWrite: false });
  private wireframe = false;
  private uvChecker = false;
  private uv: UvPreview = { mode: 'reel', scaleMM: 10 };
  private gridStep = 1;
  private readonly timer = new THREE.Timer();
  private needsRender = true;
  onGridStep?: (minor: number, major: number) => void;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.autoClear = false;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.classList.add('viewport-canvas');
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 20000);
    this.camera.position.set(30, 22, 36);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.addEventListener('change', () => (this.needsRender = true));

    this.helper = new ViewHelper(this.camera, this.renderer.domElement);
    this.helper.location.right = 12;
    this.helper.location.bottom = 12;
    this.renderer.domElement.addEventListener('pointerup', (e) => {
      if (this.helper.handleClick(e)) this.needsRender = true;
    });

    for (const def of MATCAPS) this.matcaps.set(def.id, createMatcap(def));
    this.checker = createUvChecker();
    // Léger décalage de profondeur : le filaire superposé ne scintille pas.
    this.material = new THREE.MeshMatcapMaterial({
      matcap: this.matcaps.get('argile')!,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    this.colorMaterial = this.material.clone();
    this.colorMaterial.vertexColors = true;
    this.binMaterial = new THREE.MeshMatcapMaterial({
      matcap: this.matcaps.get('gris') ?? this.matcaps.get('argile')!,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    // Fantômes : minimum en bleu, maximum en orange (mêmes teintes que les poignées de plage).
    this.ghostMaterials = [GHOST_MIN, GHOST_MAX].map(
      (color) =>
        new THREE.MeshMatcapMaterial({
          matcap: this.matcaps.get('argile')!,
          color,
          transparent: true,
          opacity: 0.32,
          depthWrite: false,
          side: THREE.DoubleSide,
          // Repoussés en profondeur : là où un fantôme coïncide avec le copeau, le copeau l'emporte (pas de scintillement).
          polygonOffset: true,
          polygonOffsetFactor: 4,
          polygonOffsetUnits: 8,
        }),
    );
    this.ghostGroup.renderOrder = 4;

    this.axes = new THREE.AxesHelper(10);
    (this.axes.material as THREE.Material).depthTest = false;
    this.axes.renderOrder = 2;
    this.scene.add(this.gridGroup, this.axes, this.root, this.binGroup, this.ghostGroup);
    this.buildGrid(20);

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  }

  private tick(): void {
    this.timer.update();
    const dt = this.timer.getDelta();
    if (this.helper.animating) {
      this.helper.update(dt);
      this.needsRender = true;
    }
    if (this.controls.update()) this.needsRender = true;
    if (!this.needsRender) return;
    this.needsRender = false;
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.helper.render(this.renderer);
  }

  requestRender(): void {
    this.needsRender = true;
  }

  /** Remplace les copeaux affichés. */
  setChips(meshes: ChipMesh[], transforms: RigidTransform[]): void {
    for (const c of this.chips) {
      c.mesh.geometry.dispose();
      c.wire?.geometry.dispose();
    }
    this.root.clear();
    this.chips = meshes.map((m, i) => {
      const geo = buildGeometry(m, this.uv);
      const mesh = new THREE.Mesh(geo, m.colors ? this.colorMaterial : this.material);
      mesh.matrixAutoUpdate = false;
      const obj: ChipObject = { mesh, source: m };
      if (this.wireframe) this.attachWire(obj);
      this.root.add(mesh);
      this.applyTransform(obj, transforms[i]);
      return obj;
    });
    this.needsRender = true;
  }

  /** Copeaux fantômes de l'aperçu de plage, placés comme le copeau affiché ; [] les retire. */
  setGhosts(meshes: ChipMesh[], transform: RigidTransform | null, visible = 0): void {
    for (const ch of this.ghostGroup.children) (ch as THREE.Mesh).geometry.dispose();
    this.ghostGroup.clear();
    meshes.forEach((m, i) => {
      const mesh = new THREE.Mesh(buildGeometry(m, this.uv), this.ghostMaterials[Math.min(i, this.ghostMaterials.length - 1)]);
      mesh.renderOrder = 4;
      if (transform) {
        mesh.matrixAutoUpdate = false;
        mesh.matrix.compose(new THREE.Vector3(...transform.t), new THREE.Quaternion(...transform.q), new THREE.Vector3(1, 1, 1));
      }
      mesh.visible = i === visible;
      this.ghostGroup.add(mesh);
    });
    this.needsRender = true;
  }

  /** N'affiche que le fantôme d'indice `i` (0 = minimum, 1 = maximum). */
  showGhost(i: number): void {
    this.ghostGroup.children.forEach((g, k) => (g.visible = k === i));
    this.needsRender = true;
  }

  /** Affiche (ou retire avec null) le bac à copeaux. */
  setBin(bin: BinGeometry | null): void {
    for (const ch of this.binGroup.children) (ch as THREE.Mesh | THREE.LineSegments).geometry.dispose();
    this.binGroup.clear();
    if (bin) {
      for (const box of binBoxes(bin)) {
        const geo = new THREE.BoxGeometry(2 * box.half[0], 2 * box.half[1], 2 * box.half[2]);
        const mesh = new THREE.Mesh(geo, this.binMaterial);
        mesh.position.set(...box.center);
        mesh.renderOrder = 3;
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), this.binEdgeMaterial);
        edges.position.copy(mesh.position);
        this.binGroup.add(mesh, edges);
      }
    }
    this.needsRender = true;
  }

  updateTransforms(transforms: RigidTransform[]): void {
    this.chips.forEach((c, i) => this.applyTransform(c, transforms[i]));
    this.needsRender = true;
  }

  private applyTransform(c: ChipObject, t: RigidTransform | undefined): void {
    if (!t) return;
    c.mesh.matrix.compose(new THREE.Vector3(...t.t), new THREE.Quaternion(...t.q), new THREE.Vector3(1, 1, 1));
    c.mesh.matrixWorldNeedsUpdate = true;
  }

  private attachWire(c: ChipObject): void {
    if (!c.wire) {
      c.wire = new THREE.LineSegments(buildWireGeometry(c.source), this.wireMaterial);
      c.wire.renderOrder = 1;
    }
    c.mesh.add(c.wire);
  }

  setMatcap(id: string): void {
    const tex = this.matcaps.get(id);
    if (!tex) return;
    for (const mat of [this.material, this.colorMaterial, ...this.ghostMaterials]) {
      mat.matcap = tex;
      mat.needsUpdate = true;
    }
    this.needsRender = true;
  }

  setWireframe(on: boolean): void {
    this.wireframe = on;
    for (const c of this.chips) {
      if (on) this.attachWire(c);
      else if (c.wire) c.mesh.remove(c.wire);
    }
    this.needsRender = true;
  }

  setUvChecker(on: boolean): void {
    this.uvChecker = on;
    for (const mat of [this.material, this.colorMaterial]) {
      mat.map = on ? this.checker : null;
      mat.needsUpdate = true;
    }
    this.needsRender = true;
  }

  setUvPreview(uv: UvPreview): void {
    this.uv = uv;
    for (const c of this.chips) {
      c.mesh.geometry.setAttribute('uv', new THREE.BufferAttribute(buildUv(c.source, uv), 2));
    }
    this.needsRender = true;
  }

  get uvCheckerEnabled(): boolean {
    return this.uvChecker;
  }

  setGridVisible(on: boolean): void {
    this.gridGroup.visible = on;
    this.needsRender = true;
  }

  setAxesVisible(on: boolean): void {
    this.axes.visible = on;
    this.needsRender = true;
  }

  /** Boîte englobante monde de tous les copeaux. */
  bounds(): THREE.Box3 {
    const box = new THREE.Box3();
    for (const c of this.chips) {
      c.mesh.geometry.computeBoundingBox();
      const b = c.mesh.geometry.boundingBox!.clone().applyMatrix4(c.mesh.matrix);
      box.union(b);
    }
    if (this.binGroup.children.length) box.union(new THREE.Box3().setFromObject(this.binGroup));
    for (const g of this.ghostGroup.children as THREE.Mesh[]) {
      if (!g.visible) continue;
      g.geometry.computeBoundingBox();
      box.union(g.geometry.boundingBox!.clone().applyMatrix4(g.matrix));
    }
    return box;
  }

  /** Recadre la caméra sur la scène et adapte la grille. */
  frame(keepDirection = true): void {
    const box = this.bounds();
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const r = Math.max(sphere.radius, 0.5);
    const dir = keepDirection
      ? this.camera.position.clone().sub(this.controls.target).normalize()
      : new THREE.Vector3(0.75, 0.62, 1).normalize();
    if (!Number.isFinite(dir.x) || dir.lengthSq() < 0.5) dir.set(0.75, 0.62, 1).normalize();
    const fov = (this.camera.fov * Math.PI) / 180;
    const dist = (r / Math.sin(fov / 2)) * 1.15;
    this.controls.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).addScaledVector(dir, dist);
    this.camera.near = Math.max(dist / 2000, 0.002);
    this.camera.far = dist * 50;
    this.camera.updateProjectionMatrix();
    this.helper.center.copy(this.controls.target);
    this.controls.update();
    const ext = Math.max(box.max.x - box.min.x, box.max.z - box.min.z, 1e-3);
    this.buildGrid(ext);
    this.axes.scale.setScalar(Math.max(r * 0.6, 0.5) / 10);
    this.needsRender = true;
  }

  /** Grille adaptative : pas mineur 1-2-5 × 10ⁿ mm, lignes majeures tous les 10 pas. */
  private buildGrid(extent: number): void {
    const target = extent / 12;
    const pow = Math.pow(10, Math.floor(Math.log10(target)));
    const minor = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= target) ?? 10 * pow;
    if (minor === this.gridStep && this.gridGroup.children.length) return;
    this.gridStep = minor;
    const major = minor * 10;
    const half = Math.ceil((extent * 2.2) / major) * major;
    for (const ch of this.gridGroup.children) (ch as THREE.LineSegments).geometry.dispose();
    this.gridGroup.clear();
    const minorPts: number[] = [];
    const majorPts: number[] = [];
    const n = Math.round(half / minor);
    for (let k = -n; k <= n; k++) {
      const v = k * minor;
      const arr = k % 10 === 0 ? majorPts : minorPts;
      if (k === 0) continue;
      arr.push(v, 0, -half, v, 0, half, -half, 0, v, half, 0, v);
    }
    const mk = (pts: number[], color: number, opacity: number) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
      return new THREE.LineSegments(g, m);
    };
    this.gridGroup.add(mk(minorPts, 0x8a93a3, 0.12), mk(majorPts, 0x9aa4b5, 0.3));
    // Axes X (rouge) et Z (bleu) sur le plan
    this.gridGroup.add(mk([-half, 0, 0, half, 0, 0], 0xd9534f, 0.55), mk([0, 0, -half, 0, 0, half], 0x4a7fd6, 0.55));
    this.onGridStep?.(minor, major);
    this.needsRender = true;
  }

  /** Statistiques de l'aperçu. */
  stats(): { chips: number; quads: number; triangles: number; vertices: number } {
    let quads = 0;
    let vertices = 0;
    for (const c of this.chips) {
      quads += c.source.quads.length / 4;
      vertices += c.source.positions.length / 3;
    }
    return { chips: this.chips.length, quads, triangles: quads * 2, vertices };
  }
}

function buildUv(m: ChipMesh, uv: UvPreview): Float32Array {
  if (uv.mode === 'normalise') return m.uv01.slice();
  const k = 1 / Math.max(1e-6, uv.scaleMM);
  const out = new Float32Array(m.uvMM.length);
  for (let i = 0; i < out.length; i++) out[i] = m.uvMM[i] * k;
  return out;
}

function buildGeometry(m: ChipMesh, uv: UvPreview): THREE.BufferGeometry {
  const V = m.vPos.length;
  const pos = new Float32Array(V * 3);
  const nrm = new Float32Array(V * 3);
  for (let v = 0; v < V; v++) {
    const p = m.vPos[v] * 3;
    const n = m.vNrm[v] * 3;
    pos[v * 3] = m.positions[p];
    pos[v * 3 + 1] = m.positions[p + 1];
    pos[v * 3 + 2] = m.positions[p + 2];
    nrm[v * 3] = m.normals[n];
    nrm[v * 3 + 1] = m.normals[n + 1];
    nrm[v * 3 + 2] = m.normals[n + 2];
  }
  const nq = m.quads.length / 4;
  const index = new Uint32Array(nq * 6);
  for (let q = 0; q < nq; q++) {
    const a = m.quads[q * 4];
    const b = m.quads[q * 4 + 1];
    const c = m.quads[q * 4 + 2];
    const d = m.quads[q * 4 + 3];
    const o = q * 6;
    index[o] = a;
    index[o + 1] = b;
    index[o + 2] = c;
    index[o + 3] = a;
    index[o + 4] = c;
    index[o + 5] = d;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(buildUv(m, uv), 2));
  if (m.colors && m.temper) g.setAttribute('color', new THREE.BufferAttribute(buildTint(m, m.colors, m.temper.chart), 3));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeBoundingSphere();
  return g;
}

/**
 * Teinte d'aperçu : couleur de revenu rapportée à celle du métal nu (en linéaire), pour que le
 * MatCap garde son aspect là où le copeau n'est pas oxydé.
 */
function buildTint(m: ChipMesh, colors: Float32Array, chart: Parameters<typeof temperBase>[0]): Float32Array {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const base = temperBase(chart).map(lin);
  const V = m.vPos.length;
  const out = new Float32Array(V * 3);
  for (let v = 0; v < V; v++) {
    const p = m.vPos[v] * 3;
    for (let c = 0; c < 3; c++) out[v * 3 + c] = Math.min(1.25, lin(colors[p + c]) / Math.max(1e-3, base[c]));
  }
  return out;
}

/** Arêtes des quads (et non des triangles) pour un filaire lisible. */
function buildWireGeometry(m: ChipMesh): THREE.BufferGeometry {
  const P = m.positions.length / 3;
  const seen = new Set<number>();
  const pts: number[] = [];
  const nq = m.quads.length / 4;
  for (let q = 0; q < nq; q++) {
    for (let k = 0; k < 4; k++) {
      const a = m.vPos[m.quads[q * 4 + k]];
      const b = m.vPos[m.quads[q * 4 + ((k + 1) % 4)]];
      const key = a < b ? a * P + b : b * P + a;
      if (seen.has(key)) continue;
      seen.add(key);
      pts.push(m.positions[a * 3], m.positions[a * 3 + 1], m.positions[a * 3 + 2], m.positions[b * 3], m.positions[b * 3 + 1], m.positions[b * 3 + 2]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
}
