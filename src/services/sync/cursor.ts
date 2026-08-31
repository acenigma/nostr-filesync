import * as db from '../db/index';
import type { SyncCursor } from '../db/index';

export type { SyncCursor } from '../db/index';

function makeId(pubkey: string, relayUrl: string): string {
  return `${pubkey}:${relayUrl}`;
}

function validatePubkey(pubkey: string): void {
  if (!pubkey || !/^[0-9a-f]{64}$/i.test(pubkey)) {
    throw new Error(`pubkey inválido: ${pubkey}`);
  }
}

export function getCursorId(pubkey: string, relayUrl: string): string {
  return makeId(pubkey, relayUrl);
}

export async function getCursor(
  pubkey: string,
  relayUrl: string
): Promise<SyncCursor | null> {
  const id = makeId(pubkey, relayUrl);
  const cursor = await db.get<SyncCursor>(db.STORE_SYNC_CURSORS, id);
  return cursor ?? null;
}

export async function setCursor(
  pubkey: string,
  relayUrl: string,
  lastEventId: string,
  lastEventCreatedAt: number
): Promise<SyncCursor> {
  validatePubkey(pubkey);
  const id = makeId(pubkey, relayUrl);
  const cursor: SyncCursor = {
    id,
    pubkey,
    relayUrl,
    lastEventId,
    lastEventCreatedAt,
    updatedAt: Date.now(),
  };
  await db.put(db.STORE_SYNC_CURSORS, cursor);
  return cursor;
}

export async function advanceCursor(
  pubkey: string,
  relayUrl: string,
  eventId: string,
  createdAt: number
): Promise<SyncCursor> {
  validatePubkey(pubkey);
  const existing = await getCursor(pubkey, relayUrl);
  if (existing && existing.lastEventCreatedAt >= createdAt) {
    return existing;
  }
  return setCursor(pubkey, relayUrl, eventId, createdAt);
}

export async function deleteCursor(
  pubkey: string,
  relayUrl: string
): Promise<boolean> {
  const id = makeId(pubkey, relayUrl);
  const existing = await db.get<SyncCursor>(db.STORE_SYNC_CURSORS, id);
  if (!existing) return false;
  await db.del(db.STORE_SYNC_CURSORS, id);
  return true;
}

export async function listCursorsByPubkey(pubkey: string): Promise<SyncCursor[]> {
  const all = await db.getAll<SyncCursor>(db.STORE_SYNC_CURSORS);
  return all.filter((c) => c.pubkey === pubkey);
}

export async function listAllCursors(): Promise<SyncCursor[]> {
  return db.getAll<SyncCursor>(db.STORE_SYNC_CURSORS);
}
