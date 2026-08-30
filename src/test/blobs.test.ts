import { describe, it, expect, beforeEach } from 'vitest';
import * as db from '../services/db';
import * as blobs from '../services/blobs';
import { BlobError } from '../services/blobs';
import * as fileEntity from '../services/file-entity';

beforeEach(async () => {
  db.__useIsolatedDatabaseForTesting();
  localStorage.clear();
  await db.clear(db.STORE_FILES);
  await db.clear(db.STORE_FOLDERS);
});

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

describe('createBlobRef', () => {
  it('cria BlobRef com hash válido', () => {
    const ref = blobs.createBlobRef(HASH_A, 1024);
    expect(ref.contentHash).toBe(HASH_A);
    expect(ref.size).toBe(1024);
    expect(ref.encrypted).toBe(true);
    expect(ref.compression).toBe('none');
  });

  it('aceita compression gzip', () => {
    const ref = blobs.createBlobRef(HASH_A, 1024, { compression: 'gzip', compressedSize: 500 });
    expect(ref.compression).toBe('gzip');
    expect(ref.compressedSize).toBe(500);
  });

  it('aceita encrypted=false', () => {
    const ref = blobs.createBlobRef(HASH_A, 1024, { encrypted: false });
    expect(ref.encrypted).toBe(false);
  });

  it('lança erro em hash inválido (curto)', () => {
    expect(() => blobs.createBlobRef('abc', 100)).toThrow(BlobError);
  });

  it('lança erro em hash com caracteres não-hex', () => {
    expect(() => blobs.createBlobRef('g'.repeat(64), 100)).toThrow(BlobError);
  });

  it('lança erro em hash vazio', () => {
    expect(() => blobs.createBlobRef('', 100)).toThrow(BlobError);
  });

  it('lança erro em size negativo', () => {
    expect(() => blobs.createBlobRef(HASH_A, -1)).toThrow(BlobError);
  });

  it('lança erro em compressedSize negativo', () => {
    expect(() => blobs.createBlobRef(HASH_A, 100, { compressedSize: -1 })).toThrow(BlobError);
  });
});

describe('verifyBlob', () => {
  it('retorna true quando hash confere', async () => {
    const data = new TextEncoder().encode('hello world');
    const { sha256Hex } = await import('../services/crypto/index');
    const hash = await sha256Hex(data);
    const ref = blobs.createBlobRef(hash, data.length);
    expect(await blobs.verifyBlob(ref, data)).toBe(true);
  });

  it('retorna false quando hash não confere', async () => {
    const ref = blobs.createBlobRef(HASH_A, 11);
    const wrongData = new TextEncoder().encode('hello world');
    expect(await blobs.verifyBlob(ref, wrongData)).toBe(false);
  });

  it('detecta corrupção (1 byte alterado)', async () => {
    const data = new TextEncoder().encode('hello world');
    const { sha256Hex } = await import('../services/crypto/index');
    const hash = await sha256Hex(data);
    const ref = blobs.createBlobRef(hash, data.length);

    const corrupted = new Uint8Array(data);
    corrupted[0] = 72; // 'H' -> mantém igual, muda outro
    corrupted[1] = (corrupted[1] + 1) % 256;
    expect(await blobs.verifyBlob(ref, corrupted)).toBe(false);
  });
});

describe('findFilesByBlobHash', () => {
  it('retorna array vazio se nenhum arquivo referencia o hash', async () => {
    expect(await blobs.findFilesByBlobHash(HASH_A)).toEqual([]);
  });

  it('retorna arquivos que referenciam o mesmo hash', async () => {
    const f1 = await fileEntity.createFile({
      name: 'a.pdf',
      mimeType: 'application/pdf',
      size: 100,
      contentHash: HASH_A,
      chunks: 1,
      headerEventId: 'h-a',
      encrypted: true,
    });
    const f2 = await fileEntity.createFile({
      name: 'b.pdf',
      mimeType: 'application/pdf',
      size: 100,
      contentHash: HASH_A,
      chunks: 1,
      headerEventId: 'h-b',
      encrypted: true,
    });
    await fileEntity.createFile({
      name: 'c.pdf',
      mimeType: 'application/pdf',
      size: 200,
      contentHash: HASH_B,
      chunks: 1,
      headerEventId: 'h-c',
      encrypted: true,
    });

    const refs = await blobs.findFilesByBlobHash(HASH_A);
    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.fileId).sort()).toEqual([f1.fileId, f2.fileId].sort());
  });

  it('lança erro em hash inválido', async () => {
    await expect(blobs.findFilesByBlobHash('invalid')).rejects.toThrow(BlobError);
  });
});

describe('computeDedupStats', () => {
  it('retorna zeros quando não há arquivos', async () => {
    const stats = await blobs.computeDedupStats();
    expect(stats.uniqueBlobs).toBe(0);
    expect(stats.totalReferences).toBe(0);
    expect(stats.duplicateReferences).toBe(0);
    expect(stats.potentialSavings).toBe(0);
  });

  it('conta duplicatas corretamente', async () => {
    const mk = (name: string, hash: string, size: number) =>
      fileEntity.createFile({
        name,
        mimeType: 'application/pdf',
        size,
        contentHash: hash,
        chunks: 1,
        headerEventId: `h-${name}`,
        encrypted: true,
      });

    await mk('a.pdf', HASH_A, 100);
    await mk('b.pdf', HASH_A, 100);
    await mk('c.pdf', HASH_A, 100);
    await mk('d.pdf', HASH_B, 200);
    await mk('e.pdf', HASH_C, 50);

    const stats = await blobs.computeDedupStats();
    expect(stats.uniqueBlobs).toBe(3);
    expect(stats.totalReferences).toBe(5);
    expect(stats.duplicateReferences).toBe(2);
    // 2 dupes * 100 bytes = 200
    expect(stats.potentialSavings).toBe(200);
  });

  it('sem duplicatas, savings = 0', async () => {
    const mk = (name: string, hash: string) =>
      fileEntity.createFile({
        name,
        mimeType: 'application/pdf',
        size: 100,
        contentHash: hash,
        chunks: 1,
        headerEventId: `h-${name}`,
        encrypted: true,
      });
    await mk('a.pdf', HASH_A);
    await mk('b.pdf', HASH_B);

    const stats = await blobs.computeDedupStats();
    expect(stats.uniqueBlobs).toBe(2);
    expect(stats.duplicateReferences).toBe(0);
    expect(stats.potentialSavings).toBe(0);
  });
});
