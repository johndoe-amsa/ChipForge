import type { ChipMesh } from '../core/geometry/mesh';
import type { QualitySettings } from '../core/params';
import type { RigidTransform } from '../core/export/transform';
import type { ChipSpec, ExportOptions, ExportedFile, WorkerRequest, WorkerResponse } from './protocol';

type Progress = (done: number, total: number) => void;

interface Pending {
  resolve: (v: WorkerResponse) => void;
  reject: (e: Error) => void;
  progress?: Progress;
}

/** Client promesse du worker de géométrie. */
class GeometryWorker {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor() {
    this.worker = new Worker(new URL('./geometry.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data;
      const p = this.pending.get(msg.id);
      if (!p) return;
      if (msg.type === 'progress') {
        p.progress?.(msg.done, msg.total);
        return;
      }
      this.pending.delete(msg.id);
      if (msg.type === 'error') p.reject(new Error(msg.message));
      else p.resolve(msg);
    };
    this.worker.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || 'Erreur du worker'));
      this.pending.clear();
    };
  }

  private send(req: WorkerRequest, progress?: Progress): Promise<WorkerResponse> {
    return new Promise((resolve, reject) => {
      this.pending.set(req.id, { resolve, reject, progress });
      this.worker.postMessage(req);
    });
  }

  /** Renvoie null si la génération a été supplantée par une requête plus récente. */
  async generate(chips: ChipSpec[], quality: QualitySettings, progress?: Progress): Promise<{ meshes: ChipMesh[]; ms: number } | null> {
    const res = await this.send({ type: 'generate', id: this.nextId++, chips, quality }, progress);
    if (res.type === 'generated') return { meshes: res.meshes, ms: res.ms };
    return null;
  }

  async export(
    format: 'obj' | 'step',
    chips: ChipSpec[],
    transforms: RigidTransform[],
    quality: QualitySettings,
    options: ExportOptions,
    progress?: Progress,
  ): Promise<{ file: ExportedFile; stats: { chips: number; quads: number; vertices: number; bytes: number }; ms: number }> {
    const res = await this.send({ type: 'export', id: this.nextId++, format, chips, transforms, quality, options }, progress);
    if (res.type !== 'exported') throw new Error('Export interrompu');
    return { file: res.file, stats: res.stats, ms: res.ms };
  }
}

let preview: GeometryWorker | null = null;
let exporter: GeometryWorker | null = null;

/** Worker dédié à l'aperçu interactif. */
export function previewWorker(): GeometryWorker {
  return (preview ??= new GeometryWorker());
}

/** Worker séparé pour l'export : l'aperçu reste réactif pendant un export long. */
export function exportWorker(): GeometryWorker {
  return (exporter ??= new GeometryWorker());
}
