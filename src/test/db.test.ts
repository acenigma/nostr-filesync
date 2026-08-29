import { describe, it, expect, beforeEach } from 'vitest';
import * as db from '../services/db';
import * as uploadState from '../services/uploadState';

interface SampleFile {
  fileId: string;
  name: string;
  size: number;
}

beforeEach(async () => {
  db.__useIsolatedDatabaseForTesting();
  localStorage.clear();
});

describe('db.ts (IndexedDB)', () => {
  beforeEach(async () => {
    const dbs = await indexedDB.databases?.();
    if (dbs) {
      for (const d of dbs) {
        if (d.name) indexedDB.deleteDatabase(d.name);
      }
    }
    localStorage.clear();
  });

  it('put + getAll retorna itens inseridos', async () => {
    const items = [
      { fileId: 'f-1', name: 'a.txt', size: 10 },
      { fileId: 'f-2', name: 'b.txt', size: 20 },
    ];
    await db.putAll(db.STORE_FILES, items);
    const result = await db.getAll<SampleFile>(db.STORE_FILES);
    expect(result).toHaveLength(2);
    expect(result.map((f) => f.fileId).sort()).toEqual(['f-1', 'f-2']);
  });

  it('get retorna item específico por id', async () => {
    await db.putAll<SampleFile>(db.STORE_FILES, [{ fileId: 'f-x', name: 'x.txt', size: 5 }]);
    const got = await db.get<SampleFile>(db.STORE_FILES, 'f-x');
    expect(got?.name).toBe('x.txt');
  });

  it('del remove item por id', async () => {
    await db.putAll<SampleFile>(db.STORE_FILES, [{ fileId: 'f-z', name: 'z.txt', size: 1 }]);
    await db.del(db.STORE_FILES, 'f-z');
    const result = await db.getAll<SampleFile>(db.STORE_FILES);
    expect(result).toHaveLength(0);
  });

  it('put upsert substitui quando chave existe', async () => {
    await db.put(db.STORE_FILES, { fileId: 'f-1', name: 'a', size: 1 });
    await db.put(db.STORE_FILES, { fileId: 'f-1', name: 'a-v2', size: 2 });
    const result = await db.getAll<{ fileId: string; name: string; size: number }>(db.STORE_FILES);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('a-v2');
    expect(result[0].size).toBe(2);
  });

  it('clear esvazia o store', async () => {
    await db.putAll(db.STORE_FILES, [
      { fileId: 'a', name: 'a', size: 1 },
      { fileId: 'b', name: 'b', size: 2 },
    ]);
    await db.clear(db.STORE_FILES);
    expect(await db.getAll(db.STORE_FILES)).toEqual([]);
  });
});

describe('uploadState com IndexedDB', () => {
  beforeEach(async () => {
    localStorage.clear();
    await db.clear(db.STORE_UPLOADS);
  });

  it('saveUploadState persiste e getUploadState recupera', async () => {
    await uploadState.saveUploadState({
      fileId: 'f-1',
      headerEventId: 'h',
      fileName: 'a.bin',
      fileType: 'application/octet-stream',
      size: 100,
      path: '',
      chunksDone: 0,
      totalChunks: 5,
      startedAt: Date.now(),
    });
    const got = await uploadState.getUploadState('f-1');
    expect(got?.fileName).toBe('a.bin');
    expect(got?.totalChunks).toBe(5);
  });

  it('updateUploadState aplica patch parcial', async () => {
    await uploadState.saveUploadState({
      fileId: 'f-1',
      headerEventId: 'h',
      fileName: 'a',
      fileType: '',
      size: 0,
      path: '',
      chunksDone: 0,
      totalChunks: 5,
      startedAt: 0,
    });
    await uploadState.updateUploadState('f-1', { chunksDone: 3 });
    const got = await uploadState.getUploadState('f-1');
    expect(got?.chunksDone).toBe(3);
    expect(got?.totalChunks).toBe(5);
  });

  it('listPendingUploads retorna apenas chunksDone < totalChunks', async () => {
    await uploadState.saveUploadState({
      fileId: 'a',
      headerEventId: '',
      fileName: '',
      fileType: '',
      size: 0,
      path: '',
      chunksDone: 5,
      totalChunks: 5,
      startedAt: 0,
    });
    await uploadState.saveUploadState({
      fileId: 'b',
      headerEventId: '',
      fileName: '',
      fileType: '',
      size: 0,
      path: '',
      chunksDone: 2,
      totalChunks: 5,
      startedAt: 0,
    });
    const pending = await uploadState.listPendingUploads();
    expect(pending).toHaveLength(1);
    expect(pending[0].fileId).toBe('b');
  });

  it('markUploadComplete remove do store', async () => {
    await uploadState.saveUploadState({
      fileId: 'a',
      headerEventId: '',
      fileName: '',
      fileType: '',
      size: 0,
      path: '',
      chunksDone: 1,
      totalChunks: 2,
      startedAt: 0,
    });
    await uploadState.markUploadComplete('a');
    expect(await uploadState.getUploadState('a')).toBeNull();
  });

  it('migrateFromLegacy copia do localStorage para IDB', async () => {
    localStorage.setItem(
      'nostr_filesync_uploads',
      JSON.stringify({
        'legacy-1': {
          fileId: 'legacy-1',
          headerEventId: '',
          fileName: 'old.bin',
          fileType: '',
          size: 0,
          path: '',
          chunksDone: 1,
          totalChunks: 2,
          startedAt: 0,
        },
      })
    );
    const migrated = await uploadState.migrateFromLegacy();
    expect(migrated).toBe(true);
    const got = await uploadState.getUploadState('legacy-1');
    expect(got?.fileName).toBe('old.bin');
    expect(localStorage.getItem('nostr_filesync_uploads')).toBe('{}');
  });

  it('migrateFromLegacy no-op quando IDB já tem dados', async () => {
    await uploadState.saveUploadState({
      fileId: 'existing',
      headerEventId: '',
      fileName: 'e',
      fileType: '',
      size: 0,
      path: '',
      chunksDone: 0,
      totalChunks: 1,
      startedAt: 0,
    });
    localStorage.setItem(
      'nostr_filesync_uploads',
      JSON.stringify({ 'legacy-1': { fileId: 'legacy-1' } })
    );
    const migrated = await uploadState.migrateFromLegacy();
    expect(migrated).toBe(false);
    expect(await uploadState.getUploadState('existing')).not.toBeNull();
    expect(await uploadState.getUploadState('legacy-1')).toBeNull();
  });

  it('pruneOld remove uploads com updatedAt > 7 dias', async () => {
    const old: uploadState.UploadState = {
      fileId: 'old',
      headerEventId: '',
      fileName: '',
      fileType: '',
      size: 0,
      path: '',
      chunksDone: 0,
      totalChunks: 1,
      startedAt: 0,
      updatedAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
    };
    const recent: uploadState.UploadState = {
      fileId: 'recent',
      headerEventId: '',
      fileName: '',
      fileType: '',
      size: 0,
      path: '',
      chunksDone: 0,
      totalChunks: 1,
      startedAt: 0,
      updatedAt: Date.now(),
    };
    await db.put(db.STORE_UPLOADS, old);
    await db.put(db.STORE_UPLOADS, recent);
    const pending = await uploadState.listPendingUploads();
    expect(pending.find((p) => p.fileId === 'old')).toBeUndefined();
    expect(pending.find((p) => p.fileId === 'recent')).toBeDefined();
  });
});