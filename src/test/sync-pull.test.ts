import { describe, it, expect, beforeEach } from 'vitest';
import * as db from '../services/db';
import * as pull from '../services/sync/pull';
import * as queue from '../services/sync/queue';
import type { Manifest, ManifestEntry } from '../services/sync/manifest';

const PUBKEY = 'a'.repeat(64);

function makeEntry(
  entityId: string,
  version: number,
  type: 'file' | 'folder' = 'file',
  deleted = false
): ManifestEntry {
  return { entityId, type, version, updatedAt: 0, deleted };
}

function makeManifest(entries: ManifestEntry[]): Manifest {
  return {
    schema: 'nostr-filesync.manifest/v1',
    version: 1,
    pubkey: PUBKEY,
    generatedAt: 0,
    entries,
  };
}

beforeEach(async () => {
  db.__useIsolatedDatabaseForTesting();
  localStorage.clear();
  await db.clear(db.STORE_SYNC_QUEUE);
});

describe('planPull', () => {
  it('local vazio: tudo vai para toDownload', () => {
    const remote = makeManifest([makeEntry('f-1', 1), makeEntry('f-2', 1)]);
    const local = makeManifest([]);
    const plan = pull.planPull(local, remote);
    expect(plan.toDownload).toHaveLength(2);
    expect(plan.toDelete).toHaveLength(0);
    expect(plan.toSkip).toHaveLength(0);
  });

  it('tombstones vão para toDelete', () => {
    const remote = makeManifest([makeEntry('f-1', 2, 'file', true)]);
    const local = makeManifest([makeEntry('f-1', 1)]);
    const plan = pull.planPull(local, remote);
    expect(plan.toDelete).toHaveLength(1);
    expect(plan.toDelete[0].entityId).toBe('f-1');
  });

  it('unchanged vai para toSkip', () => {
    const remote = makeManifest([makeEntry('f-1', 1)]);
    const local = makeManifest([makeEntry('f-1', 1)]);
    const plan = pull.planPull(local, remote);
    expect(plan.toSkip).toHaveLength(1);
    expect(plan.toDownload).toHaveLength(0);
  });

  it('update vai para toDownload', () => {
    const remote = makeManifest([makeEntry('f-1', 2)]);
    const local = makeManifest([makeEntry('f-1', 1)]);
    const plan = pull.planPull(local, remote);
    expect(plan.toDownload).toHaveLength(1);
  });

  it('folders sem download (só metadata)', () => {
    const remote = makeManifest([makeEntry('fld-1', 1, 'folder')]);
    const local = makeManifest([]);
    const plan = pull.planPull(local, remote);
    // Folders não têm conteúdo para download
    expect(plan.toDownload).toHaveLength(0);
  });
});

describe('executePull', () => {
  it('enfileira downloads e deletções', async () => {
    const remote = makeManifest([
      makeEntry('f-1', 1),
      makeEntry('f-2', 1),
      makeEntry('f-3', 2, 'file', true), // tombstone
    ]);
    const fetchContent = async (id: string) => new TextEncoder().encode(`content-${id}`);

    const result = await pull.executePull(remote, fetchContent);
    expect(result.enqueued).toBe(3); // 2 downloads + 1 delete
    expect(result.downloaded).toBe(2);
    expect(result.deleted).toBe(1);
    expect(result.failed).toBe(0);

    const ops = await queue.listAll();
    expect(ops).toHaveLength(3);
    const types = ops.map((op) => op.type).sort();
    expect(types).toEqual(['DELETE', 'DOWNLOAD', 'DOWNLOAD']);
  });

  it('fetchContent retornando null conta como falha', async () => {
    const remote = makeManifest([makeEntry('f-1', 1)]);
    const fetchContent = async () => null;

    const result = await pull.executePull(remote, fetchContent);
    expect(result.downloaded).toBe(0);
    expect(result.failed).toBe(1);
  });

  it('fetchContent lançando exceção conta como falha', async () => {
    const remote = makeManifest([makeEntry('f-1', 1)]);
    const fetchContent = async () => {
      throw new Error('network');
    };

    const result = await pull.executePull(remote, fetchContent);
    expect(result.downloaded).toBe(0);
    expect(result.failed).toBe(1);
  });

  it('operação DOWNLOAD tem payload com manifestEntry', async () => {
    const remote = makeManifest([makeEntry('f-1', 5)]);
    const fetchContent = async () => new Uint8Array([1, 2, 3]);

    await pull.executePull(remote, fetchContent);
    const ops = await queue.listByStatus('pending');
    const downloadOp = ops.find((op) => op.type === 'DOWNLOAD');
    expect(downloadOp).toBeDefined();
    const payload = downloadOp!.payload as { manifestEntry: ManifestEntry; content: Uint8Array | null };
    expect(payload.manifestEntry.version).toBe(5);
    expect(payload.content).not.toBeNull();
    expect(Array.from(payload.content!)).toEqual([1, 2, 3]);
  });
});
