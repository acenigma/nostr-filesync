import type { Manifest, ManifestEntry } from './manifest';
import { computeDelta } from './delta';
import * as queue from './queue';
import * as db from '../db/index';

export interface PullPlan {
  toDownload: ManifestEntry[];
  toDelete: ManifestEntry[];
  toSkip: ManifestEntry[];
}

export function planPull(local: Manifest, remote: Manifest): PullPlan {
  const delta = computeDelta(local, remote);
  const toDownload: ManifestEntry[] = [];
  const toDelete: ManifestEntry[] = [];
  const toSkip: ManifestEntry[] = [];

  for (const entry of delta.toAdd) {
    if (!entry.deleted && entry.type === 'file') {
      toDownload.push(entry);
    } else if (entry.deleted) {
      toDelete.push(entry);
    }
  }
  for (const entry of delta.toUpdate) {
    if (!entry.deleted && entry.type === 'file') {
      toDownload.push(entry);
    }
  }
  for (const entry of delta.toDelete) {
    toDelete.push(entry);
  }

  // Tombstones no remote que local não tem: ainda assim registrar como toDelete
  // (para que local saiba que entidade foi deletada remotamente)
  for (const entry of remote.entries) {
    if (entry.deleted && !toDelete.find((d) => d.entityId === entry.entityId)) {
      const localEntry = delta.unchanged.find((u) => u.entityId === entry.entityId);
      if (!localEntry) {
        toDelete.push(entry);
      }
    }
  }

  for (const entry of delta.unchanged) {
    if (!entry.deleted) toSkip.push(entry);
  }

  return { toDownload, toDelete, toSkip };
}

export type ContentFetcher = (entityId: string) => Promise<Uint8Array | null>;

export interface PullResult {
  enqueued: number;
  downloaded: number;
  failed: number;
  deleted: number;
}

export async function executePull(
  remote: Manifest,
  fetchContent: ContentFetcher,
  options: { entityType?: 'file' | 'folder' } = {}
): Promise<PullResult> {
  const local = {
    schema: remote.schema,
    version: remote.version,
    pubkey: remote.pubkey,
    generatedAt: Date.now(),
    entries: [],
  } as Manifest;
  const plan = planPull(local, remote);

  const result: PullResult = {
    enqueued: 0,
    downloaded: 0,
    failed: 0,
    deleted: 0,
  };

  for (const entry of plan.toDownload) {
    const entityType = options.entityType ?? entry.type;
    let content: Uint8Array | null = null;
    let failed = false;
    try {
      content = await fetchContent(entry.entityId);
      if (!content) failed = true;
    } catch {
      failed = true;
    }

    const op = await queue.enqueue({
      type: 'DOWNLOAD',
      entityId: entry.entityId,
      entityType,
      payload: { manifestEntry: entry, content },
    });

    if (failed) {
      await queue.markFailed(op.id, 'fetch failed', { maxAttempts: 0, baseDelayMs: 0, jitter: false });
      result.failed++;
    } else {
      result.downloaded++;
    }
    result.enqueued++;
  }

  for (const entry of plan.toDelete) {
    await queue.enqueue({
      type: 'DELETE',
      entityId: entry.entityId,
      entityType: entry.type,
      payload: { reason: 'remote-tombstone' },
    });
    result.enqueued++;
    result.deleted++;
  }

  return result;
}

export { db };

