import type { BlossomServer } from './types';

export const DEFAULT_BLOSSOM_SERVERS: BlossomServer[] = [
  {
    url: 'https://blossom.primal.net',
    name: 'Primal',
    healthy: true,
    lastCheckAt: null,
    avgLatencyMs: null,
    trusted: true,
    source: 'fallback',
  },
  {
    url: 'https://blossom.nostr.build',
    name: 'nostr.build',
    healthy: true,
    lastCheckAt: null,
    avgLatencyMs: null,
    trusted: true,
    source: 'fallback',
  },
  {
    url: 'https://nostr.media',
    name: 'nostr.media',
    healthy: true,
    lastCheckAt: null,
    avgLatencyMs: null,
    trusted: true,
    source: 'fallback',
  },
  {
    url: 'https://void.cat',
    name: 'void.cat',
    healthy: true,
    lastCheckAt: null,
    avgLatencyMs: null,
    trusted: true,
    source: 'fallback',
  },
];

const STORAGE_KEY = 'nostr_filesync_blossom_servers';

export function loadStoredServers(): BlossomServer[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as BlossomServer[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveStoredServers(servers: BlossomServer[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(servers));
  } catch {
    /* quota */
  }
}

export function normalizeServerUrl(url: string): string {
  return url.replace(/\/+$/, '').trim();
}

export function dedupeServers(servers: BlossomServer[]): BlossomServer[] {
  const seen = new Set<string>();
  const out: BlossomServer[] = [];
  for (const s of servers) {
    const url = normalizeServerUrl(s.url);
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ ...s, url });
  }
  return out;
}
