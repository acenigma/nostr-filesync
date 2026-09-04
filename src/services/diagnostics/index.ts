export type EventCategory = 'relay' | 'upload' | 'download' | 'sync' | 'system';

export type EventLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DiagnosticEvent {
  id: string;
  ts: number;
  category: EventCategory;
  level: EventLevel;
  message: string;
  meta?: Record<string, unknown>;
}

export interface RelayHealth {
  url: string;
  samples: number;
  avgLatencyMs: number | null;
  successCount: number;
  failureCount: number;
  lastSeenAt: number | null;
  lastError: string | null;
  score: number;
}

export interface AggregateStats {
  totalEvents: number;
  byCategory: Record<EventCategory, number>;
  byLevel: Record<EventLevel, number>;
  relayCount: number;
  oldestEventAt: number | null;
  newestEventAt: number | null;
}

const MAX_EVENTS = 500;

let events: DiagnosticEvent[] = [];
const relaySamples = new Map<string, RelayHealth>();
let listeners: Array<() => void> = [];

function genId(): string {
  return `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function emit(): void {
  listeners.forEach((l) => l());
}

function trimEvents(): void {
  if (events.length > MAX_EVENTS) {
    events = events.slice(-MAX_EVENTS);
  }
}

export function recordEvent(
  category: EventCategory,
  level: EventLevel,
  message: string,
  meta?: Record<string, unknown>
): DiagnosticEvent {
  const evt: DiagnosticEvent = {
    id: genId(),
    ts: Date.now(),
    category,
    level,
    message,
    meta,
  };
  events.push(evt);
  trimEvents();
  emit();
  return evt;
}

export function listEvents(filter?: {
  category?: EventCategory;
  level?: EventLevel;
  limit?: number;
}): DiagnosticEvent[] {
  let out = events.slice();
  if (filter?.category) out = out.filter((e) => e.category === filter.category);
  if (filter?.level) out = out.filter((e) => e.level === filter.level);
  if (filter?.limit) out = out.slice(-filter.limit);
  return out;
}

export function clearEvents(): void {
  events = [];
  emit();
}

export function onDiagnosticChange(listener: () => void): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

function getOrCreateRelay(url: string): RelayHealth {
  let h = relaySamples.get(url);
  if (!h) {
    h = {
      url,
      samples: 0,
      avgLatencyMs: null,
      successCount: 0,
      failureCount: 0,
      lastSeenAt: null,
      lastError: null,
      score: 1,
    };
    relaySamples.set(url, h);
  }
  return h;
}

export function recordRelaySuccess(url: string, latencyMs: number): void {
  const h = getOrCreateRelay(url);
  h.samples++;
  h.successCount++;
  h.lastSeenAt = Date.now();
  h.lastError = null;
  h.avgLatencyMs = computeAvgLatency(h, latencyMs);
  h.score = computeScore(h);
  recordEvent('relay', 'info', `Relay ${url} OK (${latencyMs}ms)`, { url, latencyMs });
  emit();
}

export function recordRelayFailure(url: string, error: string, latencyMs?: number): void {
  const h = getOrCreateRelay(url);
  h.samples++;
  h.failureCount++;
  h.lastSeenAt = Date.now();
  h.lastError = error;
  if (latencyMs !== undefined) {
    h.avgLatencyMs = computeAvgLatency(h, latencyMs);
  }
  h.score = computeScore(h);
  recordEvent('relay', 'error', `Relay ${url} falhou: ${error}`, { url, error, latencyMs });
  emit();
}

function computeAvgLatency(h: RelayHealth, newSample: number): number {
  if (h.avgLatencyMs === null) return newSample;
  const alpha = 0.3;
  return h.avgLatencyMs * (1 - alpha) + newSample * alpha;
}

function computeScore(h: RelayHealth): number {
  const total = h.successCount + h.failureCount;
  if (total === 0) return 1;
  const successRate = h.successCount / total;
  const latencyFactor =
    h.avgLatencyMs === null ? 1 : Math.max(0, 1 - h.avgLatencyMs / 5000);
  return Math.max(0, Math.min(1, successRate * 0.7 + latencyFactor * 0.3));
}

export function getRelayHealth(url: string): RelayHealth | null {
  return relaySamples.get(url) || null;
}

export function listRelayHealth(): RelayHealth[] {
  return Array.from(relaySamples.values());
}

export function recordUploadEvent(success: boolean, fileId: string, size: number): void {
  recordEvent(
    'upload',
    success ? 'info' : 'error',
    success ? `Upload OK ${fileId}` : `Upload falhou ${fileId}`,
    { fileId, size }
  );
}

export function recordDownloadEvent(success: boolean, fileId: string, size: number): void {
  recordEvent(
    'download',
    success ? 'info' : 'error',
    success ? `Download OK ${fileId}` : `Download falhou ${fileId}`,
    { fileId, size }
  );
}

export function recordSyncError(retryCount: number, error: string): void {
  recordEvent('sync', 'warn', `Sync tentativa ${retryCount}: ${error}`, {
    retryCount,
    error,
  });
}

export function getAggregateStats(): AggregateStats {
  const byCategory: Record<EventCategory, number> = {
    relay: 0,
    upload: 0,
    download: 0,
    sync: 0,
    system: 0,
  };
  const byLevel: Record<EventLevel, number> = {
    debug: 0,
    info: 0,
    warn: 0,
    error: 0,
  };
  for (const e of events) {
    byCategory[e.category]++;
    byLevel[e.level]++;
  }
  return {
    totalEvents: events.length,
    byCategory,
    byLevel,
    relayCount: relaySamples.size,
    oldestEventAt: events[0]?.ts ?? null,
    newestEventAt: events[events.length - 1]?.ts ?? null,
  };
}

export interface ExportShape {
  version: 1;
  generatedAt: number;
  app: { name: string; version: string };
  stats: AggregateStats;
  events: DiagnosticEvent[];
  relays: RelayHealth[];
}

export function exportDiagnostics(
  appName: string,
  appVersion: string
): ExportShape {
  return {
    version: 1,
    generatedAt: Date.now(),
    app: { name: appName, version: appVersion },
    stats: getAggregateStats(),
    events: listEvents(),
    relays: listRelayHealth(),
  };
}

export function formatDiagnosticsJson(data: ExportShape): string {
  return JSON.stringify(data, null, 2);
}

export function __resetDiagnostics(): void {
  events = [];
  relaySamples.clear();
  emit();
}
