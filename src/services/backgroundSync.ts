import * as filesync from './filesync';
import * as swMessaging from './swMessaging';
import * as notifications from './notifications';

export type BackgroundSyncStatus = 'idle' | 'running' | 'paused-offline' | 'error';

export interface BackgroundSyncState {
  status: BackgroundSyncStatus;
  lastRunAt: number | null;
  lastError: string | null;
  pendingCount: number;
  totalRuns: number;
}

const STORAGE_KEY = 'nostr_filesync_bg_sync_state';
const MIN_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 5 * 60_000;

let status: BackgroundSyncStatus = 'idle';
let lastRunAt: number | null = null;
let lastError: string | null = null;
let totalRuns = 0;
let consecutiveFailures = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let listeners: Array<(s: BackgroundSyncState) => void> = [];
let initialized = false;

function readPersisted(): Partial<BackgroundSyncState> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<BackgroundSyncState>;
  } catch {
    return {};
  }
}

function persist(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ lastRunAt, lastError, totalRuns })
    );
  } catch {
    /* quota */
  }
}

function getBackoffMs(): number {
  const exp = Math.min(consecutiveFailures, 6);
  const base = MIN_BACKOFF_MS * Math.pow(2, exp);
  const jitter = Math.random() * 0.3 * base;
  return Math.min(MAX_BACKOFF_MS, base + jitter);
}

function getState(): BackgroundSyncState {
  return { status, lastRunAt, lastError, pendingCount: 0, totalRuns };
}

function emit(): void {
  const s = getState();
  listeners.forEach((l) => l(s));
}

export function getBackgroundSyncState(): BackgroundSyncState {
  return getState();
}

export function onBackgroundSyncChange(listener: (s: BackgroundSyncState) => void): () => void {
  listeners.push(listener);
  listener(getState());
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

async function runOnce(): Promise<void> {
  if (status === 'running') return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    status = 'paused-offline';
    emit();
    return;
  }
  status = 'running';
  emit();
  try {
    const results = await filesync.resumePendingUploads();
    const ok = results.every((r) => r.ok);
    lastRunAt = Date.now();
    totalRuns++;
    if (ok) {
      lastError = null;
      consecutiveFailures = 0;
      status = 'idle';
      if (totalRuns === 1) {
        await notifications.notifySyncEvent({
          type: 'sync-recovered',
          message: 'Pendências sincronizadas',
        });
      }
    } else {
      const failed = results.filter((r) => !r.ok);
      lastError = failed[0]?.error || 'unknown';
      consecutiveFailures++;
      status = 'error';
      if (consecutiveFailures === 1) {
        await notifications.notifySyncEvent({
          type: 'sync-error',
          message: `${failed.length} operação(ões) falharam: ${lastError}`,
        });
      }
    }
    persist();
  } catch (e) {
    lastError = (e as Error).message || String(e);
    consecutiveFailures++;
    status = 'error';
    if (consecutiveFailures === 1) {
      await notifications.notifySyncEvent({
        type: 'sync-error',
        message: lastError,
      });
    }
    persist();
  } finally {
    emit();
  }
}

function scheduleNext(): void {
  if (timer) clearTimeout(timer);
  const delay = status === 'error' ? getBackoffMs() : MIN_BACKOFF_MS;
  timer = setTimeout(() => {
    void runOnce().finally(() => scheduleNext());
  }, delay);
}

export function startBackgroundSync(): void {
  if (initialized) return;
  initialized = true;
  const persisted = readPersisted();
  lastRunAt = persisted.lastRunAt ?? null;
  lastError = persisted.lastError ?? null;
  totalRuns = persisted.totalRuns ?? 0;

  const onOnline = () => {
    if (status === 'paused-offline') {
      status = 'idle';
      emit();
      if (timer) clearTimeout(timer);
      void runOnce().finally(() => scheduleNext());
    }
  };
  const onOffline = () => {
    status = 'paused-offline';
    emit();
  };
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);

  const onSwSync = (msg: swMessaging.SyncMessage) => {
    if (msg.type === 'SYNC_NOW') {
      if (timer) clearTimeout(timer);
      void runOnce().finally(() => scheduleNext());
    }
  };
  swMessaging.initServiceWorkerMessaging();
  const off = swMessaging.onSwMessage(onSwSync);

  void runOnce().finally(() => scheduleNext());

  (window as unknown as { __bgSyncCleanup?: () => void }).__bgSyncCleanup = () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    off();
    if (timer) clearTimeout(timer);
    initialized = false;
  };
}

export function stopBackgroundSync(): void {
  const w = window as unknown as { __bgSyncCleanup?: () => void };
  w.__bgSyncCleanup?.();
  if (timer) clearTimeout(timer);
  timer = null;
  status = 'idle';
  emit();
}

export function triggerBackgroundSyncNow(): void {
  if (timer) clearTimeout(timer);
  void runOnce().finally(() => scheduleNext());
}
