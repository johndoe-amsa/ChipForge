/// <reference lib="webworker" />
import { Zip, ZipDeflate, strToU8 } from 'fflate';
import { buildChipGrid } from '../core/geometry/chip';
import { gridToMesh, type ChipMesh } from '../core/geometry/mesh';
import { ObjWriter, writeMTL } from '../core/export/obj';
import { writeSTEPStream, type StepItem } from '../core/export/step';
import { safeFileName } from '../core/export/transform';
import { sanitizeParams } from '../core/params';
import { meshTransferables, type ExportedFile, type WorkerRequest, type WorkerResponse } from './protocol';
import { binBoxes, type BinGeometry } from '../core/bin';

/** Dimensions de bac reçues : nombres finis et bornés, sinon pas de bac. */
function cleanBin(b: BinGeometry | null | undefined): BinGeometry | null {
  if (!b) return null;
  const ok = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 10000;
  return ok(b.length) && ok(b.width) && ok(b.height) && ok(b.wall) ? { length: b.length, width: b.width, height: b.height, wall: b.wall } : null;
}

/**
 * Worker de génération : maillages d'aperçu et fichiers d'export, hors du thread d'interface.
 * Une nouvelle requête de génération annule la précédente (vérifiée entre deux copeaux).
 */

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let latestGenerate = 0;

const post = (msg: WorkerResponse, transfer: Transferable[] = []) => ctx.postMessage(msg, transfer);
const yieldToEvents = () => new Promise<void>((r) => setTimeout(r, 0));

ctx.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  if (!req || typeof req !== 'object') return;
  if (req.type === 'generate') {
    latestGenerate = req.id;
    void generate(req).catch((e) => post({ type: 'error', id: req.id, message: String(e?.message ?? e) }));
  } else if (req.type === 'export') {
    void exportFile(req).catch((e) => post({ type: 'error', id: req.id, message: String(e?.message ?? e) }));
  }
};

async function generate(req: Extract<WorkerRequest, { type: 'generate' }>): Promise<void> {
  const t0 = performance.now();
  const meshes: ChipMesh[] = [];
  for (let i = 0; i < req.chips.length; i++) {
    if (i > 0) {
      await yieldToEvents();
      if (req.id !== latestGenerate) {
        post({ type: 'cancelled', id: req.id });
        return;
      }
      post({ type: 'progress', id: req.id, done: i, total: req.chips.length });
    }
    const c = req.chips[i];
    meshes.push(gridToMesh(buildChipGrid(sanitizeParams(c.params), c.seed >>> 0, req.quality)));
  }
  if (req.id !== latestGenerate) {
    post({ type: 'cancelled', id: req.id });
    return;
  }
  post({ type: 'generated', id: req.id, meshes, ms: performance.now() - t0 }, meshes.flatMap(meshTransferables));
}

async function exportFile(req: Extract<WorkerRequest, { type: 'export' }>): Promise<void> {
  const t0 = performance.now();
  const base = safeFileName(req.options.baseName);
  const total = req.chips.length;
  const bin = cleanBin(req.options.bin);
  const parts: Uint8Array[] = [];
  let quads = 0;
  let vertices = 0;
  let rawBytes = 0;
  const progress = (i: number) => post({ type: 'progress', id: req.id, done: i, total });

  if (req.format === 'obj') {
    // Archive ZIP produite en flux : chaque copeau est maillé, écrit, compressé puis libéré.
    let zipError: Error | null = null;
    const zip = new Zip((err, chunk) => {
      if (err) zipError = err;
      else parts.push(chunk);
    });
    const mtlName = `${base}.mtl`;
    const objEntry = new ZipDeflate(`${base}.obj`, { level: 6 });
    zip.add(objEntry);
    const writer = new ObjWriter({ ...req.options, mtlName }, (chunk) => objEntry.push(chunk, false));
    for (let i = 0; i < total; i++) {
      const c = req.chips[i];
      const mesh = gridToMesh(buildChipGrid(sanitizeParams(c.params), c.seed >>> 0, req.quality));
      quads += mesh.quads.length / 4;
      vertices += mesh.positions.length / 3;
      writer.add({ name: safeFileName(c.name, `copeau_${i + 1}`), mesh, transform: req.transforms[i] });
      progress(i + 1);
      await yieldToEvents();
    }
    if (bin) writer.addBoxes('bac', binBoxes(bin));
    writer.finish();
    rawBytes = writer.bytesWritten;
    objEntry.push(new Uint8Array(0), true);
    const mtl = new ZipDeflate(mtlName, { level: 6 });
    zip.add(mtl);
    mtl.push(strToU8(writeMTL(writer.temperMaterials.values(), writer.hasBin)), true);
    zip.end();
    if (zipError) throw zipError;
    finish({ name: `${base}.zip`, mime: 'application/zip', parts, size: parts.reduce((a, p) => a + p.length, 0) });
    return;
  }

  const getItem = (i: number): StepItem => {
    if (i >= total) return { name: 'bac', boxes: binBoxes(bin!) };
    const c = req.chips[i];
    const grid = buildChipGrid(sanitizeParams(c.params), c.seed >>> 0, req.quality);
    quads += (grid.rings - 1) * grid.M;
    vertices += grid.rings * grid.M;
    progress(i + 1);
    return { name: safeFileName(c.name, `copeau_${i + 1}`), grid, transform: req.transforms[i] };
  };
  rawBytes = writeSTEPStream(total + (bin ? 1 : 0), getItem, `${base}.stp`, (chunk) => parts.push(chunk));
  finish({ name: `${base}.stp`, mime: 'application/step', parts, size: rawBytes });

  function finish(file: ExportedFile): void {
    post(
      {
        type: 'exported',
        id: req.id,
        file,
        stats: { chips: total, quads, vertices, bytes: rawBytes },
        ms: performance.now() - t0,
      },
      // Plusieurs blocs peuvent partager le même tampon : transfert dédoublonné.
      [...new Set(file.parts.map((p) => p.buffer as ArrayBuffer))],
    );
  }
}
