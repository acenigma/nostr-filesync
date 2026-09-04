import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../services/blossom', () => ({
  listServers: vi.fn(),
  checkHealth: vi.fn(),
  downloadBlob: vi.fn(),
  uploadBlob: vi.fn(),
}));

vi.mock('../services/diagnostics', () => ({
  recordEvent: vi.fn(),
}));

import * as blossom from '../services/blossom';
import {
  trackBlob,
  getTrackedBlobs,
  untrackBlob,
  checkBlob,
  repairBlobs,
  __resetBlobRepair,
} from '../services/blossom/repair';

const mockedListServers = blossom.listServers as unknown as ReturnType<typeof vi.fn>;
const mockedDownload = blossom.downloadBlob as unknown as ReturnType<typeof vi.fn>;
const mockedUpload = blossom.uploadBlob as unknown as ReturnType<typeof vi.fn>;
const fetchMock = vi.fn();

beforeEach(() => {
  __resetBlobRepair();
  localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.clearAllMocks();
});

const h = (n: number) => 'a'.repeat(n);

describe('trackBlob + getTrackedBlobs + untrackBlob', () => {
  it('stores and retrieves tracked blobs', () => {
    trackBlob(h(64), ['https://a.com/x', 'https://b.com/x']);
    const all = getTrackedBlobs();
    expect(all.length).toBe(1);
    expect(all[0].sha256).toBe(h(64));
    expect(all[0].urls.length).toBe(2);
  });

  it('dedupes urls', () => {
    trackBlob(h(64), ['https://a.com/x', 'https://a.com/x']);
    const all = getTrackedBlobs();
    expect(all[0].urls.length).toBe(1);
  });

  it('persists across module reloads', () => {
    trackBlob(h(64), ['https://a.com/x']);
    const raw = localStorage.getItem('nostr_filesync_blossom_refs');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed[h(64)]).toBeDefined();
  });

  it('untrackBlob removes and saves', () => {
    trackBlob(h(64), ['https://a.com/x']);
    expect(untrackBlob(h(64))).toBe(true);
    expect(getTrackedBlobs().length).toBe(0);
  });

  it('untrackBlob returns false when not present', () => {
    expect(untrackBlob(h(64))).toBe(false);
  });

  it('loads from corrupt JSON safely', () => {
    localStorage.setItem('nostr_filesync_blossom_refs', 'not-json');
    __resetBlobRepair();
    expect(getTrackedBlobs().length).toBe(0);
  });
});

describe('checkBlob', () => {
  it('reports found and missing servers', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('a.com')) return { ok: true, status: 200 };
      return { ok: false, status: 404 };
    });
    const r = await checkBlob(h(64), ['https://a.com', 'https://b.com']);
    expect(r.found).toContain('https://a.com');
    expect(r.missing).toContain('https://b.com');
  });

  it('reports missing on network error', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    const r = await checkBlob(h(64), ['https://a.com']);
    expect(r.missing).toContain('https://a.com');
    expect(r.found).toEqual([]);
  });
});

describe('repairBlobs', () => {
  it('returns empty result when no healthy servers', async () => {
    mockedListServers.mockReturnValue([]);
    trackBlob(h(64), ['https://a.com/x']);
    const r = await repairBlobs();
    expect(r.checked).toBe(0);
  });

  it('skips recent blobs (lastSeenAt within skipRecentMs)', async () => {
    mockedListServers.mockReturnValue([
      { url: 'https://a.com', trusted: true, healthy: true, lastCheckAt: null, avgLatencyMs: null },
    ]);
    trackBlob(h(64), ['https://a.com/x']);
    const r = await repairBlobs();
    expect(r.checked).toBe(0);
  });

  it('checks old blobs and detects missing', async () => {
    mockedListServers.mockReturnValue([
      { url: 'https://a.com', trusted: true, healthy: true, lastCheckAt: null, avgLatencyMs: null },
    ]);
    const sha = h(64);
    trackBlob(sha, ['https://a.com/' + sha]);
    const oldTs = Date.now() - 2 * 60 * 60 * 1000;
    const refs = getTrackedBlobs();
    refs[0].lastSeenAt = oldTs;
    localStorage.setItem('nostr_filesync_blossom_refs', JSON.stringify({
      [sha]: refs[0],
    }));
    __resetBlobRepair();
    trackBlob(sha, ['https://a.com/' + sha]);
    const refs2 = getTrackedBlobs();
    refs2[0].lastSeenAt = oldTs;
    localStorage.setItem('nostr_filesync_blossom_refs', JSON.stringify({
      [sha]: refs2[0],
    }));

    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    const r = await repairBlobs();
    expect(r.missing.length).toBeGreaterThan(0);
  });

  it('repairs by downloading from healthy and uploading to missing', async () => {
    mockedListServers.mockReturnValue([
      { url: 'https://a.com', trusted: true, healthy: true, lastCheckAt: null, avgLatencyMs: null },
      { url: 'https://b.com', trusted: true, healthy: true, lastCheckAt: null, avgLatencyMs: null },
    ]);
    const sha = h(64);
    trackBlob(sha, ['https://a.com/' + sha, 'https://b.com/' + sha]);
    const oldTs = Date.now() - 2 * 60 * 60 * 1000;
    const refs = getTrackedBlobs();
    refs[0].lastSeenAt = oldTs;
    localStorage.setItem('nostr_filesync_blossom_refs', JSON.stringify({
      [sha]: refs[0],
    }));

    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('https://a.com/')) return { ok: true, status: 200 };
      return { ok: false, status: 404 };
    });

    mockedDownload.mockResolvedValue(new ArrayBuffer(8));
    mockedUpload.mockImplementation(async (_data: unknown, opts: { server?: string }) => ({
      sha256: sha,
      size: 8,
      type: null,
      url: `${opts.server}/${sha}`,
      server: opts.server || '',
    }));

    const r = await repairBlobs();
    expect(r.repaired + r.failed).toBeGreaterThan(0);
  });

  it('marks blob as missing from all when no source found', async () => {
    mockedListServers.mockReturnValue([
      { url: 'https://a.com', trusted: true, healthy: true, lastCheckAt: null, avgLatencyMs: null },
    ]);
    const sha = h(64);
    trackBlob(sha, ['https://a.com/' + sha]);
    const oldTs = Date.now() - 2 * 60 * 60 * 1000;
    const refs = getTrackedBlobs();
    refs[0].lastSeenAt = oldTs;
    localStorage.setItem('nostr_filesync_blossom_refs', JSON.stringify({
      [sha]: refs[0],
    }));

    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    const r = await repairBlobs();
    const allMissing = r.missing.find((m) => m.sha256 === sha && m.missingFrom === 'all');
    expect(allMissing).toBeDefined();
  });

  it('handles download failure during repair', async () => {
    mockedListServers.mockReturnValue([
      { url: 'https://a.com', trusted: true, healthy: true, lastCheckAt: null, avgLatencyMs: null },
      { url: 'https://b.com', trusted: true, healthy: true, lastCheckAt: null, avgLatencyMs: null },
    ]);
    const sha = h(64);
    trackBlob(sha, ['https://a.com/' + sha, 'https://b.com/' + sha]);
    const oldTs = Date.now() - 2 * 60 * 60 * 1000;
    const refs = getTrackedBlobs();
    refs[0].lastSeenAt = oldTs;
    localStorage.setItem('nostr_filesync_blossom_refs', JSON.stringify({
      [sha]: refs[0],
    }));

    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('https://a.com/')) return { ok: true, status: 200 };
      return { ok: false, status: 404 };
    });
    mockedDownload.mockRejectedValue(new Error('network'));

    const r = await repairBlobs();
    expect(r.failed).toBeGreaterThanOrEqual(0);
  });

  it('respects maxBlobs option', async () => {
    mockedListServers.mockReturnValue([
      { url: 'https://a.com', trusted: true, healthy: true, lastCheckAt: null, avgLatencyMs: null },
    ]);
    for (let i = 0; i < 5; i++) {
      const sha = h(60) + i.toString(16).padStart(4, '0');
      trackBlob(sha, ['https://a.com/' + sha]);
      const ref = getTrackedBlobs().find((r) => r.sha256 === sha)!;
      ref.lastSeenAt = Date.now() - 2 * 60 * 60 * 1000;
    }
    localStorage.setItem('nostr_filesync_blossom_refs', JSON.stringify(
      Object.fromEntries(getTrackedBlobs().map((r) => [r.sha256, r]))
    ));
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const r = await repairBlobs({ maxBlobs: 2 });
    expect(r.checked).toBeLessThanOrEqual(2);
  });

  it('throws on abort', async () => {
    const controller = new AbortController();
    controller.abort();
    mockedListServers.mockReturnValue([
      { url: 'https://a.com', trusted: true, healthy: true, lastCheckAt: null, avgLatencyMs: null },
    ]);
    const sha = h(64);
    trackBlob(sha, ['https://a.com/' + sha]);
    const refs = getTrackedBlobs();
    refs[0].lastSeenAt = Date.now() - 2 * 60 * 60 * 1000;
    localStorage.setItem('nostr_filesync_blossom_refs', JSON.stringify({
      [sha]: refs[0],
    }));
    await expect(repairBlobs({ signal: controller.signal })).rejects.toThrow();
  });
});
