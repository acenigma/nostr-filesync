import { describe, it, expect } from 'vitest';
import {
  chunkByContent,
  hashChunk,
  deduplicateChunks,
  estimateDedupRatio,
  DEFAULT_CDC_OPTIONS,
} from '../services/cdc';

function makeData(size: number, seed = 0x42): Uint8Array {
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    out[i] = (i * 31 + seed) & 0xff;
  }
  return out;
}

describe('chunkByContent', () => {
  it('produces at least one chunk for small input', () => {
    const data = new Uint8Array(100);
    const chunks = chunkByContent(data);
    expect(chunks.length).toBeGreaterThan(0);
    const totalLen = chunks.reduce((s, c) => s + c.length, 0);
    expect(totalLen).toBe(100);
  });

  it('respects maxChunkSize as upper bound', () => {
    const data = makeData(1024 * 1024);
    const chunks = chunkByContent(data, { minChunkSize: 16 * 1024, avgChunkSize: 64 * 1024, maxChunkSize: 128 * 1024 });
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(128 * 1024);
    }
  });

  it('produces deterministic boundaries for same content', () => {
    const data = makeData(512 * 1024);
    const a = chunkByContent(data);
    const b = chunkByContent(data);
    expect(a).toEqual(b);
  });

  it('produces different boundaries when content shifts', () => {
    const data1 = makeData(512 * 1024, 1);
    const data2 = new Uint8Array(512 * 1024);
    for (let i = 0; i < data2.length; i++) {
      data2[i] = Math.floor(Math.random() * 256);
    }
    const a = chunkByContent(data1);
    const b = chunkByContent(data2);
    const aOffsets = a.map((c) => c.offset).join(',');
    const bOffsets = b.map((c) => c.offset).join(',');
    expect(aOffsets === bOffsets).toBe(false);
  });

  it('handles zero-length input', () => {
    const chunks = chunkByContent(new Uint8Array(0));
    expect(chunks.length).toBe(0);
  });

  it('handles input smaller than min chunk size', () => {
    const data = new Uint8Array(100);
    const chunks = chunkByContent(data);
    expect(chunks.length).toBe(1);
    expect(chunks[0].length).toBe(100);
  });
});

describe('hashChunk', () => {
  it('produces 64 hex chars', async () => {
    const data = makeData(1024);
    const h = await hashChunk(data, 0, 1024);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for same content', async () => {
    const data = makeData(2048);
    const h1 = await hashChunk(data, 100, 500);
    const h2 = await hashChunk(data, 100, 500);
    expect(h1).toBe(h2);
  });

  it('differs for different content', async () => {
    const d1 = makeData(1024, 1);
    const d2 = makeData(1024, 2);
    const h1 = await hashChunk(d1, 0, 1024);
    const h2 = await hashChunk(d2, 0, 1024);
    expect(h1).not.toBe(h2);
  });
});

describe('deduplicateChunks', () => {
  it('marks all as non-duplicate when no known hashes', async () => {
    const data = makeData(128 * 1024);
    const chunks = await deduplicateChunks(data, new Set());
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) {
      expect(c.isDuplicate).toBe(false);
    }
  });

  it('marks known hashes as duplicate', async () => {
    const data = makeData(128 * 1024);
    const initial = await deduplicateChunks(data, new Set());
    const known = new Set(initial.map((c) => c.hash));
    const again = await deduplicateChunks(data, known);
    for (const c of again) {
      expect(c.isDuplicate).toBe(true);
    }
  });
});

describe('estimateDedupRatio', () => {
  it('returns 0 for empty', () => {
    expect(estimateDedupRatio([])).toBe(0);
  });

  it('returns 0 when no duplicates', () => {
    const ratio = estimateDedupRatio([
      { offset: 0, length: 1000, hash: 'a', isDuplicate: false },
    ]);
    expect(ratio).toBe(0);
  });

  it('returns 1 when all duplicates', () => {
    const ratio = estimateDedupRatio([
      { offset: 0, length: 500, hash: 'a', isDuplicate: true },
      { offset: 500, length: 500, hash: 'b', isDuplicate: true },
    ]);
    expect(ratio).toBe(1);
  });

  it('returns 0.5 for half duplicates', () => {
    const ratio = estimateDedupRatio([
      { offset: 0, length: 500, hash: 'a', isDuplicate: true },
      { offset: 500, length: 500, hash: 'b', isDuplicate: false },
    ]);
    expect(ratio).toBe(0.5);
  });
});

describe('DEFAULT_CDC_OPTIONS', () => {
  it('has valid ranges', () => {
    expect(DEFAULT_CDC_OPTIONS.minChunkSize).toBeLessThan(DEFAULT_CDC_OPTIONS.avgChunkSize);
    expect(DEFAULT_CDC_OPTIONS.avgChunkSize).toBeLessThan(DEFAULT_CDC_OPTIONS.maxChunkSize);
  });
});
