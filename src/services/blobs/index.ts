import * as db from '../db/index';

/**
 * Content-addressed blob reference.
 *
 * Separa a metadata do arquivo (FileRecord) do conteúdo binário.
 * O conteúdo é identificado unicamente pelo seu SHA-256 hash (contentHash).
 *
 * Na Fase 3 (Integridade e Storage), múltiplos FileRecord podem referenciar
 * o mesmo BlobRef, habilitando deduplicação real.
 *
 * Por enquanto (Fase 1.3), BlobRef é conceitual — não há store separado para blobs.
 * O conteúdo ainda reside nos chunks Nostr (kind 1064) e é identificado pelo
 * `encryptedHash` no header event (kind 1063).
 */
export interface BlobRef {
  contentHash: string;
  size: number;
  encrypted: boolean;
  compression?: 'gzip' | 'none';
  /** Tamanho após compressão (se aplicável) */
  compressedSize?: number;
}

export class BlobError extends Error {
  constructor(
    message: string,
    public readonly code: 'INVALID_HASH' | 'HASH_MISMATCH' | 'NOT_FOUND'
  ) {
    super(message);
    this.name = 'BlobError';
  }
}

const HASH_PATTERN = /^[0-9a-f]{64}$/;

function validateHash(hash: string): void {
  if (!hash || !HASH_PATTERN.test(hash)) {
    throw new BlobError(`Hash inválido: esperado SHA-256 hex de 64 chars`, 'INVALID_HASH');
  }
}

export function createBlobRef(
  contentHash: string,
  size: number,
  options: { encrypted?: boolean; compression?: 'gzip' | 'none'; compressedSize?: number } = {}
): BlobRef {
  validateHash(contentHash);
  if (size < 0) {
    throw new BlobError('size não pode ser negativo', 'INVALID_HASH');
  }
  if (options.compressedSize !== undefined && options.compressedSize < 0) {
    throw new BlobError('compressedSize não pode ser negativo', 'INVALID_HASH');
  }
  return {
    contentHash,
    size,
    encrypted: options.encrypted ?? true,
    compression: options.compression ?? 'none',
    compressedSize: options.compressedSize,
  };
}

/**
 * Verifica se o hash calculado bate com o esperado.
 * Usado após download para validar integridade.
 */
export async function verifyBlob(ref: BlobRef, data: Uint8Array): Promise<boolean> {
  const { sha256Hex } = await import('../crypto/index');
  const actual = await sha256Hex(data);
  return actual === ref.contentHash;
}

/**
 * Encontra todos os FileRecord que referenciam o mesmo contentHash.
 * Base para deduplicação (Fase 3).
 */
export async function findFilesByBlobHash(contentHash: string): Promise<db.FileRecord[]> {
  validateHash(contentHash);
  const all = await db.getAll<db.FileRecord>(db.STORE_FILES);
  return all.filter((f) => f.contentHash === contentHash);
}

/**
 * Calcula economia de espaço se todos os arquivos com mesmo hash
 * compartilhassem o mesmo blob físico.
 */
export interface DedupStats {
  uniqueBlobs: number;
  totalReferences: number;
  duplicateReferences: number;
  potentialSavings: number;
}

export async function computeDedupStats(): Promise<DedupStats> {
  const all = await db.getAll<db.FileRecord>(db.STORE_FILES);
  const byHash = new Map<string, db.FileRecord[]>();
  for (const f of all) {
    const list = byHash.get(f.contentHash) ?? [];
    list.push(f);
    byHash.set(f.contentHash, list);
  }

  let totalReferences = 0;
  let duplicateReferences = 0;
  let potentialSavings = 0;

  for (const [_hash, files] of byHash) {
    totalReferences += files.length;
    if (files.length > 1) {
      duplicateReferences += files.length - 1;
      // Savings = (refs - 1) * size
      const size = files[0].size;
      potentialSavings += (files.length - 1) * size;
    }
  }

  return {
    uniqueBlobs: byHash.size,
    totalReferences,
    duplicateReferences,
    potentialSavings,
  };
}
