import { describe, it, expect, beforeEach } from 'vitest';
import {
  BANDWIDTH_PRESETS,
  getBandwidthConfig,
  setBandwidthProfile,
  adaptiveChunkSize,
  shouldParallelizeFile,
} from '../services/bandwidth';

beforeEach(() => {
  localStorage.clear();
  setBandwidthProfile('high');
});

describe('bandwidth', () => {
  it('getBandwidthConfig returns current config', () => {
    expect(getBandwidthConfig().profile).toBe('high');
  });

  it('setBandwidthProfile persists and changes config', () => {
    setBandwidthProfile('low');
    expect(getBandwidthConfig().profile).toBe('low');
    expect(localStorage.getItem('nostr_filesync_bandwidth')).toBe('low');
  });

  it('unlimited has highest concurrency', () => {
    const u = BANDWIDTH_PRESETS.unlimited;
    const l = BANDWIDTH_PRESETS.low;
    expect(u.maxParallelFiles).toBeGreaterThan(l.maxParallelFiles);
    expect(u.maxParallelChunks).toBeGreaterThan(l.maxParallelChunks);
  });

  it('adaptiveChunkSize scales with file size', () => {
    const base = 64 * 1024;
    expect(adaptiveChunkSize(1024, base)).toBeLessThan(base);
    expect(adaptiveChunkSize(512 * 1024, base)).toBe(base);
    expect(adaptiveChunkSize(5 * 1024 * 1024, base)).toBeGreaterThan(base);
    expect(adaptiveChunkSize(50 * 1024 * 1024, base)).toBeGreaterThanOrEqual(base * 2);
  });

  it('shouldParallelizeFile only for files > 256KB', () => {
    expect(shouldParallelizeFile(1024)).toBe(false);
    expect(shouldParallelizeFile(100 * 1024)).toBe(false);
    expect(shouldParallelizeFile(500 * 1024)).toBe(true);
    expect(shouldParallelizeFile(10 * 1024 * 1024)).toBe(true);
  });
});
