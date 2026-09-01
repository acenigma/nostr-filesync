import * as db from '../db/index';
import * as blobs from '../blobs/index';
import * as fileEntity from '../file-entity/index';
import * as folders from '../folders/index';
import * as tombstones from '../tombstones/index';

export const GC_VERSION = '1.0.0';

const DEFAULT_AGE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 50;
const MIN_BATCH_SIZE = 1;
const MAX_BATCH_SIZE = 1000;

export interface GCOptions {
  /** Idade mínima para considerar um blob para coleta (ms). Default: 7 dias */
  ageThresholdMs?: number;
  /** Tamanho do batch para evitar travamentos. Default: 50 */
  batchSize?: number;
  /** Se true, não remove nada, apenas retorna o que seria removido */
  dryRun?: boolean;
  /** Callback de progresso (0..1) */
  onProgress?: (progress: GCProgress) => void;
  /** Callback para cancelar (retornar true para parar) */
  shouldCancel?: () => boolean;
}

export interface GCProgress {
  phase: 'marking' | 'collecting' | 'done';
  total: number;
  processed: number;
  currentHash?: string;
}

export interface GCMarkedSet {
  used: Set<string>;
  orphanCandidates: Set<string>;
  markedAt: number;
}

export interface GCResult {
  totalBlobs: number;
  marked: number;
  candidates: number;
  removed: number;
  bytesFreed: number;
  dryRun: boolean;
  durationMs: number;
  cancelled: boolean;
  removedHashes?: string[];
}

export interface GCStats {
  totalBlobs: number;
  usedBlobs: number;
  orphanBlobs: number;
  recyclableBlobs: number;
  bytesUsed: number;
  bytesOrphan: number;
  bytesRecyclable: number;
}

let scheduledTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Mark phase: identifica todos os blobs referenciados por files vivos.
 */
export async function markUsedBlobs(): Promise<Set<string>> {
  const files = await db.getAll<db.FileRecord>(db.STORE_FILES);
  const used = new Set<string>();
  for (const file of files) {
    if (file.contentHash && /^[0-9a-f]{64}$/i.test(file.contentHash)) {
      used.add(file.contentHash.toLowerCase());
    }
  }
  return used;
}

/**
 * Find orphans: blobs não referenciados por files vivos.
 * Inclui blobs com refCount=0 E blobs marcados como "usados" mas que na verdade não são.
 */
export async function findOrphans(): Promise<db.BlobRecord[]> {
  const used = await markUsedBlobs();
  const allBlobs = await blobs.listAllBlobs();
  return allBlobs.filter((blob) => !used.has(blob.contentHash.toLowerCase()));
}

/**
 * Marca todos os blobs referenciados e classifica em used vs orphan.
 */
export async function classifyBlobs(): Promise<GCMarkedSet> {
  const used = await markUsedBlobs();
  const allBlobs = await blobs.listAllBlobs();
  const orphanCandidates = new Set<string>();
  for (const blob of allBlobs) {
    if (!used.has(blob.contentHash.toLowerCase())) {
      orphanCandidates.add(blob.contentHash);
    }
  }
  return {
    used,
    orphanCandidates,
    markedAt: Date.now(),
  };
}

/**
 * Coleta garbage: remove blobs orphans antigos.
 */
export async function collectGarbage(options: GCOptions = {}): Promise<GCResult> {
  const start = Date.now();
  const ageThreshold = options.ageThresholdMs ?? DEFAULT_AGE_THRESHOLD_MS;
  const batchSize = Math.max(MIN_BATCH_SIZE, Math.min(options.batchSize ?? DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE));
  const dryRun = options.dryRun ?? false;
  const onProgress = options.onProgress;
  const shouldCancel = options.shouldCancel;

  const allBlobs = await blobs.listAllBlobs();
  const total = allBlobs.length;
  const now = Date.now();

  onProgress?.({ phase: 'marking', total, processed: 0 });

  const used = await markUsedBlobs();
  const marked = used.size;

  const orphans = allBlobs.filter((b) => {
    if (used.has(b.contentHash.toLowerCase())) return false;
    if (now - b.lastAccessedAt < ageThreshold) return false;
    return true;
  });

  onProgress?.({ phase: 'collecting', total: orphans.length, processed: 0 });

  const removedHashes: string[] = [];
  let bytesFreed = 0;
  let removed = 0;
  let cancelled = false;

  for (let i = 0; i < orphans.length; i++) {
    if (shouldCancel?.()) {
      cancelled = true;
      break;
    }
    const orphan = orphans[i];
    onProgress?.({
      phase: 'collecting',
      total: orphans.length,
      processed: i,
      currentHash: orphan.contentHash,
    });
    if (!dryRun) {
      try {
        await db.del(db.STORE_BLOBS, orphan.contentHash);
        removed++;
        bytesFreed += orphan.size;
        removedHashes.push(orphan.contentHash);
      } catch {
        // ignora erros individuais
      }
    } else {
      removedHashes.push(orphan.contentHash);
      bytesFreed += orphan.size;
    }

    if ((i + 1) % batchSize === 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  onProgress?.({ phase: 'done', total: orphans.length, processed: orphans.length });

  return {
    totalBlobs: total,
    marked,
    candidates: orphans.length,
    removed: dryRun ? 0 : removed,
    bytesFreed: dryRun ? 0 : bytesFreed,
    dryRun,
    durationMs: Date.now() - start,
    cancelled,
    removedHashes: dryRun ? removedHashes : undefined,
  };
}

/**
 * Agenda GC para executar após delayMs.
 */
export function scheduleGC(delayMs: number, options: GCOptions = {}): void {
  cancelScheduledGC();
  scheduledTimer = setTimeout(() => {
    scheduledTimer = null;
    void collectGarbage(options);
  }, delayMs);
}

/**
 * Cancela GC agendado.
 */
export function cancelScheduledGC(): void {
  if (scheduledTimer) {
    clearTimeout(scheduledTimer);
    scheduledTimer = null;
  }
}

/**
 * Retorna se há GC agendado.
 */
export function isGCScheduled(): boolean {
  return scheduledTimer !== null;
}

export async function getGCStats(): Promise<GCStats> {
  const used = await markUsedBlobs();
  const allBlobs = await blobs.listAllBlobs();
  const now = Date.now();

  let usedBlobs = 0;
  let orphanBlobs = 0;
  let recyclableBlobs = 0;
  let bytesUsed = 0;
  let bytesOrphan = 0;
  let bytesRecyclable = 0;

  for (const blob of allBlobs) {
    const isUsed = used.has(blob.contentHash.toLowerCase());
    if (isUsed) {
      usedBlobs++;
      bytesUsed += blob.size;
    } else {
      orphanBlobs++;
      bytesOrphan += blob.size;
      if (now - blob.lastAccessedAt > DEFAULT_AGE_THRESHOLD_MS) {
        recyclableBlobs++;
        bytesRecyclable += blob.size;
      }
    }
  }

  return {
    totalBlobs: allBlobs.length,
    usedBlobs,
    orphanBlobs,
    recyclableBlobs,
    bytesUsed,
    bytesOrphan,
    bytesRecyclable,
  };
}

/**
 * Remove blobs que foram marcados como "orphan" no scan anterior e estão fora do threshold.
 * Útil após rodar runFullScan() e o usuário confirmar.
 */
export async function collectFromScan(
  scanReport: { issues: { code: string; entityId?: string }[] },
  options: GCOptions = {}
): Promise<GCResult> {
  const orphanHashes = new Set<string>();
  for (const issue of scanReport.issues) {
    if (issue.code === 'BLOB_ORPHAN_TOO_OLD' && issue.entityId) {
      orphanHashes.add(issue.entityId);
    }
  }
  return collectSpecificBlobs(Array.from(orphanHashes), options);
}

/**
 * Coleta blobs específicos (lista de hashes).
 */
export async function collectSpecificBlobs(
  hashes: string[],
  options: GCOptions = {}
): Promise<GCResult> {
  const start = Date.now();
  const dryRun = options.dryRun ?? false;
  const onProgress = options.onProgress;
  const shouldCancel = options.shouldCancel;
  const batchSize = Math.max(MIN_BATCH_SIZE, Math.min(options.batchSize ?? DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE));

  onProgress?.({ phase: 'collecting', total: hashes.length, processed: 0 });

  const removedHashes: string[] = [];
  let bytesFreed = 0;
  let removed = 0;
  let cancelled = false;

  for (let i = 0; i < hashes.length; i++) {
    if (shouldCancel?.()) {
      cancelled = true;
      break;
    }
    const hash = hashes[i];
    onProgress?.({
      phase: 'collecting',
      total: hashes.length,
      processed: i,
      currentHash: hash,
    });
    if (!dryRun) {
      try {
        const record = await blobs.getBlobRecord(hash);
        if (record) {
          await db.del(db.STORE_BLOBS, hash);
          removed++;
          bytesFreed += record.size;
          removedHashes.push(hash);
        }
      } catch {
        // ignora
      }
    } else {
      removedHashes.push(hash);
    }

    if ((i + 1) % batchSize === 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  onProgress?.({ phase: 'done', total: hashes.length, processed: hashes.length });

  return {
    totalBlobs: hashes.length,
    marked: 0,
    candidates: hashes.length,
    removed: dryRun ? 0 : removed,
    bytesFreed: dryRun ? 0 : bytesFreed,
    dryRun,
    durationMs: Date.now() - start,
    cancelled,
    removedHashes: dryRun ? removedHashes : undefined,
  };
}

export { db, fileEntity, folders, tombstones };
