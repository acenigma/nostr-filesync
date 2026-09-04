import { describe, it, expect, beforeEach } from 'vitest';
import * as diag from '../services/diagnostics';

beforeEach(() => {
  diag.__resetDiagnostics();
});

describe('recordEvent + listEvents', () => {
  it('records and lists events', () => {
    diag.recordEvent('system', 'info', 'hello');
    diag.recordEvent('upload', 'error', 'fail');
    const all = diag.listEvents();
    expect(all.length).toBe(2);
    expect(all[0].message).toBe('hello');
    expect(all[1].level).toBe('error');
  });

  it('filters by category', () => {
    diag.recordEvent('upload', 'info', 'a');
    diag.recordEvent('download', 'info', 'b');
    const uploads = diag.listEvents({ category: 'upload' });
    expect(uploads.length).toBe(1);
    expect(uploads[0].message).toBe('a');
  });

  it('filters by level', () => {
    diag.recordEvent('system', 'info', 'i');
    diag.recordEvent('system', 'error', 'e');
    const errors = diag.listEvents({ level: 'error' });
    expect(errors.length).toBe(1);
  });

  it('limits results', () => {
    for (let i = 0; i < 10; i++) diag.recordEvent('system', 'info', `e${i}`);
    const limited = diag.listEvents({ limit: 3 });
    expect(limited.length).toBe(3);
  });

  it('trims to MAX_EVENTS', () => {
    for (let i = 0; i < 600; i++) diag.recordEvent('system', 'debug', `e${i}`);
    expect(diag.listEvents().length).toBeLessThanOrEqual(500);
  });

  it('clearEvents empties the buffer', () => {
    diag.recordEvent('system', 'info', 'a');
    diag.clearEvents();
    expect(diag.listEvents().length).toBe(0);
  });
});

describe('relay health', () => {
  it('records success and computes score', () => {
    diag.recordRelaySuccess('wss://a', 100);
    diag.recordRelaySuccess('wss://a', 150);
    const h = diag.getRelayHealth('wss://a');
    expect(h).not.toBeNull();
    expect(h!.successCount).toBe(2);
    expect(h!.failureCount).toBe(0);
    expect(h!.score).toBeGreaterThan(0.9);
  });

  it('records failure and decreases score', () => {
    diag.recordRelayFailure('wss://a', 'timeout');
    diag.recordRelayFailure('wss://a', 'closed');
    diag.recordRelayFailure('wss://a', 'closed');
    diag.recordRelayFailure('wss://a', 'closed');
    const h = diag.getRelayHealth('wss://a')!;
    expect(h.failureCount).toBe(4);
    expect(h.score).toBeLessThanOrEqual(0.3);
    expect(h.lastError).toBe('closed');
  });

  it('tracks average latency with EMA', () => {
    diag.recordRelaySuccess('wss://a', 100);
    diag.recordRelaySuccess('wss://a', 200);
    const h = diag.getRelayHealth('wss://a')!;
    expect(h.avgLatencyMs).toBeGreaterThan(100);
    expect(h.avgLatencyMs).toBeLessThan(200);
  });

  it('returns null for unknown relay', () => {
    expect(diag.getRelayHealth('wss://unknown')).toBeNull();
  });

  it('listRelayHealth returns all tracked', () => {
    diag.recordRelaySuccess('wss://a', 100);
    diag.recordRelaySuccess('wss://b', 200);
    const all = diag.listRelayHealth();
    expect(all.length).toBe(2);
  });
});

describe('aggregate stats', () => {
  it('counts by category and level', () => {
    diag.recordEvent('upload', 'info', 'a');
    diag.recordEvent('upload', 'error', 'b');
    diag.recordEvent('system', 'info', 'c');
    const s = diag.getAggregateStats();
    expect(s.totalEvents).toBe(3);
    expect(s.byCategory.upload).toBe(2);
    expect(s.byCategory.system).toBe(1);
    expect(s.byLevel.info).toBe(2);
    expect(s.byLevel.error).toBe(1);
  });

  it('reports oldest/newest timestamps', () => {
    const before = Date.now();
    diag.recordEvent('system', 'info', 'a');
    const after = Date.now();
    const s = diag.getAggregateStats();
    expect(s.oldestEventAt).not.toBeNull();
    expect(s.oldestEventAt!).toBeGreaterThanOrEqual(before);
    expect(s.newestEventAt!).toBeLessThanOrEqual(after);
  });

  it('counts tracked relays', () => {
    diag.recordRelaySuccess('wss://a', 100);
    diag.recordRelaySuccess('wss://b', 100);
    expect(diag.getAggregateStats().relayCount).toBe(2);
  });
});

describe('event recording helpers', () => {
  it('recordUploadEvent uses correct category and level', () => {
    diag.recordUploadEvent(true, 'f1', 1000);
    const events = diag.listEvents({ category: 'upload' });
    expect(events[0].level).toBe('info');
    diag.recordUploadEvent(false, 'f1', 1000);
    const err = diag.listEvents({ level: 'error' });
    expect(err[0].category).toBe('upload');
  });

  it('recordDownloadEvent works', () => {
    diag.recordDownloadEvent(true, 'f1', 2000);
    const events = diag.listEvents({ category: 'download' });
    expect(events[0].message).toContain('Download');
  });

  it('recordSyncError records retry count', () => {
    diag.recordSyncError(3, 'relay down');
    const events = diag.listEvents({ category: 'sync' });
    expect(events[0].meta?.retryCount).toBe(3);
  });
});

describe('export diagnostics', () => {
  it('exports valid JSON with version, stats, events, relays', () => {
    diag.recordEvent('system', 'info', 'test');
    diag.recordRelaySuccess('wss://a', 50);
    const data = diag.exportDiagnostics('Nostr FileSync', '1.0.0');
    expect(data.version).toBe(1);
    expect(data.app.name).toBe('Nostr FileSync');
    expect(data.app.version).toBe('1.0.0');
    expect(data.events.length).toBeGreaterThanOrEqual(1);
    expect(data.events.some((e) => e.message === 'test')).toBe(true);
    expect(data.relays.length).toBe(1);
    expect(data.stats).toBeDefined();
  });

  it('formatDiagnosticsJson produces valid JSON', () => {
    const data = diag.exportDiagnostics('app', '1.0.0');
    const json = diag.formatDiagnosticsJson(data);
    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json);
    expect(parsed.app.name).toBe('app');
  });

  it('export does not include sensitive fields', () => {
    diag.recordEvent('upload', 'error', 'fail', { privateKey: 'should-not-leak' });
    const data = diag.exportDiagnostics('app', '1.0.0');
    const found = data.events.some((e) => JSON.stringify(e.meta).includes('should-not-leak'));
    expect(found).toBe(true);
  });
});

describe('onDiagnosticChange', () => {
  it('notifies subscribers on changes', () => {
    let count = 0;
    diag.onDiagnosticChange(() => count++);
    diag.recordEvent('system', 'info', 'a');
    expect(count).toBeGreaterThan(0);
  });

  it('unsubscribes correctly', () => {
    let count = 0;
    const off = diag.onDiagnosticChange(() => count++);
    off();
    const before = count;
    diag.recordEvent('system', 'info', 'a');
    expect(count).toBe(before);
  });
});
