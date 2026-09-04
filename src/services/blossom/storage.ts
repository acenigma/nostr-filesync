import * as blossom from '../blossom';
import { recordEvent } from '../diagnostics';

export type StorageTarget = 'relay' | 'blossom';

export interface StorageDecision {
  target: StorageTarget;
  reason: string;
}

export const RELAY_SIZE_THRESHOLD = 64 * 1024;

export function decideStorageTarget(encryptedSize: number): StorageDecision {
  if (encryptedSize >= RELAY_SIZE_THRESHOLD) {
    return { target: 'blossom', reason: `encrypted size ${encryptedSize} >= ${RELAY_SIZE_THRESHOLD}` };
  }
  return { target: 'relay', reason: `encrypted size ${encryptedSize} < ${RELAY_SIZE_THRESHOLD}` };
}

export interface BlossomStoreResult {
  sha256: string;
  size: number;
  type: string | null;
  url: string;
  server: string;
}

export async function storeEncryptedBlob(
  encrypted: Uint8Array,
  mimeType: string,
  options: { signal?: AbortSignal } = {}
): Promise<BlossomStoreResult> {
  const start = performance.now();
  const result = await blossom.uploadBlob(encrypted, {
    contentType: mimeType,
    signal: options.signal,
  });
  const elapsed = Math.round(performance.now() - start);
  recordEvent('upload', 'info', `Blossom: ${result.server} ${result.size}B em ${elapsed}ms`, {
    server: result.server,
    sha256: result.sha256,
    size: result.size,
    elapsedMs: elapsed,
  });
  return result;
}

export async function fetchEncryptedBlob(sha256: string, options?: {
  server?: string;
  fallbackServers?: string[];
  signal?: AbortSignal;
}): Promise<Uint8Array> {
  const buf = await blossom.downloadBlob(sha256, options);
  return new Uint8Array(buf);
}

export interface BlossomMirrorResult {
  url: string;
  server: string;
  sha256: string;
}

export async function mirrorToServers(
  data: Uint8Array,
  contentType: string,
  serverUrls: string[],
  options: { signal?: AbortSignal } = {}
): Promise<BlossomMirrorResult[]> {
  const results: BlossomMirrorResult[] = [];
  const errors: { server: string; error: string }[] = [];

  await Promise.all(
    serverUrls.map(async (url) => {
      try {
        const r = await blossom.uploadBlob(data, {
          contentType,
          server: url,
          signal: options.signal,
        });
        results.push({ url: r.url, server: r.server, sha256: r.sha256 });
      } catch (e) {
        errors.push({ server: url, error: (e as Error).message });
      }
    })
  );

  if (errors.length > 0) {
    recordEvent('upload', 'warn', `Mirror parcial: ${errors.length}/${serverUrls.length} falharam`, {
      errors,
    });
  }

  return results;
}
