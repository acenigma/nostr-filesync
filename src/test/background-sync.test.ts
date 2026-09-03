import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

type SwListener = (event: MessageEvent) => void;

vi.mock('../services/filesync', () => ({
  resumePendingUploads: vi.fn(),
}));

beforeEach(async () => {
  localStorage.clear();
  const listeners: SwListener[] = [];
  (navigator as unknown as { serviceWorker: ServiceWorkerContainer }).serviceWorker = {
    controller: { postMessage: vi.fn() } as unknown as ServiceWorker,
    ready: Promise.resolve({} as ServiceWorkerRegistration),
    getRegistration: () => Promise.resolve({} as ServiceWorkerRegistration),
    addEventListener: (type: string, l: EventListener) => {
      if (type === 'message') listeners.push(l as unknown as SwListener);
    },
    removeEventListener: () => {},
  } as unknown as ServiceWorkerContainer;
  (globalThis as unknown as { __swListeners?: SwListener[] }).__swListeners = listeners;
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('backgroundSync', () => {
  it('starts in idle state and transitions to running then idle on success', async () => {
    const { resumePendingUploads } = await import('../services/filesync');
    (resumePendingUploads as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { fileId: 'f1', ok: true, result: {} },
    ]);
    const bg = await import('../services/backgroundSync');
    const states: string[] = [];
    bg.onBackgroundSyncChange((s) => states.push(s.status));
    bg.startBackgroundSync();
    await new Promise((r) => setTimeout(r, 50));
    const final = bg.getBackgroundSyncState();
    expect(final.status).toBe('idle');
    expect(final.lastRunAt).not.toBeNull();
    expect(final.totalRuns).toBeGreaterThanOrEqual(1);
    expect(states).toContain('running');
    bg.stopBackgroundSync();
  });

  it('transitions to error when resume fails', async () => {
    const { resumePendingUploads } = await import('../services/filesync');
    (resumePendingUploads as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { fileId: 'f1', ok: false, error: 'relay down' },
    ]);
    const bg = await import('../services/backgroundSync');
    bg.startBackgroundSync();
    await new Promise((r) => setTimeout(r, 50));
    const s = bg.getBackgroundSyncState();
    expect(s.status).toBe('error');
    expect(s.lastError).toBe('relay down');
    bg.stopBackgroundSync();
  });

  it('pauses when offline', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    const bg = await import('../services/backgroundSync');
    bg.startBackgroundSync();
    await new Promise((r) => setTimeout(r, 50));
    expect(bg.getBackgroundSyncState().status).toBe('paused-offline');
    bg.stopBackgroundSync();
  });

  it('triggerBackgroundSyncNow re-runs immediately', async () => {
    const { resumePendingUploads } = await import('../services/filesync');
    (resumePendingUploads as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { fileId: 'f1', ok: true, result: {} },
    ]);
    const bg = await import('../services/backgroundSync');
    bg.startBackgroundSync();
    await new Promise((r) => setTimeout(r, 50));
    const before = bg.getBackgroundSyncState().totalRuns;
    bg.triggerBackgroundSyncNow();
    await new Promise((r) => setTimeout(r, 50));
    const after = bg.getBackgroundSyncState().totalRuns;
    expect(after).toBeGreaterThan(before);
    bg.stopBackgroundSync();
  });

  it('reacts to SYNC_NOW message from SW', async () => {
    const { resumePendingUploads } = await import('../services/filesync');
    (resumePendingUploads as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { fileId: 'f1', ok: true, result: {} },
    ]);
    const bg = await import('../services/backgroundSync');
    bg.startBackgroundSync();
    await new Promise((r) => setTimeout(r, 100));
    const before = bg.getBackgroundSyncState().totalRuns;
    const listeners = (globalThis as unknown as { __swListeners?: SwListener[] }).__swListeners ?? [];
    const ev = new MessageEvent('message', { data: { type: 'SYNC_NOW' } });
    listeners.forEach((l) => l(ev));
    await new Promise((r) => setTimeout(r, 200));
    const after = bg.getBackgroundSyncState().totalRuns;
    expect(after).toBeGreaterThan(before);
    bg.stopBackgroundSync();
  });

  it('onBackgroundSyncChange returns unsubscribe', async () => {
    const bg = await import('../services/backgroundSync');
    const off = bg.onBackgroundSyncChange(() => {});
    expect(typeof off).toBe('function');
    off();
  });

  it('uses exponential backoff on consecutive failures', async () => {
    vi.useFakeTimers();
    const { resumePendingUploads } = await import('../services/filesync');
    (resumePendingUploads as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { fileId: 'f1', ok: false, error: 'fail' },
    ]);
    const bg = await import('../services/backgroundSync');
    bg.startBackgroundSync();
    await vi.advanceTimersByTimeAsync(100);
    const s1 = bg.getBackgroundSyncState();
    expect(s1.status).toBe('error');
    await vi.advanceTimersByTimeAsync(15_000);
    const s2 = bg.getBackgroundSyncState();
    expect(s2.totalRuns).toBeGreaterThan(s1.totalRuns);
    bg.stopBackgroundSync();
  });
});
