import { describe, it, expect, beforeEach } from 'vitest';
import * as db from '../services/db';
import * as folders from '../services/folders';
import * as fileEntity from '../services/file-entity';
import { FileEntityError } from '../services/file-entity';

beforeEach(async () => {
  db.__useIsolatedDatabaseForTesting();
  localStorage.clear();
  await db.clear(db.STORE_FILES);
  await db.clear(db.STORE_FOLDERS);
});

let counter = 0;
const makeInput = (
  overrides: Partial<fileEntity.CreateFileInput> = {}
): fileEntity.CreateFileInput => {
  counter++;
  return {
    name: `doc-${counter}.pdf`,
    mimeType: 'application/pdf',
    size: 1024,
    contentHash: `hash-${counter}`,
    chunks: 1,
    headerEventId: `header-evt-${counter}`,
    encrypted: true,
    compression: 'gzip',
    ...overrides,
  };
};

describe('createFile', () => {
  it('cria arquivo na raiz', async () => {
    const input = makeInput({ name: 'doc.pdf' });
    const file = await fileEntity.createFile(input);
    expect(file.folderId).toBeNull();
    expect(file.name).toBe('doc.pdf');
    expect(file.version).toBe(1);
    expect(file.encryptedHash).toBeUndefined();
    expect(file.fileId).toBe(input.headerEventId);
  });

  it('cria arquivo dentro de uma pasta', async () => {
    const folder = await folders.createFolder({ name: 'docs' });
    const file = await fileEntity.createFile(makeInput({ name: 'a.pdf', folderId: folder.id }));
    expect(file.folderId).toBe(folder.id);
  });

  it('aceita encryptedHash quando fornecido', async () => {
    const file = await fileEntity.createFile(makeInput({ encryptedHash: 'enc-hash-1' }));
    expect(file.encryptedHash).toBe('enc-hash-1');
  });

  it('lança erro em nome vazio', async () => {
    await expect(fileEntity.createFile(makeInput({ name: '' }))).rejects.toThrow(FileEntityError);
    await expect(fileEntity.createFile(makeInput({ name: '   ' }))).rejects.toThrow(FileEntityError);
  });

  it('lança erro em nome com /', async () => {
    await expect(fileEntity.createFile(makeInput({ name: 'a/b' }))).rejects.toThrow(FileEntityError);
  });

  it('lança erro em nome com caractere nulo', async () => {
    await expect(fileEntity.createFile(makeInput({ name: 'a\0b' }))).rejects.toThrow(FileEntityError);
  });

  it('lança erro em nome muito longo (> 255 chars)', async () => {
    const longName = 'a'.repeat(256);
    await expect(fileEntity.createFile(makeInput({ name: longName }))).rejects.toThrow(FileEntityError);
  });

  it('lança erro se folderId não existir', async () => {
    await expect(
      fileEntity.createFile(makeInput({ folderId: 'fld-nope' }))
    ).rejects.toMatchObject({ code: 'FOLDER_NOT_FOUND' });
  });

  it('lança erro em nome duplicado no mesmo folder', async () => {
    await fileEntity.createFile(makeInput({ name: 'report.pdf' }));
    await expect(
      fileEntity.createFile(makeInput({ name: 'report.pdf' }))
    ).rejects.toMatchObject({ code: 'DUPLICATE_NAME' });
  });

  it('permite mesmo nome em folders diferentes', async () => {
    const a = await folders.createFolder({ name: 'A' });
    const b = await folders.createFolder({ name: 'B' });
    await fileEntity.createFile(makeInput({ name: 'x.txt', folderId: a.id }));
    const file2 = await fileEntity.createFile(makeInput({ name: 'x.txt', folderId: b.id }));
    expect(file2.folderId).toBe(b.id);
  });

  it('permite mesmo nome na raiz e em uma pasta', async () => {
    const folder = await folders.createFolder({ name: 'sub' });
    await fileEntity.createFile(makeInput({ name: 'shared.pdf' }));
    const file2 = await fileEntity.createFile(makeInput({ name: 'shared.pdf', folderId: folder.id }));
    expect(file2.folderId).toBe(folder.id);
  });
});

describe('getFile / listFiles', () => {
  beforeEach(async () => {
    await db.clear(db.STORE_FILES);
    await db.clear(db.STORE_FOLDERS);
  });

  it('getFile retorna null para id inexistente', async () => {
    expect(await fileEntity.getFile('nope')).toBeNull();
  });

  it('getFile retorna arquivo existente', async () => {
    const created = await fileEntity.createFile(makeInput());
    const fetched = await fileEntity.getFile(created.fileId);
    expect(fetched).toEqual(created);
  });

  it('listFiles(null) retorna apenas arquivos raiz', async () => {
    const folder = await folders.createFolder({ name: 'sub' });
    await fileEntity.createFile(makeInput({ name: 'root.pdf' }));
    await fileEntity.createFile(makeInput({ name: 'in.pdf', folderId: folder.id }));

    const roots = await fileEntity.listFiles(null);
    expect(roots).toHaveLength(1);
    expect(roots[0].name).toBe('root.pdf');
  });

  it('listFiles(folderId) retorna apenas filhos diretos', async () => {
    const folder = await folders.createFolder({ name: 'parent' });
    const sub = await folders.createFolder({ name: 'sub', parentId: folder.id });
    await fileEntity.createFile(makeInput({ name: 'a.pdf', folderId: folder.id }));
    await fileEntity.createFile(makeInput({ name: 'b.pdf', folderId: sub.id }));

    const children = await fileEntity.listFiles(folder.id);
    expect(children).toHaveLength(1);
    expect(children[0].name).toBe('a.pdf');
  });

  it('listAllFiles retorna todos os arquivos', async () => {
    const folder = await folders.createFolder({ name: 'sub' });
    await fileEntity.createFile(makeInput({ name: 'a.pdf' }));
    await fileEntity.createFile(makeInput({ name: 'b.pdf', folderId: folder.id }));
    const all = await fileEntity.listAllFiles();
    expect(all).toHaveLength(2);
  });
});

describe('updateFile (rename)', () => {
  it('atualiza nome', async () => {
    const file = await fileEntity.createFile(makeInput({ name: 'old.pdf' }));
    const updated = await fileEntity.renameFile(file.fileId, 'renamed.pdf');
    expect(updated.name).toBe('renamed.pdf');
    expect(updated.version).toBe(2);
    expect(updated.updatedAt).toBeGreaterThanOrEqual(file.updatedAt);
  });

  it('lança erro em nome vazio', async () => {
    const file = await fileEntity.createFile(makeInput());
    await expect(fileEntity.renameFile(file.fileId, '')).rejects.toThrow(FileEntityError);
  });

  it('lança erro em nome duplicado no mesmo folder', async () => {
    const folder = await folders.createFolder({ name: 'docs' });
    await fileEntity.createFile(makeInput({ name: 'a.pdf', folderId: folder.id }));
    const b = await fileEntity.createFile(makeInput({ name: 'b.pdf', folderId: folder.id }));
    await expect(fileEntity.renameFile(b.fileId, 'a.pdf')).rejects.toMatchObject({
      code: 'DUPLICATE_NAME',
    });
  });

  it('permite renomear para mesmo nome (no-op)', async () => {
    const file = await fileEntity.createFile(makeInput({ name: 'same.pdf' }));
    const updated = await fileEntity.renameFile(file.fileId, 'same.pdf');
    expect(updated.name).toBe('same.pdf');
    expect(updated.version).toBe(1);
  });
});

describe('updateFile (move)', () => {
  it('move arquivo entre pastas', async () => {
    const a = await folders.createFolder({ name: 'A' });
    const b = await folders.createFolder({ name: 'B' });
    const file = await fileEntity.createFile(makeInput({ folderId: a.id }));

    const moved = await fileEntity.moveFile(file.fileId, b.id);
    expect(moved.folderId).toBe(b.id);
    expect(moved.version).toBe(2);
  });

  it('move arquivo para raiz', async () => {
    const folder = await folders.createFolder({ name: 'sub' });
    const file = await fileEntity.createFile(makeInput({ folderId: folder.id }));

    const moved = await fileEntity.moveFile(file.fileId, null);
    expect(moved.folderId).toBeNull();
  });

  it('lança erro ao mover para folderId inexistente', async () => {
    const file = await fileEntity.createFile(makeInput());
    await expect(fileEntity.moveFile(file.fileId, 'fld-nope')).rejects.toMatchObject({
      code: 'FOLDER_NOT_FOUND',
    });
  });

  it('lança erro se nome colidir no destino', async () => {
    const a = await folders.createFolder({ name: 'A' });
    const b = await folders.createFolder({ name: 'B' });
    await fileEntity.createFile(makeInput({ name: 'shared.pdf', folderId: a.id }));
    const toMove = await fileEntity.createFile(makeInput({ name: 'shared.pdf', folderId: b.id }));

    await expect(fileEntity.moveFile(toMove.fileId, a.id)).rejects.toMatchObject({
      code: 'DUPLICATE_NAME',
    });
  });

  it('preserva outras propriedades ao mover', async () => {
    const folder = await folders.createFolder({ name: 'sub' });
    const file = await fileEntity.createFile(makeInput());
    const originalHash = file.contentHash;
    const originalSize = file.size;

    const moved = await fileEntity.moveFile(file.fileId, folder.id);
    expect(moved.contentHash).toBe(originalHash);
    expect(moved.size).toBe(originalSize);
    expect(moved.headerEventId).toBe(file.headerEventId);
  });
});

describe('deleteFile', () => {
  it('deleta arquivo existente', async () => {
    const file = await fileEntity.createFile(makeInput());
    await fileEntity.deleteFile(file.fileId, { permanent: true });
    expect(await fileEntity.getFile(file.fileId)).toBeNull();
  });

  it('lança erro ao deletar arquivo inexistente', async () => {
    await expect(fileEntity.deleteFile('f-nope')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('contentHash — base para content-addressing (Fase 3)', () => {
  it('findByContentHash retorna arquivo com hash correspondente', async () => {
    const file = await fileEntity.createFile(makeInput({ contentHash: 'unique-hash-1' }));
    const found = await fileEntity.findByContentHash('unique-hash-1');
    expect(found?.fileId).toBe(file.fileId);
  });

  it('findByContentHash retorna null para hash desconhecido', async () => {
    expect(await fileEntity.findByContentHash('nope')).toBeNull();
  });

  it('findDuplicates encontra arquivos com mesmo contentHash e size', async () => {
    await fileEntity.createFile(makeInput({ name: 'a.pdf', contentHash: 'shared-hash', size: 100 }));
    await fileEntity.createFile(makeInput({ name: 'b.pdf', contentHash: 'shared-hash', size: 100 }));
    await fileEntity.createFile(makeInput({ name: 'c.pdf', contentHash: 'other-hash', size: 100 }));

    const dupes = await fileEntity.findDuplicates('shared-hash', 100);
    expect(dupes).toHaveLength(2);
    expect(dupes.map((d) => d.name).sort()).toEqual(['a.pdf', 'b.pdf']);
  });

  it('findDuplicates diferencia por size', async () => {
    await fileEntity.createFile(makeInput({ name: 'a.pdf', contentHash: 'h', size: 100 }));
    await fileEntity.createFile(makeInput({ name: 'b.pdf', contentHash: 'h', size: 200 }));
    const dupes = await fileEntity.findDuplicates('h', 100);
    expect(dupes).toHaveLength(1);
  });
});
