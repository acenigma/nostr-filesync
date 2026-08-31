import * as db from '../db/index';
import * as tombstones from '../tombstones/index';
import * as fileEntity from '../file-entity/index';
import * as folders from '../folders/index';
import type { Manifest, ManifestEntry } from './manifest';

export interface ApplyResult {
  applied: number;
  skipped: number;
  errors: string[];
}

export async function applyRemoteTombstone(
  entry: ManifestEntry
): Promise<{ applied: boolean; reason?: string }> {
  if (!entry.deleted) {
    return { applied: false, reason: 'not-deleted' };
  }

  if (entry.type === 'file') {
    const existing = await fileEntity.getFile(entry.entityId);
    if (existing) {
      await fileEntity.deleteFile(entry.entityId);
    }
  } else if (entry.type === 'folder') {
    const existing = await folders.getFolder(entry.entityId);
    if (existing) {
      await folders.deleteFolder(entry.entityId);
    }
  }

  await tombstones.createTombstone({
    entityId: entry.entityId,
    entityType: entry.type,
    deletedBy: 'remote-sync',
    reason: 'sync',
  });

  return { applied: true };
}

export async function applyRemoteTombstones(
  entries: ManifestEntry[]
): Promise<ApplyResult> {
  const result: ApplyResult = {
    applied: 0,
    skipped: 0,
    errors: [],
  };

  for (const entry of entries) {
    if (!entry.deleted) continue;
    try {
      const res = await applyRemoteTombstone(entry);
      if (res.applied) result.applied++;
      else result.skipped++;
    } catch (e) {
      result.errors.push(`${entry.entityId}: ${(e as Error).message}`);
    }
  }

  return result;
}

export async function collectTombstonesForPush(
  local: Manifest
): Promise<ManifestEntry[]> {
  return local.entries.filter((e) => e.deleted);
}

export async function pruneExpiredTombstones(
  maxAgeMs: number = 7 * 24 * 60 * 60 * 1000
): Promise<{ removed: number; remaining: number }> {
  return tombstones.pruneOldTombstones(maxAgeMs);
}

export async function syncTombstones(
  remote: Manifest
): Promise<{
  applied: ApplyResult;
  toPush: ManifestEntry[];
}> {
  const remoteTombstones = remote.entries.filter((e) => e.deleted);
  const applied = await applyRemoteTombstones(remoteTombstones);

  const localTombstones = await tombstones.listTombstones();
  const localTombIds = new Set(
    localTombstones.map((t) => `${t.entityType}:${t.entityId}`)
  );
  const toPush = remoteTombstones.filter((e) => {
    const key = `${e.type}:${e.entityId}`;
    return !localTombIds.has(key);
  });

  return { applied, toPush };
}

export { db };
