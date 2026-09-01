import { describe, it, expect, beforeEach } from 'vitest';
import * as db from '../services/db';
import * as versions from '../services/versions';
import * as fileEntity from '../services/file-entity';

beforeEach(async () => {
  db.__useIsolatedDatabaseForTesting();
  localStorage.clear();
  await db.clear(db.STORE_FILES);
  await db.clear(db.STORE_FILE_VERSIONS);
});

describe('File Versioning', () => {
  it('cria versão ao atualizar arquivo', async () => {
    const file = await fileEntity.createFile({
      name: 'test.txt',
      mimeType: 'text/plain',
      size: 100,
      contentHash: 'a'.repeat(64),
      chunks: 1,
      headerEventId: 'h-1',
      encrypted: false,
    });

    const updated = await fileEntity.renameFile(file.fileId, 'renamed.txt');
    expect(updated.version).toBe(2);

    const versionsList = await versions.listVersions(file.fileId);
    expect(versionsList).toHaveLength(1);
    expect(versionsList[0].version).toBe(1);
    expect(versionsList[0].name).toBe('test.txt');
    expect(versionsList[0].contentHash).toBe('a'.repeat(64));
    expect(versionsList[0].fileId).toBe(file.fileId);
  });

  it('cria versão ao mover arquivo', async () => {
    const folder = await import('../services/folders').then((m) => m.createFolder({ name: 'sub' }));
    const file = await fileEntity.createFile({
      name: 'test.txt',
      mimeType: 'text/plain',
      size: 100,
      contentHash: 'a'.repeat(64),
      chunks: 1,
      headerEventId: 'h-2',
      encrypted: false,
    });

    const updated = await fileEntity.moveFile(file.fileId, folder.id);
    expect(updated.version).toBe(2);
    expect(updated.folderId).toBe(folder.id);

    const versionsList = await versions.listVersions(file.fileId);
    expect(versionsList).toHaveLength(1);
    expect(versionsList[0].folderId).toBeNull();
  });

  it('não cria versão se nada mudou (no-op update)', async () => {
    const file = await fileEntity.createFile({
      name: 'test.txt',
      mimeType: 'text/plain',
      size: 100,
      contentHash: 'a'.repeat(64),
      chunks: 1,
      headerEventId: 'h-3',
      encrypted: false,
    });

    const updated = await fileEntity.renameFile(file.fileId, 'test.txt');
    expect(updated.version).toBe(1);

    const versionsList = await versions.listVersions(file.fileId);
    expect(versionsList).toHaveLength(0);
  });

  it('getFileVersions retorna estrutura correta', async () => {
    const file = await fileEntity.createFile({
      name: 'test.txt',
      mimeType: 'text/plain',
      size: 100,
      contentHash: 'a'.repeat(64),
      chunks: 1,
      headerEventId: 'h-4',
      encrypted: false,
    });

    await fileEntity.renameFile(file.fileId, 'v2.txt');
    await new Promise(r => setTimeout(r, 5));
    await fileEntity.renameFile(file.fileId, 'v3.txt');

    const result = await versions.getFileVersions(file.fileId);
    expect(result.currentVersion).toBe(3);
    expect(result.versions).toHaveLength(2);
    expect(result.versions[0].version).toBe(2);
    expect(result.versions[1].version).toBe(1);
  });

  it('deleteVersions remove todas as versões', async () => {
    const file = await fileEntity.createFile({
      name: 'test.txt',
      mimeType: 'text/plain',
      size: 100,
      contentHash: 'a'.repeat(64),
      chunks: 1,
      headerEventId: 'h-5',
      encrypted: false,
    });

    await fileEntity.renameFile(file.fileId, 'v2.txt');
    const removed = await versions.deleteVersions(file.fileId);
    expect(removed).toBe(1);

    const versionsList = await versions.listVersions(file.fileId);
    expect(versionsList).toHaveLength(0);
  });

  it('getLatestVersion retorna a versão mais recente', async () => {
    const file = await fileEntity.createFile({
      name: 'test.txt',
      mimeType: 'text/plain',
      size: 100,
      contentHash: 'a'.repeat(64),
      chunks: 1,
      headerEventId: 'h-6',
      encrypted: false,
    });

    await fileEntity.renameFile(file.fileId, 'v2.txt');
    const latest = await versions.getLatestVersion(file.fileId);
    expect(latest?.version).toBe(1);
    expect(latest?.name).toBe('test.txt');
  });

  it('restaura arquivo para versão anterior', async () => {
    const file = await fileEntity.createFile({
      name: 'original.txt',
      mimeType: 'text/plain',
      size: 100,
      contentHash: 'a'.repeat(64),
      chunks: 1,
      headerEventId: 'h-7',
      encrypted: false,
    });

    await fileEntity.renameFile(file.fileId, 'v2.txt');
    await new Promise(r => setTimeout(r, 5));
    await fileEntity.renameFile(file.fileId, 'v3.txt');

    const versionsList = await versions.listVersions(file.fileId);
    expect(versionsList).toHaveLength(2);

    const v1Id = versionsList[1].id;
    const restored = await versions.restoreVersion(v1Id);
    expect(restored).not.toBeNull();
    expect(restored!.version).toBe(4);
    expect(restored!.name).toBe('original.txt');
    expect(restored!.contentHash).toBe('a'.repeat(64));

    const newVersions = await versions.listVersions(file.fileId);
    expect(newVersions).toHaveLength(3);
    expect(newVersions[0].name).toBe('v3.txt');
  });

  it('retorna null ao restaurar versão inexistente', async () => {
    const result = await versions.restoreVersion('v-nonexistent');
    expect(result).toBeNull();
  });

  it('retorna null ao restaurar versão de arquivo deletado', async () => {
    const file = await fileEntity.createFile({
      name: 'test.txt',
      mimeType: 'text/plain',
      size: 100,
      contentHash: 'a'.repeat(64),
      chunks: 1,
      headerEventId: 'h-8',
      encrypted: false,
    });

    await fileEntity.renameFile(file.fileId, 'v2.txt');
    await new Promise(r => setTimeout(r, 5));
    await fileEntity.renameFile(file.fileId, 'v3.txt');
    const versionsList = await versions.listVersions(file.fileId);
    const v1Id = versionsList[1].id;

    await fileEntity.deleteFile(file.fileId, { permanent: true });

    const result = await versions.restoreVersion(v1Id);
    expect(result).toBeNull();
  });
});