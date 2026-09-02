import { describe, it, expect, beforeEach } from 'vitest';
import * as db from '../services/db';
import * as bundle from '../services/bundle';
import * as fileEntity from '../services/file-entity';
import * as folders from '../services/folders';
import * as devices from '../services/devices';
import * as versions from '../services/versions';

beforeEach(async () => {
  db.__useIsolatedDatabaseForTesting();
  localStorage.clear();
  await db.clear(db.STORE_FILES);
  await db.clear(db.STORE_FOLDERS);
  await db.clear(db.STORE_FILE_VERSIONS);
  await db.clear(db.STORE_DEVICES);
  await db.clear(db.STORE_SYNC_QUEUE);
  await db.clear(db.STORE_SYNC_CURSORS);
  await db.clear(db.STORE_BLOBS);
  await db.clear(db.STORE_TRASH);
});

describe('Bundle Export/Import', () => {
  const testPassword = 'test-password-123';

  it('exporta bundle vazio', async () => {
    const result = await bundle.exportBundle({ password: testPassword });
    expect(result.bundle).toBeInstanceOf(Uint8Array);
    expect(result.bundle.length).toBeGreaterThan(0);
    expect(result.stats.folders).toBe(0);
    expect(result.stats.files).toBe(0);
  });

  it('exporta bundle com pastas e arquivos', async () => {
    const folder = await folders.createFolder({ name: 'TestFolder' });
    await fileEntity.createFile({
      name: 'test.txt',
      mimeType: 'text/plain',
      size: 100,
      contentHash: 'a'.repeat(64),
      chunks: 1,
      headerEventId: 'h-1',
      encrypted: false,
      folderId: folder.id,
    });

    const result = await bundle.exportBundle({ password: testPassword });
    expect(result.stats.folders).toBe(1);
    expect(result.stats.files).toBe(1);
  });

  it('importa bundle vazio', async () => {
    const exported = await bundle.exportBundle({ password: testPassword });
    const result = await bundle.importBundle(exported.bundle, { password: testPassword });
    expect(result.success).toBe(true);
    expect(result.stats.foldersRestored).toBe(0);
    expect(result.stats.filesRestored).toBe(0);
  });

  it('importa bundle com dados', async () => {
    const folder = await folders.createFolder({ name: 'TestFolder' });
    const file = await fileEntity.createFile({
      name: 'test.txt',
      mimeType: 'text/plain',
      size: 100,
      contentHash: 'a'.repeat(64),
      chunks: 1,
      headerEventId: 'h-1',
      encrypted: false,
      folderId: folder.id,
    });

    const exported = await bundle.exportBundle({ password: testPassword });
    
    await db.clear(db.STORE_FILES);
    await db.clear(db.STORE_FOLDERS);

    const result = await bundle.importBundle(exported.bundle, { password: testPassword });
    expect(result.success).toBe(true);
    expect(result.stats.foldersRestored).toBe(1);
    expect(result.stats.filesRestored).toBe(1);

    const restoredFolder = await folders.getFolder(folder.id);
    expect(restoredFolder?.name).toBe('TestFolder');

    const restoredFile = await fileEntity.getFile(file.fileId);
    expect(restoredFile?.name).toBe('test.txt');
  });

  it('falha com senha incorreta', async () => {
    const exported = await bundle.exportBundle({ password: testPassword });
    await expect(
      bundle.importBundle(exported.bundle, { password: 'wrong-password' })
    ).rejects.toThrow(bundle.BundleError);
  });

  it('falha com bundle corrompido', async () => {
    const exported = await bundle.exportBundle({ password: testPassword });
    const corrupted = new Uint8Array(exported.bundle);
    corrupted[corrupted.length - 1] ^= 0xFF;
    await expect(
      bundle.importBundle(corrupted, { password: testPassword })
    ).rejects.toThrow(bundle.BundleError);
  });

  it('valida bundle com validateBundle', async () => {
    const exported = await bundle.exportBundle({ password: testPassword });
    const validation = await bundle.validateBundle(exported.bundle);
    expect(validation.valid).toBe(true);
    expect(validation.header).toBeDefined();
    expect(validation.header?.version).toBe(bundle.BUNDLE_VERSION);
  });

  it('parseBundleHeader retorna header', async () => {
    const exported = await bundle.exportBundle({ password: testPassword });
    const header = bundle.parseBundleHeader(exported.bundle);
    expect(header).not.toBeNull();
    expect(header?.version).toBe(bundle.BUNDLE_VERSION);
    expect(header?.magic).toBe(bundle.BUNDLE_MAGIC);
  });

  it('formata tamanho do bundle', () => {
    expect(bundle.formatBundleSize(500)).toBe('500 B');
    expect(bundle.formatBundleSize(1500)).toBe('1.5 KB');
    expect(bundle.formatBundleSize(1500000)).toBe('1.4 MB');
  });

  it('sobrescreve dados existentes com overwriteExisting', async () => {
    const folder = await folders.createFolder({ name: 'Original' });
    const exported = await bundle.exportBundle({ password: testPassword });

    await folders.updateFolder(folder.id, { name: 'Modified' });

    await bundle.importBundle(exported.bundle, { password: testPassword, overwriteExisting: true });
    const restored = await folders.getFolder(folder.id);
    expect(restored?.name).toBe('Original');
  });

  it('não sobrescreve sem overwriteExisting', async () => {
    const folder = await folders.createFolder({ name: 'Original' });
    const exported = await bundle.exportBundle({ password: testPassword });

    await folders.updateFolder(folder.id, { name: 'Modified' });

    await bundle.importBundle(exported.bundle, { password: testPassword, overwriteExisting: false });
    const restored = await folders.getFolder(folder.id);
    expect(restored?.name).toBe('Modified');
  });

  it('inclui privateKey quando includePrivateKey=true', async () => {
    await devices.registerLocalDevice({ pubkey: 'a'.repeat(64) });
    const exported = await bundle.exportBundle({ 
      password: testPassword, 
      includePrivateKey: true 
    });
    expect(exported.bundle.length).toBeGreaterThan(0);
  });

  it('versão do bundle é 2', async () => {
    const exported = await bundle.exportBundle({ password: testPassword });
    const header = bundle.parseBundleHeader(exported.bundle);
    expect(header?.version).toBe(2);
  });

  it('inclui manifest com checksums por tipo de entidade', async () => {
    const folder = await folders.createFolder({ name: 'TestFolder' });
    await fileEntity.createFile({
      name: 'test.txt',
      mimeType: 'text/plain',
      size: 100,
      contentHash: 'a'.repeat(64),
      chunks: 1,
      headerEventId: 'h-1',
      encrypted: false,
      folderId: folder.id,
    });

    const exported = await bundle.exportBundle({ password: testPassword });
    const header = bundle.parseBundleHeader(exported.bundle);
    expect(header?.manifest).toBeDefined();
    expect(header?.manifest.entities.folders?.count).toBe(1);
    expect(header?.manifest.entities.folders?.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(header?.manifest.entities.files?.count).toBe(1);
    expect(header?.manifest.totalEntities).toBeGreaterThan(0);
  });

  it('verifica manifest no import (dados íntegros)', async () => {
    await folders.createFolder({ name: 'TestFolder' });
    const result = await bundle.exportBundle({ password: testPassword });
    const importResult = await bundle.importBundle(result.bundle, { password: testPassword });
    expect(importResult.manifestVerified).toBe(true);
    expect(importResult.manifestMismatches).toBeUndefined();
  });

  it('recupera DB completo após destruição (export → destroy → import → verify)', async () => {
    const pubkey = 'a'.repeat(64);
    const localDevice = await devices.registerLocalDevice({ pubkey });
    const deviceId = localDevice.id;

    const folder1 = await folders.createFolder({ name: 'Folder1' });
    const subFolder = await folders.createFolder({ name: 'SubFolder', parentId: folder1.id });
    const folder2 = await folders.createFolder({ name: 'Folder2' });

    const file1 = await fileEntity.createFile({
      name: 'doc1.txt',
      mimeType: 'text/plain',
      size: 100,
      contentHash: 'a'.repeat(64),
      chunks: 1,
      headerEventId: 'h-1',
      encrypted: false,
      folderId: folder1.id,
    });

    const file2 = await fileEntity.createFile({
      name: 'doc2.txt',
      mimeType: 'text/plain',
      size: 200,
      contentHash: 'b'.repeat(64),
      chunks: 2,
      headerEventId: 'h-2',
      encrypted: true,
      folderId: subFolder.id,
    });

    const version = await versions.createVersion({
      fileId: file1.fileId,
      parentVersionId: null,
      contentHash: 'c'.repeat(64),
      size: 50,
      name: 'doc1_v1.txt',
      folderId: folder1.id,
      mimeType: 'text/plain',
      version: 1,
    });

    const exported = await bundle.exportBundle({ password: testPassword });

    db.__useIsolatedDatabaseForTesting();
    db.__resetForTesting();
    localStorage.clear();

    const allFolders = await db.getAll<any>(db.STORE_FOLDERS);
    const allFiles = await db.getAll<any>(db.STORE_FILES);
    const allDevices = await db.getAll<any>(db.STORE_DEVICES);
    const allVersions = await db.getAll<any>(db.STORE_FILE_VERSIONS);
    expect(allFolders.length).toBe(0);
    expect(allFiles.length).toBe(0);
    expect(allDevices.length).toBe(0);
    expect(allVersions.length).toBe(0);

    const result = await bundle.importBundle(exported.bundle, {
      password: testPassword,
      overwriteExisting: true,
    });
    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);

    const restoredFolder1 = await folders.getFolder(folder1.id);
    expect(restoredFolder1?.name).toBe('Folder1');
    expect(restoredFolder1?.id).toBe(folder1.id);

    const restoredSubFolder = await folders.getFolder(subFolder.id);
    expect(restoredSubFolder?.parentId).toBe(folder1.id);
    expect(restoredSubFolder?.name).toBe('SubFolder');

    const restoredFolder2 = await folders.getFolder(folder2.id);
    expect(restoredFolder2?.name).toBe('Folder2');

    const restoredFile1 = await fileEntity.getFile(file1.fileId);
    expect(restoredFile1?.name).toBe('doc1.txt');
    expect(restoredFile1?.folderId).toBe(folder1.id);
    expect(restoredFile1?.contentHash).toBe('a'.repeat(64));

    const restoredFile2 = await fileEntity.getFile(file2.fileId);
    expect(restoredFile2?.name).toBe('doc2.txt');
    expect(restoredFile2?.encrypted).toBe(true);
    expect(restoredFile2?.folderId).toBe(subFolder.id);

    const restoredVersion = await versions.getVersion(version.id);
    expect(restoredVersion?.fileId).toBe(file1.fileId);
    expect(restoredVersion?.version).toBe(1);
    expect(restoredVersion?.contentHash).toBe('c'.repeat(64));

    const restoredDevices = await devices.listDevicesByPubkey(pubkey);
    expect(restoredDevices).toHaveLength(1);
    expect(restoredDevices[0].id).toBe(deviceId);
    expect(restoredDevices[0].pubkey).toBe(pubkey);

    expect(result.stats.foldersRestored).toBe(3);
    expect(result.stats.filesRestored).toBe(2);
    expect(result.stats.fileVersionsRestored).toBe(1);
    expect(result.stats.devicesRestored).toBe(1);
  });
});