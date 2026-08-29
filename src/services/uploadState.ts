import * as db from './db';

const STORE = db.STORE_UPLOADS;
const STORAGE_UPLOADS = 'nostr_filesync_uploads';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface UploadState {
  fileId: string;
  headerEventId: string;
  fileName: string;
  fileType: string;
  size: number;
  path: string;
  chunksDone: number;
  totalChunks: number;
  startedAt: number;
  updatedAt?: number;
  headerPublished?: boolean;
  aborted?: boolean;
}

function loadLegacy(): Record<string, UploadState> {
  try {
    const raw = localStorage.getItem(STORAGE_UPLOADS);
    return raw ? (JSON.parse(raw) as Record<string, UploadState>) : {};
  } catch {
    return {};
  }
}

function saveLegacy(map: Record<string, UploadState>): void {
  localStorage.setItem(STORAGE_UPLOADS, JSON.stringify(map));
}

async function pruneOld(): Promise<void> {
  const all = await db.getAll<UploadState>(STORE);
  const now = Date.now();
  const stale: string[] = [];
  for (const v of all) {
    if (!v || (v.updatedAt && now - v.updatedAt > MAX_AGE_MS)) {
      stale.push(v.fileId);
    }
  }
  for (const id of stale) await db.del(STORE, id);
}

export async function saveUploadState(state: UploadState): Promise<void> {
  const next: UploadState = { ...state, updatedAt: Date.now() };
  await db.put(STORE, next);
}

export async function updateUploadState(
  fileId: string,
  patch: Partial<UploadState>
): Promise<void> {
  const existing = await db.get<UploadState>(STORE, fileId);
  if (!existing) return;
  await db.put(STORE, { ...existing, ...patch, updatedAt: Date.now() });
}

export async function getUploadState(fileId: string): Promise<UploadState | null> {
  return (await db.get<UploadState>(STORE, fileId)) ?? null;
}

export async function listPendingUploads(): Promise<UploadState[]> {
  await pruneOld();
  const all = await db.getAll<UploadState>(STORE);
  return all.filter((u) => u && u.chunksDone < u.totalChunks);
}

export async function listAllUploads(): Promise<UploadState[]> {
  await pruneOld();
  return db.getAll<UploadState>(STORE);
}

export async function removeUploadState(fileId: string): Promise<void> {
  await db.del(STORE, fileId);
}

export async function markUploadComplete(fileId: string): Promise<void> {
  await removeUploadState(fileId);
}

export async function clearAllUploadStates(): Promise<void> {
  await db.clear(STORE);
}

export async function migrateFromLegacy(): Promise<boolean> {
  const legacy = loadLegacy();
  const entries = Object.values(legacy).filter((v): v is UploadState => !!v);
  if (entries.length === 0) return false;
  const existing = await db.getAll<UploadState>(STORE);
  if (existing.length > 0) {
    saveLegacy({});
    return false;
  }
  await db.putAll(STORE, entries);
  saveLegacy({});
  return true;
}