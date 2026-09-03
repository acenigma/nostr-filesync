import { describe, it, expect } from 'vitest';
import { parseDeepLink } from '../hooks/useDeepLink';

describe('parseDeepLink', () => {
  it('parses nostrsync:// share link', () => {
    const link = 'nostrsync://share/abc123?from=npub1xyz&id=shr-1';
    const result = parseDeepLink(link);
    expect(result).toEqual({
      type: 'share',
      eventId: 'abc123',
      from: 'npub1xyz',
      shareId: 'shr-1',
    });
  });

  it('rejects share link with missing fields', () => {
    expect(parseDeepLink('nostrsync://share/abc?from=x')).toBeNull();
  });

  it('parses https view query', () => {
    expect(parseDeepLink('https://example.com/?view=todo')).toEqual({
      type: 'view',
      view: 'todo',
    });
    expect(parseDeepLink('https://example.com/?view=sync')).toEqual({
      type: 'view',
      view: 'sync',
    });
  });

  it('parses https settings path', () => {
    expect(parseDeepLink('https://example.com/settings')).toEqual({ type: 'settings' });
  });

  it('parses nostrsync:// settings', () => {
    expect(parseDeepLink('nostrsync://settings')).toEqual({ type: 'settings' });
  });

  it('returns null for unknown scheme', () => {
    expect(parseDeepLink('ftp://example.com')).toBeNull();
  });

  it('returns null for invalid URL', () => {
    expect(parseDeepLink('not a url')).toBeNull();
  });

  it('ignores unknown view param', () => {
    expect(parseDeepLink('https://example.com/?view=other')).toBeNull();
  });
});
