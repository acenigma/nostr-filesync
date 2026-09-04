import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_BLOSSOM_SERVERS,
  loadStoredServers,
  saveStoredServers,
  normalizeServerUrl,
  dedupeServers,
} from '../services/blossom/servers';

beforeEach(() => {
  localStorage.clear();
});

describe('Blossom servers helpers', () => {
  it('exports default servers', () => {
    expect(DEFAULT_BLOSSOM_SERVERS.length).toBeGreaterThan(0);
    for (const s of DEFAULT_BLOSSOM_SERVERS) {
      expect(s.url).toMatch(/^https?:\/\//);
      expect(s.trusted).toBe(true);
    }
  });

  it('normalizeServerUrl strips trailing slashes', () => {
    expect(normalizeServerUrl('https://a.com/')).toBe('https://a.com');
    expect(normalizeServerUrl('https://a.com///')).toBe('https://a.com');
    expect(normalizeServerUrl('  https://a.com  ')).toBe('https://a.com');
  });

  it('loadStoredServers returns [] when empty', () => {
    expect(loadStoredServers()).toEqual([]);
  });

  it('saveStoredServers roundtrips via loadStoredServers', () => {
    const list = [
      {
        url: 'https://custom.example.com',
        name: 'custom',
        healthy: true,
        lastCheckAt: null,
        avgLatencyMs: null,
        trusted: true,
        source: 'custom' as const,
      },
    ];
    saveStoredServers(list);
    const got = loadStoredServers();
    expect(got.length).toBe(1);
    expect(got[0].url).toBe('https://custom.example.com');
  });

  it('dedupeServers removes duplicates by normalized URL', () => {
    const a = {
      url: 'https://a.com/',
      name: 'A',
      healthy: true,
      lastCheckAt: null,
      avgLatencyMs: null,
      trusted: true,
      source: 'fallback' as const,
    };
    const b = {
      url: 'https://a.com',
      name: 'A-dup',
      healthy: true,
      lastCheckAt: null,
      avgLatencyMs: null,
      trusted: true,
      source: 'fallback' as const,
    };
    const out = dedupeServers([a, b]);
    expect(out.length).toBe(1);
    expect(out[0].url).toBe('https://a.com');
  });

  it('loadStoredServers returns [] on corrupt JSON', () => {
    localStorage.setItem('nostr_filesync_blossom_servers', 'not-json');
    expect(loadStoredServers()).toEqual([]);
  });
});
