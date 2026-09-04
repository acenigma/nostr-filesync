import * as blossom from '../blossom';
import { recordEvent } from '../diagnostics';

export interface BlobLocation {
  sha256: string;
  url: string;
  server: string;
}

export interface MissingBlob {
  sha256: string;
  missingFrom: string;
}

export interface RepairResult {
  checked: number;
  missing: MissingBlob[];
  repaired: number;
  failed: number;
  durationMs: number;
}

export interface RepairOptions {
  /** Max number of blobs to check in one pass */
  maxBlobs?: number;
  /** Concurrency limit */
  concurrency?: number;
  /** Signal for cancellation */
  signal?: AbortSignal;
  /** Min healthy servers to require for repair */
  minHealthyForRepair?: number;
  /** Skip blobs that are recent (e.g. uploaded < 1h ago) */
  skipRecentMs?: number;
}

const DEFAULT_REPAIR_OPTIONS: Required<RepairOptions> = {
  maxBlobs: 50,
  concurrency: 3,
  signal: undefined as unknown as AbortSignal,
  minHealthyForRepair: 1,
  skipRecentMs: 60 * 60 * 1000,
};

export interface StoredBlobRef {
  sha256: string;
  urls: string[];
  lastSeenAt: number;
}

const STORAGE_KEY = 'nostr_filesync_blossom_refs';
const refStore: Map<string, StoredBlobRef> = new Map();

function loadRefs(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, StoredBlobRef>;
    for (const [k, v] of Object.entries(parsed)) {
      refStore.set(k, v);
    }
  } catch {
    /* corrupt */
  }
}

function saveRefs(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const obj: Record<string, StoredBlobRef> = {};
    for (const [k, v] of refStore.entries()) obj[k] = v;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    /* quota */
  }
}

let initialized = false;
function ensureInit(): void {
  if (initialized) return;
  initialized = true;
  loadRefs();
}

export function trackBlob(sha256: string, urls: string[]): void {
  ensureInit();
  const ref: StoredBlobRef = {
    sha256,
    urls: dedupe(urls),
    lastSeenAt: Date.now(),
  };
  refStore.set(sha256, ref);
  saveRefs();
}

export function getTrackedBlobs(): StoredBlobRef[] {
  ensureInit();
  return Array.from(refStore.values());
}

export function untrackBlob(sha256: string): boolean {
  ensureInit();
  const deleted = refStore.delete(sha256);
  if (deleted) saveRefs();
  return deleted;
}

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

function serverFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return '';
  }
}

async function checkBlobOnServer(sha256: string, serverUrl: string, signal?: AbortSignal): Promise<boolean> {
  const url = `${serverUrl.replace(/\/+$/, '')}/${sha256}`;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5_000);
    signal?.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
    try {
      const res = await fetch(url, { method: 'HEAD', signal: controller.signal });
      return res.ok;
    } finally {
      clearTimeout(timeoutId);
    }
  } catch {
    return false;
  }
}

export async function checkBlob(sha256: string, servers: string[]): Promise<{
  found: string[];
  missing: string[];
}> {
  const results = await Promise.all(
    servers.map(async (s) => ({ server: s, ok: await checkBlobOnServer(sha256, s) }))
  );
  return {
    found: results.filter((r) => r.ok).map((r) => r.server),
    missing: results.filter((r) => !r.ok).map((r) => r.server),
  };
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let idx = 0;
  async function next(): Promise<void> {
    while (idx < items.length) {
      const i = idx++;
      results.push(await worker(items[i]));
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => next());
  await Promise.all(workers);
  return results;
}

export async function repairBlobs(options: RepairOptions = {}): Promise<RepairResult> {
  const opts: Required<RepairOptions> = { ...DEFAULT_REPAIR_OPTIONS, ...options };
  const start = performance.now();
  ensureInit();

  const refs = getTrackedBlobs();
  const cutoff = Date.now() - opts.skipRecentMs;
  const candidates = refs.filter((r) => r.lastSeenAt <= cutoff).slice(0, opts.maxBlobs);

  const trustedServers = blossom.listServers().filter((s) => s.trusted);
  const healthyServers = trustedServers.filter((s) => s.healthy || s.lastCheckAt === null);

  if (healthyServers.length < opts.minHealthyForRepair) {
    recordEvent('system', 'warn', `Repair abortado: ${healthyServers.length} servidores saudáveis`, {
      minRequired: opts.minHealthyForRepair,
    });
    return {
      checked: 0,
      missing: [],
      repaired: 0,
      failed: 0,
      durationMs: performance.now() - start,
    };
  }

  const missing: MissingBlob[] = [];
  const repairTargets: Array<{ sha256: string; sourceServer: string; targetServer: string }> = [];

  await runWithConcurrency(candidates, opts.concurrency, async (ref) => {
    opts.signal?.throwIfAborted();
    const serverList = dedupe(ref.urls.map(serverFromUrl)).filter(Boolean);
    if (serverList.length === 0) return;
    const { found, missing: missingFroms } = await checkBlob(ref.sha256, serverList);
    if (found.length === 0) {
      missing.push({ sha256: ref.sha256, missingFrom: 'all' });
      return;
    }
    for (const m of missingFroms) {
      const hasHealthy = healthyServers.find((s) => s.url === m);
      if (hasHealthy) {
        const source = found[0];
        repairTargets.push({ sha256: ref.sha256, sourceServer: source, targetServer: m });
      }
    }
  });

  let repaired = 0;
  let failed = 0;
  await runWithConcurrency(repairTargets, opts.concurrency, async (t) => {
    opts.signal?.throwIfAborted();
    try {
      const buf = await blossom.downloadBlob(t.sha256, { server: t.sourceServer });
      const data = new Uint8Array(buf);
      const result = await blossom.uploadBlob(data, { server: t.targetServer });
      const ref = refStore.get(t.sha256);
      if (ref) {
        ref.urls.push(result.url);
        ref.urls = dedupe(ref.urls);
        ref.lastSeenAt = Date.now();
      }
      repaired++;
      recordEvent('system', 'info', `Repaired: ${t.sha256.slice(0, 8)} → ${t.targetServer}`, {
        sha256: t.sha256,
        from: t.sourceServer,
        to: t.targetServer,
      });
    } catch (e) {
      failed++;
      recordEvent('system', 'warn', `Repair failed: ${t.sha256.slice(0, 8)} → ${t.targetServer}: ${(e as Error).message}`);
    }
  });

  saveRefs();

  const result: RepairResult = {
    checked: candidates.length,
    missing,
    repaired,
    failed,
    durationMs: performance.now() - start,
  };
  recordEvent('system', 'info', `Blossom repair: ${repaired} ok / ${failed} fail de ${candidates.length} blobs`, {
    checked: result.checked,
    repaired,
    failed,
  });
  return result;
}

export function __resetBlobRepair(): void {
  refStore.clear();
  saveRefs();
  initialized = false;
}
