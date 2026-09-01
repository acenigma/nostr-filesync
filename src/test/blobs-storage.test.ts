import { describe, it, expect, beforeEach } from 'vitest';
import * as db from '../services/db';
import * as blobs from '../services/blobs';
import { sha256Hex } from '../services/crypto/index';
import * as fileEntity from '../services/file-entity';

beforeEach(async () => {
  db.__useIsolatedDatabaseForTesting();
  localStorage.clear();
  await db.clear(db.STORE_BLOBS);
  await db.clear(db.STORE_FILES);
});

async function makeHash(data: Uint8Array): Promise<string> {
  return sha256Hex(data);
}

describe('storeBlob', () => {
  it('cria novo blob com hash correto e refCount=0', async () => {
    const data = new TextEncoder().encode('hello world');
    const hash = await makeHash(data);
    const { record, isNew } = await blobs.storeBlob({ data });
    expect(isNew).toBe(true);
    expect(record.contentHash).toBe(hash);
    expect(record.size).toBe(11);
    expect(record.refCount).toBe(0);
    expect(record.encrypted).toBe(false);
  });

  it('segundo store do mesmo blob: não incrementa refCount automaticamente, isNew=false', async () => {
    const data = new TextEncoder().encode('duplicate');
    const { record: r1, isNew: n1 } = await blobs.storeBlob({ data });
    const { record: r2, isNew: n2 } = await blobs.storeBlob({ data });
    expect(n1).toBe(true);
    expect(n2).toBe(false);
    expect(r2.refCount).toBe(0);
    expect(r1.contentHash).toBe(r2.contentHash);
  });

  it('linkBlob incrementa refCount', async () => {
    const data = new TextEncoder().encode('linked');
    const { record } = await blobs.storeBlob({ data });
    const after1 = await blobs.linkBlob(record.contentHash);
    expect(after1?.refCount).toBe(1);
    const after2 = await blobs.linkBlob(record.contentHash);
    expect(after2?.refCount).toBe(2);
  });

  it('aceita expectedHash e verifica', async () => {
    const data = new TextEncoder().encode('check');
    const hash = await makeHash(data);
    await expect(blobs.storeBlob({ data, expectedHash: hash })).resolves.toBeDefined();
  });

  it('lança erro em hash mismatch', async () => {
    const data = new TextEncoder().encode('check');
    const wrongHash = 'a'.repeat(64);
    await expect(
      blobs.storeBlob({ data, expectedHash: wrongHash })
    ).rejects.toThrow(/mismatch/);
  });

  it('aceita encrypted e compression', async () => {
    const data = new TextEncoder().encode('secret');
    const { record } = await blobs.storeBlob({
      data,
      encrypted: true,
      compression: 'gzip',
    });
    expect(record.encrypted).toBe(true);
    expect(record.compression).toBe('gzip');
  });
});

describe('getBlobRecord', () => {
  it('retorna null para hash inexistente', async () => {
    expect(await blobs.getBlobRecord('a'.repeat(64))).toBeNull();
  });

  it('retorna blob existente', async () => {
    const data = new TextEncoder().encode('hello');
    const { record } = await blobs.storeBlob({ data });
    const fetched = await blobs.getBlobRecord(record.contentHash);
    expect(fetched?.contentHash).toBe(record.contentHash);
  });

  it('lança erro em hash inválido', async () => {
    await expect(blobs.getBlobRecord('invalid')).rejects.toThrow(/Hash inválido/);
    await expect(blobs.getBlobRecord('g'.repeat(64))).rejects.toThrow(/Hash inválido/);
  });
});

describe('touchBlob', () => {
  it('atualiza lastAccessedAt', async () => {
    const data = new TextEncoder().encode('x');
    const { record } = await blobs.storeBlob({ data });
    const old = record.lastAccessedAt;
    await new Promise((r) => setTimeout(r, 5));
    const touched = await blobs.touchBlob(record.contentHash);
    expect(touched!.lastAccessedAt).toBeGreaterThan(old);
  });

  it('retorna null para hash inexistente', async () => {
    expect(await blobs.touchBlob('a'.repeat(64))).toBeNull();
  });
});

describe('releaseBlob', () => {
  it('decrementa refCount', async () => {
    const data = new TextEncoder().encode('x');
    const { record } = await blobs.storeBlob({ data });
    await blobs.linkBlob(record.contentHash);
    const after = await blobs.releaseBlob(record.contentHash);
    expect(after?.refCount).toBe(0);
  });

  it('decrementa refCount a partir de valor > 1', async () => {
    const data = new TextEncoder().encode('x');
    const { record } = await blobs.storeBlob({ data });
    await blobs.linkBlob(record.contentHash);
    await blobs.linkBlob(record.contentHash);
    const after1 = await blobs.releaseBlob(record.contentHash);
    expect(after1?.refCount).toBe(1);
    const after2 = await blobs.releaseBlob(record.contentHash);
    expect(after2?.refCount).toBe(0);
  });

  it('retorna null para hash inexistente', async () => {
    expect(await blobs.releaseBlob('a'.repeat(64))).toBeNull();
  });
});

describe('getOrphanBlobs / listAllBlobs', () => {
  it('getOrphanBlobs retorna blobs com refCount=0', async () => {
    const data = new TextEncoder().encode('x');
    const { record } = await blobs.storeBlob({ data });
    await blobs.releaseBlob(record.contentHash); // refCount=0
    const orphans = await blobs.getOrphanBlobs();
    expect(orphans).toHaveLength(1);
    expect(orphans[0].contentHash).toBe(record.contentHash);
  });

  it('listAllBlobs retorna todos', async () => {
    await blobs.storeBlob({ data: new TextEncoder().encode('a') });
    await blobs.storeBlob({ data: new TextEncoder().encode('b') });
    const all = await blobs.listAllBlobs();
    expect(all).toHaveLength(2);
  });
});

describe('garbageCollect', () => {
  it('remove orphans antigos', async () => {
    const data = new TextEncoder().encode('old');
    const { record } = await blobs.storeBlob({ data });
    await blobs.releaseBlob(record.contentHash);
    // Simular orphan antigo
    const oldBlob = await blobs.getBlobRecord(record.contentHash);
    if (oldBlob) {
      await db.put(db.STORE_BLOBS, {
        ...oldBlob,
        lastAccessedAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
      });
    }

    const result = await blobs.garbageCollect(7 * 24 * 60 * 60 * 1000);
    expect(result.removed).toBe(1);
    expect(result.bytesFreed).toBe(3);
  });

  it('mantém orphans recentes', async () => {
    const data = new TextEncoder().encode('recent');
    const { record } = await blobs.storeBlob({ data });
    await blobs.releaseBlob(record.contentHash);

    const result = await blobs.garbageCollect(7 * 24 * 60 * 60 * 1000);
    expect(result.removed).toBe(0);
    expect(result.kept).toBe(1);
  });

  it('não remove blobs com refCount > 0', async () => {
    const { record } = await blobs.storeBlob({ data: new TextEncoder().encode('alive') });
    await blobs.linkBlob(record.contentHash);
    const result = await blobs.garbageCollect(0);
    expect(result.removed).toBe(0);
  });
});

describe('computeStorageStats', () => {
  it('retorna zeros quando sem blobs', async () => {
    const stats = await blobs.computeStorageStats();
    expect(stats.totalBlobs).toBe(0);
    expect(stats.totalSize).toBe(0);
    expect(stats.avgRefCount).toBe(0);
    expect(stats.orphanBlobs).toBe(0);
  });

  it('conta blobs e tamanhos', async () => {
    await blobs.storeBlob({ data: new TextEncoder().encode('a'.repeat(100)) });
    await blobs.storeBlob({ data: new TextEncoder().encode('b'.repeat(200)) });
    const stats = await blobs.computeStorageStats();
    expect(stats.totalBlobs).toBe(2);
    expect(stats.totalSize).toBe(300);
  });

  it('dedupRatio reflete referências', async () => {
    const data = new TextEncoder().encode('shared');
    await blobs.storeBlob({ data }); // 1 ref
    await fileEntity.createFile({
      name: 'a.txt',
      mimeType: 'text/plain',
      size: 6,
      contentHash: await makeHash(data),
      chunks: 1,
      headerEventId: 'h-a',
      encrypted: false,
    });
    const stats = await blobs.computeStorageStats();
    expect(stats.fileReferences).toBe(1);
  });
});

describe('deleteBlob / clearAllBlobs', () => {
  it('deleteBlob remove blob com refCount=0', async () => {
    const { record } = await blobs.storeBlob({ data: new TextEncoder().encode('x') });
    await blobs.releaseBlob(record.contentHash);
    expect(await blobs.deleteBlob(record.contentHash)).toBe(true);
  });

  it('deleteBlob lança erro se refCount > 0', async () => {
    const { record } = await blobs.storeBlob({ data: new TextEncoder().encode('x') });
    await blobs.linkBlob(record.contentHash);
    await expect(blobs.deleteBlob(record.contentHash)).rejects.toThrow(/refCount/);
  });

  it('deleteBlob retorna false para hash inexistente', async () => {
    expect(await blobs.deleteBlob('a'.repeat(64))).toBe(false);
  });

  it('clearAllBlobs remove todos', async () => {
    await blobs.storeBlob({ data: new TextEncoder().encode('a') });
    await blobs.storeBlob({ data: new TextEncoder().encode('b') });
    const removed = await blobs.clearAllBlobs();
    expect(removed).toBe(2);
    expect(await blobs.listAllBlobs()).toEqual([]);
  });
});

describe('Integração: storeBlob + refCount + fileEntity', () => {
  it('múltiplos files com mesmo contentHash compartilham blob', async () => {
    const data = new TextEncoder().encode('shared content');
    const hash = await makeHash(data);
    const { record } = await blobs.storeBlob({ data });
    expect(record.refCount).toBe(0);

    // Simular que 2 files referenciam o mesmo hash
    await fileEntity.createFile({
      name: 'a.txt',
      mimeType: 'text/plain',
      size: data.byteLength,
      contentHash: hash,
      chunks: 1,
      headerEventId: 'h-a',
      encrypted: false,
    });
    await fileEntity.createFile({
      name: 'b.txt',
      mimeType: 'text/plain',
      size: data.byteLength,
      contentHash: hash,
      chunks: 1,
      headerEventId: 'h-b',
      encrypted: false,
    });

    const refs = await blobs.findFilesByBlobHash(hash);
    expect(refs).toHaveLength(2);

    const stats = await blobs.computeStorageStats();
    expect(stats.totalBlobs).toBe(1);
    expect(stats.fileReferences).toBe(2);
  });
});
