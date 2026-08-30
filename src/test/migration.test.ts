import { describe, it, expect, beforeEach } from 'vitest';
import * as db from '../services/db';
import * as migration from '../services/migration';
import { pathSegments, resetMigrationFlag } from '../services/migration';
import * as fileEntity from '../services/file-entity';
import * as folders from '../services/folders';

beforeEach(async () => {
  db.__useIsolatedDatabaseForTesting();
  localStorage.clear();
  await db.clear(db.STORE_FILES);
  await db.clear(db.STORE_FOLDERS);
  resetMigrationFlag();
});

async function putLegacyFile(id: string, name: string, path: string, hash: string): Promise<void> {
  const file = {
    fileId: id,
    name,
    folderId: null,
    mimeType: 'application/octet-stream',
    size: 100,
    contentHash: hash,
    chunks: 1,
    headerEventId: `header-${id}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    version: 1,
    encrypted: true,
    path,
  };
  await db.put(db.STORE_FILES, file);
}

describe('pathSegments', () => {
  it('divide path em segmentos', () => {
    expect(pathSegments('photos/2024/vacation.jpg')).toEqual(['photos', '2024', 'vacation.jpg']);
  });

  it('retorna array vazio para path vazio', () => {
    expect(pathSegments('')).toEqual([]);
  });

  it('ignora barras extras', () => {
    expect(pathSegments('//photos//2024//')).toEqual(['photos', '2024']);
  });

  it('suporta backslashes convertidos', () => {
    expect(pathSegments('photos\\2024')).toEqual(['photos', '2024']);
  });
});

describe('migratePathToFolders', () => {
  it('retorna alreadyMigrated=true se já rodou', async () => {
    await migration.migratePathToFolders();
    const result = await migration.migratePathToFolders();
    expect(result.alreadyMigrated).toBe(true);
  });

  it('não faz nada se não há arquivos com path', async () => {
    await fileEntity.createFile({
      name: 'a.pdf',
      mimeType: 'application/pdf',
      size: 100,
      contentHash: 'h1',
      chunks: 1,
      headerEventId: 'h-a',
      encrypted: true,
    });
    const result = await migration.migratePathToFolders();
    expect(result.foldersCreated).toBe(0);
    expect(result.filesMigrated).toBe(0);
  });

  it('cria pasta raiz e migra arquivo de primeiro nível', async () => {
    await putLegacyFile('f-1', 'vacation.jpg', 'photos', 'h1');
    const result = await migration.migratePathToFolders();
    expect(result.foldersCreated).toBe(1);
    expect(result.filesMigrated).toBe(1);

    const allFolders = await folders.listAllFolders();
    expect(allFolders).toHaveLength(1);
    expect(allFolders[0].name).toBe('photos');
    expect(allFolders[0].parentId).toBeNull();

    const file = await fileEntity.getFile('f-1');
    expect(file?.name).toBe('vacation.jpg');
    expect(file?.folderId).toBe(allFolders[0].id);
  });

  it('cria hierarquia de pastas aninhadas', async () => {
    await putLegacyFile('f-1', 'photo.jpg', 'photos/2024/vacation', 'h1');
    const result = await migration.migratePathToFolders();
    expect(result.foldersCreated).toBe(3);
    expect(result.filesMigrated).toBe(1);

    const tree = await folders.buildFolderTree();
    expect(tree?.folder.name).toBe('photos');
    expect(tree?.children).toHaveLength(1);
    expect(tree?.children[0].folder.name).toBe('2024');
    expect(tree?.children[0].children[0].folder.name).toBe('vacation');
  });

  it('preserva arquivos sem path (folderId null)', async () => {
    await putLegacyFile('f-root', 'root.txt', '', 'h1');
    await putLegacyFile('f-nested', 'nested.txt', 'sub', 'h2');
    const result = await migration.migratePathToFolders();
    expect(result.foldersCreated).toBe(1);
    expect(result.filesMigrated).toBe(1);

    const root = await fileEntity.getFile('f-root');
    expect(root?.name).toBe('root.txt');
    expect(root?.folderId).toBeNull();

    const nested = await fileEntity.getFile('f-nested');
    expect(nested?.name).toBe('nested.txt');
    expect(nested?.folderId).not.toBeNull();
  });

  it('compartilha pastas entre arquivos no mesmo path', async () => {
    await putLegacyFile('f-1', 'a.jpg', 'photos/2024', 'h1');
    await putLegacyFile('f-2', 'b.jpg', 'photos/2024', 'h2');
    const result = await migration.migratePathToFolders();
    expect(result.foldersCreated).toBe(2);
    expect(result.filesMigrated).toBe(2);

    const allFolders = await folders.listAllFolders();
    const y2024 = allFolders.find((f) => f.name === '2024')!;
    const files2024 = await fileEntity.listFiles(y2024.id);
    expect(files2024.map((f) => f.name).sort()).toEqual(['a.jpg', 'b.jpg']);
  });

  it('incrementa version do arquivo ao migrar', async () => {
    await putLegacyFile('f-1', 'photo.jpg', 'photos', 'h1');
    await migration.migratePathToFolders();
    const file = await fileEntity.getFile('f-1');
    expect(file?.version).toBe(2);
  });

  it('preserva contentHash, size, headerEventId, mimeType', async () => {
    await putLegacyFile('f-1', 'doc.pdf', 'docs', 'hash-abc');
    const original = await fileEntity.getFile('f-1');
    const origHash = original?.contentHash;
    const origSize = original?.size;
    const origHeader = original?.headerEventId;

    await migration.migratePathToFolders();

    const migrated = await fileEntity.getFile('f-1');
    expect(migrated?.contentHash).toBe(origHash);
    expect(migrated?.size).toBe(origSize);
    expect(migrated?.headerEventId).toBe(origHeader);
  });

  it('lida com múltiplos arquivos em paths diferentes', async () => {
    await putLegacyFile('f-1', 'a.jpg', 'photos/2024', 'h1');
    await putLegacyFile('f-2', 'b.txt', 'docs/work', 'h2');
    await putLegacyFile('f-3', 'c.mp4', 'videos', 'h3');
    const result = await migration.migratePathToFolders();
    expect(result.foldersCreated).toBe(5); // photos, 2024, docs, work, videos
    expect(result.filesMigrated).toBe(3);
  });
});

describe('hasLegacyPathFiles', () => {
  it('retorna false se não há arquivos', async () => {
    expect(await migration.hasLegacyPathFiles()).toBe(false);
  });

  it('retorna true se há arquivo com path', async () => {
    await putLegacyFile('f-1', 'a.jpg', 'photos', 'h1');
    expect(await migration.hasLegacyPathFiles()).toBe(true);
  });

  it('retorna false se todos os arquivos já migraram', async () => {
    await putLegacyFile('f-1', 'a.jpg', 'photos', 'h1');
    await migration.migratePathToFolders();
    expect(await migration.hasLegacyPathFiles()).toBe(false);
  });
});

describe('resetMigrationFlag', () => {
  it('permite re-rodar migration após reset', async () => {
    await putLegacyFile('f-1', 'a.jpg', 'photos', 'h1');
    await migration.migratePathToFolders();
    const first = await migration.migratePathToFolders();
    expect(first.alreadyMigrated).toBe(true);

    resetMigrationFlag();
    const second = await migration.migratePathToFolders();
    expect(second.alreadyMigrated).toBe(false);
  });
});
