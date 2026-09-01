import { describe, it, expect, beforeEach } from 'vitest';
import * as db from '../services/db';
import * as fileEntity from '../services/file-entity';
import * as folders from '../services/folders';
import * as tombstones from '../services/tombstones';
import * as blobs from '../services/blobs';
import * as integrity from '../services/diagnostics/integrity';

beforeEach(async () => {
  db.__useIsolatedDatabaseForTesting();
  localStorage.clear();
  await db.clear(db.STORE_FILES);
  await db.clear(db.STORE_FOLDERS);
  await db.clear(db.STORE_BLOBS);
  await db.clear(db.STORE_TOMBSTONES);
});

const makeInput = (overrides: Partial<fileEntity.CreateFileInput> = {}): fileEntity.CreateFileInput => ({
  name: 'doc.pdf',
  mimeType: 'application/pdf',
  size: 100,
  contentHash: 'a'.repeat(64),
  chunks: 1,
  headerEventId: `h-${Math.random().toString(36).slice(2, 8)}`,
  encrypted: true,
  ...overrides,
});

describe('scanFiles', () => {
  it('sem files: sem issues', async () => {
    const issues = await integrity.scanFiles();
    expect(issues).toEqual([]);
  });

  it('files válidos: sem issues', async () => {
    const folder = await folders.createFolder({ name: 'docs' });
    await fileEntity.createFile(makeInput({ name: 'a.txt', folderId: folder.id }));
    await fileEntity.createFile(makeInput({ name: 'b.txt' }));
    expect(await integrity.scanFiles()).toEqual([]);
  });

  it('detecta folderId inexistente', async () => {
    const file = await fileEntity.createFile(makeInput({ name: 'a.txt' }));
    await db.put(db.STORE_FILES, { ...file, folderId: 'fld-fake' });
    const issues = await integrity.scanFiles();
    const issue = issues.find((i) => i.code === 'FILE_FOLDER_MISSING');
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe('error');
  });

  it('detecta nome vazio', async () => {
    const file = await fileEntity.createFile(makeInput({ name: 'a.txt' }));
    await db.put(db.STORE_FILES, { ...file, name: '' });
    const issues = await integrity.scanFiles();
    const issue = issues.find((i) => i.code === 'FILE_NAME_INVALID');
    expect(issue).toBeDefined();
  });

  it('detecta nome com /', async () => {
    const file = await fileEntity.createFile(makeInput({ name: 'a.txt' }));
    await db.put(db.STORE_FILES, { ...file, name: 'a/b.txt' });
    const issues = await integrity.scanFiles();
    expect(issues.some((i) => i.code === 'FILE_NAME_INVALID')).toBe(true);
  });

  it('detecta contentHash inválido', async () => {
    const file = await fileEntity.createFile(makeInput({ name: 'a.txt' }));
    await db.put(db.STORE_FILES, { ...file, contentHash: 'invalid' });
    const issues = await integrity.scanFiles();
    const issue = issues.find((i) => i.code === 'FILE_HASH_INVALID');
    expect(issue).toBeDefined();
  });

  it('detecta size negativo', async () => {
    const file = await fileEntity.createFile(makeInput({ name: 'a.txt' }));
    await db.put(db.STORE_FILES, { ...file, size: -1 });
    const issues = await integrity.scanFiles();
    expect(issues.some((i) => i.code === 'FILE_SIZE_INVALID')).toBe(true);
  });

  it('detecta duplicatas de nome no mesmo folder', async () => {
    const folder = await folders.createFolder({ name: 'x' });
    const f1 = await fileEntity.createFile(makeInput({ name: 'same.txt', folderId: folder.id }));
    // Cria segundo file diretamente no DB com mesmo nome (bypass da validação)
    await db.put(db.STORE_FILES, {
      fileId: 'f-dup-' + Math.random().toString(36).slice(2, 8),
      folderId: folder.id,
      name: 'same.txt',
      mimeType: 'text/plain',
      size: 100,
      contentHash: 'b'.repeat(64),
      chunks: 1,
      headerEventId: 'h-dup',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: 1,
      encrypted: true,
    });
    void f1;
    const issues = await integrity.scanFiles();
    expect(issues.some((i) => i.code === 'FILE_DUPLICATE_NAME')).toBe(true);
  });
});

describe('scanFolders', () => {
  it('sem folders: sem issues', async () => {
    expect(await integrity.scanFolders()).toEqual([]);
  });

  it('folders válidos: sem issues', async () => {
    const a = await folders.createFolder({ name: 'A' });
    await folders.createFolder({ name: 'B', parentId: a.id });
    expect(await integrity.scanFolders()).toEqual([]);
  });

  it('detecta parentId inexistente', async () => {
    const folder = await folders.createFolder({ name: 'A' });
    await db.put(db.STORE_FOLDERS, { ...folder, parentId: 'fld-fake' });
    const issues = await integrity.scanFolders();
    expect(issues.some((i) => i.code === 'FOLDER_PARENT_MISSING')).toBe(true);
  });

  it('detecta nome vazio', async () => {
    const folder = await folders.createFolder({ name: 'A' });
    await db.put(db.STORE_FOLDERS, { ...folder, name: '' });
    const issues = await integrity.scanFolders();
    expect(issues.some((i) => i.code === 'FOLDER_NAME_INVALID')).toBe(true);
  });

  it('detecta ciclos', async () => {
    const a = await folders.createFolder({ name: 'A' });
    const b = await folders.createFolder({ name: 'B', parentId: a.id });
    // Forçar ciclo: a.parentId = b
    await db.put(db.STORE_FOLDERS, { ...a, parentId: b.id });
    const issues = await integrity.scanFolders();
    expect(issues.some((i) => i.code === 'FOLDER_PARENT_CYCLE')).toBe(true);
  });
});

describe('scanBlobs', () => {
  it('sem blobs: sem issues', async () => {
    expect(await integrity.scanBlobs()).toEqual([]);
  });

  it('blobs válidos: sem issues', async () => {
    await blobs.storeBlob({ data: new TextEncoder().encode('hello') });
    expect(await integrity.scanBlobs()).toEqual([]);
  });

  it('detecta hash inválido', async () => {
    await db.put(db.STORE_BLOBS, {
      contentHash: 'bad',
      size: 10,
      encrypted: false,
      refCount: 1,
      createdAt: 0,
      lastAccessedAt: 0,
    });
    const issues = await integrity.scanBlobs();
    expect(issues.some((i) => i.code === 'BLOB_HASH_INVALID')).toBe(true);
  });

  it('detecta size negativo', async () => {
    await db.put(db.STORE_BLOBS, {
      contentHash: 'a'.repeat(64),
      size: -1,
      encrypted: false,
      refCount: 1,
      createdAt: 0,
      lastAccessedAt: 0,
    });
    const issues = await integrity.scanBlobs();
    expect(issues.some((i) => i.code === 'BLOB_SIZE_INVALID')).toBe(true);
  });

  it('detecta orphan antigo', async () => {
    const data = new TextEncoder().encode('old');
    const { record } = await blobs.storeBlob({ data });
    await blobs.releaseBlob(record.contentHash);
    const oldBlob = await blobs.getBlobRecord(record.contentHash);
    if (oldBlob) {
      await db.put(db.STORE_BLOBS, {
        ...oldBlob,
        lastAccessedAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
      });
    }
    const issues = await integrity.scanBlobs({ orphanMaxAgeMs: 7 * 24 * 60 * 60 * 1000 });
    expect(issues.some((i) => i.code === 'BLOB_ORPHAN_TOO_OLD')).toBe(true);
  });

  it('detecta blob com refCount>0 sem file referenciando', async () => {
    const data = new TextEncoder().encode('orphan-ref');
    const { record } = await blobs.storeBlob({ data });
    // Força refCount=2 sem criar file
    await db.put(db.STORE_BLOBS, { ...record, refCount: 2 });
    const issues = await integrity.scanBlobs();
    expect(issues.some((i) => i.code === 'BLOB_MISSING_FOR_FILE')).toBe(true);
  });
});

describe('scanTombstones', () => {
  it('sem tombstones: sem issues', async () => {
    expect(await integrity.scanTombstones()).toEqual([]);
  });

  it('detecta tombstone para file ainda vivo', async () => {
    const file = await fileEntity.createFile(makeInput({ name: 'a.txt' }));
    await tombstones.createTombstone({
      entityId: file.fileId,
      entityType: 'file',
      deletedBy: 'user',
    });
    const issues = await integrity.scanTombstones();
    expect(issues.some((i) => i.code === 'TOMBSTONE_ENTITY_STILL_LIVE')).toBe(true);
  });

  it('detecta tombstone para folder ainda vivo', async () => {
    const folder = await folders.createFolder({ name: 'x' });
    await tombstones.createTombstone({
      entityId: folder.id,
      entityType: 'folder',
      deletedBy: 'user',
    });
    const issues = await integrity.scanTombstones();
    expect(issues.some((i) => i.code === 'TOMBSTONE_ENTITY_STILL_LIVE')).toBe(true);
  });

  it('tombstone para entidade inexistente: sem issue', async () => {
    await tombstones.createTombstone({
      entityId: 'f-ghost',
      entityType: 'file',
      deletedBy: 'user',
    });
    const issues = await integrity.scanTombstones();
    expect(issues).toEqual([]);
  });
});

describe('runFullScan', () => {
  it('estado limpo: retorna report com stats e zero issues', async () => {
    const report = await integrity.runFullScan();
    expect(report.issues).toEqual([]);
    expect(report.stats.errors).toBe(0);
    expect(report.stats.warnings).toBe(0);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('agrega issues de todos os scans', async () => {
    const file = await fileEntity.createFile(makeInput({ name: 'a.txt' }));
    await db.put(db.STORE_FILES, { ...file, contentHash: 'invalid' });
    const folder = await folders.createFolder({ name: 'x' });
    await db.put(db.STORE_FOLDERS, { ...folder, name: '' });
    const report = await integrity.runFullScan();
    expect(report.issues.some((i) => i.code === 'FILE_HASH_INVALID')).toBe(true);
    expect(report.issues.some((i) => i.code === 'FOLDER_NAME_INVALID')).toBe(true);
  });

  it('conta issues por severidade', async () => {
    const file = await fileEntity.createFile(makeInput({ name: 'a.txt' }));
    await db.put(db.STORE_FILES, { ...file, size: -1 });
    const report = await integrity.runFullScan();
    expect(report.stats.errors).toBeGreaterThan(0);
  });
});

describe('generateReport', () => {
  it('gera texto legível', async () => {
    const report = await integrity.runFullScan();
    const text = integrity.generateReport(report);
    expect(text).toContain('Integrity Scan Report');
    expect(text).toContain('Stats:');
    expect(text).toContain('Files:');
  });

  it('inclui issues no texto', async () => {
    const file = await fileEntity.createFile(makeInput({ name: 'a.txt' }));
    await db.put(db.STORE_FILES, { ...file, size: -1 });
    const report = await integrity.runFullScan();
    const text = integrity.generateReport(report);
    expect(text).toContain('Issues');
    expect(text).toContain('FILE_SIZE_INVALID');
  });

  it('estado limpo: "No issues found"', async () => {
    const report = await integrity.runFullScan();
    const text = integrity.generateReport(report);
    expect(text).toContain('No issues found');
  });
});

describe('groupByCode', () => {
  it('agrupa issues por código', async () => {
    const file = await fileEntity.createFile(makeInput({ name: 'a.txt' }));
    await db.put(db.STORE_FILES, { ...file, size: -1 });
    const file2 = await fileEntity.createFile(makeInput({ name: 'b.txt' }));
    await db.put(db.STORE_FILES, { ...file2, size: -1 });
    const report = await integrity.runFullScan();
    const grouped = integrity.groupByCode(report.issues);
    expect(grouped.get('FILE_SIZE_INVALID')?.length).toBe(2);
  });
});
