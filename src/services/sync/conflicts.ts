import type { FileRecord } from '../db/index';
import type { Manifest, ManifestEntry } from './manifest';

export type ConflictStrategy = 'KEEP_BOTH' | 'LAST_WRITE_WINS' | 'MANUAL';

export interface ConflictInfo {
  entityId: string;
  entityType: 'file' | 'folder';
  localVersion: number;
  remoteVersion: number;
  localUpdatedAt: number;
  remoteUpdatedAt: number;
  baseVersion: number | null;
}

export function detectConflicts(
  local: Manifest,
  remote: Manifest,
  base: Manifest
): ConflictInfo[] {
  const baseMap = new Map<string, ManifestEntry>();
  for (const e of base.entries) baseMap.set(e.entityId, e);

  const localMap = new Map<string, ManifestEntry>();
  for (const e of local.entries) localMap.set(e.entityId, e);

  const remoteMap = new Map<string, ManifestEntry>();
  for (const e of remote.entries) remoteMap.set(e.entityId, e);

  const conflicts: ConflictInfo[] = [];

  for (const [entityId, localEntry] of localMap) {
    if (localEntry.deleted) continue;
    const remoteEntry = remoteMap.get(entityId);
    if (!remoteEntry || remoteEntry.deleted) continue;
    const baseEntry = baseMap.get(entityId);

    const localChanged = !baseEntry || localEntry.version > baseEntry.version;
    const remoteChanged = !baseEntry || remoteEntry.version > baseEntry.version;

    if (localChanged && remoteChanged) {
      conflicts.push({
        entityId,
        entityType: localEntry.type,
        localVersion: localEntry.version,
        remoteVersion: remoteEntry.version,
        localUpdatedAt: localEntry.updatedAt,
        remoteUpdatedAt: remoteEntry.updatedAt,
        baseVersion: baseEntry?.version ?? null,
      });
    }
  }

  return conflicts;
}

export interface ResolutionResult {
  action: 'keep-local' | 'keep-remote' | 'keep-both' | 'manual';
  fileId?: string;
}

export async function resolveConflict(
  strategy: ConflictStrategy,
  _entityId: string,
  local: FileRecord,
  remote: { fileId: string; name: string; size: number; contentHash: string }
): Promise<ResolutionResult> {
  switch (strategy) {
    case 'LAST_WRITE_WINS': {
      const localIsNewer = local.updatedAt >= Date.now();
      return {
        action: localIsNewer ? 'keep-local' : 'keep-remote',
        fileId: localIsNewer ? local.fileId : remote.fileId,
      };
    }
    case 'KEEP_BOTH': {
      // Cria uma cópia do remote com nome modificado
      return { action: 'keep-both', fileId: remote.fileId };
    }
    case 'MANUAL':
      return { action: 'manual' };
  }
}

export function defaultStrategy(entityType: 'file' | 'folder', mimeType?: string): ConflictStrategy {
  if (entityType === 'folder') return 'LAST_WRITE_WINS';
  // Para arquivos binários, KEEP_BOTH é mais seguro
  if (mimeType && !mimeType.startsWith('text/') && mimeType !== 'application/json') {
    return 'KEEP_BOTH';
  }
  return 'LAST_WRITE_WINS';
}
