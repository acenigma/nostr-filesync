import * as db from '../db/index';
import * as fileEntity from '../file-entity/index';
import * as blobStorage from './storage';

export interface DuplicateGroup {
  contentHash: string;
  fileIds: string[];
  totalSize: number;
  potentialSavings: number;
  /** IDs de files que poderiam ser removidos sem perder o blob (mantém 1) */
  redundantFileIds: string[];
}

export interface DeduplicationReport {
  totalFiles: number;
  totalBlobs: number;
  duplicateGroups: number;
  duplicateFiles: number;
  uniqueBlobs: number;
  totalSize: number;
  potentialSavings: number;
  deduplicationRatio: number;
}

export class DeduplicationError extends Error {
  constructor(
    message: string,
    public readonly code: 'NOT_FOUND' | 'CANNOT_MERGE' | 'INVALID'
  ) {
    super(message);
    this.name = 'DeduplicationError';
  }
}

export async function findDuplicatesByHash(contentHash: string): Promise<db.FileRecord[]> {
  const all = await fileEntity.listAllFiles();
  return all.filter((f) => f.contentHash === contentHash);
}

export async function findAllDuplicateGroups(): Promise<DuplicateGroup[]> {
  const all = await fileEntity.listAllFiles();
  const byHash = new Map<string, db.FileRecord[]>();
  for (const file of all) {
    if (!file.contentHash) continue;
    const list = byHash.get(file.contentHash) ?? [];
    list.push(file);
    byHash.set(file.contentHash, list);
  }

  const groups: DuplicateGroup[] = [];
  for (const [hash, files] of byHash) {
    if (files.length <= 1) continue;
    const totalSize = files[0].size;
    groups.push({
      contentHash: hash,
      fileIds: files.map((f) => f.fileId),
      totalSize,
      potentialSavings: totalSize * (files.length - 1),
      redundantFileIds: files.slice(1).map((f) => f.fileId),
    });
  }

  return groups.sort((a, b) => b.potentialSavings - a.potentialSavings);
}

export interface MergeDuplicatesOptions {
  /**
   * Estratégia: 'keep-first' mantém o primeiro FileRecord e deleta os outros.
   * 'keep-newest' mantém o mais recente (updatedAt) e deleta os outros.
   */
  strategy?: 'keep-first' | 'keep-newest';
}

export interface MergeResult {
  keptFileId: string;
  removedFileIds: string[];
  contentHash: string;
}

/**
 * Faz merge de duplicatas: mantém um FileRecord e deleta os outros.
 * O blob (contentHash) permanece — apenas os FileRecords redundantes são removidos.
 */
export async function mergeDuplicates(
  contentHash: string,
  options: MergeDuplicatesOptions = {}
): Promise<MergeResult> {
  const strategy = options.strategy ?? 'keep-first';
  const duplicates = await findDuplicatesByHash(contentHash);
  if (duplicates.length === 0) {
    throw new DeduplicationError(`NOT_FOUND: Nenhum file encontrado com hash ${contentHash}`, 'NOT_FOUND');
  }

  let kept: db.FileRecord;
  if (strategy === 'keep-newest') {
    const sorted = [...duplicates].sort((a, b) => b.updatedAt - a.updatedAt);
    kept = sorted[0];
  } else {
    kept = duplicates[0];
  }

  const removedFileIds: string[] = [];
  for (const file of duplicates) {
    if (file.fileId === kept.fileId) continue;
    await fileEntity.deleteFile(file.fileId);
    removedFileIds.push(file.fileId);
  }

  return {
    keptFileId: kept.fileId,
    removedFileIds,
    contentHash,
  };
}

export interface MergeAllResult {
  groupsProcessed: number;
  filesRemoved: number;
  spaceSaved: number;
}

export async function mergeAllDuplicates(
  options: MergeDuplicatesOptions = {}
): Promise<MergeAllResult> {
  const groups = await findAllDuplicateGroups();
  let filesRemoved = 0;
  let spaceSaved = 0;

  for (const group of groups) {
    const result = await mergeDuplicates(group.contentHash, options);
    filesRemoved += result.removedFileIds.length;
    spaceSaved += result.removedFileIds.length * group.totalSize;
  }

  return {
    groupsProcessed: groups.length,
    filesRemoved,
    spaceSaved,
  };
}

/**
 * Cria um novo FileRecord que referencia o mesmo blob (contentHash) de um file existente.
 * Não requer novo upload — apenas registro de metadata.
 */
export interface ReflinkInput {
  sourceFileId: string;
  newName: string;
  newFolderId?: string | null;
  mimeType?: string;
}

export interface ReflinkResult {
  newFile: db.FileRecord;
  sourceFile: db.FileRecord;
  sharedContentHash: string;
}

export async function reflinkTo(input: ReflinkInput): Promise<ReflinkResult> {
  const source = await fileEntity.getFile(input.sourceFileId);
  if (!source) {
    throw new DeduplicationError(`NOT_FOUND: File origem não encontrado: ${input.sourceFileId}`, 'NOT_FOUND');
  }

  const now = Date.now();
  const newFile = await fileEntity.createFile({
    name: input.newName,
    folderId: input.newFolderId ?? source.folderId,
    mimeType: input.mimeType ?? source.mimeType,
    size: source.size,
    contentHash: source.contentHash,
    encryptedHash: source.encryptedHash,
    chunks: source.chunks,
    headerEventId: `local-${now}-${Math.random().toString(36).slice(2, 12)}`,
    encrypted: source.encrypted,
    compression: source.compression,
  });

  return {
    newFile,
    sourceFile: source,
    sharedContentHash: source.contentHash,
  };
}

export async function getDeduplicationReport(): Promise<DeduplicationReport> {
  const allFiles = await fileEntity.listAllFiles();
  const allBlobs = await blobStorage.listAllBlobs();
  const groups = await findAllDuplicateGroups();

  const duplicateFiles = groups.reduce((sum, g) => sum + g.fileIds.length, 0);
  const totalSize = allFiles.reduce((sum, f) => sum + f.size, 0);
  const potentialSavings = groups.reduce((sum, g) => sum + g.potentialSavings, 0);
  const uniqueBlobs = allFiles.length - duplicateFiles + groups.length;

  return {
    totalFiles: allFiles.length,
    totalBlobs: allBlobs.length,
    duplicateGroups: groups.length,
    duplicateFiles,
    uniqueBlobs,
    totalSize,
    potentialSavings,
    deduplicationRatio: allFiles.length > 0 ? uniqueBlobs / allFiles.length : 1,
  };
}

/**
 * Refcount reconciliation: ajusta o refCount de cada blob para bater com
 * o número real de FileRecords que o referenciam. Útil após migrations ou
 * corrupções.
 */
export interface ReconcileResult {
  adjusted: number;
  removed: number;
  errors: string[];
}

export async function reconcileBlobRefCounts(): Promise<ReconcileResult> {
  const all = await blobStorage.listAllBlobs();
  const files = await fileEntity.listAllFiles();
  const expectedCounts = new Map<string, number>();
  for (const file of files) {
    if (!file.contentHash) continue;
    const hash = file.contentHash.toLowerCase();
    expectedCounts.set(hash, (expectedCounts.get(hash) ?? 0) + 1);
  }

  const result: ReconcileResult = { adjusted: 0, removed: 0, errors: [] };
  const existingHashes = new Set(all.map((b) => b.contentHash.toLowerCase()));
  for (const blob of all) {
    const hash = blob.contentHash.toLowerCase();
    const expected = expectedCounts.get(hash) ?? 0;
    if (expected === 0) {
      try {
        await db.del(db.STORE_BLOBS, blob.contentHash);
        result.removed++;
      } catch (e) {
        result.errors.push(`${blob.contentHash}: ${(e as Error).message}`);
      }
    } else if (blob.refCount !== expected) {
      try {
        await db.put(db.STORE_BLOBS, { ...blob, refCount: expected });
        result.adjusted++;
      } catch (e) {
        result.errors.push(`${blob.contentHash}: ${(e as Error).message}`);
      }
    }
  }

  for (const [hash, expected] of expectedCounts) {
    if (existingHashes.has(hash)) continue;
    if (expected === 0) continue;
    try {
      const now = Date.now();
      const record: db.BlobRecord = {
        contentHash: hash,
        size: 0,
        encrypted: false,
        compression: 'none',
        refCount: expected,
        createdAt: now,
        lastAccessedAt: now,
      };
      await db.put(db.STORE_BLOBS, record);
      result.adjusted++;
    } catch (e) {
      result.errors.push(`${hash}: ${(e as Error).message}`);
    }
  }

  return result;
}

export { db, fileEntity, blobStorage as blobs };
