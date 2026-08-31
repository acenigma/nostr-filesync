import * as db from '../db/index';
import type { SyncOperation, SyncOperationType, SyncOperationStatus } from '../db/index';
import { computeBackoff } from './backoff';

export type { SyncOperation, SyncOperationType, SyncOperationStatus } from '../db/index';

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 5;

function makeId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return 'op-' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface EnqueueInput {
  type: SyncOperationType;
  entityId: string;
  entityType: 'file' | 'folder';
  payload?: unknown;
  /** Delay inicial antes da primeira tentativa (ms). Default: 0 */
  initialDelayMs?: number;
}

export async function enqueue(input: EnqueueInput): Promise<SyncOperation> {
  const now = Date.now();
  const op: SyncOperation = {
    id: makeId(),
    type: input.type,
    entityId: input.entityId,
    entityType: input.entityType,
    payload: input.payload,
    createdAt: now,
    attempts: 0,
    nextAttemptAt: now + (input.initialDelayMs ?? 0),
    status: 'pending',
    updatedAt: now,
  };
  await db.put(db.STORE_SYNC_QUEUE, op);
  return op;
}

export async function getOperation(id: string): Promise<SyncOperation | null> {
  const op = await db.get<SyncOperation>(db.STORE_SYNC_QUEUE, id);
  return op ?? null;
}

export async function listAll(): Promise<SyncOperation[]> {
  return db.getAll<SyncOperation>(db.STORE_SYNC_QUEUE);
}

export async function listByStatus(status: SyncOperationStatus): Promise<SyncOperation[]> {
  const all = await listAll();
  return all.filter((op) => op.status === status);
}

export async function listReadyForExecution(now: number = Date.now()): Promise<SyncOperation[]> {
  const pending = await listByStatus('pending');
  return pending.filter((op) => op.nextAttemptAt <= now);
}

export async function listFailed(): Promise<SyncOperation[]> {
  return listByStatus('failed');
}

export async function markInProgress(id: string): Promise<SyncOperation> {
  const op = await requireOperation(id);
  if (op.status !== 'pending') {
    throw new Error(`Cannot mark in_progress from status ${op.status}`);
  }
  const updated: SyncOperation = {
    ...op,
    status: 'in_progress',
    attempts: op.attempts + 1,
    updatedAt: Date.now(),
  };
  await db.put(db.STORE_SYNC_QUEUE, updated);
  return updated;
}

export async function markCompleted(id: string): Promise<void> {
  const op = await requireOperation(id);
  const updated: SyncOperation = {
    ...op,
    status: 'completed',
    updatedAt: Date.now(),
  };
  await db.put(db.STORE_SYNC_QUEUE, updated);
}

export interface FailOptions {
  baseDelayMs?: number;
  maxAttempts?: number;
  jitter?: boolean;
}

export async function markFailed(
  id: string,
  error: string,
  options: FailOptions = {}
): Promise<SyncOperation> {
  const op = await requireOperation(id);
  const baseDelay = options.baseDelayMs ?? 1000;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const jitter = options.jitter ?? true;

  const permanent = op.attempts >= maxAttempts;
  const nextDelay = permanent ? 0 : computeBackoff(op.attempts, baseDelay, jitter);
  const now = Date.now();

  const updated: SyncOperation = {
    ...op,
    status: permanent ? 'failed' : 'pending',
    lastError: error,
    nextAttemptAt: permanent ? now : now + nextDelay,
    updatedAt: now,
  };
  await db.put(db.STORE_SYNC_QUEUE, updated);
  return updated;
}

export async function cancel(id: string): Promise<void> {
  const op = await requireOperation(id);
  if (op.status === 'completed' || op.status === 'cancelled') return;
  const updated: SyncOperation = {
    ...op,
    status: 'cancelled',
    updatedAt: Date.now(),
  };
  await db.put(db.STORE_SYNC_QUEUE, updated);
}

export async function cancelByEntity(entityId: string): Promise<number> {
  const all = await listAll();
  const toCancel = all.filter(
    (op) => op.entityId === entityId && op.status !== 'completed' && op.status !== 'cancelled'
  );
  for (const op of toCancel) {
    const updated: SyncOperation = {
      ...op,
      status: 'cancelled',
      updatedAt: Date.now(),
    };
    await db.put(db.STORE_SYNC_QUEUE, updated);
  }
  return toCancel.length;
}

export async function deleteOperation(id: string): Promise<boolean> {
  const op = await getOperation(id);
  if (!op) return false;
  await db.del(db.STORE_SYNC_QUEUE, id);
  return true;
}

export async function clearAll(): Promise<void> {
  await db.clear(db.STORE_SYNC_QUEUE);
}

export interface PruneResult {
  removed: number;
  remaining: number;
}

export async function pruneOld(maxAgeMs: number = MAX_AGE_MS): Promise<PruneResult> {
  const all = await listAll();
  const now = Date.now();
  const toRemove: string[] = [];
  for (const op of all) {
    if (op.status === 'completed' || op.status === 'cancelled' || op.status === 'failed') {
      if (now - op.updatedAt > maxAgeMs) {
        toRemove.push(op.id);
      }
    }
  }
  for (const id of toRemove) {
    await db.del(db.STORE_SYNC_QUEUE, id);
  }
  return { removed: toRemove.length, remaining: all.length - toRemove.length };
}

export interface QueueStats {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  failed: number;
  cancelled: number;
}

export async function getStats(): Promise<QueueStats> {
  const all = await listAll();
  const stats: QueueStats = {
    total: all.length,
    pending: 0,
    inProgress: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  };
  for (const op of all) {
    if (op.status === 'in_progress') stats.inProgress++;
    else stats[op.status]++;
  }
  return stats;
}

async function requireOperation(id: string): Promise<SyncOperation> {
  const op = await getOperation(id);
  if (!op) throw new Error(`Operação não encontrada: ${id}`);
  return op;
}
