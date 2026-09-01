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

describe('db.ts — Versionamento e Migrations', () => {
  // Helper: cria um mock IDBDatabase mínimo para testar applyMigrations isoladamente
  function createMockDb(stores: Set<string>): IDBDatabase {
    const createdStores: string[] = [];
    const mockStoreNames = {
      contains: (name: string) => stores.has(name),
      [Symbol.iterator]: function* () {
        for (const s of stores) yield s;
      },
      length: stores.size,
    };
    return {
      objectStoreNames: mockStoreNames as any,
      createObjectStore: (name: string) => {
        stores.add(name);
        createdStores.push(name);
        return { name } as any;
      },
      createdStores,
    } as unknown as IDBDatabase;
  }

  it('DB_VERSION é 6', () => {
    expect(db.DB_VERSION).toBe(6);
  });

  it('exports STORE_FOLDERS e STORE_TOMBSTONES', () => {
    expect(db.STORE_FOLDERS).toBe('folders');
    expect(db.STORE_TOMBSTONES).toBe('tombstones');
  });

  it('exports interfaces FolderRecord e TombstoneRecord', () => {
    const folder: db.FolderRecord = {
      id: 'f-1',
      parentId: null,
      name: 'Test',
      createdAt: 0,
      updatedAt: 0,
      version: 1,
    };
    const tomb: db.TombstoneRecord = {
      entityId: 'f-1',
      entityType: 'file',
      deletedAt: 0,
      version: 1,
    };
    expect(folder.id).toBe('f-1');
    expect(tomb.entityId).toBe('f-1');
  });

  it('applyMigrations v1→v2 cria stores folders e tombstones', () => {
    const mockDb = createMockDb(new Set(['files', 'uploads']));

    db.applyMigrations(mockDb, 1, 2);

    expect(mockDb.objectStoreNames.contains('folders')).toBe(true);
    expect(mockDb.objectStoreNames.contains('tombstones')).toBe(true);
  });

  it('migration v1→v2 preserva stores existentes (não recria)', () => {
    const mockDb = createMockDb(new Set(['files', 'uploads', 'folders', 'tombstones']));

    db.applyMigrations(mockDb, 1, 2);

    // Stores folders e tombstones já existiam, não devem ser recriadas
    expect(mockDb.objectStoreNames.contains('folders')).toBe(true);
    expect(mockDb.objectStoreNames.contains('tombstones')).toBe(true);
  });

  it('migration v1→v2 preserva dados existentes em files e uploads', async () => {
    db.__useIsolatedDatabaseForTesting();

    // Inserir dados usando o módulo db
    const fileRecord = { fileId: 'f-1', name: 'preserved.txt', size: 42 };
    const uploadRecord = { fileId: 'u-1', headerEventId: 'h-1' };
    await db.put(db.STORE_FILES, fileRecord);
    await db.put(db.STORE_UPLOADS, uploadRecord);

    // Verificar que dados persistem após openDb (que já abriu na v2)
    const files = await db.getAll<any>(db.STORE_FILES);
    const uploads = await db.getAll<any>(db.STORE_UPLOADS);

    expect(files.find((f) => f.fileId === 'f-1')?.name).toBe('preserved.txt');
    expect(uploads.find((u) => u.fileId === 'u-1')?.headerEventId).toBe('h-1');
  });

  it('migrations é idempotente — aplicar duas vezes não quebra', () => {
    const mockDb = createMockDb(new Set(['files', 'uploads']));

    db.applyMigrations(mockDb, 1, 2);
    expect(mockDb.objectStoreNames.contains('folders')).toBe(true);
    expect(mockDb.objectStoreNames.contains('tombstones')).toBe(true);

    // Aplicar novamente — stores já existem
    db.applyMigrations(mockDb, 1, 2);
    expect(mockDb.objectStoreNames.contains('folders')).toBe(true);
    expect(mockDb.objectStoreNames.contains('tombstones')).toBe(true);
  });

  it('migrations vazia quando oldVersion === newVersion', () => {
    const mockDb = createMockDb(new Set(['files', 'uploads', 'folders', 'tombstones']));

    db.applyMigrations(mockDb, 2, 2);

    // Nenhuma store nova deve ser criada
    expect(mockDb.objectStoreNames.contains('files')).toBe(true);
    expect(mockDb.objectStoreNames.contains('uploads')).toBe(true);
    expect(mockDb.objectStoreNames.contains('folders')).toBe(true);
    expect(mockDb.objectStoreNames.contains('tombstones')).toBe(true);
  });

  it('migrations não cria stores entre versões não aplicáveis (v3 > target v2)', () => {
    const mockDb = createMockDb(new Set(['files', 'uploads']));

    // Se target for 2, e migration for v2, deve aplicar
    db.applyMigrations(mockDb, 0, 2);
    expect(mockDb.objectStoreNames.contains('folders')).toBe(true);
  });

  it('migrations não faz nada se oldVersion >= target', () => {
    const mockDb = createMockDb(new Set(['files', 'uploads']));

    db.applyMigrations(mockDb, 2, 1);

    expect(mockDb.objectStoreNames.contains('folders')).toBe(false);
    expect(mockDb.objectStoreNames.contains('tombstones')).toBe(false);
  });

  it('instalação nova cria schema v2 diretamente', async () => {
    db.__useIsolatedDatabaseForTesting();
    const result = await db.getAll<SampleFile>(db.STORE_FILES);
    expect(result).toEqual([]);

    // Stores folders e tombstones devem existir
    const testFolder: db.FolderRecord = {
      id: 'fld-1',
      parentId: null,
      name: 'TestFolder',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: 1,
    };
    await db.put(db.STORE_FOLDERS, testFolder);
    const folders = await db.getAll<db.FolderRecord>(db.STORE_FOLDERS);
    expect(folders).toHaveLength(1);
    expect(folders[0].name).toBe('TestFolder');

    const tombstone: db.TombstoneRecord = {
      entityId: 'f-del',
      entityType: 'file',
      deletedAt: Date.now(),
      version: 1,
    };
    await db.put(db.STORE_TOMBSTONES, tombstone);
    const tombs = await db.getAll<db.TombstoneRecord>(db.STORE_TOMBSTONES);
    expect(tombs).toHaveLength(1);
    expect(tombs[0].entityId).toBe('f-del');
  });

  it('migrations lista está correta', () => {
    expect(db.migrations.length).toBe(5);
    expect(db.migrations[0].version).toBe(2);
    expect(db.migrations[1].version).toBe(3);
    expect(db.migrations[2].version).toBe(4);
    expect(db.migrations[3].version).toBe(5);
    expect(db.migrations[4].version).toBe(6);
  });
});