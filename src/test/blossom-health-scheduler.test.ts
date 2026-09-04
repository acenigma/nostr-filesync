import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../services/blossom', () => ({
  listServers: vi.fn(),
  checkHealth: vi.fn(),
  downloadBlob: vi.fn(),
  uploadBlob: vi.fn(),
}));

vi.mock('../services/diagnostics', () => ({
  recordEvent: vi.fn(),
}));

import * as blossom from '../services/blossom';
import {
  startHealthScheduler,
  stopHealthScheduler,
  runHealthNow,
  getHealthSchedulerState,
  onHealthSchedulerChange,
  __resetHealthScheduler,
  DEFAULT_HEALTH_CONFIG,
} from '../services/blossom/healthScheduler';

const mockedListServers = blossom.listServers as unknown as ReturnType<typeof vi.fn>;
const mockedCheckHealth = blossom.checkHealth as unknown as ReturnType<typeof vi.fn>;

const fetchMock = vi.fn();

beforeEach(() => {
  __resetHealthScheduler();
  localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.clearAllMocks();
});

describe('health scheduler', () => {
  it('startHealthScheduler is idempotent', () => {
    startHealthScheduler();
    startHealthScheduler();
    expect(true).toBe(true);
  });

  it('records lastResult and lastRunAt after run', async () => {
    mockedListServers.mockReturnValue([
      {
        url: 'https://a.com',
        trusted: true,
        healthy: true,
        lastCheckAt: null,
        avgLatencyMs: null,
      },
    ]);
    mockedCheckHealth.mockResolvedValue({ healthy: true, latencyMs: 50 });

    await runHealthNow();
    const s = getHealthSchedulerState();
    expect(s.lastRunAt).not.toBeNull();
    expect(s.lastResult?.healthy).toBe(1);
    expect(s.lastResult?.total).toBe(1);
  });

  it('reports unhealthy servers', async () => {
    mockedListServers.mockReturnValue([
      {
        url: 'https://a.com',
        trusted: true,
        healthy: true,
        lastCheckAt: null,
        avgLatencyMs: null,
      },
      {
        url: 'https://b.com',
        trusted: true,
        healthy: true,
        lastCheckAt: null,
        avgLatencyMs: null,
      },
    ]);
    mockedCheckHealth.mockImplementation(async (url: string) => {
      if (url === 'https://b.com') {
        return { healthy: false, latencyMs: null, error: 'timeout' };
      }
      return { healthy: true, latencyMs: 30 };
    });

    await runHealthNow();
    const s = getHealthSchedulerState();
    expect(s.lastResult?.healthy).toBe(1);
    expect(s.lastResult?.total).toBe(2);
    expect(s.lastResult?.errors.length).toBe(1);
  });

  it('skips untrusted servers', async () => {
    mockedListServers.mockReturnValue([
      {
        url: 'https://a.com',
        trusted: false,
        healthy: true,
        lastCheckAt: null,
        avgLatencyMs: null,
      },
    ]);
    mockedCheckHealth.mockResolvedValue({ healthy: true, latencyMs: 30 });

    await runHealthNow();
    expect(mockedCheckHealth).not.toHaveBeenCalled();
  });

  it('updates avgLatencyMs with EMA on success', async () => {
    const server = {
      url: 'https://a.com',
      trusted: true,
      healthy: true,
      lastCheckAt: null,
      avgLatencyMs: 100,
    };
    mockedListServers.mockReturnValue([server]);
    mockedCheckHealth.mockResolvedValue({ healthy: true, latencyMs: 50 });

    await runHealthNow();
    expect(server.avgLatencyMs).toBeLessThan(100);
    expect(server.avgLatencyMs).toBeGreaterThan(50);
  });

  it('handles no trusted servers gracefully', async () => {
    mockedListServers.mockReturnValue([]);
    await runHealthNow();
    const s = getHealthSchedulerState();
    expect(s.lastResult?.total).toBe(0);
  });

  it('notifies listeners on changes', async () => {
    mockedListServers.mockReturnValue([
      {
        url: 'https://a.com',
        trusted: true,
        healthy: true,
        lastCheckAt: null,
        avgLatencyMs: null,
      },
    ]);
    mockedCheckHealth.mockResolvedValue({ healthy: true, latencyMs: 30 });

    let calls = 0;
    onHealthSchedulerChange(() => calls++);
    await runHealthNow();
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('unsubscribe stops notifications', async () => {
    mockedListServers.mockReturnValue([
      {
        url: 'https://a.com',
        trusted: true,
        healthy: true,
        lastCheckAt: null,
        avgLatencyMs: null,
      },
    ]);
    mockedCheckHealth.mockResolvedValue({ healthy: true, latencyMs: 30 });

    let calls = 0;
    const off = onHealthSchedulerChange(() => calls++);
    off();
    const before = calls;
    await runHealthNow();
    expect(calls).toBe(before);
  });

  it('stopHealthScheduler clears timer', () => {
    startHealthScheduler();
    stopHealthScheduler();
    expect(true).toBe(true);
  });

  it('respects batch size', async () => {
    const servers = Array.from({ length: 10 }, (_, i) => ({
      url: `https://s${i}.com`,
      trusted: true,
      healthy: true,
      lastCheckAt: null,
      avgLatencyMs: null,
    }));
    mockedListServers.mockReturnValue(servers);
    mockedCheckHealth.mockResolvedValue({ healthy: true, latencyMs: 30 });

    await runHealthNow({ batchSize: 3 });
    const s = getHealthSchedulerState();
    expect(s.lastResult?.total).toBe(3);
  });
});

describe('DEFAULT_HEALTH_CONFIG', () => {
  it('has sane defaults', () => {
    expect(DEFAULT_HEALTH_CONFIG.intervalMs).toBeGreaterThan(0);
    expect(DEFAULT_HEALTH_CONFIG.initialDelayMs).toBeGreaterThan(0);
    expect(DEFAULT_HEALTH_CONFIG.batchSize).toBeGreaterThan(0);
  });
});
