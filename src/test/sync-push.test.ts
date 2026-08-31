import { describe, it, expect, beforeEach } from 'vitest';
import * as db from '../services/db';
import * as push from '../services/sync/push';
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

describe('planPush', () => {
  it('local tem entidade nova (remote vazio): toCreate', () => {
    const local = makeManifest([makeEntry('f-1', 1)]);
    const remote = makeManifest([]);
    const plan = push.planPush(local, remote);
    expect(plan.toCreate).toHaveLength(1);
    expect(plan.toCreate[0].entityId).toBe('f-1');
    expect(plan.toUpdate).toHaveLength(0);
  });

  it('local tem versão maior: toUpdate', () => {
    const local = makeManifest([makeEntry('f-1', 2)]);
    const remote = makeManifest([makeEntry('f-1', 1)]);
    const plan = push.planPush(local, remote);
    expect(plan.toUpdate).toHaveLength(1);
    expect(plan.toUpdate[0].version).toBe(2);
  });

  it('tombstone local: toDelete', () => {
    const local = makeManifest([makeEntry('f-1', 2, 'file', true)]);
    const remote = makeManifest([makeEntry('f-1', 1)]);
    const plan = push.planPush(local, remote);
    expect(plan.toDelete).toHaveLength(1);
  });

  it('unchanged: toSkip', () => {
    const local = makeManifest([makeEntry('f-1', 1)]);
    const remote = makeManifest([makeEntry('f-1', 1)]);
    const plan = push.planPush(local, remote);
    expect(plan.toSkip).toHaveLength(1);
    expect(plan.toCreate).toHaveLength(0);
    expect(plan.toUpdate).toHaveLength(0);
  });
});

describe('executePush', () => {
  it('enfileira e publica todas as operações', async () => {
    const plan: push.PushPlan = {
      toCreate: [makeEntry('f-1', 1)],
      toUpdate: [makeEntry('f-2', 2)],
      toDelete: [makeEntry('f-3', 2, 'file', true)],
      toSkip: [],
    };
    const publisher = async () => 'evt-' + Math.random();

    const result = await push.executePush(plan, publisher);
    expect(result.enqueued).toBe(3);
    expect(result.published).toBe(3);
    expect(result.failed).toBe(0);

    const ops = await queue.listAll();
    expect(ops).toHaveLength(3);
    const types = ops.map((op) => op.type).sort();
    expect(types).toEqual(['CREATE', 'DELETE', 'UPDATE']);
  });

  it('publisher lançando exceção conta como falha', async () => {
    const plan: push.PushPlan = {
      toCreate: [makeEntry('f-1', 1)],
      toUpdate: [],
      toDelete: [],
      toSkip: [],
    };
    const publisher = async () => {
      throw new Error('relay error');
    };

    const result = await push.executePush(plan, publisher);
    expect(result.published).toBe(0);
    expect(result.failed).toBe(1);
  });

  it('plan vazio: result zerado', async () => {
    const plan: push.PushPlan = {
      toCreate: [],
      toUpdate: [],
      toDelete: [],
      toSkip: [],
    };
    const result = await push.executePush(plan, async () => 'evt');
    expect(result.enqueued).toBe(0);
    expect(result.published).toBe(0);
  });

  it('operação tem payload com manifestEntry', async () => {
    const plan: push.PushPlan = {
      toCreate: [makeEntry('f-1', 7)],
      toUpdate: [],
      toDelete: [],
      toSkip: [],
    };
    const publisher = async () => 'evt-1';

    await push.executePush(plan, publisher);
    const ops = await queue.listAll();
    const createOp = ops.find((op) => op.type === 'CREATE');
    expect(createOp).toBeDefined();
    const payload = createOp!.payload as { manifestEntry: ManifestEntry };
    expect(payload.manifestEntry.version).toBe(7);
  });
});
