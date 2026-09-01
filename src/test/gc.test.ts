import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as db from '../services/db';
import * as blobs from '../services/blobs';
import * as fileEntity from '../services/file-entity';
import * as gc from '../services/diagnostics/gc';
import { sha256Hex } from '../services/crypto/index';

beforeEach(async () => {
  db.__useIsolatedDatabaseForTesting();
  localStorage.clear();
  await db.clear(db.STORE_BLOBS);
  await db.clear(db.STORE_FILES);
  gc.cancelScheduledGC();
});

afterEach(() => {
  gc.cancelScheduledGC();
});

async function makeOldBlob(data: Uint8Array, ageDays: number): Promise<string> {
  const { record } = await blobs.storeBlob({ data });
  const old = await blobs.getBlobRecord(record.contentHash);
  if (old) {
    await db.put(db.STORE_BLOBS, {
      ...old,
      refCount: 0,
      lastAccessedAt: Date.now() - ageDays * 24 * 60 * 60 * 1000,
    });
  }
  return record.contentHash;
}

describe('markUsedBlobs', () => {
  it('retorna set vazio quando não há files', async () => {
    const used = await gc.markUsedBlobs();
    expect(used.size).toBe(0);
  });

  it('inclui hashes de files vivos', async () => {
    const data = new TextEncoder().encode('hello');
    const hash = await sha256Hex(data);
    await fileEntity.createFile({
      name: 'a.txt',
      mimeType: 'text/plain',
      size: 5,
      contentHash: hash,
      chunks: 1,
      headerEventId: 'h-a',
      encrypted: true,
    });
    const used = await gc.markUsedBlobs();
    expect(used.has(hash.toLowerCase())).toBe(true);
  });

  it('ignora files com hash inválido', async () => {
    await fileEntity.createFile({
      name: 'a.txt',
      mimeType: 'text/plain',
      size: 5,
      contentHash: 'invalid',
      chunks: 1,
      headerEventId: 'h-a',
      encrypted: true,
    });
    const used = await gc.markUsedBlobs();
    expect(used.size).toBe(0);
  });
});

describe('findOrphans / classifyBlobs', () => {
  it('findOrphans retorna blobs não referenciados', async () => {
    await blobs.storeBlob({ data: new TextEncoder().encode('a') });
    await blobs.storeBlob({ data: new TextEncoder().encode('b') });
    const orphans = await gc.findOrphans();
    expect(orphans).toHaveLength(2);
  });

  it('findOrphans exclui blobs referenciados por files', async () => {
    const data = new TextEncoder().encode('used');
    const hash = await sha256Hex(data);
    await blobs.storeBlob({ data });
    await fileEntity.createFile({
      name: 'a.txt',
      mimeType: 'text/plain',
      size: 4,
      contentHash: hash,
      chunks: 1,
      headerEventId: 'h-a',
      encrypted: true,
    });
    const orphans = await gc.findOrphans();
    expect(orphans).toHaveLength(0);
  });

  it('classifyBlobs retorna used e orphanCandidates', async () => {
    const data = new TextEncoder().encode('used');
    const hash = await sha256Hex(data);
    await blobs.storeBlob({ data });
    await blobs.storeBlob({ data: new TextEncoder().encode('unused') });
    await fileEntity.createFile({
      name: 'a.txt',
      mimeType: 'text/plain',
      size: 4,
      contentHash: hash,
      chunks: 1,
      headerEventId: 'h-a',
      encrypted: true,
    });
    const classified = await gc.classifyBlobs();
    expect(classified.used.size).toBe(1);
    expect(classified.orphanCandidates.size).toBe(1);
  });
});

describe('collectGarbage', () => {
  it('remove orphans antigos', async () => {
    const hash1 = await makeOldBlob(new TextEncoder().encode('old1'), 10);
    const hash2 = await makeOldBlob(new TextEncoder().encode('old2'), 10);
    const result = await gc.collectGarbage({ ageThresholdMs: 7 * 24 * 60 * 60 * 1000 });
    expect(result.removed).toBe(2);
    expect(result.bytesFreed).toBe(8);
    expect(await blobs.getBlobRecord(hash1)).toBeNull();
    expect(await blobs.getBlobRecord(hash2)).toBeNull();
  });

  it('mantém orphans recentes', async () => {
    const data = new TextEncoder().encode('recent');
    const { record } = await blobs.storeBlob({ data });
    await db.put(db.STORE_BLOBS, { ...record, refCount: 0 });
    const result = await gc.collectGarbage({ ageThresholdMs: 7 * 24 * 60 * 60 * 1000 });
    expect(result.removed).toBe(0);
  });

  it('dry-run não remove nada', async () => {
    const hash = await makeOldBlob(new TextEncoder().encode('old'), 10);
    const result = await gc.collectGarbage({
      ageThresholdMs: 7 * 24 * 60 * 60 * 1000,
      dryRun: true,
    });
    expect(result.removed).toBe(0);
    expect(result.removedHashes).toContain(hash);
    expect(await blobs.getBlobRecord(hash)).not.toBeNull();
  });

  it('respeita shouldCancel', async () => {
    for (let i = 0; i < 10; i++) {
      await makeOldBlob(new TextEncoder().encode(`blob-${i}`), 10);
    }
    let callCount = 0;
    const result = await gc.collectGarbage({
      ageThresholdMs: 7 * 24 * 60 * 60 * 1000,
      shouldCancel: () => {
        callCount++;
        return callCount > 2;
      },
    });
    expect(result.cancelled).toBe(true);
  });

  it('chama onProgress nas fases marking, collecting, done', async () => {
    const progress: gc.GCProgress[] = [];
    await makeOldBlob(new TextEncoder().encode('x'), 10);
    await gc.collectGarbage({
      ageThresholdMs: 7 * 24 * 60 * 60 * 1000,
      onProgress: (p) => progress.push({ ...p }),
    });
    const phases = progress.map((p) => p.phase);
    expect(phases).toContain('marking');
    expect(phases).toContain('collecting');
    expect(phases).toContain('done');
  });

  it('respeita batchSize (limita trabalho por batch)', async () => {
    for (let i = 0; i < 5; i++) {
      await makeOldBlob(new TextEncoder().encode(`blob-${i}`), 10);
    }
    const result = await gc.collectGarbage({
      ageThresholdMs: 7 * 24 * 60 * 60 * 1000,
      batchSize: 2,
    });
    expect(result.removed).toBe(5);
  });

  it('não remove blobs referenciados por files', async () => {
    const data = new TextEncoder().encode('used');
    const hash = await sha256Hex(data);
    await blobs.storeBlob({ data });
    await fileEntity.createFile({
      name: 'a.txt',
      mimeType: 'text/plain',
      size: 4,
      contentHash: hash,
      chunks: 1,
      headerEventId: 'h-a',
      encrypted: true,
    });
    // Forçar lastAccessedAt antigo
    const old = await blobs.getBlobRecord(hash);
    if (old) {
      await db.put(db.STORE_BLOBS, {
        ...old,
        lastAccessedAt: Date.now() - 10 * 24 * 60 * 60 * 1000,
      });
    }
    const result = await gc.collectGarbage({ ageThresholdMs: 7 * 24 * 60 * 60 * 1000 });
    expect(result.removed).toBe(0);
    expect(await blobs.getBlobRecord(hash)).not.toBeNull();
  });
});

describe('scheduleGC / cancelScheduledGC / isGCScheduled', () => {
  it('isGCScheduled reflete o estado', () => {
    expect(gc.isGCScheduled()).toBe(false);
    gc.scheduleGC(10000);
    expect(gc.isGCScheduled()).toBe(true);
    gc.cancelScheduledGC();
    expect(gc.isGCScheduled()).toBe(false);
  });

  it('cancelScheduledGC antes de schedule não dá erro', () => {
    expect(() => gc.cancelScheduledGC()).not.toThrow();
  });
});

describe('getGCStats', () => {
  it('retorna zeros quando sem blobs', async () => {
    const stats = await gc.getGCStats();
    expect(stats.totalBlobs).toBe(0);
    expect(stats.usedBlobs).toBe(0);
    expect(stats.orphanBlobs).toBe(0);
    expect(stats.recyclableBlobs).toBe(0);
  });

  it('classifica used vs orphan corretamente', async () => {
    const data = new TextEncoder().encode('used');
    const hash = await sha256Hex(data);
    await blobs.storeBlob({ data: new TextEncoder().encode('a') });
    await blobs.storeBlob({ data });
    await fileEntity.createFile({
      name: 'a.txt',
      mimeType: 'text/plain',
      size: 4,
      contentHash: hash,
      chunks: 1,
      headerEventId: 'h-a',
      encrypted: true,
    });

    const stats = await gc.getGCStats();
    expect(stats.totalBlobs).toBe(2);
    expect(stats.usedBlobs).toBe(1);
    expect(stats.orphanBlobs).toBe(1);
  });

  it('identifica recyclable (orphans antigos)', async () => {
    await makeOldBlob(new TextEncoder().encode('old'), 10);
    const stats = await gc.getGCStats();
    expect(stats.recyclableBlobs).toBe(1);
    expect(stats.bytesRecyclable).toBe(3);
  });
});

describe('collectFromScan', () => {
  it('coleta blobs identificados pelo scan', async () => {
    const hash = await makeOldBlob(new TextEncoder().encode('x'), 10);
    const report = {
      issues: [{ code: 'BLOB_ORPHAN_TOO_OLD', entityId: hash }],
    };
    const result = await gc.collectFromScan(report);
    expect(result.removed).toBe(1);
    expect(await blobs.getBlobRecord(hash)).toBeNull();
  });

  it('dry-run não remove', async () => {
    const hash = await makeOldBlob(new TextEncoder().encode('x'), 10);
    const report = {
      issues: [{ code: 'BLOB_ORPHAN_TOO_OLD', entityId: hash }],
    };
    const result = await gc.collectFromScan(report, { dryRun: true });
    expect(result.removed).toBe(0);
    expect(await blobs.getBlobRecord(hash)).not.toBeNull();
  });

  it('ignora issues que não são BLOB_ORPHAN_TOO_OLD', async () => {
    const hash = await makeOldBlob(new TextEncoder().encode('x'), 10);
    const report = {
      issues: [{ code: 'OTHER_CODE', entityId: hash }],
    };
    const result = await gc.collectFromScan(report);
    expect(result.removed).toBe(0);
  });
});

describe('collectSpecificBlobs', () => {
  it('remove blobs específicos', async () => {
    const data1 = new TextEncoder().encode('a');
    const data2 = new TextEncoder().encode('b');
    const { record: r1 } = await blobs.storeBlob({ data: data1 });
    const { record: r2 } = await blobs.storeBlob({ data: data2 });

    const result = await gc.collectSpecificBlobs([r1.contentHash, r2.contentHash]);
    expect(result.removed).toBe(2);
    expect(await blobs.getBlobRecord(r1.contentHash)).toBeNull();
    expect(await blobs.getBlobRecord(r2.contentHash)).toBeNull();
  });

  it('dry-run preserva blobs', async () => {
    const { record } = await blobs.storeBlob({ data: new TextEncoder().encode('x') });
    const result = await gc.collectSpecificBlobs([record.contentHash], { dryRun: true });
    expect(result.removed).toBe(0);
    expect(result.removedHashes).toContain(record.contentHash);
    expect(await blobs.getBlobRecord(record.contentHash)).not.toBeNull();
  });

  it('respeita shouldCancel', async () => {
    const hashes: string[] = [];
    for (let i = 0; i < 5; i++) {
      const { record } = await blobs.storeBlob({ data: new TextEncoder().encode(`b-${i}`) });
      hashes.push(record.contentHash);
    }
    let callCount = 0;
    const result = await gc.collectSpecificBlobs(hashes, {
      shouldCancel: () => {
        callCount++;
        return callCount > 2;
      },
    });
    expect(result.cancelled).toBe(true);
  });

  it('hashes inexistentes são ignorados', async () => {
    const result = await gc.collectSpecificBlobs(['a'.repeat(64)]);
    expect(result.removed).toBe(0);
  });
});

describe('Integração: collectGarbage + scan', () => {
  it('run full workflow: mark → identify → collect', async () => {
    const data = new TextEncoder().encode('used');
    const hash = await sha256Hex(data);
    await blobs.storeBlob({ data });
    await blobs.storeBlob({ data: new TextEncoder().encode('orphan1') });
    await blobs.storeBlob({ data: new TextEncoder().encode('orphan2') });
    await fileEntity.createFile({
      name: 'a.txt',
      mimeType: 'text/plain',
      size: 4,
      contentHash: hash,
      chunks: 1,
      headerEventId: 'h-a',
      encrypted: true,
    });

    // Forçar orphans antigos
    for (const orphan of await gc.findOrphans()) {
      await db.put(db.STORE_BLOBS, {
        ...orphan,
        refCount: 0,
        lastAccessedAt: Date.now() - 10 * 24 * 60 * 60 * 1000,
      });
    }

    const classified = await gc.classifyBlobs();
    expect(classified.used.size).toBe(1);
    expect(classified.orphanCandidates.size).toBe(2);

    const result = await gc.collectGarbage({ ageThresholdMs: 7 * 24 * 60 * 60 * 1000 });
    expect(result.removed).toBe(2);
    expect(result.bytesFreed).toBe(14);

    // Blob usado permanece
    expect(await blobs.getBlobRecord(hash)).not.toBeNull();
  });
});
