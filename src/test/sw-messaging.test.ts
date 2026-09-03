import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

type SwListener = (event: MessageEvent) => void;
let listeners: SwListener[] = [];

function setupMockSw() {
  listeners = [];
  const reg = {
    active: {
      postMessage: vi.fn(),
    },
  };
  const ctrl = {
    postMessage: vi.fn(),
  };
  (navigator as unknown as { serviceWorker: ServiceWorkerContainer }).serviceWorker = {
    controller: ctrl as unknown as ServiceWorker,
    ready: Promise.resolve(reg as unknown as ServiceWorkerRegistration),
    getRegistration: () => Promise.resolve(reg as unknown as ServiceWorkerRegistration),
    addEventListener: (type: string, l: EventListener) => {
      if (type === 'message') {
        listeners.push(l as unknown as SwListener);
      }
    },
    removeEventListener: () => {},
  } as unknown as ServiceWorkerContainer;
}

function setupMockCaches() {
  (globalThis as unknown as { caches: CacheStorage }).caches = {
    keys: () => Promise.resolve([]),
    open: () =>
      Promise.resolve({
        keys: () => Promise.resolve([]),
        match: () => Promise.resolve(undefined),
        put: () => Promise.resolve(),
        delete: () => Promise.resolve(true),
        add: () => Promise.resolve(),
        addAll: () => Promise.resolve(),
      } as unknown as Cache),
    delete: () => Promise.resolve(true),
    has: () => Promise.resolve(true),
    match: () => Promise.resolve(undefined),
  } as unknown as CacheStorage;
}

type SwApi = typeof import('../services/swMessaging');
let swApi: SwApi;

beforeEach(async () => {
  setupMockSw();
  setupMockCaches();
  vi.resetModules();
  swApi = await import('../services/swMessaging');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('swMessaging', () => {
  it('initServiceWorkerMessaging is idempotent', () => {
    swApi.initServiceWorkerMessaging();
    swApi.initServiceWorkerMessaging();
    expect(listeners.length).toBe(1);
  });

  it('onSwMessage registers and returns unsubscriber', () => {
    swApi.initServiceWorkerMessaging();
    const off = swApi.onSwMessage(() => {});
    expect(typeof off).toBe('function');
    off();
  });

  it('postSwMessage sends to active worker', async () => {
    swApi.initServiceWorkerMessaging();
    const reg = await navigator.serviceWorker.getRegistration();
    const spy = vi.spyOn(reg!.active!, 'postMessage');
    await swApi.postSwMessage('HELLO', { x: 1 });
    expect(spy).toHaveBeenCalledWith({ type: 'HELLO', payload: { x: 1 } });
  });

  it('requestSyncNow uses controller if available', async () => {
    swApi.initServiceWorkerMessaging();
    const ctrl = navigator.serviceWorker.controller!;
    const spy = vi.spyOn(ctrl, 'postMessage');
    await swApi.requestSyncNow();
    expect(spy).toHaveBeenCalled();
  });

  it('clearAllCaches removes all caches', async () => {
    (caches as unknown as { keys: () => Promise<string[]> }).keys = vi
      .fn()
      .mockResolvedValue(['a', 'b']);
    const del = vi.fn().mockResolvedValue(true);
    (caches as unknown as { delete: (k: string) => Promise<boolean> }).delete = del;
    await swApi.clearAllCaches();
    expect(del).toHaveBeenCalledWith('a');
    expect(del).toHaveBeenCalledWith('b');
  });

  it('getCacheSize computes per-cache size', async () => {
    (caches as unknown as { keys: () => Promise<string[]> }).keys = vi
      .fn()
      .mockResolvedValue(['cache1']);
    const fakeReq = {} as Request;
    const fakeBuf = new ArrayBuffer(128);
    (caches as unknown as { open: (k: string) => Promise<Cache> }).open = vi
      .fn()
      .mockResolvedValue({
        keys: () => Promise.resolve([fakeReq]),
        match: () =>
          Promise.resolve({
            clone: () => ({ arrayBuffer: () => Promise.resolve(fakeBuf) }),
          } as Response),
      });
    const out = await swApi.getCacheSize();
    expect(out).toEqual([{ name: 'cache1', size: 128 }]);
  });

  it('handler receives messages from SW', () => {
    swApi.initServiceWorkerMessaging();
    const received: string[] = [];
    swApi.onSwMessage((m) => received.push(m.type));
    const ev = new MessageEvent('message', { data: { type: 'SYNC_NOW' } });
    listeners.forEach((l) => l(ev));
    expect(received).toEqual(['SYNC_NOW']);
  });
});
