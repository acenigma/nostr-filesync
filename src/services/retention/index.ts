import * as db from '../db/index';
import * as trash from '../trash/index';
import * as versions from '../versions/index';
import * as fileEntity from '../file-entity/index';

export type RetentionPeriod = '30d' | '90d' | '1y' | 'indefinite' | 'custom';

export interface RetentionConfig {
  trashRetention: RetentionPeriod;
  customTrashDays?: number;
  versionRetention: RetentionPeriod;
  customVersionDays?: number;
  maxVersionsPerFile?: number;
  enabled: boolean;
}

export interface RetentionResult {
  trashRemoved: number;
  versionsRemoved: number;
  bytesFreed: number;
  durationMs: number;
}

const DEFAULT_CONFIG: RetentionConfig = {
  trashRetention: '30d',
  versionRetention: '1y',
  maxVersionsPerFile: 50,
  enabled: true,
};

const CONFIG_KEY = 'retention_config';

function periodToMs(period: RetentionPeriod, customDays?: number): number {
  switch (period) {
    case '30d':
      return 30 * 24 * 60 * 60 * 1000;
    case '90d':
      return 90 * 24 * 60 * 60 * 1000;
    case '1y':
      return 365 * 24 * 60 * 60 * 1000;
    case 'indefinite':
      return Number.MAX_SAFE_INTEGER;
    case 'custom':
      return (customDays ?? 30) * 24 * 60 * 60 * 1000;
  }
}

export async function getRetentionConfig(): Promise<RetentionConfig> {
  const stored = localStorage.getItem(CONFIG_KEY);
  if (stored) {
    try {
      return { ...DEFAULT_CONFIG, ...JSON.parse(stored) };
    } catch {
      return DEFAULT_CONFIG;
    }
  }
  return DEFAULT_CONFIG;
}

export async function setRetentionConfig(config: Partial<RetentionConfig>): Promise<RetentionConfig> {
  const current = await getRetentionConfig();
  const updated = { ...current, ...config };
  localStorage.setItem(CONFIG_KEY, JSON.stringify(updated));
  return updated;
}

export async function applyTrashRetention(config?: RetentionConfig): Promise<number> {
  const cfg = config ?? await getRetentionConfig();
  if (!cfg.enabled || cfg.trashRetention === 'indefinite') return 0;

  const maxAgeMs = periodToMs(cfg.trashRetention, cfg.customTrashDays);
  const removed = await trash.emptyTrash(maxAgeMs);
  return removed;
}

export async function applyVersionRetention(config?: RetentionConfig): Promise<number> {
  const cfg = config ?? await getRetentionConfig();
  if (!cfg.enabled || cfg.versionRetention === 'indefinite') return 0;

  const maxAgeMs = periodToMs(cfg.versionRetention, cfg.customVersionDays);
  const maxVersions = cfg.maxVersionsPerFile ?? 50;
  const now = Date.now();
  let removed = 0;

  const allFiles = await fileEntity.listAllFiles();
  for (const file of allFiles) {
    const versionsList = await versions.listVersions(file.fileId);
    if (versionsList.length <= maxVersions) continue;

    const cutoff = now - maxAgeMs;
    for (const version of versionsList) {
      if (versionsList.length <= maxVersions) break;
      if (version.createdAt < cutoff) {
        await db.del(db.STORE_FILE_VERSIONS, version.id);
        removed++;
      }
    }
  }
  return removed;
}

export async function applyRetention(config?: RetentionConfig): Promise<RetentionResult> {
  const start = Date.now();
  const cfg = config ?? await getRetentionConfig();

  if (!cfg.enabled) {
    return { trashRemoved: 0, versionsRemoved: 0, bytesFreed: 0, durationMs: 0 };
  }

  const trashRemoved = await applyTrashRetention(cfg);
  const versionsRemoved = await applyVersionRetention(cfg);

  const stats = await trash.getTrashStats();
  const bytesFreed = stats.totalSize;

  return {
    trashRemoved,
    versionsRemoved,
    bytesFreed,
    durationMs: Date.now() - start,
  };
}

let retentionTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleRetention(intervalMs: number = 24 * 60 * 60 * 1000): void {
  cancelScheduledRetention();
  retentionTimer = setInterval(async () => {
    try {
      await applyRetention();
    } catch {
      // ignora erros
    }
  }, intervalMs);
}

export function cancelScheduledRetention(): void {
  if (retentionTimer) {
    clearInterval(retentionTimer);
    retentionTimer = null;
  }
}

export function isRetentionScheduled(): boolean {
  return retentionTimer !== null;
}

export function formatPeriod(period: RetentionPeriod, customDays?: number): string {
  switch (period) {
    case '30d':
      return '30 dias';
    case '90d':
      return '90 dias';
    case '1y':
      return '1 ano';
    case 'indefinite':
      return 'Indefinido';
    case 'custom':
      return `${customDays ?? 30} dias`;
  }
}

export { DEFAULT_CONFIG };