import { sanitizeParams, type ChipParams } from '../core/params';
import { DEFAULT_PILE, FORMS, MAX_PILE_COUNT, MATERIALS, PROCESSES, SHORTCUTS, type PileSettings, type PresetSelection } from '../core/presets/presets';
import { PYRAMID_SLOPE_RANGE } from '../core/pyramid';

/**
 * Presets personnels au format JSON.
 * L'import est strictement validé : seules les clés connues sont lues, les valeurs sont
 * bornées, les identifiants vérifiés contre les listes internes. Rien n'est jamais exécuté
 * ni injecté dans le DOM.
 */

export const PRESET_FORMAT = 'chipforge-preset';
export const PRESET_VERSION = 1;
export const MAX_PRESET_BYTES = 256 * 1024;

export interface PresetFile {
  format: typeof PRESET_FORMAT;
  version: number;
  name: string;
  createdAt: string;
  selection: PresetSelection;
  params: ChipParams;
  seed: number;
  mode: 'unique' | 'tas';
  pile: PileSettings;
}

export function serializePreset(data: Omit<PresetFile, 'format' | 'version' | 'createdAt'>): string {
  const file: PresetFile = { format: PRESET_FORMAT, version: PRESET_VERSION, createdAt: new Date().toISOString(), ...data };
  return JSON.stringify(file, null, 2);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const own = (o: Record<string, unknown>, k: string) => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

function cleanName(v: unknown): string {
  if (typeof v !== 'string') return 'Preset importé';
  // Caractères imprimables uniquement, longueur bornée
  return v.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 60) || 'Preset importé';
}

function pickId(v: unknown, list: { id: string }[], fallback: string): string {
  return typeof v === 'string' && list.some((x) => x.id === v) ? v : fallback;
}

export function parsePreset(text: string, fallbackParams: ChipParams, fallbackSel: PresetSelection): PresetFile {
  if (text.length > MAX_PRESET_BYTES) throw new Error('Fichier trop volumineux pour un preset.');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Ce fichier n'est pas un JSON valide.");
  }
  if (!isObj(raw) || own(raw, 'format') !== PRESET_FORMAT) throw new Error("Ce fichier n'est pas un preset ChipForge.");
  const version = own(raw, 'version');
  if (typeof version !== 'number' || version > PRESET_VERSION) throw new Error('Version de preset non prise en charge.');

  const selRaw = own(raw, 'selection');
  const sel = isObj(selRaw) ? selRaw : {};
  const shortcut = own(sel, 'shortcut');
  const selection: PresetSelection = {
    material: pickId(own(sel, 'material'), MATERIALS, fallbackSel.material),
    process: pickId(own(sel, 'process'), PROCESSES, fallbackSel.process),
    form: pickId(own(sel, 'form'), FORMS, fallbackSel.form),
    shortcut: typeof shortcut === 'string' && SHORTCUTS.some((s) => s.id === shortcut) ? shortcut : undefined,
  };

  const seedRaw = own(raw, 'seed');
  const seed = typeof seedRaw === 'number' && Number.isFinite(seedRaw) ? Math.floor(Math.abs(seedRaw)) % 4294967296 : 1;

  const pileRaw = own(raw, 'pile');
  const pr = isObj(pileRaw) ? pileRaw : {};
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  const pile: PileSettings = {
    count: Math.round(num(own(pr, 'count'), 1, MAX_PILE_COUNT, DEFAULT_PILE.count)),
    variability: num(own(pr, 'variability'), 0, 1, DEFAULT_PILE.variability),
    spread: num(own(pr, 'spread'), 0, 2000, DEFAULT_PILE.spread),
    physics: bool(own(pr, 'physics'), DEFAULT_PILE.physics),
    container: own(pr, 'container') === 'bac' ? 'bac' : own(pr, 'container') === 'pyramide' ? 'pyramide' : 'sol',
    pyramidSlope: num(own(pr, 'pyramidSlope'), PYRAMID_SLOPE_RANGE[0], PYRAMID_SLOPE_RANGE[1], DEFAULT_PILE.pyramidSlope),
    binLength: num(own(pr, 'binLength'), 0, 2000, DEFAULT_PILE.binLength),
    binWidth: num(own(pr, 'binWidth'), 0, 2000, DEFAULT_PILE.binWidth),
    binHeight: num(own(pr, 'binHeight'), 0, 2000, DEFAULT_PILE.binHeight),
    exportBin: bool(own(pr, 'exportBin'), DEFAULT_PILE.exportBin),
  };

  return {
    format: PRESET_FORMAT,
    version: PRESET_VERSION,
    name: cleanName(own(raw, 'name')),
    createdAt: typeof own(raw, 'createdAt') === 'string' ? String(own(raw, 'createdAt')).slice(0, 40) : '',
    selection,
    params: sanitizeParams(own(raw, 'params'), fallbackParams),
    seed,
    mode: own(raw, 'mode') === 'tas' ? 'tas' : 'unique',
    pile,
  };
}
