import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/diagnostics', () => ({
  recordEvent: vi.fn(),
}));

vi.mock('../services/blossom', () => ({
  uploadBlob: vi.fn(),
  downloadBlob: vi.fn(),
}));

import * as blossom from '../services/blossom';
import {
  RELAY_SIZE_THRESHOLD,
  decideStorageTarget,
  storeEncryptedBlob,
  fetchEncryptedBlob,
  mirrorToServers,
} from '../services/blossom/storage';
import {
  buildXTags,
  parseXAndRTags,
  isBlossomUrl,
  extractSha256FromUrl,
  selectPreferredServer,
} from '../services/blossom/tags';
import type { BlossomServer } from '../services/blossom/types';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('decideStorageTarget', () => {
  it('chooses relay for small files', () => {
    const d = decideStorageTarget(1000);
    expect(d.target).toBe('relay');
  });

  it('chooses blossom for files >= 64KB encrypted', () => {
    const d = decideStorageTarget(70_000);
    expect(d.target).toBe('blossom');
  });

  it('threshold is exactly 64KB', () => {
    expect(decideStorageTarget(RELAY_SIZE_THRESHOLD).target).toBe('blossom');
    expect(decideStorageTarget(RELAY_SIZE_THRESHOLD - 1).target).toBe('relay');
  });
});

describe('storeEncryptedBlob', () => {
  it('calls uploadBlob with content type', async () => {
    (blossom.uploadBlob as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      sha256: 'abc',
      size: 100,
      type: 'application/octet-stream',
      url: 'https://a.com/abc',
      server: 'https://a.com',
    });
    const r = await storeEncryptedBlob(new Uint8Array(100), 'application/octet-stream');
    expect(r.sha256).toBe('abc');
    expect(blossom.uploadBlob).toHaveBeenCalled();
  });
});

describe('fetchEncryptedBlob', () => {
  it('returns Uint8Array from arrayBuffer', async () => {
    (blossom.downloadBlob as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new ArrayBuffer(8)
    );
    const r = await fetchEncryptedBlob('a'.repeat(64));
    expect(r).toBeInstanceOf(Uint8Array);
  });
});

describe('mirrorToServers', () => {
  it('mirrors to multiple servers in parallel', async () => {
    (blossom.uploadBlob as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (_data: unknown, opts: { server?: string }) => ({
        sha256: 'abc',
        size: 100,
        type: 'application/octet-stream',
        url: `${opts.server}/abc`,
        server: opts.server || '',
      })
    );
    const r = await mirrorToServers(new Uint8Array(100), 'text/plain', [
      'https://a.com',
      'https://b.com',
    ]);
    expect(r.length).toBe(2);
    expect(r.map((x) => x.server).sort()).toEqual(['https://a.com', 'https://b.com']);
  });

  it('returns partial results when some servers fail', async () => {
    (blossom.uploadBlob as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (_data: unknown, opts: { server?: string }) => {
        if (opts.server === 'https://b.com') throw new Error('offline');
        return {
          sha256: 'abc',
          size: 100,
          type: 'application/octet-stream',
          url: `${opts.server}/abc`,
          server: opts.server || '',
        };
      }
    );
    const r = await mirrorToServers(new Uint8Array(100), 'text/plain', [
      'https://a.com',
      'https://b.com',
    ]);
    expect(r.length).toBe(1);
    expect(r[0].server).toBe('https://a.com');
  });
});

describe('buildXTags', () => {
  it('builds x tag with hash and r tags for blossom urls', () => {
    const tags = buildXTags('abc123', [
      {
        sha256: 'abc123',
        size: 100,
        type: 'text/plain',
        url: 'https://blossom.primal.net/abc123',
        server: 'https://blossom.primal.net',
      },
    ]);
    expect(tags).toContainEqual(['x', 'abc123']);
    expect(tags).toContainEqual(['r', 'https://blossom.primal.net/abc123']);
  });

  it('builds only x tag when no blossom results', () => {
    const tags = buildXTags('abc123');
    expect(tags.length).toBe(1);
    expect(tags[0]).toEqual(['x', 'abc123']);
  });
});

describe('parseXAndRTags', () => {
  it('extracts hash and blossom urls', () => {
    const { primaryHash, blossomUrls } = parseXAndRTags([
      ['x', 'abc123'],
      ['r', 'https://blossom.primal.net/abc123'],
    ]);
    expect(primaryHash).toBe('abc123');
    expect(blossomUrls).toEqual(['https://blossom.primal.net/abc123']);
  });

  it('returns null hash when no x tag', () => {
    const { primaryHash } = parseXAndRTags([['r', 'https://a.com/x']]);
    expect(primaryHash).toBeNull();
  });

  it('skips non-http r tags', () => {
    const { blossomUrls } = parseXAndRTags([
      ['r', 'wss://relay.com'],
      ['r', 'not-a-url'],
    ]);
    expect(blossomUrls).toEqual([]);
  });
});

describe('isBlossomUrl', () => {
  it('returns true for http(s) URL ending in 64 hex chars', () => {
    const h = 'a'.repeat(64);
    expect(isBlossomUrl(`https://blossom.primal.net/${h}`)).toBe(true);
  });

  it('returns false for invalid URLs', () => {
    expect(isBlossomUrl('not-a-url')).toBe(false);
    expect(isBlossomUrl('wss://relay.com/abc')).toBe(false);
    expect(isBlossomUrl('https://a.com/short')).toBe(false);
  });
});

describe('extractSha256FromUrl', () => {
  it('extracts hash from valid Blossom URL', () => {
    const h = 'a'.repeat(64);
    expect(extractSha256FromUrl(`https://blossom.primal.net/${h}`)).toBe(h);
  });

  it('returns null for URLs without hash', () => {
    expect(extractSha256FromUrl('https://a.com/foo')).toBeNull();
  });

  it('handles case-insensitive hash', () => {
    const h = 'A'.repeat(64);
    expect(extractSha256FromUrl(`https://a.com/${h}`)).toBe(h.toLowerCase());
  });
});

describe('selectPreferredServer', () => {
  const mkServer = (over: Partial<BlossomServer>): BlossomServer => ({
    url: 'https://x',
    name: 'X',
    healthy: true,
    lastCheckAt: null,
    avgLatencyMs: null,
    trusted: true,
    source: 'fallback',
    ...over,
  });

  it('returns null when no trusted servers', () => {
    expect(selectPreferredServer([mkServer({ trusted: false })])).toBeNull();
  });

  it('picks the lowest latency server', () => {
    const a = mkServer({ url: 'https://a', avgLatencyMs: 200 });
    const b = mkServer({ url: 'https://b', avgLatencyMs: 50 });
    expect(selectPreferredServer([a, b])?.url).toBe('https://b');
  });

  it('returns first trusted when no latency info', () => {
    const a = mkServer({ url: 'https://a' });
    const b = mkServer({ url: 'https://b' });
    expect(selectPreferredServer([a, b])?.url).toBe('https://a');
  });
});
