export interface CdcOptions {
  minChunkSize: number;
  avgChunkSize: number;
  maxChunkSize: number;
  windowSize: number;
}

export const DEFAULT_CDC_OPTIONS: CdcOptions = {
  minChunkSize: 16 * 1024,
  avgChunkSize: 64 * 1024,
  maxChunkSize: 256 * 1024,
  windowSize: 48,
};

const MASK_12_BITS = 0xfff;

function rollHash(buf: Uint8Array, start: number, len: number): number {
  let h = 0;
  for (let i = 0; i < len; i++) {
    h = (h * 31 + buf[start + i]) | 0;
  }
  return h >>> 0;
}

function endsWithMarker(hash: number): boolean {
  return (hash & MASK_12_BITS) === 0;
}

export interface CdcChunk {
  offset: number;
  length: number;
  hash: number;
}

export function chunkByContent(
  data: Uint8Array,
  options: Partial<CdcOptions> = {}
): CdcChunk[] {
  const opts: CdcOptions = { ...DEFAULT_CDC_OPTIONS, ...options };
  const chunks: CdcChunk[] = [];
  let pos = 0;
  const total = data.length;

  while (pos < total) {
    const remaining = total - pos;
    if (remaining <= opts.maxChunkSize) {
      chunks.push({ offset: pos, length: remaining, hash: 0 });
      break;
    }
    let found = false;
    const minEnd = Math.min(pos + opts.maxChunkSize, total);
    const window = Math.min(opts.windowSize, opts.maxChunkSize);
    const searchStart = pos + opts.minChunkSize;
    for (let i = searchStart; i <= minEnd - window; i++) {
      const h = rollHash(data, i, window);
      if (endsWithMarker(h)) {
        const len = i - pos;
        chunks.push({ offset: pos, length: len, hash: h });
        pos += len;
        found = true;
        break;
      }
    }
    if (!found) {
      const len = Math.min(opts.maxChunkSize, remaining);
      chunks.push({ offset: pos, length: len, hash: 0 });
      pos += len;
    }
  }

  return chunks;
}

export async function hashChunk(data: Uint8Array, offset: number, length: number): Promise<string> {
  const ab = new ArrayBuffer(length);
  new Uint8Array(ab).set(data.subarray(offset, offset + length));
  const digest = await crypto.subtle.digest('SHA-256', ab);
  const bytes = new Uint8Array(digest);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

export interface DeduplicatedChunk {
  offset: number;
  length: number;
  hash: string;
  isDuplicate: boolean;
}

export async function deduplicateChunks(
  data: Uint8Array,
  knownHashes: Set<string>,
  options: Partial<CdcOptions> = {}
): Promise<DeduplicatedChunk[]> {
  const chunks = chunkByContent(data, options);
  const out: DeduplicatedChunk[] = [];
  for (const c of chunks) {
    const h = await hashChunk(data, c.offset, c.length);
    out.push({
      offset: c.offset,
      length: c.length,
      hash: h,
      isDuplicate: knownHashes.has(h),
    });
  }
  return out;
}

export function estimateDedupRatio(chunks: DeduplicatedChunk[]): number {
  if (chunks.length === 0) return 0;
  const dupBytes = chunks.filter((c) => c.isDuplicate).reduce((s, c) => s + c.length, 0);
  const totalBytes = chunks.reduce((s, c) => s + c.length, 0);
  return totalBytes === 0 ? 0 : dupBytes / totalBytes;
}
