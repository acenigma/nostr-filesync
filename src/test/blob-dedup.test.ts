import { describe, it, expect, beforeEach } from 'vitest';
import * as db from '../services/db';
import * as blobs from '../services/blobs';
import * as fileEntity from '../services/file-entity';
import { sha256Hex } from '../services/crypto/index';

let counter = 0;
const makeInput = (overrides: Partial<fileEntity.CreateFileInput> = {}): fileEntity.CreateFileInput => {
  counter++;
  return {
    name: `doc-${counter}.txt`,
    mimeType: 'text/plain',
    size: 100,
    contentHash: 'a'.repeat(64),
    chunks: 1,
    headerEventId: `h-${counter}-${Math.random().toString(36).slice(2, 8)}`,
    encrypted: true,
    ...overrides,
  };
};

beforeEach(async () => {
  db.__useIsolatedDatabaseForTesting();
  localStorage.clear();
  await db.clear(db.STORE_FILES);
  await db.clear(db.STORE_BLOBS);
  counter = 0;
});

describe('findDuplicatesByHash', () => {
  it('retorna array vazio se não há files com o hash', async () => {
    expect(await blobs.findDuplicatesByHash('a'.repeat(64))).toEqual([]);
  });

  it('encontra files com mesmo contentHash', async () => {
    await fileEntity.createFile(makeInput({ name: 'a.txt', contentHash: 'b'.repeat(64) }));
    await fileEntity.createFile(makeInput({ name: 'b.txt', contentHash: 'b'.repeat(64) }));
    const dupes = await blobs.findDuplicatesByHash('b'.repeat(64));
    expect(dupes).toHaveLength(2);
  });
});

describe('findAllDuplicateGroups', () => {
  it('sem files: sem grupos', async () => {
    expect(await blobs.findAllDuplicateGroups()).toEqual([]);
  });

  it('files únicos: sem grupos', async () => {
    await fileEntity.createFile(makeInput({ name: 'a.txt', contentHash: 'a'.repeat(64) }));
    await fileEntity.createFile(makeInput({ name: 'b.txt', contentHash: 'b'.repeat(64) }));
    expect(await blobs.findAllDuplicateGroups()).toEqual([]);
  });

  it('agrupa files com mesmo contentHash', async () => {
    const hash = 'c'.repeat(64);
    await fileEntity.createFile(makeInput({ name: 'a.txt', contentHash: hash, size: 500 }));
    await fileEntity.createFile(makeInput({ name: 'b.txt', contentHash: hash, size: 500 }));
    await fileEntity.createFile(makeInput({ name: 'c.txt', contentHash: hash, size: 500 }));
    const groups = await blobs.findAllDuplicateGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].fileIds).toHaveLength(3);
    expect(groups[0].totalSize).toBe(500);
    expect(groups[0].potentialSavings).toBe(1000);
  });

  it('ordena por potentialSavings descendente', async () => {
    await fileEntity.createFile(makeInput({ name: 'a.txt', contentHash: 'd'.repeat(64), size: 100 }));
    await fileEntity.createFile(makeInput({ name: 'b.txt', contentHash: 'd'.repeat(64), size: 100 }));
    await fileEntity.createFile(makeInput({ name: 'c.txt', contentHash: 'e'.repeat(64), size: 1000 }));
    await fileEntity.createFile(makeInput({ name: 'd.txt', contentHash: 'e'.repeat(64), size: 1000 }));
    await fileEntity.createFile(makeInput({ name: 'e.txt', contentHash: 'e'.repeat(64), size: 1000 }));
    const groups = await blobs.findAllDuplicateGroups();
    expect(groups[0].contentHash).toBe('e'.repeat(64)); // 2000 savings > 100
  });

  it('redundantFileIds exclui o primeiro (mantido)', async () => {
    const hash = 'f'.repeat(64);
    const f1 = await fileEntity.createFile(makeInput({ name: 'a.txt', contentHash: hash }));
    const f2 = await fileEntity.createFile(makeInput({ name: 'b.txt', contentHash: hash }));
    const groups = await blobs.findAllDuplicateGroups();
    expect(groups[0].redundantFileIds).not.toContain(f1.fileId);
    expect(groups[0].redundantFileIds).toContain(f2.fileId);
  });
});

describe('mergeDuplicates', () => {
  it('keep-first: mantém o primeiro e deleta os outros', async () => {
    const hash = 'a'.repeat(64);
    const f1 = await fileEntity.createFile(makeInput({ name: 'a.txt', contentHash: hash }));
    const f2 = await fileEntity.createFile(makeInput({ name: 'b.txt', contentHash: hash }));
    const f3 = await fileEntity.createFile(makeInput({ name: 'c.txt', contentHash: hash }));

    const result = await blobs.mergeDuplicates(hash, { strategy: 'keep-first' });
    expect(result.keptFileId).toBe(f1.fileId);
    expect(result.removedFileIds).toContain(f2.fileId);
    expect(result.removedFileIds).toContain(f3.fileId);
    expect(result.removedFileIds).toHaveLength(2);

    expect(await fileEntity.getFile(f1.fileId)).not.toBeNull();
    expect(await fileEntity.getFile(f2.fileId)).toBeNull();
    expect(await fileEntity.getFile(f3.fileId)).toBeNull();
  });

  it('keep-newest: mantém o mais recente', async () => {
    const hash = 'b'.repeat(64);
    await fileEntity.createFile(makeInput({ name: 'a.txt', contentHash: hash }));
    await new Promise((r) => setTimeout(r, 5));
    await fileEntity.createFile(makeInput({ name: 'b.txt', contentHash: hash }));
    await new Promise((r) => setTimeout(r, 5));
    const f3 = await fileEntity.createFile(makeInput({ name: 'c.txt', contentHash: hash }));

    const result = await blobs.mergeDuplicates(hash, { strategy: 'keep-newest' });
    expect(result.keptFileId).toBe(f3.fileId);
  });

  it('lança erro se não há duplicatas', async () => {
    await expect(blobs.mergeDuplicates('z'.repeat(64))).rejects.toThrow(/NOT_FOUND/);
  });

  it('merge de grupo com 2 files: mantém 1, remove 1', async () => {
    const hash = 'c'.repeat(64);
    const f1 = await fileEntity.createFile(makeInput({ name: 'a.txt', contentHash: hash }));
    await fileEntity.createFile(makeInput({ name: 'b.txt', contentHash: hash }));
    const result = await blobs.mergeDuplicates(hash);
    expect(result.removedFileIds).toHaveLength(1);
    expect(await fileEntity.getFile(f1.fileId)).not.toBeNull();
  });
});

describe('mergeAllDuplicates', () => {
  it('processa todos os grupos', async () => {
    const h1 = 'a'.repeat(64);
    const h2 = 'b'.repeat(64);
    await fileEntity.createFile(makeInput({ name: 'a.txt', contentHash: h1 }));
    await fileEntity.createFile(makeInput({ name: 'b.txt', contentHash: h1 }));
    await fileEntity.createFile(makeInput({ name: 'c.txt', contentHash: h2 }));
    await fileEntity.createFile(makeInput({ name: 'd.txt', contentHash: h2 }));
    await fileEntity.createFile(makeInput({ name: 'e.txt', contentHash: h2 }));

    const result = await blobs.mergeAllDuplicates();
    expect(result.groupsProcessed).toBe(2);
    expect(result.filesRemoved).toBe(3);
    expect(result.spaceSaved).toBe(100 * 1 + 100 * 2); // 1 + 2 redundantes
  });

  it('sem duplicatas: no-op', async () => {
    await fileEntity.createFile(makeInput({ name: 'a.txt', contentHash: 'a'.repeat(64) }));
    const result = await blobs.mergeAllDuplicates();
    expect(result.groupsProcessed).toBe(0);
    expect(result.filesRemoved).toBe(0);
  });
});

describe('reflinkTo', () => {
  it('cria novo file que referencia mesmo blob', async () => {
    const source = await fileEntity.createFile(makeInput({ name: 'original.txt', size: 500 }));
    const result = await blobs.reflinkTo({
      sourceFileId: source.fileId,
      newName: 'copia.txt',
    });
    expect(result.newFile.name).toBe('copia.txt');
    expect(result.newFile.contentHash).toBe(source.contentHash);
    expect(result.newFile.size).toBe(500);
    expect(result.sharedContentHash).toBe(source.contentHash);
  });

  it('reflink em folder diferente', async () => {
    const folder = await import('../services/folders').then((m) => m.createFolder({ name: 'sub' }));
    const source = await fileEntity.createFile(makeInput({ name: 'a.txt' }));
    const result = await blobs.reflinkTo({
      sourceFileId: source.fileId,
      newName: 'a.txt',
      newFolderId: folder.id,
    });
    expect(result.newFile.folderId).toBe(folder.id);
  });

  it('lança erro se source não existe', async () => {
    await expect(blobs.reflinkTo({ sourceFileId: 'f-nope', newName: 'x' })).rejects.toThrow(/NOT_FOUND/);
  });

  it('reflink preserva mimeType do source se não fornecido', async () => {
    const source = await fileEntity.createFile(
      makeInput({ name: 'a.txt', mimeType: 'application/json' })
    );
    const result = await blobs.reflinkTo({ sourceFileId: source.fileId, newName: 'b.txt' });
    expect(result.newFile.mimeType).toBe('application/json');
  });

  it('reflink com mimeType customizado', async () => {
    const source = await fileEntity.createFile(makeInput({ name: 'a.txt' }));
    const result = await blobs.reflinkTo({
      sourceFileId: source.fileId,
      newName: 'b.txt',
      mimeType: 'image/png',
    });
    expect(result.newFile.mimeType).toBe('image/png');
  });
});

describe('getDeduplicationReport', () => {
  it('sem files: zeros', async () => {
    const report = await blobs.getDeduplicationReport();
    expect(report.totalFiles).toBe(0);
    expect(report.duplicateGroups).toBe(0);
    expect(report.potentialSavings).toBe(0);
    expect(report.deduplicationRatio).toBe(1);
  });

  it('conta duplicatas e savings', async () => {
    const hash = 'a'.repeat(64);
    await fileEntity.createFile(makeInput({ name: 'a.txt', contentHash: hash, size: 1000 }));
    await fileEntity.createFile(makeInput({ name: 'b.txt', contentHash: hash, size: 1000 }));
    await fileEntity.createFile(makeInput({ name: 'c.txt', contentHash: hash, size: 1000 }));
    await fileEntity.createFile(makeInput({ name: 'd.txt', contentHash: 'b'.repeat(64), size: 500 }));
    const report = await blobs.getDeduplicationReport();
    expect(report.totalFiles).toBe(4);
    expect(report.duplicateGroups).toBe(1);
    expect(report.duplicateFiles).toBe(3);
    expect(report.uniqueBlobs).toBe(2);
    expect(report.potentialSavings).toBe(2000);
    expect(report.deduplicationRatio).toBe(0.5);
  });

  it('sem duplicatas: ratio=1', async () => {
    await fileEntity.createFile(makeInput({ name: 'a.txt', contentHash: 'a'.repeat(64) }));
    await fileEntity.createFile(makeInput({ name: 'b.txt', contentHash: 'b'.repeat(64) }));
    const report = await blobs.getDeduplicationReport();
    expect(report.deduplicationRatio).toBe(1);
    expect(report.duplicateGroups).toBe(0);
  });
});

describe('reconcileBlobRefCounts', () => {
  it('ajusta refCount para bater com # de files', async () => {
    const hash = 'a'.repeat(64);
    await fileEntity.createFile(makeInput({ name: 'a.txt', contentHash: hash }));
    await fileEntity.createFile(makeInput({ name: 'b.txt', contentHash: hash }));
    await fileEntity.createFile(makeInput({ name: 'c.txt', contentHash: hash }));
    // Forçar refCount errado
    const blob = await blobs.getBlobRecord(hash);
    if (blob) {
      await db.put(db.STORE_BLOBS, { ...blob, refCount: 10 });
    }
    const result = await blobs.reconcileBlobRefCounts();
    expect(result.adjusted).toBe(1);
    const fixed = await blobs.getBlobRecord(hash);
    expect(fixed?.refCount).toBe(3);
  });

  it('remove blobs sem files referenciando', async () => {
    const hash = 'b'.repeat(64);
    await blobs.storeBlob({ data: new TextEncoder().encode('orphan') });
    const orphan = await blobs.getBlobRecord(hash);
    if (orphan) {
      expect(orphan.refCount).toBe(0);
    }
    void hash;
    const result = await blobs.reconcileBlobRefCounts();
    expect(result.removed).toBeGreaterThanOrEqual(1);
  });

  it('não ajusta blobs corretos', async () => {
    const { record } = await blobs.storeBlob({ data: new TextEncoder().encode('test') });
    const hash = record.contentHash;
    await fileEntity.createFile(makeInput({ name: 'a.txt', contentHash: hash }));
    const blob = await blobs.getBlobRecord(hash);
    if (blob) {
      await db.put(db.STORE_BLOBS, { ...blob, refCount: 1 });
    }
    const result = await blobs.reconcileBlobRefCounts();
    expect(result.adjusted).toBe(0);
  });
});

describe('Integração: reflink + merge + report', () => {
  it('reflink cria duplicata que aparece no report', async () => {
    const source = await fileEntity.createFile(makeInput({ name: 'orig.txt', size: 1000 }));
    await blobs.reflinkTo({ sourceFileId: source.fileId, newName: 'copia.txt' });
    const report = await blobs.getDeduplicationReport();
    expect(report.duplicateGroups).toBe(1);
    expect(report.duplicateFiles).toBe(2);
  });

  it('merge reduz duplicateFiles', async () => {
    const source = await fileEntity.createFile(makeInput({ name: 'a.txt', size: 1000 }));
    await blobs.reflinkTo({ sourceFileId: source.fileId, newName: 'b.txt' });
    await blobs.reflinkTo({ sourceFileId: source.fileId, newName: 'c.txt' });
    expect((await blobs.getDeduplicationReport()).duplicateFiles).toBe(3);

    const mergeResult = await blobs.mergeDuplicates(source.contentHash, { strategy: 'keep-first' });
    expect(mergeResult.removedFileIds).toHaveLength(2);
    expect((await blobs.getDeduplicationReport()).duplicateFiles).toBe(0);
  });
});

describe('end-to-end com content hash real', () => {
  it('reflink baseado em hash calculado de dados reais', async () => {
    const data = new TextEncoder().encode('real content here');
    const hash = await sha256Hex(data);
    await blobs.storeBlob({ data });
    const source = await fileEntity.createFile(
      makeInput({ name: 'original.txt', size: data.byteLength, contentHash: hash })
    );
    const reflink = await blobs.reflinkTo({ sourceFileId: source.fileId, newName: 'alias.txt' });
    expect(reflink.newFile.contentHash).toBe(hash);
    expect(reflink.sharedContentHash).toBe(hash);
  });
});
