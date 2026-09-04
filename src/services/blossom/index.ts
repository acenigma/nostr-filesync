import { DEFAULT_BLOSSOM_SERVERS, dedupeServers, loadStoredServers, normalizeServerUrl, saveStoredServers } from './servers';
import { authWithBlossom } from './auth';
import { recordEvent } from '../diagnostics';
import type { BlossomServer, BlossomUploadResult, BlossomUploadOptions, BlossomDownloadOptions } from './types';

let servers: BlossomServer[] = dedupeServers([...DEFAULT_BLOSSOM_SERVERS, ...loadStoredServers()]);

const listeners: Array<(s: BlossomServer[]) => void> = [];

function emit(): void {
  listeners.forEach((l) => l(servers.slice()));
}

export function listServers(): BlossomServer[] {
  return servers.slice();
}

export function getServer(url: string): BlossomServer | null {
  const u = normalizeServerUrl(url);
  return servers.find((s) => normalizeServerUrl(s.url) === u) || null;
}

export function addCustomServer(url: string, name?: string): BlossomServer {
  const u = normalizeServerUrl(url);
  if (!u.startsWith('http://') && !u.startsWith('https://')) {
    throw new Error('URL inválida: precisa começar com http:// ou https://');
  }
  const existing = getServer(u);
  if (existing) {
    if (!existing.trusted) {
      existing.trusted = true;
      existing.source = 'custom';
      persistCustom();
      emit();
    }
    return existing;
  }
  const server: BlossomServer = {
    url: u,
    name: name || new URL(u).hostname,
    healthy: true,
    lastCheckAt: null,
    avgLatencyMs: null,
    trusted: true,
    source: 'custom',
  };
  servers = dedupeServers([...servers, server]);
  persistCustom();
  emit();
  return server;
}

export function removeServer(url: string): boolean {
  const u = normalizeServerUrl(url);
  const before = servers.length;
  servers = servers.filter((s) => normalizeServerUrl(s.url) !== u);
  if (servers.length < before) {
    persistCustom();
    emit();
    return true;
  }
  return false;
}

export function toggleServerTrusted(url: string, trusted: boolean): void {
  const s = getServer(url);
  if (!s) return;
  s.trusted = trusted;
  persistCustom();
  emit();
}

function persistCustom(): void {
  const customs = servers.filter((s) => s.source === 'custom' || s.source === 'user-list');
  saveStoredServers(customs);
}

function pickServer(preferred?: string): BlossomServer | null {
  if (preferred) {
    const s = getServer(preferred);
    if (s && s.trusted && s.healthy) return s;
  }
  const trusted = servers.filter((s) => s.trusted);
  if (trusted.length === 0) return null;
  const withLatency = trusted.filter((s) => s.avgLatencyMs !== null);
  if (withLatency.length > 0) {
    return withLatency.sort((a, b) => (a.avgLatencyMs || 0) - (b.avgLatencyMs || 0))[0];
  }
  return trusted[0];
}

function arrayBufferToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

export async function uploadBlob(
  data: Uint8Array | ArrayBuffer | Blob,
  options: BlossomUploadOptions = {}
): Promise<BlossomUploadResult> {
  const server = pickServer(options.server);
  if (!server) {
    throw new Error('Nenhum servidor Blossom disponível. Verifique Settings → Servidores Blossom.');
  }

  const blob = data instanceof Blob ? data : new Blob([data as BlobPart]);
  const contentType = options.contentType || blob.type || 'application/octet-stream';
  const sha256 = await sha256OfBlob(blob);

  const uploadUrl = `${server.url}/upload`;
  const signal = options.signal;
  const timeout = options.timeoutMs ?? 60_000;

  let headers: Record<string, string> = {
    'Content-Type': contentType,
    Accept: 'application/json',
  };

  if (!options.noAuth) {
    const auth = await authWithBlossom(server.url, 'POST', '/upload');
    if (auth) {
      headers['Authorization'] = auth.header;
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error('timeout')), timeout);
  if (signal) {
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }

  try {
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      body: blob,
      headers,
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      recordEvent('upload', 'error', `Blossom upload ${server.url} falhou: ${res.status} ${text.slice(0, 200)}`, {
        server: server.url,
        status: res.status,
      });
      throw new Error(`Upload falhou: ${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
    }

    let body: { sha256?: string; url?: string } = {};
    try {
      body = await res.json();
    } catch {
      body = {};
    }

    if (body.sha256 && body.sha256 !== sha256) {
      throw new Error(`SHA-256 mismatch: esperado ${sha256}, servidor retornou ${body.sha256}`);
    }

    recordEvent('upload', 'info', `Blossom upload ${server.url} OK`, {
      server: server.url,
      sha256,
      size: blob.size,
    });

    return {
      sha256,
      size: blob.size,
      type: contentType,
      url: body.url || `${server.url}/${sha256}`,
      server: server.url,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function downloadBlob(
  sha256: string,
  options: BlossomDownloadOptions = {}
): Promise<ArrayBuffer> {
  const tried = new Set<string>();
  const candidates: BlossomServer[] = [];

  if (options.server) {
    const s = getServer(options.server);
    if (s) candidates.push(s);
  }
  for (const url of options.fallbackServers || []) {
    const s = getServer(url);
    if (s) candidates.push(s);
  }
  for (const s of servers) {
    if (s.trusted && !tried.has(s.url)) {
      candidates.push(s);
      tried.add(s.url);
    }
  }

  if (candidates.length === 0) {
    throw new Error('Nenhum servidor Blossom disponível');
  }

  let lastError: Error | null = null;
  for (const server of candidates) {
    const url = `${server.url}/${sha256}`;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(new Error('timeout')), options.timeoutMs ?? 60_000);
      if (options.signal) {
        options.signal.addEventListener('abort', () => controller.abort(options.signal!.reason), { once: true });
      }
      try {
        const res = await fetch(url, {
          method: 'GET',
          signal: controller.signal,
        });
        if (!res.ok) {
          lastError = new Error(`Download ${url} falhou: ${res.status}`);
          continue;
        }
        const buf = await res.arrayBuffer();
        const got = await sha256OfArrayBuffer(buf);
        if (got !== sha256) {
          lastError = new Error(`SHA-256 mismatch from ${url}`);
          continue;
        }
        return buf;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (e) {
      lastError = e as Error;
    }
  }

  throw lastError || new Error('Download falhou em todos os servidores');
}

export async function checkHealth(url: string): Promise<{ healthy: boolean; latencyMs: number | null; error?: string }> {
  const start = performance.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
      });
      const latency = performance.now() - start;
      return { healthy: res.ok || res.status === 405, latencyMs: latency };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (e) {
    return { healthy: false, latencyMs: null, error: (e as Error).message };
  }
}

export async function runHealthChecks(): Promise<void> {
  const checks = await Promise.all(
    servers.map(async (s) => {
      const r = await checkHealth(s.url);
      s.healthy = r.healthy;
      s.lastCheckAt = Date.now();
      if (r.healthy && r.latencyMs !== null) {
        s.avgLatencyMs = s.avgLatencyMs === null ? r.latencyMs : s.avgLatencyMs * 0.7 + r.latencyMs * 0.3;
      }
      return { server: s.url, ...r };
    })
  );
  persistCustom();
  emit();
  recordEvent('system', 'info', `Blossom health: ${checks.filter((c) => c.healthy).length}/${checks.length} OK`);
}

export async function sha256OfBlob(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  return sha256OfArrayBuffer(buf);
}

export async function sha256OfArrayBuffer(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return arrayBufferToHex(digest);
}

export function onServersChange(listener: (servers: BlossomServer[]) => void): () => void {
  listeners.push(listener);
  listener(servers.slice());
  return () => {
    const idx = listeners.indexOf(listener);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

export function setUserListServers(userServers: BlossomServer[]): void {
  const without = servers.filter((s) => s.source !== 'user-list');
  servers = dedupeServers([...without, ...userServers]);
  persistCustom();
  emit();
}
