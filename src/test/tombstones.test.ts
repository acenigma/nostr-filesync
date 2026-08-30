import { describe, it, expect, beforeEach } from 'vitest';
import * as db from '../services/db';
import * as tombstones from '../services/tombstones';
import { TombstoneError } from '../services/tombstones';

const PUBKEY = 'a'.repeat(64);
const PUBKEY_2 = 'b'.repeat(64);

beforeEach(async () => {
  db.__useIsolatedDatabaseForTesting();
  localStorage.clear();
  await db.clear(db.STORE_TOMBSTONES);
});

describe('createTombstone', () => {
  it('cria tombstone para arquivo', async () => {
    const tomb = await tombstones.createTombstone({
      entityId: 'f-1',
      entityType: 'file',
      deletedBy: PUBKEY,
    });
    expect(tomb.entityId).toBe('f-1');
    expect(tomb.entityType).toBe('file');
    expect(tomb.version).toBe(1);
    expect(tomb.deletedAt).toBeGreaterThan(0);
  });

  it('cria tombstone para pasta', async () => {
    const tomb = await tombstones.createTombstone({
      entityId: 'fld-1',
      entityType: 'folder',
      deletedBy: PUBKEY,
    });
    expect(tomb.entityType).toBe('folder');
  });

  it('lança erro em entityId vazio', async () => {
    await expect(
      tombstones.createTombstone({ entityId: '', entityType: 'file', deletedBy: PUBKEY })
    ).rejects.toThrow(TombstoneError);
  });

  it('lança erro em deletedBy inválido (curto)', async () => {
    await expect(
      tombstones.createTombstone({ entityId: 'f-1', entityType: 'file', deletedBy: 'abc' })
    ).rejects.toThrow(TombstoneError);
  });

  it('lança erro em deletedBy com caracteres não-hex', async () => {
    await expect(
      tombstones.createTombstone({
        entityId: 'f-1',
        entityType: 'file',
        deletedBy: 'g'.repeat(64),
      })
    ).rejects.toThrow(TombstoneError);
  });

  it('idempotente: criar 2x para mesma entidade atualiza version', async () => {
    const t1 = await tombstones.createTombstone({
      entityId: 'f-1',
      entityType: 'file',
      deletedBy: PUBKEY,
    });
    await new Promise((r) => setTimeout(r, 5));
    const t2 = await tombstones.createTombstone({
      entityId: 'f-1',
      entityType: 'file',
      deletedBy: PUBKEY_2,
    });
    expect(t2.entityId).toBe(t1.entityId);
    expect(t2.version).toBe(2);
    expect(t2.deletedAt).toBeGreaterThanOrEqual(t1.deletedAt);
  });
});

describe('getTombstone / isDeleted', () => {
  it('getTombstone retorna null para id inexistente', async () => {
    expect(await tombstones.getTombstone('nope')).toBeNull();
  });

  it('isDeleted retorna false para entidade não deletada', async () => {
    expect(await tombstones.isDeleted('f-1', 'file')).toBe(false);
  });

  it('isDeleted retorna true após criar tombstone', async () => {
    await tombstones.createTombstone({
      entityId: 'f-1',
      entityType: 'file',
      deletedBy: PUBKEY,
    });
    expect(await tombstones.isDeleted('f-1', 'file')).toBe(true);
  });

  it('isDeleted diferencia file vs folder', async () => {
    await tombstones.createTombstone({
      entityId: 'f-1',
      entityType: 'file',
      deletedBy: PUBKEY,
    });
    expect(await tombstones.isDeleted('f-1', 'file')).toBe(true);
    expect(await tombstones.isDeleted('f-1', 'folder')).toBe(false);
  });
});

describe('listTombstones', () => {
  it('retorna array vazio quando não há tombstones', async () => {
    expect(await tombstones.listTombstones()).toEqual([]);
  });

  it('retorna todos os tombstones', async () => {
    await tombstones.createTombstone({ entityId: 'f-1', entityType: 'file', deletedBy: PUBKEY });
    await tombstones.createTombstone({ entityId: 'f-2', entityType: 'file', deletedBy: PUBKEY });
    await tombstones.createTombstone({ entityId: 'fld-1', entityType: 'folder', deletedBy: PUBKEY });
    const all = await tombstones.listTombstones();
    expect(all).toHaveLength(3);
  });

  it('filtra por entityType', async () => {
    await tombstones.createTombstone({ entityId: 'f-1', entityType: 'file', deletedBy: PUBKEY });
    await tombstones.createTombstone({ entityId: 'fld-1', entityType: 'folder', deletedBy: PUBKEY });
    const files = await tombstones.listTombstones('file');
    const folders = await tombstones.listTombstones('folder');
    expect(files).toHaveLength(1);
    expect(files[0].entityType).toBe('file');
    expect(folders).toHaveLength(1);
    expect(folders[0].entityType).toBe('folder');
  });
});

describe('deleteTombstone (undelete)', () => {
  it('remove tombstone existente', async () => {
    await tombstones.createTombstone({ entityId: 'f-1', entityType: 'file', deletedBy: PUBKEY });
    expect(await tombstones.deleteTombstone('f-1')).toBe(true);
    expect(await tombstones.isDeleted('f-1', 'file')).toBe(false);
  });

  it('retorna false para tombstone inexistente', async () => {
    expect(await tombstones.deleteTombstone('nope')).toBe(false);
  });

  it('permite recriar após delete (undelete)', async () => {
    await tombstones.createTombstone({ entityId: 'f-1', entityType: 'file', deletedBy: PUBKEY });
    await tombstones.deleteTombstone('f-1');
    const recreated = await tombstones.createTombstone({
      entityId: 'f-1',
      entityType: 'file',
      deletedBy: PUBKEY,
    });
    expect(recreated.version).toBe(1);
  });
});

describe('pruneOldTombstones', () => {
  it('remove tombstones mais antigos que maxAge', async () => {
    const oldTomb: db.TombstoneRecord = {
      entityId: 'old-1',
      entityType: 'file',
      deletedAt: Date.now() - 8 * 24 * 60 * 60 * 1000, // 8 dias atrás
      version: 1,
    };
    const recentTomb: db.TombstoneRecord = {
      entityId: 'recent-1',
      entityType: 'file',
      deletedAt: Date.now(),
      version: 1,
    };
    await db.put(db.STORE_TOMBSTONES, oldTomb);
    await db.put(db.STORE_TOMBSTONES, recentTomb);

    const result = await tombstones.pruneOldTombstones(7 * 24 * 60 * 60 * 1000);
    expect(result.removed).toBe(1);
    expect(result.remaining).toBe(1);

    expect(await tombstones.getTombstone('old-1')).toBeNull();
    expect(await tombstones.getTombstone('recent-1')).not.toBeNull();
  });

  it('retorna zeros quando não há tombstones velhos', async () => {
    await tombstones.createTombstone({ entityId: 'f-1', entityType: 'file', deletedBy: PUBKEY });
    const result = await tombstones.pruneOldTombstones(7 * 24 * 60 * 60 * 1000);
    expect(result.removed).toBe(0);
    expect(result.remaining).toBe(1);
  });

  it('remove todos se maxAge = 0', async () => {
    await tombstones.createTombstone({ entityId: 'f-1', entityType: 'file', deletedBy: PUBKEY });
    await new Promise((r) => setTimeout(r, 5));
    const result = await tombstones.pruneOldTombstones(0);
    expect(result.removed).toBe(1);
  });
});
