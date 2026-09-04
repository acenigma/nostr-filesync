import { describe, it, expect, beforeEach, vi } from 'vitest';
import { authWithBlossom, makeAuthHeader } from '../services/blossom/auth';
import type { VerifiedEvent } from 'nostr-tools';

vi.mock('../services/nip42', () => ({
  isReady: vi.fn(),
  handleAuth: vi.fn(),
}));

import * as nip42 from '../services/nip42';

const mockedIsReady = nip42.isReady as unknown as ReturnType<typeof vi.fn>;
const mockedHandleAuth = nip42.handleAuth as unknown as ReturnType<typeof vi.fn>;

const mockEvent = {
  id: 'id',
  pubkey: 'pk',
  created_at: 0,
  kind: 24242,
  tags: [],
  content: '',
  sig: 'sig',
} as unknown as VerifiedEvent;

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('authWithBlossom', () => {
  it('returns null when no challenge in www-authenticate', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        headers: { get: () => null },
      })
    );
    const r = await authWithBlossom('https://a.com', 'POST', '/upload');
    expect(r).toBeNull();
  });

  it('returns null when nip42 not ready', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        headers: { get: () => 'Nostr challenge="abc"' },
      })
    );
    mockedIsReady.mockReturnValue(false);
    const r = await authWithBlossom('https://a.com', 'POST', '/upload');
    expect(r).toBeNull();
  });

  it('returns signed event with Nostr header', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        headers: { get: () => 'Nostr challenge="abc",relay="wss://r"' },
      })
    );
    mockedIsReady.mockReturnValue(true);
    mockedHandleAuth.mockResolvedValue(mockEvent);
    const r = await authWithBlossom('https://a.com', 'POST', '/upload');
    expect(r).not.toBeNull();
    expect(r!.header).toMatch(/^Nostr /);
    expect(r!.event).toBe(mockEvent);
  });

  it('handles fetch errors gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    const r = await authWithBlossom('https://a.com', 'POST', '/upload');
    expect(r).toBeNull();
  });
});

describe('makeAuthHeader', () => {
  it('produces Nostr <base64> header', () => {
    const h = makeAuthHeader(mockEvent);
    expect(h.startsWith('Nostr ')).toBe(true);
    const b64 = h.slice(6);
    if (typeof atob === 'function') {
      const json = atob(b64);
      const parsed = JSON.parse(json);
      expect(parsed.id).toBe('id');
    }
  });
});
