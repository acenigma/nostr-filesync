import { describe, it, expect, beforeEach } from 'vitest';
import * as db from '../services/db';
import * as folders from '../services/folders';
import * as fileEntity from '../services/file-entity';
import * as tombstones from '../services/tombstones';
import * as blobs from '../services/blobs';
import * as migration from '../services/migration';
import { resetMigrationFlag } from '../services/migration';

beforeEach(async () => {
  db.__useIsolatedDatabaseForTesting();
  localStorage.clear();
  await db.clear(db.STORE_FILES);
  await db.clear(db.STORE_FOLDERS);
  await db.clear(db.STORE_TOMBSTONES);
  resetMigrationFlag();
});

const PUBKEY = 'a'.repeat(64);

const makeFile = (
  name: string,
  overrides: Partial<fileEntity.CreateFileInput> = {}
): fileEntity.CreateFileInput => ({
  name,
  mimeType: 'application/octet-stream',
  size: 100,
  contentHash: `hash-${name}-${Date.now()}-${Math.random()}`,
  chunks: 1,
  headerEventId: `header-${name}-${Date.now()}-${Math.random()}`,
  encrypted: true,
  ...overrides,
});

describe('Integration: Folder + File', () => {
  it('cria hierarquia completa de pastas e arquivos', async () => {
    const docs = await folders.createFolder({ name: 'docs' });
    const work = await folders.createFolder({ name: 'work', parentId: docs.id });
    const personal = await folders.createFolder({ name: 'personal', parentId: docs.id });

    await fileEntity.createFile(makeFile('report.pdf', { folderId: work.id }));
    await fileEntity.createFile(makeFile('todo.txt', { folderId: personal.id }));
    await fileEntity.createFile(makeFile('readme.md'));

    const allFolders = await folders.listAllFolders();
    expect(allFolders).toHaveLength(3);

    const workFiles = await fileEntity.listFiles(work.id);
    expect(workFiles).toHaveLength(1);
    expect(workFiles[0].name).toBe('report.pdf');

    const rootFiles = await fileEntity.listFiles(null);
    expect(rootFiles).toHaveLength(1);
    expect(rootFiles[0].name).toBe('readme.md');
  });

  it('rename de pasta não afeta arquivos', async () => {
    const old = await folders.createFolder({ name: 'old-name' });
    const file = await fileEntity.createFile(makeFile('a.txt', { folderId: old.id }));

    await folders.updateFolder(old.id, { name: 'new-name' });

    const refetched = await fileEntity.getFile(file.fileId);
    expect(refetched?.folderId).toBe(old.id);
  });

  it('move de arquivo para pasta inexistente falha', async () => {
    const file = await fileEntity.createFile(makeFile('a.txt'));
    await expect(fileEntity.moveFile(file.fileId, 'fld-nope')).rejects.toMatchObject({
      code: 'FOLDER_NOT_FOUND',
    });
  });

  it('cascata: delete pasta deleta descendentes', async () => {
    const root = await folders.createFolder({ name: 'root' });
    const child = await folders.createFolder({ name: 'child', parentId: root.id });
    const grandchild = await folders.createFolder({ name: 'gc', parentId: child.id });

    const deleted = await folders.deleteFolder(root.id, { permanent: true });
    expect(deleted).toHaveLength(3);

    expect(await folders.getFolder(root.id)).toBeNull();
    expect(await folders.getFolder(child.id)).toBeNull();
    expect(await folders.getFolder(grandchild.id)).toBeNull();
  });

  it('empty folder pode ser deletada sem afetar outros', async () => {
    const a = await folders.createFolder({ name: 'A' });
    const b = await folders.createFolder({ name: 'B' });
    await fileEntity.createFile(makeFile('only.txt', { folderId: b.id }));

    await folders.deleteFolder(a.id, { permanent: true });

    expect(await folders.getFolder(b.id)).not.toBeNull();
    const files = await fileEntity.listFiles(b.id);
    expect(files).toHaveLength(1);
  });
});

describe('Integration: Folder + File + Tombstone', () => {
  it('tombstone impede recriação de arquivo deletado', async () => {
    const file = await fileEntity.createFile(makeFile('deleted.txt'));
    await tombstones.createTombstone({
      entityId: file.fileId,
      entityType: 'file',
      deletedBy: PUBKEY,
    });

    expect(await tombstones.isDeleted(file.fileId, 'file')).toBe(true);
    expect(await fileEntity.getFile(file.fileId)).not.toBeNull();
  });

  it('workflow: delete file + tombstone + remove local', async () => {
    const file = await fileEntity.createFile(makeFile('temp.txt'));

    await tombstones.createTombstone({
      entityId: file.fileId,
      entityType: 'file',
      deletedBy: PUBKEY,
    });
    await fileEntity.deleteFile(file.fileId, { permanent: true });

    expect(await fileEntity.getFile(file.fileId)).toBeNull();
    expect(await tombstones.isDeleted(file.fileId, 'file')).toBe(true);
  });

  it('cascata: delete folder com tombstone para todos os descendentes', async () => {
    const root = await folders.createFolder({ name: 'root' });
    const child = await folders.createFolder({ name: 'child', parentId: root.id });
    await fileEntity.createFile(makeFile('a.txt', { folderId: child.id }));

    await tombstones.createTombstone({
      entityId: root.id,
      entityType: 'folder',
      deletedBy: PUBKEY,
    });
    const deletedFolders = await folders.deleteFolder(root.id, { permanent: true });

    expect(deletedFolders).toContain(root.id);
    expect(deletedFolders).toContain(child.id);
    expect(await tombstones.isDeleted(root.id, 'folder')).toBe(true);
  });
});

describe('Integration: Folder + File + Blobs', () => {
  it('findByContentHash atravessa folder hierarchy', async () => {
    const sharedHash = 'd'.repeat(64);
    const folder = await folders.createFolder({ name: 'shared' });
    await fileEntity.createFile(makeFile('a.bin', { folderId: folder.id, contentHash: sharedHash }));
    await fileEntity.createFile(makeFile('b.bin', { folderId: null, contentHash: sharedHash }));

    const refs = await blobs.findFilesByBlobHash(sharedHash);
    expect(refs).toHaveLength(2);
    const folderIds = refs.map((r) => r.folderId).sort();
    expect(folderIds).toEqual([null, folder.id].sort());
  });

  it('computeDedupStats considera hierarquia', async () => {
    const sharedHash = 'e'.repeat(64);
    const a = await folders.createFolder({ name: 'A' });
    const b = await folders.createFolder({ name: 'B' });

    await fileEntity.createFile(makeFile('1.bin', { folderId: a.id, contentHash: sharedHash, size: 500 }));
    await fileEntity.createFile(makeFile('2.bin', { folderId: b.id, contentHash: sharedHash, size: 500 }));
    await fileEntity.createFile(makeFile('3.bin', { folderId: a.id, contentHash: sharedHash, size: 500 }));

    const stats = await blobs.computeDedupStats();
    expect(stats.uniqueBlobs).toBe(1);
    expect(stats.totalReferences).toBe(3);
    expect(stats.duplicateReferences).toBe(2);
    expect(stats.potentialSavings).toBe(1000); // 2 * 500
  });
});

describe('Integration: Migration end-to-end', () => {
  it('migra, depois operações normais funcionam', async () => {
    const legacy = {
      fileId: 'legacy-1',
      name: 'old.jpg',
      folderId: null,
      mimeType: 'image/jpeg',
      size: 5000,
      contentHash: 'f'.repeat(64),
      chunks: 1,
      headerEventId: 'header-legacy-1',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: 1,
      encrypted: true,
      path: 'photos/2024',
    };
    await db.put(db.STORE_FILES, legacy);

    const result = await migration.migratePathToFolders();
    expect(result.foldersCreated).toBe(2);
    expect(result.filesMigrated).toBe(1);

    const migrated = await fileEntity.getFile('legacy-1');
    expect(migrated?.name).toBe('old.jpg');
    expect(migrated?.path).toBeUndefined();
    expect(migrated?.folderId).not.toBeNull();
    expect(migrated?.version).toBe(2);

    // Agora operações normais funcionam
    const allFolders = await folders.listAllFolders();
    const y2024 = allFolders.find((f) => f.name === '2024')!;
    await fileEntity.createFile(makeFile('new.jpg', { folderId: y2024.id }));
    const files = await fileEntity.listFiles(y2024.id);
    expect(files).toHaveLength(2);
  });

  it('rejeita criar arquivo com folderId inexistente', async () => {
    await expect(
      fileEntity.createFile(makeFile('a.txt', { folderId: 'fld-fake' }))
    ).rejects.toMatchObject({ code: 'FOLDER_NOT_FOUND' });
  });

  it('rejeita renomear para nome que já existe no mesmo folder', async () => {
    const folder = await folders.createFolder({ name: 'sub' });
    await fileEntity.createFile(makeFile('a.txt', { folderId: folder.id }));
    const b = await fileEntity.createFile(makeFile('b.txt', { folderId: folder.id }));
    await expect(fileEntity.renameFile(b.fileId, 'a.txt')).rejects.toMatchObject({
      code: 'DUPLICATE_NAME',
    });
  });
});

describe('Integration: deep tree operations', () => {
  it('cria e navega árvore de 5 níveis', async () => {
    let parent: folders.FolderRecord | null = null;
    const names = ['L1', 'L2', 'L3', 'L4', 'L5'];
    for (const name of names) {
      parent = await folders.createFolder({ name, parentId: parent?.id ?? null });
    }

    const file = await fileEntity.createFile(makeFile('deep.txt', { folderId: parent!.id }));

    // Navigate up
    let current: string | null = parent!.id;
    const path: string[] = [];
    while (current) {
      const folder = await folders.getFolder(current);
      path.unshift(folder!.name);
      current = folder!.parentId;
    }
    expect(path).toEqual(names);

    // File should be in L5
    const refetched = await fileEntity.getFile(file.fileId);
    expect(refetched?.folderId).toBe(parent!.id);
  });

  it('ciclo detectado em update', async () => {
    const a = await folders.createFolder({ name: 'A' });
    const b = await folders.createFolder({ name: 'B', parentId: a.id });
    const c = await folders.createFolder({ name: 'C', parentId: b.id });

    // Tentar mover A para dentro de C criaria ciclo
    await expect(folders.updateFolder(a.id, { parentId: c.id })).rejects.toMatchObject({
      code: 'CYCLE',
    });
  });

  it('cascade delete com arquivos em múltiplos níveis', async () => {
    const root = await folders.createFolder({ name: 'root' });
    const sub1 = await folders.createFolder({ name: 'sub1', parentId: root.id });
    const sub2 = await folders.createFolder({ name: 'sub2', parentId: sub1.id });

    await fileEntity.createFile(makeFile('a.txt', { folderId: root.id }));
    await fileEntity.createFile(makeFile('b.txt', { folderId: sub1.id }));
    await fileEntity.createFile(makeFile('c.txt', { folderId: sub2.id }));

    const deletedFolders = await folders.deleteFolder(root.id, { permanent: true });
    expect(deletedFolders).toHaveLength(3);

    // Arquivos ainda existem (cascade delete é só de pastas)
    expect(await fileEntity.listAllFiles()).toHaveLength(3);
  });
});

describe('Integration: tombstone + file uniqueness', () => {
  it('permite recriar arquivo com mesmo nome após tombstone + delete', async () => {
    const folder = await folders.createFolder({ name: 'sub' });

    const f1 = await fileEntity.createFile(makeFile('a.txt', { folderId: folder.id }));
    await tombstones.createTombstone({
      entityId: f1.fileId,
      entityType: 'file',
      deletedBy: PUBKEY,
    });
    await fileEntity.deleteFile(f1.fileId, { permanent: true });

    // Agora pode recriar
    const f2 = await fileEntity.createFile(makeFile('a.txt', { folderId: folder.id }));
    expect(f2.fileId).not.toBe(f1.fileId);
  });
});
