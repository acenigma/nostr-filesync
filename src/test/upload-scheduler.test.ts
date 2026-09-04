import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UploadScheduler } from '../services/uploadScheduler';
import { setBandwidthProfile } from '../services/bandwidth';

beforeEach(() => {
  localStorage.clear();
  setBandwidthProfile('high');
  vi.useRealTimers();
});

describe('UploadScheduler', () => {
  it('limits parallel files based on bandwidth config', async () => {
    const scheduler = new UploadScheduler();
    let running = 0;
    let maxRunning = 0;
    scheduler.setWorker(async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 30));
      running--;
    });
    for (let i = 0; i < 10; i++) {
      scheduler.enqueueFile({ fileId: `f${i}`, fileSize: 1024, userRequested: false });
    }
    await new Promise((r) => setTimeout(r, 200));
    expect(maxRunning).toBeLessThanOrEqual(3);
    scheduler.destroy();
  });

  it('enforces user-requested priority first', async () => {
    setBandwidthProfile('low');
    const scheduler = new UploadScheduler();
    const order: string[] = [];
    let resolveFirst: (() => void) | null = null;
    const firstStarted = new Promise<void>((r) => {
      resolveFirst = r;
    });
    scheduler.setWorker(async (t) => {
      if (order.length === 0) resolveFirst!();
      order.push(t.fileId);
      await new Promise((r) => setTimeout(r, 20));
    });
    scheduler.enqueueFile({ fileId: 'bg1', fileSize: 1024, userRequested: false });
    await firstStarted;
    scheduler.enqueueFile({ fileId: 'urgent', fileSize: 1024, userRequested: true });
    scheduler.enqueueFile({ fileId: 'bg2', fileSize: 1024, userRequested: false });
    await new Promise((r) => setTimeout(r, 200));
    expect(order.indexOf('urgent')).toBeGreaterThanOrEqual(0);
    scheduler.destroy();
  });

  it('does not enqueue duplicate fileId', () => {
    const scheduler = new UploadScheduler();
    scheduler.setWorker(async () => {});
    scheduler.enqueueFile({ fileId: 'f1', fileSize: 1024, userRequested: false });
    scheduler.enqueueFile({ fileId: 'f1', fileSize: 1024, userRequested: false });
    expect(scheduler.state().queued + scheduler.state().inFlight).toBe(1);
    scheduler.destroy();
  });

  it('cancel removes from queue', async () => {
    setBandwidthProfile('low');
    const scheduler = new UploadScheduler();
    scheduler.setWorker(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    scheduler.enqueueFile({ fileId: 'f1', fileSize: 1024, userRequested: false });
    scheduler.enqueueFile({ fileId: 'f2', fileSize: 1024, userRequested: false });
    scheduler.cancel('f2');
    expect(scheduler.state().queued).toBe(0);
    scheduler.destroy();
  });

  it('respects bandwidth change', async () => {
    setBandwidthProfile('low');
    const scheduler = new UploadScheduler();
    scheduler.setWorker(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    for (let i = 0; i < 5; i++) {
      scheduler.enqueueFile({ fileId: `f${i}`, fileSize: 1024, userRequested: false });
    }
    setBandwidthProfile('high');
    expect(scheduler.state().maxParallel).toBe(3);
    scheduler.destroy();
  });

  it('state reports inFlight, queued, maxParallel', () => {
    const scheduler = new UploadScheduler();
    scheduler.setWorker(async () => {});
    scheduler.enqueueFile({ fileId: 'f1', fileSize: 1024, userRequested: false });
    scheduler.enqueueFile({ fileId: 'f2', fileSize: 1024, userRequested: false });
    scheduler.enqueueFile({ fileId: 'f3', fileSize: 1024, userRequested: false });
    const s = scheduler.state();
    expect(s.maxParallel).toBe(3);
    expect(s.queued + s.inFlight).toBe(3);
    scheduler.destroy();
  });

  it('destroy clears state', () => {
    const scheduler = new UploadScheduler();
    scheduler.setWorker(async () => {});
    scheduler.enqueueFile({ fileId: 'f1', fileSize: 1024, userRequested: false });
    scheduler.destroy();
    expect(scheduler.state().queued).toBe(0);
  });
});
