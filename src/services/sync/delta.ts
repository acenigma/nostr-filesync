import type { Manifest, ManifestEntry } from './manifest';

export interface DeltaResult {
  toAdd: ManifestEntry[];
  toUpdate: ManifestEntry[];
  toDelete: ManifestEntry[];
  unchanged: ManifestEntry[];
}

export function computeDelta(local: Manifest, remote: Manifest): DeltaResult {
  const localMap = new Map<string, ManifestEntry>();
  for (const e of local.entries) localMap.set(e.entityId, e);
  const remoteMap = new Map<string, ManifestEntry>();
  for (const e of remote.entries) remoteMap.set(e.entityId, e);

  const toAdd: ManifestEntry[] = [];
  const toUpdate: ManifestEntry[] = [];
  const toDelete: ManifestEntry[] = [];
  const unchanged: ManifestEntry[] = [];

  // Remote → local: add ou update
  for (const [entityId, remoteEntry] of remoteMap) {
    if (remoteEntry.deleted) {
      // Tombstone no remote
      const localEntry = localMap.get(entityId);
      if (localEntry && !localEntry.deleted) {
        toDelete.push(remoteEntry);
      }
      continue;
    }
    const localEntry = localMap.get(entityId);
    if (!localEntry) {
      toAdd.push(remoteEntry);
    } else if (localEntry.deleted) {
      // Local tem tombstone mas remote quer ressuscitar
      toAdd.push(remoteEntry);
    } else if (remoteEntry.version > localEntry.version) {
      toUpdate.push(remoteEntry);
    } else {
      unchanged.push(remoteEntry);
    }
  }

  // Local → remote: entidades que existem localmente mas não no remote
  for (const [entityId, localEntry] of localMap) {
    if (localEntry.deleted) continue;
    if (!remoteMap.has(entityId)) {
      // Local tem, remote não — remote precisa adicionar
      toAdd.push(localEntry);
    }
  }

  return { toAdd, toUpdate, toDelete, unchanged };
}

export function deltaStats(delta: DeltaResult): {
  toAdd: number;
  toUpdate: number;
  toDelete: number;
  unchanged: number;
} {
  return {
    toAdd: delta.toAdd.length,
    toUpdate: delta.toUpdate.length,
    toDelete: delta.toDelete.length,
    unchanged: delta.unchanged.length,
  };
}

export function isEmpty(delta: DeltaResult): boolean {
  return (
    delta.toAdd.length === 0 &&
    delta.toUpdate.length === 0 &&
    delta.toDelete.length === 0
  );
}
