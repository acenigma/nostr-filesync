export type BandwidthProfile = 'unlimited' | 'high' | 'medium' | 'low';

export interface BandwidthConfig {
  profile: BandwidthProfile;
  maxParallelChunks: number;
  maxParallelFiles: number;
  chunkSizeBytes: number;
  minChunkSizeBytes: number;
  maxChunkSizeBytes: number;
}

export const BANDWIDTH_PRESETS: Record<BandwidthProfile, BandwidthConfig> = {
  unlimited: {
    profile: 'unlimited',
    maxParallelChunks: 6,
    maxParallelFiles: 4,
    chunkSizeBytes: 64 * 1024,
    minChunkSizeBytes: 16 * 1024,
    maxChunkSizeBytes: 256 * 1024,
  },
  high: {
    profile: 'high',
    maxParallelChunks: 4,
    maxParallelFiles: 3,
    chunkSizeBytes: 64 * 1024,
    minChunkSizeBytes: 16 * 1024,
    maxChunkSizeBytes: 128 * 1024,
  },
  medium: {
    profile: 'medium',
    maxParallelChunks: 2,
    maxParallelFiles: 2,
    chunkSizeBytes: 32 * 1024,
    minChunkSizeBytes: 16 * 1024,
    maxChunkSizeBytes: 64 * 1024,
  },
  low: {
    profile: 'low',
    maxParallelChunks: 1,
    maxParallelFiles: 1,
    chunkSizeBytes: 16 * 1024,
    minChunkSizeBytes: 8 * 1024,
    maxChunkSizeBytes: 32 * 1024,
  },
};

const STORAGE_KEY = 'nostr_filesync_bandwidth';

let currentConfig: BandwidthConfig = (() => {
  if (typeof localStorage === 'undefined') return BANDWIDTH_PRESETS.high;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && stored in BANDWIDTH_PRESETS) {
    return BANDWIDTH_PRESETS[stored as BandwidthProfile];
  }
  return BANDWIDTH_PRESETS.high;
})();

let listeners: Array<(cfg: BandwidthConfig) => void> = [];

export function getBandwidthConfig(): BandwidthConfig {
  return currentConfig;
}

export function setBandwidthProfile(profile: BandwidthProfile): void {
  currentConfig = BANDWIDTH_PRESETS[profile];
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, profile);
  }
  listeners.forEach((l) => l(currentConfig));
}

export function onBandwidthChange(listener: (cfg: BandwidthConfig) => void): () => void {
  listeners.push(listener);
  listener(currentConfig);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export function adaptiveChunkSize(fileSize: number, base: number): number {
  if (fileSize < 256 * 1024) return Math.max(base / 2, 8 * 1024);
  if (fileSize < 1024 * 1024) return base;
  if (fileSize < 10 * 1024 * 1024) return Math.min(base * 2, 256 * 1024);
  return Math.min(base * 4, 512 * 1024);
}

export function shouldParallelizeFile(fileSize: number): boolean {
  return fileSize > 256 * 1024;
}
