import * as blossom from '../blossom';
import { recordEvent } from '../diagnostics';

export interface HealthSchedulerConfig {
  /** Interval between full health checks (ms) */
  intervalMs: number;
  /** Initial delay before first check (ms) */
  initialDelayMs: number;
  /** Number of trusted servers to check per cycle */
  batchSize: number;
}

export const DEFAULT_HEALTH_CONFIG: HealthSchedulerConfig = {
  intervalMs: 6 * 60 * 60 * 1000,
  initialDelayMs: 30_000,
  batchSize: 4,
};

let timer: ReturnType<typeof setTimeout> | null = null;
let initialized = false;
let lastRunAt: number | null = null;
let lastResult: { healthy: number; total: number; errors: string[] } | null = null;
let listeners: Array<(state: { lastRunAt: number | null; lastResult: typeof lastResult }) => void> = [];

function emit(): void {
  listeners.forEach((l) => l({ lastRunAt, lastResult }));
}

function schedule(config: HealthSchedulerConfig): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    await runOnce(config);
    schedule(config);
  }, config.intervalMs);
}

async function runOnce(config: HealthSchedulerConfig): Promise<void> {
  const all = blossom.listServers().filter((s) => s.trusted);
  if (all.length === 0) {
    lastResult = { healthy: 0, total: 0, errors: ['no trusted servers'] };
    lastRunAt = Date.now();
    emit();
    return;
  }

  const batch = all.slice(0, config.batchSize);
  const checks = await Promise.all(
    batch.map(async (s) => {
      const r = await blossom.checkHealth(s.url);
      s.healthy = r.healthy;
      s.lastCheckAt = Date.now();
      if (r.healthy && r.latencyMs !== null) {
        s.avgLatencyMs = s.avgLatencyMs === null
          ? r.latencyMs
          : s.avgLatencyMs * 0.7 + r.latencyMs * 0.3;
      }
      return { url: s.url, ...r };
    })
  );

  const healthy = checks.filter((c) => c.healthy).length;
  const errors = checks.filter((c) => !c.healthy).map((c) => `${c.url}: ${c.error || 'unhealthy'}`);
  lastResult = { healthy, total: checks.length, errors };
  lastRunAt = Date.now();

  recordEvent('system', errors.length === 0 ? 'info' : 'warn',
    `Blossom health: ${healthy}/${checks.length} OK${errors.length > 0 ? ` (errors: ${errors.join(', ')})` : ''}`,
    { healthy, total: checks.length });

  emit();
}

export function startHealthScheduler(config: Partial<HealthSchedulerConfig> = {}): void {
  if (initialized) return;
  initialized = true;
  const cfg = { ...DEFAULT_HEALTH_CONFIG, ...config };

  setTimeout(() => {
    void runOnce(cfg);
    schedule(cfg);
  }, cfg.initialDelayMs);
}

export function stopHealthScheduler(): void {
  initialized = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

export function runHealthNow(config: Partial<HealthSchedulerConfig> = {}): Promise<void> {
  const cfg = { ...DEFAULT_HEALTH_CONFIG, ...config };
  return runOnce(cfg);
}

export function getHealthSchedulerState(): { lastRunAt: number | null; lastResult: typeof lastResult } {
  return { lastRunAt, lastResult };
}

export function onHealthSchedulerChange(
  listener: (state: { lastRunAt: number | null; lastResult: typeof lastResult }) => void
): () => void {
  listeners.push(listener);
  listener({ lastRunAt, lastResult });
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export function __resetHealthScheduler(): void {
  stopHealthScheduler();
  lastRunAt = null;
  lastResult = null;
  listeners = [];
}
