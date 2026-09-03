import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePWAInstall } from '../hooks/usePWAInstall';

function setMatchMedia(value: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((q: string) => ({
      matches: value,
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function setUserAgent(ua: string) {
  Object.defineProperty(navigator, 'userAgent', {
    value: ua,
    configurable: true,
  });
}

describe('usePWAInstall', () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    setMatchMedia(false);
  });

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
  });

  it('starts with no install available on desktop', () => {
    setUserAgent('Mozilla/5.0 (Windows NT 10.0)');
    const { result } = renderHook(() => usePWAInstall());
    expect(result.current.installable).toBe(false);
    expect(result.current.installed).toBe(false);
    expect(result.current.ios).toBe(false);
  });

  it('detects iOS user agents', () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0)');
    const { result } = renderHook(() => usePWAInstall());
    expect(result.current.ios).toBe(true);
  });

  it('detects installed via standalone display-mode', () => {
    setMatchMedia(true);
    setUserAgent('Mozilla/5.0 (Windows NT 10.0)');
    const { result } = renderHook(() => usePWAInstall());
    expect(result.current.installed).toBe(true);
  });

  it('captures beforeinstallprompt event', () => {
    setUserAgent('Mozilla/5.0 (Windows NT 10.0)');
    const { result } = renderHook(() => usePWAInstall());

    const evt = new Event('beforeinstallprompt') as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
    };
    evt.prompt = vi.fn().mockResolvedValue(undefined);
    evt.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });
    Object.defineProperty(evt, 'preventDefault', { value: vi.fn() });

    act(() => {
      window.dispatchEvent(evt);
    });

    expect(result.current.installable).toBe(true);
  });

  it('promptInstall returns unavailable without event', async () => {
    setUserAgent('Mozilla/5.0 (Windows NT 10.0)');
    const { result } = renderHook(() => usePWAInstall());
    const outcome = await result.current.promptInstall();
    expect(outcome).toBe('unavailable');
  });

  it('handles appinstalled event', () => {
    setUserAgent('Mozilla/5.0 (Windows NT 10.0)');
    const { result } = renderHook(() => usePWAInstall());

    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });

    expect(result.current.installed).toBe(true);
  });
});
