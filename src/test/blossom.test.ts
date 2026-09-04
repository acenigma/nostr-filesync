import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../services/diagnostics', () => ({
  recordEvent: vi.fn(),
}));

vi.mock('../services/nip42', () => ({
  isReady: vi.fn().mockReturnValue(false),
  handleAuth: vi.fn(),
}));

import {
  listServers,
  addCustomServer,
  removeServer,
  getServer,
  toggleServerTrusted,
  uploadBlob,
  downloadBlob,
  checkHealth,
  runHealthChecks,
  onServersChange,
  setUserListServers,
} from '../services/blossom';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

async function makeBlob(size: number): Promise<{ data: Uint8Array; sha256: string }> {
  const data = new Uint8Array(size);
  for (let i = 0; i < size; i++) data[i] = (i * 31) & 0xff;
  const digest = await crypto.subtle.digest('SHA-256', data);
  const hashBytes = new Uint8Array(digest);
  let sha256 = '';
  for (let i = 0; i < hashBytes.length; i++) {
    sha256 += hashBytes[i].toString(16).padStart(2, '0');
  }
  return { data, sha256 };
}

describe('server list management', () => {
  it('listServers returns default + stored', () => {
    const s = listServers();
    expect(s.length).toBeGreaterThanOrEqual(4);
    expect(s.some((x) => x.source === 'fallback')).toBe(true);
  });

  it('addCustomServer adds a new trusted server', () => {
    const s = addCustomServer('https://my-server.example.com', 'My Server');
    expect(s.url).toBe('https://my-server.example.com');
    expect(s.trusted).toBe(true);
    expect(s.source).toBe('custom');
    expect(getServer('https://my-server.example.com')).not.toBeNull();
  });

  it('addCustomServer normalizes trailing slash', () => {
    addCustomServer('https://my-server.example.com/');
    const s = getServer('https://my-server.example.com');
    expect(s).not.toBeNull();
  });

  it('addCustomServer rejects invalid URL', () => {
    expect(() => addCustomServer('not-a-url')).toThrow();
  });

  it('addCustomServer toggles existing non-trusted to trusted', () => {
    addCustomServer('https://x.com');
    toggleServerTrusted('https://x.com', false);
    const s = addCustomServer('https://x.com');
    expect(s.trusted).toBe(true);
  });

  it('removeServer removes a server', () => {
    addCustomServer('https://x.com');
    expect(removeServer('https://x.com')).toBe(true);
    expect(getServer('https://x.com')).toBeNull();
  });

  it('removeServer returns false for missing', () => {
    expect(removeServer('https://missing.com')).toBe(false);
  });

  it('toggleServerTrusted updates trusted flag', () => {
    addCustomServer('https://x.com');
    toggleServerTrusted('https://x.com', false);
    expect(getServer('https://x.com')!.trusted).toBe(false);
  });

  it('onServersChange notifies on changes', () => {
    const calls: number[] = [];
    onServersChange((s) => calls.push(s.length));
    addCustomServer('https://x.com');
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it('onServersChange returns unsubscribe', () => {
    const off = onServersChange(() => {});
    expect(typeof off).toBe('function');
    off();
  });

  it('setUserListServers replaces user-list entries', () => {
    setUserListServers([
      {
        url: 'https://userlist.example.com',
        name: 'UserList',
        healthy: true,
        lastCheckAt: null,
        avgLatencyMs: null,
        trusted: true,
        source: 'user-list',
      },
    ]);
    expect(getServer('https://userlist.example.com')).not.toBeNull();
  });
});

describe('uploadBlob', () => {
  it('uploads successfully and returns sha256 + url', async () => {
    const { data, sha256 } = await makeBlob(1024);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ sha256, url: `https://blossom.primal.net/${sha256}` }),
    });

    const result = await uploadBlob(data, { noAuth: true });
    expect(result.sha256).toBe(sha256);
    expect(result.size).toBe(1024);
    expect(result.url).toContain(sha256);
  });

  it('uses provided server URL when trusted', async () => {
    const { data, sha256 } = await makeBlob(512);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ sha256 }),
    });
    const result = await uploadBlob(data, {
      server: 'https://blossom.primal.net',
      noAuth: true,
    });
    expect(fetchMock).toHaveBeenCalled();
    expect(result.server).toBe('https://blossom.primal.net');
  });

  it('throws on sha256 mismatch', async () => {
    const { data } = await makeBlob(256);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ sha256: 'wrong' }),
    });
    await expect(uploadBlob(data, { noAuth: true })).rejects.toThrow(/SHA-256 mismatch/);
  });

  it('throws on HTTP error', async () => {
    const { data } = await makeBlob(256);
    fetchMock.mockResolvedValue({
      ok: false,
      status: 413,
      statusText: 'Too Large',
      text: () => Promise.resolve('file too big'),
    });
    await expect(uploadBlob(data, { noAuth: true })).rejects.toThrow(/Upload falhou/);
  });

  it('handles JSON parse failure gracefully', async () => {
    const { data, sha256 } = await makeBlob(256);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error('not json')),
    });
    const result = await uploadBlob(data, { noAuth: true });
    expect(result.sha256).toBe(sha256);
  });
});

describe('downloadBlob', () => {
  it('downloads and verifies sha256', async () => {
    const { data, sha256 } = await makeBlob(1024);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(data.buffer),
    });
    const buf = await downloadBlob(sha256);
    expect(buf.byteLength).toBe(1024);
  });

  it('rejects on sha256 mismatch', async () => {
    const { data } = await makeBlob(1024);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(data.buffer),
    });
    await expect(downloadBlob('a'.repeat(64))).rejects.toThrow();
  });

  it('rejects when no servers available', async () => {
    vi.resetModules();
    const mod = await import('../services/blossom');
    for (const s of mod.listServers()) {
      if (s.source === 'fallback') mod.removeServer(s.url);
    }
    await expect(mod.downloadBlob('a'.repeat(64))).rejects.toThrow(/Nenhum servidor/);
  });

  it('tries fallback servers', async () => {
    const { data, sha256 } = await makeBlob(64);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(data.buffer),
    });
    const buf = await downloadBlob(sha256, {
      fallbackServers: ['https://blossom.primal.net', 'https://blossom.nostr.build'],
    });
    expect(buf.byteLength).toBe(64);
  });
});

describe('checkHealth', () => {
  it('reports healthy on 200', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const r = await checkHealth('https://a.com');
    expect(r.healthy).toBe(true);
    expect(r.latencyMs).not.toBeNull();
  });

  it('reports healthy on 405 (method not allowed)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 405 });
    const r = await checkHealth('https://a.com');
    expect(r.healthy).toBe(true);
  });

  it('reports unhealthy on network error', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    const r = await checkHealth('https://a.com');
    expect(r.healthy).toBe(false);
    expect(r.error).toBe('offline');
  });
});

describe('runHealthChecks', () => {
  it('updates server health status', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await runHealthChecks();
    for (const s of listServers()) {
      expect(s.lastCheckAt).not.toBeNull();
    }
  });
});
