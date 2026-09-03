import { describe, it, expect, beforeEach, vi } from 'vitest';
import { shouldDeferHeavyUploads, type NetworkInfo } from '../hooks/useNetworkInfo';

function makeInfo(over: Partial<NetworkInfo> = {}): NetworkInfo {
  return {
    supported: true,
    online: true,
    effectiveType: '4g',
    downlinkMbps: 10,
    rttMs: 50,
    saveData: false,
    ...over,
  };
}

describe('shouldDeferHeavyUploads', () => {
  it('defers when offline', () => {
    expect(shouldDeferHeavyUploads(makeInfo({ online: false }))).toBe(true);
  });

  it('defers when save-data is on', () => {
    expect(shouldDeferHeavyUploads(makeInfo({ saveData: true }))).toBe(true);
  });

  it('defers on 2g and slow-2g', () => {
    expect(shouldDeferHeavyUploads(makeInfo({ effectiveType: '2g' }))).toBe(true);
    expect(shouldDeferHeavyUploads(makeInfo({ effectiveType: 'slow-2g' }))).toBe(true);
  });

  it('defers on 3g with high rtt', () => {
    expect(shouldDeferHeavyUploads(makeInfo({ effectiveType: '3g', rttMs: 800 }))).toBe(true);
  });

  it('does not defer on 4g', () => {
    expect(shouldDeferHeavyUploads(makeInfo({ effectiveType: '4g' }))).toBe(false);
  });

  it('does not defer on 3g with low rtt', () => {
    expect(shouldDeferHeavyUploads(makeInfo({ effectiveType: '3g', rttMs: 100 }))).toBe(false);
  });
});

describe('useBattery', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns unsupported when getBattery is missing', async () => {
    const { renderHook } = await import('@testing-library/react');
    const { useBattery } = await import('../hooks/useBattery');
    const { result } = renderHook(() => useBattery());
    expect(result.current.supported).toBe(false);
  });

  it('reads battery state when supported', async () => {
    const mockBattery = {
      level: 0.85,
      charging: true,
      chargingTime: 0,
      dischargingTime: Infinity,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    Object.defineProperty(navigator, 'getBattery', {
      configurable: true,
      value: () => Promise.resolve(mockBattery),
    });
    const { renderHook, waitFor } = await import('@testing-library/react');
    const { useBattery } = await import('../hooks/useBattery');
    const { result } = renderHook(() => useBattery());
    await waitFor(() => {
      expect(result.current.supported).toBe(true);
    });
    expect(result.current.level).toBe(0.85);
    expect(result.current.charging).toBe(true);
    expect(result.current.lowPower).toBe(false);
  });
});
