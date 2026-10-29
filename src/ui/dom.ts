/**
 * Construction DOM minimale et sûre : uniquement createElement / textContent,
 * jamais d'innerHTML (aucune injection possible depuis des données importées).
 */

type Child = Node | string | null | undefined | false;

export interface Props {
  class?: string;
  text?: string;
  title?: string;
  attrs?: Record<string, string>;
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (ev: HTMLElementEventMap[K]) => void }>;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, children: Child[] = []): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.title) el.title = props.title;
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) el.setAttribute(k, v);
  if (props.on) {
    for (const [k, fn] of Object.entries(props.on)) el.addEventListener(k, fn as EventListener);
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Icônes au trait (24 × 24), tracés statiques. */
const ICONS: Record<string, string[]> = {
  dice: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M8 8h.01', 'M16 8h.01', 'M12 12h.01', 'M8 16h.01', 'M16 16h.01'],
  download: ['M12 3v12', 'M7 10l5 5 5-5', 'M5 21h14'],
  upload: ['M12 21V9', 'M7 14l5-5 5 5', 'M5 3h14'],
  save: ['M5 3h11l3 3v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z', 'M8 3v5h8V3', 'M8 21v-7h8v7'],
  frame: ['M4 9V4h5', 'M20 9V4h-5', 'M4 15v5h5', 'M20 15v5h-5', 'M9 12h6', 'M12 9v6'],
  grid: ['M3 9h18', 'M3 15h18', 'M9 3v18', 'M15 3v18', 'M3 3h18v18H3z'],
  axes: ['M4 20V6', 'M4 20h14', 'M4 20l9-9', 'M4 6l-2 3', 'M4 6l2 3', 'M18 20l-3-2', 'M18 20l-3 2'],
  wire: ['M12 2l9 5v10l-9 5-9-5V7z', 'M12 2v20', 'M3 7l18 10', 'M21 7L3 17'],
  checker: ['M3 3h18v18H3z', 'M3 12h18', 'M12 3v18', 'M3 3h9v9H3z', 'M12 12h9v9h-9z'],
  reset: ['M3 12a9 9 0 1 0 3-6.7', 'M3 4v5h5'],
  play: ['M7 4l13 8-13 8z'],
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  sliders: ['M4 6h10', 'M18 6h2', 'M4 18h4', 'M12 18h8', 'M14 4v4', 'M8 16v4', 'M4 12h16'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  info: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 16v-5', 'M12 8h.01'],
  layers: ['M12 3l9 5-9 5-9-5z', 'M3 13l9 5 9-5', 'M3 17.5l9 5 9-5'],
  chip: ['M4 18c4-1 6-4 6-8s2-6 6-6', 'M8 20c4-1 6-4 6-8s2-6 6-6', 'M4 18l4 2', 'M16 4l4 2'],
  check: ['M5 12l5 5L20 7'],
  chevron: ['M9 6l6 6-6 6'],
  alert: ['M12 3l10 18H2z', 'M12 10v4', 'M12 17h.01'],
  // Navigation
  preset: ['M12 2l9 5v10l-9 5-9-5V7z', 'M3 7l9 5 9-5', 'M12 12v10'],
  coil: ['M6 4h12', 'M6 4c-3 1.5-1 4 6 4s9 2.5 6 4-3 4 0 4', 'M18 12c3 1.5 1 4-6 4s-9 2.5-6 4', 'M6 20h12'],
  waves: ['M3 7c3-3 6 3 9 0s6 3 9 0', 'M3 12c3-3 6 3 9 0s6 3 9 0', 'M3 17c3-3 6 3 9 0s6 3 9 0'],
  flame: ['M12 22c4 0 7-3 7-7 0-5-5-7-5-12-3 2-5 5-5 8-1-1-2-2-2-4-2 2-2 5-2 8 0 4 3 7 7 7z', 'M12 22c-1.7 0-3-1.3-3-3 0-2 3-4 3-6 1 2 3 4 3 6 0 1.7-1.3 3-3 3z'],
  keyboard: ['M3 6h18v12H3z', 'M7 10h.01', 'M11 10h.01', 'M15 10h.01', 'M7 14h10'],
  folder: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
  help: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6', 'M12 17h.01'],
  file: ['M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z', 'M14 3v6h6'],
  panel: ['M3 4h18v16H3z', 'M9 4v16'],
  // Sections de paramètres
  section: ['M4 17l3-10h10l3 10z', 'M9 12h6'],
  edge: ['M4 20V11a7 7 0 0 1 7-7h9', 'M8 20v-4', 'M12 20v-2'],
  taper: ['M3 9l18-4v14L3 15z'],
  wave: ['M2 12c2.5-5 5-5 7.5 0s5 5 7.5 0 3.5-3 5-2'],
  noise: ['M3 12h3l2-6 3 12 3-9 2 5 1.5-2H21'],
  // Procédés
  turning: ['M2 8h11v8H2z', 'M13 10h4v4h-4', 'M16 20l2-6h3l-2 6z'],
  groove: ['M3 8h18v8H3z', 'M10 8v4h4V8', 'M12 2v3'],
  milling: ['M9 2h6v3H9z', 'M10 5v11h4V5', 'M10 8l4 2', 'M10 12l4 2', 'M3 20h18', 'M8 20v-2h8v2'],
  drilling: ['M12 2v3', 'M9 5h6v10l-3 5-3-5z', 'M9 8l6 2', 'M9 12l6 2'],
  // Réceptacles du tas
  ground: ['M3 19h18', 'M5 19c1-5 3.5-8 7-8s6 3 7 8'],
  bin: ['M3 7l2 13h14l2-13', 'M2 7h20', 'M8 12c1-2 3-2 4 0s3 2 4 0'],
  pyramid: ['M12 3l9 17H3z', 'M12 3l-2 17'],
  gauge: ['M12 21a9 9 0 1 1 9-9', 'M12 12l4-4', 'M12 12h.01'],
  ingot: ['M3 16l3.5-8h11L21 16z', 'M3 16h18v3H3z'],
  bolt: ['M13 2L4 14h7l-1 8 9-12h-7z'],
  eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  shuffle: ['M16 3h5v5', 'M4 20L21 3', 'M21 16v5h-5', 'M15 15l6 6', 'M4 4l5 5'],
};

export function icon(name: keyof typeof ICONS | string, cls = 'w-4 h-4'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', cls);
  for (const d of ICONS[name] ?? []) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}

/** Téléchargement local d'un fichier généré (aucun envoi réseau). */
export function downloadBytes(data: Uint8Array[] | string, name: string, mime: string): void {
  const parts: BlobPart[] = typeof data === 'string' ? [data] : (data as Uint8Array<ArrayBuffer>[]);
  const blob = new Blob(parts, { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { attrs: { href: url, download: name, rel: 'noopener' } });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function formatCount(n: number): string {
  return Math.round(n).toLocaleString('fr-CH');
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}
