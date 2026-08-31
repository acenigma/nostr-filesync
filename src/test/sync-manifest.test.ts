import { describe, it, expect, beforeEach } from 'vitest';
import * as db from '../services/db';
import * as folders from '../services/folders';
import * as fileEntity from '../services/file-entity';
import * as tombstones from '../services/tombstones';
import * as manifest from '../services/sync/manifest';

const PUBKEY = 'a'.repeat(64);

beforeEach(async () => {
  db.__useIsolatedDatabaseForTesting();
  localStorage.clear();
  await db.clear(db.STORE_FILES);
  await db.clear(db.STORE_FOLDERS);
  await db.clear(db.STORE_TOMBSTONES);
});

describe('buildManifest', () => {
  it('retorna manifest vazio quando não há entidades', async () => {
    const m = await manifest.buildManifest(PUBKEY);
    expect(m.schema).toBe(manifest.MANIFEST_SCHEMA);
    expect(m.pubkey).toBe(PUBKEY);
    expect(m.entries).toEqual([]);
    expect(m.generatedAt).toBeGreaterThan(0);
  });

  it('inclui folders e files', async () => {
    const folder = await folders.createFolder({ name: 'docs' });
    await fileEntity.createFile({
      name: 'a.txt',
      mimeType: 'text/plain',
      size: 100,
      contentHash: 'h1',
      chunks: 1,
      headerEventId: 'h-a',
      encrypted: true,
      folderId: folder.id,
    });
    await fileEntity.createFile({
      name: 'b.txt',
      mimeType: 'text/plain',
      size: 200,
      contentHash: 'h2',
      chunks: 1,
      headerEventId: 'h-b',
      encrypted: true,
    });

    const m = await manifest.buildManifest(PUBKEY);
    expect(m.entries).toHaveLength(3);
    const types = m.entries.map((e) => e.type).sort();
    expect(types).toEqual(['file', 'file', 'folder']);
  });

  it('inclui tombstones como entries deleted=true', async () => {
    const f = await folders.createFolder({ name: 'x' });
    await tombstones.createTombstone({
      entityId: f.id,
      entityType: 'folder',
      deletedBy: PUBKEY,
    });

    const m = await manifest.buildManifest(PUBKEY);
    const deleted = m.entries.find((e) => e.deleted);
    expect(deleted).toBeDefined();
    expect(deleted?.entityId).toBe(f.id);
    expect(deleted?.type).toBe('folder');
  });

  it('ordena entries por entityId', async () => {
    await folders.createFolder({ name: 'z' });
    await folders.createFolder({ name: 'a' });
    await folders.createFolder({ name: 'm' });

    const m = await manifest.buildManifest(PUBKEY);
    const names = m.entries.map((e) => e.entityId);
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });

  it('inclui version e updatedAt de cada entry', async () => {
    const folder = await folders.createFolder({ name: 'x' });
    await folders.updateFolder(folder.id, { name: 'y' });

    const m = await manifest.buildManifest(PUBKEY);
    const entry = m.entries[0];
    expect(entry.version).toBe(2);
    expect(entry.updatedAt).toBeGreaterThan(0);
    expect(folder).toBeDefined();
  });
});

describe('serializeManifest / deserializeManifest', () => {
  it('roundtrip preserva dados', async () => {
    await folders.createFolder({ name: 'x' });
    const m = await manifest.buildManifest(PUBKEY);
    const json = manifest.serializeManifest(m);
    const back = manifest.deserializeManifest(json);
    expect(back).toEqual(m);
  });

  it('deserializeManifest lança em JSON inválido', () => {
    expect(() => manifest.deserializeManifest('not json')).toThrow();
  });

  it('deserializeManifest lança em schema errado', () => {
    expect(() => manifest.deserializeManifest(JSON.stringify({ schema: 'wrong' }))).toThrow(
      /Schema/
    );
  });

  it('deserializeManifest valida pubkey', () => {
    expect(() =>
      manifest.deserializeManifest(
        JSON.stringify({ schema: manifest.MANIFEST_SCHEMA, entries: [], version: 1 })
      )
    ).toThrow(/pubkey/);
  });
});

describe('manifestSize / getEntry / isDeleted', () => {
  beforeEach(async () => {
    await db.clear(db.STORE_FILES);
    await db.clear(db.STORE_FOLDERS);
    await db.clear(db.STORE_TOMBSTONES);
  });

  it('manifestSize retorna número de entries', async () => {
    await folders.createFolder({ name: 'a' });
    await folders.createFolder({ name: 'b' });
    const m = await manifest.buildManifest(PUBKEY);
    expect(manifest.manifestSize(m)).toBe(2);
  });

  it('getEntry retorna entry por entityId', async () => {
    const f = await folders.createFolder({ name: 'x' });
    const m = await manifest.buildManifest(PUBKEY);
    const entry = manifest.getEntry(m, f.id);
    expect(entry?.entityId).toBe(f.id);
  });

  it('getEntry retorna null para entityId inexistente', async () => {
    const m = await manifest.buildManifest(PUBKEY);
    expect(manifest.getEntry(m, 'nope')).toBeNull();
  });

  it('isDeleted retorna true para tombstone', async () => {
    const f = await folders.createFolder({ name: 'x' });
    await tombstones.createTombstone({
      entityId: f.id,
      entityType: 'folder',
      deletedBy: PUBKEY,
    });
    const m = await manifest.buildManifest(PUBKEY);
    expect(manifest.isDeleted(m, f.id)).toBe(true);
  });
});

describe('Cenários', () => {
  it('manifest reflete estado completo do IDB', async () => {
    const a = await folders.createFolder({ name: 'A' });
    const b = await folders.createFolder({ name: 'B', parentId: a.id });
    await fileEntity.createFile({
      name: '1.txt',
      mimeType: 'text/plain',
      size: 1,
      contentHash: 'h1',
      chunks: 1,
      headerEventId: 'h1',
      encrypted: true,
      folderId: a.id,
    });
    await fileEntity.createFile({
      name: '2.txt',
      mimeType: 'text/plain',
      size: 1,
      contentHash: 'h2',
      chunks: 1,
      headerEventId: 'h2',
      encrypted: true,
      folderId: b.id,
    });
    const f3 = await fileEntity.createFile({
      name: '3.txt',
      mimeType: 'text/plain',
      size: 1,
      contentHash: 'h3',
      chunks: 1,
      headerEventId: 'h3',
      encrypted: true,
    });
    await tombstones.createTombstone({
      entityId: f3.fileId,
      entityType: 'file',
      deletedBy: PUBKEY,
    });

    const m = await manifest.buildManifest(PUBKEY);
    expect(m.entries).toHaveLength(6); // 2 folders + 3 files + 1 tombstone

    const fileEntries = m.entries.filter((e) => e.type === 'file');
    expect(fileEntries).toHaveLength(4); // 3 files + 1 tombstone (also type='file')
    const deleted = fileEntries.filter((e) => e.deleted);
    expect(deleted).toHaveLength(1);
  });
});
