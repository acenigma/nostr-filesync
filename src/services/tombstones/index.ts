import * as db from '../db/index';
import type { TombstoneRecord } from '../db/index';

export type { TombstoneRecord };

export type TombstoneReason = 'user' | 'sync' | 'cascade';

export interface CreateTombstoneInput {
  entityId: string;
  entityType: 'file' | 'folder';
  deletedBy: string;
  reason?: TombstoneReason;
  originalEntity?: unknown;
}

export class TombstoneError extends Error {
  constructor(
    message: string,
    public readonly code: 'INVALID_INPUT' | 'NOT_FOUND'
  ) {
    super(message);
    this.name = 'TombstoneError';
  }
}

function validateEntityId(id: string): void {
  if (!id || !id.trim()) {
    throw new TombstoneError('entityId não pode ser vazio', 'INVALID_INPUT');
  }
}

function validatePubkey(pubkey: string): void {
  if (!pubkey || !/^[0-9a-f]{64}$/i.test(pubkey)) {
    throw new TombstoneError('deletedBy deve ser uma pubkey hex de 64 chars', 'INVALID_INPUT');
  }
}

/**
 * Cria um tombstone para uma entidade deletada.
 * Idempotente: se já existe, atualiza `deletedAt` e `version`.
 */
export async function createTombstone(input: CreateTombstoneInput): Promise<TombstoneRecord> {
  validateEntityId(input.entityId);
  validatePubkey(input.deletedBy);

  const existing = await getTombstone(input.entityId);
  const now = Date.now();

  if (existing) {
    const updated: TombstoneRecord = {
      ...existing,
      deletedAt: now,
      version: existing.version + 1,
    };
    await db.put(db.STORE_TOMBSTONES, updated);
    return updated;
  }

  const tombstone: TombstoneRecord = {
    entityId: input.entityId,
    entityType: input.entityType,
    deletedAt: now,
    version: 1,
  };
  await db.put(db.STORE_TOMBSTONES, tombstone);
  return tombstone;
}

export async function getTombstone(entityId: string): Promise<TombstoneRecord | null> {
  const tomb = await db.get<TombstoneRecord>(db.STORE_TOMBSTONES, entityId);
  return tomb ?? null;
}

export async function listTombstones(
  entityType?: 'file' | 'folder'
): Promise<TombstoneRecord[]> {
  const all = await db.getAll<TombstoneRecord>(db.STORE_TOMBSTONES);
  return entityType ? all.filter((t) => t.entityType === entityType) : all;
}

export async function isDeleted(
  entityId: string,
  entityType: 'file' | 'folder'
): Promise<boolean> {
  const tomb = await getTombstone(entityId);
  return tomb !== null && tomb.entityType === entityType;
}

export async function deleteTombstone(entityId: string): Promise<boolean> {
  const existing = await getTombstone(entityId);
  if (!existing) return false;
  await db.del(db.STORE_TOMBSTONES, entityId);
  return true;
}

export interface PruneResult {
  removed: number;
  remaining: number;
}

export async function pruneOldTombstones(maxAgeMs: number): Promise<PruneResult> {
  const all = await db.getAll<TombstoneRecord>(db.STORE_TOMBSTONES);
  const now = Date.now();
  const toRemove: string[] = [];
  for (const t of all) {
    if (now - t.deletedAt > maxAgeMs) {
      toRemove.push(t.entityId);
    }
  }
  for (const id of toRemove) {
    await db.del(db.STORE_TOMBSTONES, id);
  }
  return { removed: toRemove.length, remaining: all.length - toRemove.length };
}
