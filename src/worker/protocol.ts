import type { ChipParams, QualitySettings } from '../core/params';
import type { ChipMesh } from '../core/geometry/mesh';
import type { RigidTransform } from '../core/export/transform';
import type { LengthUnit, UvMode } from '../core/export/obj';
import type { BinGeometry } from '../core/bin';

export interface ChipSpec {
  name: string;
  params: ChipParams;
  seed: number;
}

export interface ExportOptions {
  unit: LengthUnit;
  uvMode: UvMode;
  uvScaleMM: number;
  baseName: string;
  /** Bac à copeaux à exporter avec le tas, ou null. */
  bin: BinGeometry | null;
}

export type WorkerRequest =
  | { type: 'generate'; id: number; chips: ChipSpec[]; quality: QualitySettings }
  | {
      type: 'export';
      id: number;
      format: 'obj' | 'step';
      chips: ChipSpec[];
      transforms: RigidTransform[];
      quality: QualitySettings;
      options: ExportOptions;
    };

export interface ExportedFile {
  name: string;
  mime: string;
  /** Contenu en blocs (assemblés en Blob côté interface, sans copie géante). */
  parts: Uint8Array[];
  size: number;
}

export type WorkerResponse =
  | { type: 'progress'; id: number; done: number; total: number }
  | { type: 'generated'; id: number; meshes: ChipMesh[]; ms: number }
  | { type: 'exported'; id: number; file: ExportedFile; stats: { chips: number; quads: number; vertices: number; bytes: number }; ms: number }
  | { type: 'cancelled'; id: number }
  | { type: 'error'; id: number; message: string };

/** Tableaux transférables d'un maillage (zéro copie entre threads). */
export function meshTransferables(m: ChipMesh): ArrayBuffer[] {
  const arrays: ArrayBufferView[] = [m.positions, m.normals, m.vPos, m.vNrm, m.uvMM, m.uv01, m.quads, m.groups, m.colliders, m.bounds];
  if (m.colors) arrays.push(m.colors);
  return arrays.map((a) => a.buffer as ArrayBuffer);
}
