import * as db from '../db/index';
import type { BlobRecord } from '../db/index';
import { sha256Hex } from '../crypto/index';
import * as blobIndex from './index';

const HASH_PATTERN = /^[0-9a-f]{64}$/;

function validateHash(hash: string): void {
  if (!hash || !HASH_PATTERN.test(hash)) {
    throw new Error(`Hash inválido: esperado SHA-256 hex de 64 chars, recebido '${hash}'`);
  }
}

export interface StoreBlobInput {
  data: Uint8Array;
  encrypted?: boolean;
  compression?: 'gzip' | 'none';
  expectedHash?: string;
}

export interface StoreBlobResult {
  record: BlobRecord;
  isNew: boolean;
}

export async function storeBlob(input: StoreBlobInput): Promise<StoreBlobResult> {
  const hash = await sha256Hex(input.data);
  if (input.expectedHash && input.expectedHash !== hash) {
    throw new Error(`Hash mismatch: esperado ${input.expectedHash}, calculado ${hash}`);
  }

  const existing = await getBlobRecord(hash);
  if (existing) {
    const updated: BlobRecord = {
      ...existing,
      lastAccessedAt: Date.now(),
    };
    await db.put(db.STORE_BLOBS, updated);
    return { record: updated, isNew: false };
  }

  const now = Date.now();
  const record: BlobRecord = {
    contentHash: hash,
    size: input.data.byteLength,
    encrypted: input.encrypted ?? false,
    compression: input.compression ?? 'none',
    refCount: 0,
    createdAt: now,
    lastAccessedAt: now,
  };
  await db.put(db.STORE_BLOBS, record);
  return { record, isNew: true };
}

export async function linkBlob(contentHash: string): Promise<BlobRecord | null> {
  validateHash(contentHash);
  const record = await getBlobRecord(contentHash);
  if (!record) return null;
  const updated: BlobRecord = {
    ...record,
    refCount: record.refCount + 1,
    lastAccessedAt: Date.now(),
  };
  await db.put(db.STORE_BLOBS, updated);
  return updated;
}

export async function unlinkBlob(contentHash: string): Promise<BlobRecord | null> {
  return releaseBlob(contentHash);
}

export async function getBlobRecord(contentHash: string): Promise<BlobRecord | null> {
  validateHash(contentHash);
  const record = await db.get<BlobRecord>(db.STORE_BLOBS, contentHash);
  return record ?? null;
}

export async function touchBlob(contentHash: string): Promise<BlobRecord | null> {
  validateHash(contentHash);
  const record = await getBlobRecord(contentHash);
  if (!record) return null;
  const updated: BlobRecord = { ...record, lastAccessedAt: Date.now() };
  await db.put(db.STORE_BLOBS, updated);
  return updated;
}

export async function releaseBlob(contentHash: string): Promise<BlobRecord | null> {
  validateHash(contentHash);
  const record = await getBlobRecord(contentHash);
  if (!record) return null;

  const newRefCount = Math.max(0, record.refCount - 1);
  const updated: BlobRecord = { ...record, refCount: newRefCount };
  await db.put(db.STORE_BLOBS, updated);
  return updated;
}

export async function getOrphanBlobs(): Promise<BlobRecord[]> {
  const all = await db.getAll<BlobRecord>(db.STORE_BLOBS);
  return all.filter((b) => b.refCount === 0);
}

export async function listAllBlobs(): Promise<BlobRecord[]> {
  return db.getAll<BlobRecord>(db.STORE_BLOBS);
}

export interface GarbageCollectResult {
  removed: number;
  kept: number;
  bytesFreed: number;
}

export async function garbageCollect(
  maxAgeMs: number = 7 * 24 * 60 * 60 * 1000
): Promise<GarbageCollectResult> {
  const orphans = await getOrphanBlobs();
  const now = Date.now();
  const toRemove: BlobRecord[] = [];
  for (const orphan of orphans) {
    if (now - orphan.lastAccessedAt > maxAgeMs) {
      toRemove.push(orphan);
    }
  }
  let bytesFreed = 0;
  for (const orphan of toRemove) {
    bytesFreed += orphan.size;
    await db.del(db.STORE_BLOBS, orphan.contentHash);
  }
  return { removed: toRemove.length, kept: orphans.length - toRemove.length, bytesFreed };
}

export interface StorageStats {
  totalBlobs: number;
  totalSize: number;
  totalCompressedSize: number;
  avgRefCount: number;
  orphanBlobs: number;
  fileReferences: number;
  dedupRatio: number;
}

export async function computeStorageStats(pubkey?: string): Promise<StorageStats> {
  const all = await listAllBlobs();
  const stats: StorageStats = {
    totalBlobs: all.length,
    totalSize: 0,
    totalCompressedSize: 0,
    avgRefCount: 0,
    orphanBlobs: 0,
    fileReferences: 0,
    dedupRatio: 1,
  };

  let totalRefs = 0;
  for (const blob of all) {
    stats.totalSize += blob.size;
    stats.totalCompressedSize += blob.compressedSize ?? blob.size;
    totalRefs += blob.refCount;
    if (blob.refCount === 0) stats.orphanBlobs++;
  }

  if (all.length > 0) {
    stats.avgRefCount = totalRefs / all.length;
  }

  const dedupStats = await blobIndex.computeDedupStats();
  stats.fileReferences = dedupStats.totalReferences;
  if (dedupStats.totalReferences > 0) {
    stats.dedupRatio = dedupStats.uniqueBlobs / dedupStats.totalReferences;
  }

  void pubkey;
  return stats;
}

export async function deleteBlob(contentHash: string): Promise<boolean> {
  validateHash(contentHash);
  const record = await getBlobRecord(contentHash);
  if (!record) return false;
  if (record.refCount > 0) {
    throw new Error(`Não pode deletar blob com refCount > 0 (atual: ${record.refCount})`);
  }
  await db.del(db.STORE_BLOBS, contentHash);
  return true;
}

export async function clearAllBlobs(): Promise<number> {
  const all = await listAllBlobs();
  for (const blob of all) {
    await db.del(db.STORE_BLOBS, blob.contentHash);
  }
  return all.length;
}
