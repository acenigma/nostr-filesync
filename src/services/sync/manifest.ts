import * as db from '../db/index';
import * as tombstones from '../tombstones/index';

export const MANIFEST_SCHEMA = 'nostr-filesync.manifest/v1';

export type ManifestEntityType = 'file' | 'folder';

export interface ManifestEntry {
  entityId: string;
  type: ManifestEntityType;
  version: number;
  updatedAt: number;
  deleted?: boolean;
}

export interface Manifest {
  schema: typeof MANIFEST_SCHEMA;
  version: number;
  pubkey: string;
  generatedAt: number;
  entries: ManifestEntry[];
}

export class ManifestError extends Error {
  constructor(
    message: string,
    public readonly code: 'INVALID' | 'SCHEMA_MISMATCH' | 'EMPTY'
  ) {
    super(message);
    this.name = 'ManifestError';
  }
}

function makeManifestVersion(): number {
  return 1;
}

export async function buildManifest(pubkey: string): Promise<Manifest> {
  const files = await db.getAll<db.FileRecord>(db.STORE_FILES);
  const folders = await db.getAll<db.FolderRecord>(db.STORE_FOLDERS);
  const tombs = await tombstones.listTombstones();

  const entries: ManifestEntry[] = [];

  for (const f of files) {
    entries.push({
      entityId: f.fileId,
      type: 'file',
      version: f.version,
      updatedAt: f.updatedAt,
    });
  }

  for (const f of folders) {
    entries.push({
      entityId: f.id,
      type: 'folder',
      version: f.version,
      updatedAt: f.updatedAt,
    });
  }

  for (const t of tombs) {
    entries.push({
      entityId: t.entityId,
      type: t.entityType,
      version: t.version,
      updatedAt: t.deletedAt,
      deleted: true,
    });
  }

  entries.sort((a, b) => a.entityId.localeCompare(b.entityId));

  return {
    schema: MANIFEST_SCHEMA,
    version: makeManifestVersion(),
    pubkey,
    generatedAt: Date.now(),
    entries,
  };
}

export function serializeManifest(manifest: Manifest): string {
  return JSON.stringify(manifest);
}

export function deserializeManifest(json: string): Manifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new ManifestError('JSON inválido', 'INVALID');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new ManifestError('Manifest não é objeto', 'INVALID');
  }
  const m = parsed as Record<string, unknown>;
  if (m.schema !== MANIFEST_SCHEMA) {
    throw new ManifestError(
      `Schema mismatch: esperado ${MANIFEST_SCHEMA}, recebido ${m.schema}`,
      'SCHEMA_MISMATCH'
    );
  }
  if (typeof m.pubkey !== 'string') throw new ManifestError('pubkey ausente', 'INVALID');
  if (typeof m.generatedAt !== 'number') throw new ManifestError('generatedAt ausente', 'INVALID');
  if (typeof m.version !== 'number') throw new ManifestError('version ausente', 'INVALID');
  if (!Array.isArray(m.entries)) throw new ManifestError('entries deve ser array', 'INVALID');
  return m as unknown as Manifest;
}

export function manifestSize(manifest: Manifest): number {
  return manifest.entries.length;
}

export function getEntry(
  manifest: Manifest,
  entityId: string
): ManifestEntry | null {
  return manifest.entries.find((e) => e.entityId === entityId) ?? null;
}

export function isDeleted(manifest: Manifest, entityId: string): boolean {
  // Qualquer entry com deleted=true indica que a entidade foi deletada
  return manifest.entries.some((e) => e.entityId === entityId && e.deleted === true);
}
