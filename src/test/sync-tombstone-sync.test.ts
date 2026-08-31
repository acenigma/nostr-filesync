import { describe, it, expect, beforeEach } from 'vitest';
import * as db from '../services/db';
import * as folders from '../services/folders';
import * as fileEntity from '../services/file-entity';
import * as tombstones from '../services/tombstones';
import * as tombSync from '../services/sync/tombstone-sync';
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
  await db.clear(db.STORE_FILES);
  await db.clear(db.STORE_FOLDERS);
  await db.clear(db.STORE_TOMBSTONES);
});

describe('applyRemoteTombstone', () => {
  it('aplica tombstone de file: deleta file e cria tombstone', async () => {
    const f = await fileEntity.createFile({
      name: 'a.txt',
      mimeType: 'text/plain',
      size: 100,
      contentHash: 'h1',
      chunks: 1,
      headerEventId: 'h-a',
      encrypted: true,
    });

    const result = await tombSync.applyRemoteTombstone({
      entityId: f.fileId,
      type: 'file',
      version: 2,
      updatedAt: Date.now(),
      deleted: true,
    });

    expect(result.applied).toBe(true);
    expect(await fileEntity.getFile(f.fileId)).toBeNull();
    expect(await tombstones.isDeleted(f.fileId, 'file')).toBe(true);
  });

  it('aplica tombstone de folder: deleta folder e descendentes', async () => {
    const folder = await folders.createFolder({ name: 'x' });
    const result = await tombSync.applyRemoteTombstone({
      entityId: folder.id,
      type: 'folder',
      version: 2,
      updatedAt: Date.now(),
      deleted: true,
    });

    expect(result.applied).toBe(true);
    expect(await folders.getFolder(folder.id)).toBeNull();
    expect(await tombstones.isDeleted(folder.id, 'folder')).toBe(true);
  });

  it('aplica tombstone de entidade inexistente: cria tombstone mesmo assim', async () => {
    const result = await tombSync.applyRemoteTombstone({
      entityId: 'f-ghost',
      type: 'file',
      version: 1,
      updatedAt: Date.now(),
      deleted: true,
    });

    expect(result.applied).toBe(true);
    expect(await tombstones.isDeleted('f-ghost', 'file')).toBe(true);
  });

  it('retorna reason=not-deleted para entry sem flag deleted', async () => {
    const result = await tombSync.applyRemoteTombstone({
      entityId: 'f-1',
      type: 'file',
      version: 1,
      updatedAt: Date.now(),
      deleted: false,
    });
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('not-deleted');
  });
});

describe('applyRemoteTombstones (batch)', () => {
  it('processa múltiplos tombstones', async () => {
    const f1 = await fileEntity.createFile({
      name: 'a.txt',
      mimeType: 'text/plain',
      size: 100,
      contentHash: 'h1',
      chunks: 1,
      headerEventId: 'h-a',
      encrypted: true,
    });
    const folder = await folders.createFolder({ name: 'x' });

    const entries = [
      { entityId: f1.fileId, type: 'file' as const, version: 2, updatedAt: 0, deleted: true },
      { entityId: folder.id, type: 'folder' as const, version: 2, updatedAt: 0, deleted: true },
    ];

    const result = await tombSync.applyRemoteTombstones(entries);
    expect(result.applied).toBe(2);
    expect(result.errors).toEqual([]);
  });

  it('ignora entries não-deleted', async () => {
    const entries = [
      { entityId: 'f-1', type: 'file' as const, version: 1, updatedAt: 0, deleted: false },
    ];
    const result = await tombSync.applyRemoteTombstones(entries);
    expect(result.applied).toBe(0);
  });
});

describe('collectTombstonesForPush', () => {
  it('retorna apenas entries deleted', async () => {
    const manifest = makeManifest([
      makeEntry('f-1', 1, 'file', false),
      makeEntry('f-2', 2, 'file', true),
      makeEntry('f-3', 1, 'folder', true),
    ]);
    const result = await tombSync.collectTombstonesForPush(manifest);
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.entityId).sort()).toEqual(['f-2', 'f-3']);
  });
});

describe('pruneExpiredTombstones', () => {
  it('remove tombstones antigos', async () => {
    await tombstones.createTombstone({
      entityId: 'old-1',
      entityType: 'file',
      deletedBy: PUBKEY,
    });
    const oldTomb = await tombstones.getTombstone('old-1');
    if (oldTomb) {
      await db.put(db.STORE_TOMBSTONES, {
        ...oldTomb,
        deletedAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
      });
    }

    const result = await tombSync.pruneExpiredTombstones(7 * 24 * 60 * 60 * 1000);
    expect(result.removed).toBe(1);
  });
});

describe('syncTombstones (end-to-end)', () => {
  it('aplica tombstones remotos e retorna o que ainda precisa push', async () => {
    const f1 = await fileEntity.createFile({
      name: 'a.txt',
      mimeType: 'text/plain',
      size: 100,
      contentHash: 'h1',
      chunks: 1,
      headerEventId: 'h-a',
      encrypted: true,
    });
    const f2 = await fileEntity.createFile({
      name: 'b.txt',
      mimeType: 'text/plain',
      size: 200,
      contentHash: 'h2',
      chunks: 1,
      headerEventId: 'h-b',
      encrypted: true,
    });

    const remote = makeManifest([
      makeEntry(f1.fileId, 2, 'file', true), // tombstone remoto
      makeEntry(f2.fileId, 2, 'file', true), // tombstone remoto
    ]);

    const result = await tombSync.syncTombstones(remote);
    expect(result.applied.applied).toBe(2);
    expect(result.toPush).toHaveLength(0); // já aplicados localmente

    expect(await fileEntity.getFile(f1.fileId)).toBeNull();
    expect(await fileEntity.getFile(f2.fileId)).toBeNull();
  });
});
