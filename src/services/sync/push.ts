import type { Manifest, ManifestEntry } from './manifest';
import { computeDelta } from './delta';
import * as queue from './queue';

export interface PushPlan {
  toCreate: ManifestEntry[];
  toUpdate: ManifestEntry[];
  toDelete: ManifestEntry[];
  toSkip: ManifestEntry[];
}

export function planPush(local: Manifest, remote: Manifest): PushPlan {
  // Push: o que local tem e remote não (ou tem versão menor)
  const delta = computeDelta(remote, local);
  const toCreate: ManifestEntry[] = [];
  const toUpdate: ManifestEntry[] = [];
  const toDelete: ManifestEntry[] = [];
  const toSkip: ManifestEntry[] = [];

  for (const entry of delta.toAdd) {
    if (entry.deleted) {
      toDelete.push(entry);
    } else {
      toCreate.push(entry);
    }
  }
  for (const entry of delta.toUpdate) {
    toUpdate.push(entry);
  }
  for (const _entry of delta.toDelete) {
    // Remote tem, local não: nada a fazer no push
  }
  for (const entry of delta.unchanged) {
    toSkip.push(entry);
  }

  // Tombstones em local: precisam ser enviados como delete para remote
  for (const localEntry of local.entries) {
    if (localEntry.deleted && !toDelete.find((d) => d.entityId === localEntry.entityId)) {
      toDelete.push(localEntry);
    }
  }

  return { toCreate, toUpdate, toDelete, toSkip };
}

export type EventPublisher = (
  entry: ManifestEntry,
  type: 'CREATE' | 'UPDATE' | 'DELETE'
) => Promise<string>;

export interface PushResult {
  enqueued: number;
  published: number;
  failed: number;
}

export async function executePush(
  plan: PushPlan,
  publisher: EventPublisher,
  entityTypeFallback: 'file' | 'folder' = 'file'
): Promise<PushResult> {
  const result: PushResult = {
    enqueued: 0,
    published: 0,
    failed: 0,
  };

  for (const entry of plan.toCreate) {
    const opType: 'CREATE' | 'UPDATE' = 'CREATE';
    await queue.enqueue({
      type: opType,
      entityId: entry.entityId,
      entityType: entry.type || entityTypeFallback,
      payload: { manifestEntry: entry },
    });
    result.enqueued++;

    try {
      await publisher(entry, opType);
      result.published++;
    } catch {
      result.failed++;
    }
  }

  for (const entry of plan.toUpdate) {
    await queue.enqueue({
      type: 'UPDATE',
      entityId: entry.entityId,
      entityType: entry.type || entityTypeFallback,
      payload: { manifestEntry: entry },
    });
    result.enqueued++;

    try {
      await publisher(entry, 'UPDATE');
      result.published++;
    } catch {
      result.failed++;
    }
  }

  for (const entry of plan.toDelete) {
    await queue.enqueue({
      type: 'DELETE',
      entityId: entry.entityId,
      entityType: entry.type || entityTypeFallback,
      payload: { reason: 'local-tombstone' },
    });
    result.enqueued++;

    try {
      await publisher(entry, 'DELETE');
      result.published++;
    } catch {
      result.failed++;
    }
  }

  return result;
}
