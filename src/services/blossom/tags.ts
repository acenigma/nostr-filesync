import type { BlossomServer, BlossomStoreResult } from '../blossom/types';

export function buildXTags(
  primaryHash: string,
  blossomResults: BlossomStoreResult[] = []
): string[][] {
  const tags: string[][] = [['x', primaryHash]];
  for (const r of blossomResults) {
    const url = new URL(r.url);
    tags.push(['r', url.toString()]);
  }
  return tags;
}

export function parseXAndRTags(tags: string[][]): {
  primaryHash: string | null;
  blossomUrls: string[];
} {
  let primaryHash: string | null = null;
  const blossomUrls: string[] = [];
  for (const t of tags) {
    if (t[0] === 'x' && t[1]) {
      primaryHash = t[1];
    } else if (t[0] === 'r' && t[1]) {
      try {
        const u = new URL(t[1]);
        if (u.protocol === 'http:' || u.protocol === 'https:') {
          blossomUrls.push(t[1]);
        }
      } catch {
        /* skip invalid url */
      }
    }
  }
  return { primaryHash, blossomUrls };
}

export function isBlossomUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const path = u.pathname.toLowerCase();
    return /\/[0-9a-f]{64}$/i.test(path);
  } catch {
    return false;
  }
}

export function extractSha256FromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const match = u.pathname.match(/\/([0-9a-f]{64})$/i);
    return match ? match[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

export function selectPreferredServer(
  servers: BlossomServer[]
): BlossomServer | null {
  const trusted = servers.filter((s) => s.trusted);
  if (trusted.length === 0) return null;
  const withLatency = trusted.filter((s) => s.avgLatencyMs !== null);
  if (withLatency.length > 0) {
    return withLatency.sort((a, b) => (a.avgLatencyMs || 0) - (b.avgLatencyMs || 0))[0];
  }
  return trusted[0];
}
