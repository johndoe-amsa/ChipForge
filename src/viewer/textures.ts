import * as THREE from 'three';

/**
 * Textures générées localement (aucun fichier externe) :
 * MatCaps neutres pour lire les reliefs, damier pour contrôler les UVs.
 */

export interface MatcapDef {
  id: string;
  label: string;
  base: [number, number, number];
  lights: { dir: [number, number, number]; power: number; color?: [number, number, number] }[];
  ambient: number;
  spec: number;
  shininess: number;
  rim: number;
  horizon?: number;
}

export const MATCAPS: MatcapDef[] = [
  {
    id: 'argile',
    label: 'Argile',
    base: [0.66, 0.63, 0.6],
    lights: [
      { dir: [-0.5, 0.65, 0.6], power: 0.85 },
      { dir: [0.7, -0.2, 0.4], power: 0.25 },
    ],
    ambient: 0.16,
    spec: 0.12,
    shininess: 18,
    rim: 0.12,
  },
  {
    id: 'gris',
    label: 'Gris studio',
    base: [0.6, 0.6, 0.61],
    lights: [
      { dir: [-0.35, 0.7, 0.62], power: 0.75 },
      { dir: [0.8, 0.1, 0.5], power: 0.35 },
      { dir: [0, -0.9, 0.3], power: 0.12 },
    ],
    ambient: 0.14,
    spec: 0.25,
    shininess: 40,
    rim: 0.18,
  },
  {
    id: 'metal',
    label: 'Métal satiné',
    base: [0.5, 0.51, 0.53],
    lights: [
      { dir: [-0.4, 0.75, 0.5], power: 0.55 },
      { dir: [0.75, 0.3, 0.55], power: 0.3 },
    ],
    ambient: 0.1,
    spec: 0.85,
    shininess: 70,
    rim: 0.3,
    horizon: 0.35,
  },
  {
    id: 'relief',
    label: 'Relief rasant',
    base: [0.62, 0.62, 0.62],
    lights: [{ dir: [-0.92, 0.25, 0.3], power: 1.1 }],
    ambient: 0.06,
    spec: 0.08,
    shininess: 12,
    rim: 0.05,
  },
];

function norm(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

export function createMatcap(def: MatcapDef, size = 256): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const img = g.createImageData(size, size);
  const lights = def.lights.map((l) => ({ ...l, dir: norm(l.dir) }));
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = ((px + 0.5) / size) * 2 - 1;
      const y = 1 - ((py + 0.5) / size) * 2;
      const r2 = x * x + y * y;
      const o = (py * size + px) * 4;
      if (r2 > 1) {
        // Bord : prolonge la dernière couleur pour éviter les liserés.
        const k = 1 / Math.sqrt(r2);
        shade(x * k * 0.999, y * k * 0.999, o);
      } else shade(x, y, o);
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;

  function shade(x: number, y: number, o: number): void {
    const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
    let r = def.ambient;
    let gg = def.ambient;
    let b = def.ambient;
    let spec = 0;
    for (const l of lights) {
      const ndl = Math.max(0, x * l.dir[0] + y * l.dir[1] + z * l.dir[2]);
      const c = l.color ?? [1, 1, 1];
      // Lambert enveloppé : ombres douces type argile
      const d = Math.pow((ndl + 0.15) / 1.15, 1.2) * l.power;
      r += d * c[0];
      gg += d * c[1];
      b += d * c[2];
      // Blinn-Phong avec la vue selon +Z
      const hx = l.dir[0];
      const hy = l.dir[1];
      const hz = l.dir[2] + 1;
      const hl = Math.hypot(hx, hy, hz);
      const ndh = Math.max(0, (x * hx + y * hy + z * hz) / hl);
      spec += Math.pow(ndh, def.shininess) * l.power;
    }
    const rim = Math.pow(1 - z, 3) * def.rim;
    let hor = 0;
    if (def.horizon) hor = def.horizon * Math.exp(-Math.pow((y + 0.1) * 6, 2)) * (0.6 + 0.4 * z);
    const out = [
      def.base[0] * r + spec * def.spec + rim + hor,
      def.base[1] * gg + spec * def.spec + rim + hor,
      def.base[2] * b + spec * def.spec + rim + hor,
    ];
    for (let k = 0; k < 3; k++) {
      // Conversion linéaire → sRGB approchée (gamma 2.2)
      img.data[o + k] = Math.round(255 * Math.pow(Math.min(1, Math.max(0, out[k])), 1 / 2.2));
    }
    img.data[o + 3] = 255;
  }
}

/** Damier UV 8×8 avec dégradé de couleur et repères d'orientation. */
export function createUvChecker(size = 512): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const n = 8;
  const cell = size / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const hue = (i / n) * 300;
      const light = (i + j) % 2 === 0 ? 62 : 38;
      g.fillStyle = `hsl(${hue.toFixed(0)}, 45%, ${light}%)`;
      g.fillRect(i * cell, (n - 1 - j) * cell, cell, cell);
    }
  }
  g.strokeStyle = 'rgba(255,255,255,0.65)';
  g.lineWidth = 2;
  g.strokeRect(1, 1, size - 2, size - 2);
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.font = `bold ${Math.round(cell * 0.32)}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      g.fillText(`${String.fromCharCode(65 + i)}${j + 1}`, i * cell + cell / 2, (n - 1 - j) * cell + cell / 2);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}
