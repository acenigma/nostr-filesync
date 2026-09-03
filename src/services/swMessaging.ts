export interface SyncMessage {
  type: 'SYNC_NOW' | 'RELAY_PONG';
  payload?: unknown;
}

export type SwMessageHandler = (msg: SyncMessage) => void;

let handlers: SwMessageHandler[] = [];
let initialized = false;
let messageListener: ((event: MessageEvent) => void) | null = null;

export function initServiceWorkerMessaging(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (initialized) return;
  initialized = true;
  messageListener = (event: MessageEvent) => {
    const data = event.data as SyncMessage | undefined;
    if (!data) return;
    handlers.forEach((h) => h(data));
  };
  navigator.serviceWorker.addEventListener('message', messageListener);
}

export function onSwMessage(handler: SwMessageHandler): () => void {
  handlers.push(handler);
  return () => {
    handlers = handlers.filter((h) => h !== handler);
  };
}

export async function postSwMessage(type: string, payload?: unknown): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  reg?.active?.postMessage({ type, payload });
}

export async function requestSyncNow(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const ctrl = navigator.serviceWorker.controller;
  if (ctrl) {
    ctrl.postMessage({ type: 'TRIGGER_SYNC', payload: { ts: Date.now() } });
  } else if (reg?.active) {
    reg.active.postMessage({ type: 'TRIGGER_SYNC', payload: { ts: Date.now() } });
  }
}

export async function clearAllCaches(): Promise<void> {
  if (typeof navigator === 'undefined' || !('caches' in window)) return;
  const keys = await caches.keys();
  await Promise.all(keys.map((k) => caches.delete(k)));
}

export async function getCacheSize(): Promise<{ name: string; size: number }[]> {
  if (typeof navigator === 'undefined' || !('caches' in window)) return [];
  const keys = await caches.keys();
  const out: { name: string; size: number }[] = [];
  for (const name of keys) {
    const cache = await caches.open(name);
    const reqs = await cache.keys();
    let size = 0;
    for (const req of reqs) {
      const res = await cache.match(req);
      if (!res) continue;
      const buf = await res.clone().arrayBuffer();
      size += buf.byteLength;
    }
    out.push({ name, size });
  }
  return out;
}
