import { finalizeEvent, nip44, type EventTemplate, type NostrEvent, type SimplePool } from 'nostr-tools';
import * as uploadState from './uploadState';
import * as db from './db';
import { getRelays } from './nostr';

const KIND_FILE_HEADER = 1063;
const KIND_FILE_CHUNK = 1064;
const KIND_FILE_DELETE = 5;
const STORE_FILES = db.STORE_FILES;
const STORAGE_FILES_LEGACY = 'nostr_filesync_files';

const CHUNK_SIZE = 64 * 1024;
const ENCRYPTION_VERSION = 1;

export interface PublishOptions {
  path?: string;
  skipDedup?: boolean;
}

export interface FileRecord {
  fileId: string;
  name: string;
  type: string;
  size: number;
  hash: string;
  encryptedHash?: string;
  chunks: number;
  headerEventId: string;
  createdAt: number;
  status: string;
  encrypted: boolean;
  compression?: string;
  path?: string;
  deduplicated?: boolean;
}

export interface FileHeaders {
  fileId: string;
  name: string;
  type: string;
  size: number;
  hash: string;
  encryptedHash: string;
  chunks: number;
  headerEventId: string;
  createdAt: number;
  status: string;
  encrypted: boolean;
  encKey: string | null;
  encNonce: string | null;
  compression: string;
  path: string;
}

export interface DownloadProgress {
  phase: string;
  current: number;
  total: number;
}

export interface ResumeResult {
  fileId: string;
  status: 'complete' | 'incomplete';
  chunksReceived: number;
  expected?: number;
}

export interface ResumeEntry {
  fileId: string;
  ok: boolean;
  result?: ResumeResult;
  error?: string;
}

let privateKey: Uint8Array | null = null;
let publicKey: string | null = null;
let pool: SimplePool | null = null;
let getPoolFn: (() => SimplePool | null) | null = null;
let getKeysFn: (() => { privateKey: Uint8Array | null; publicKey: string | null }) | null = null;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk))
    );
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, '');
  if (clean.length % 2 !== 0) throw new Error('hex inválido');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

function concatBytes(arrays: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return bytesToHex(new Uint8Array(digest));
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error('Operação cancelada');
    err.name = 'AbortError';
    throw err;
  }
}

interface AesResult {
  encrypted: Uint8Array;
  key: Uint8Array;
  nonce: Uint8Array;
}

async function aesGcmEncrypt(plainBytes: Uint8Array): Promise<AesResult> {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await crypto.subtle.importKey('raw', key as BufferSource, 'AES-GCM', false, ['encrypt']);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, cryptoKey, plainBytes as BufferSource);
  const out = new Uint8Array(nonce.length + ct.byteLength);
  out.set(nonce, 0);
  out.set(new Uint8Array(ct), nonce.length);
  return { encrypted: out, key, nonce };
}

async function aesGcmDecrypt(combinedBytes: Uint8Array, keyBytes: Uint8Array): Promise<Uint8Array> {
  const nonce = combinedBytes.subarray(0, 12);
  const ciphertext = combinedBytes.subarray(12);
  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes as BufferSource, 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, cryptoKey, ciphertext as BufferSource);
  return new Uint8Array(plain);
}

function nip44SelfWrap(keyBytes: Uint8Array, sec: Uint8Array, pub: string): string {
  const convKey = nip44.getConversationKey(sec, pub);
  return nip44.encrypt(bytesToHex(keyBytes), convKey);
}

function nip44SelfUnwrap(payload: string, sec: Uint8Array, pub: string): Uint8Array {
  const convKey = nip44.getConversationKey(sec, pub);
  const hex = nip44.decrypt(payload, convKey);
  return hexToBytes(hex);
}

interface CompressResult {
  compressed: Uint8Array;
  ratio: number;
}

async function gzipCompress(bytes: Uint8Array): Promise<CompressResult> {
  if (typeof CompressionStream === 'undefined') {
    return { compressed: bytes, ratio: 1 };
  }
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  writer.write(bytes as BufferSource);
  writer.close();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = cs.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as Uint8Array);
    total += (value as Uint8Array).byteLength;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return { compressed: out, ratio: out.byteLength / bytes.byteLength };
}

async function gzipDecompress(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    return bytes;
  }
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(bytes as BufferSource);
  writer.close();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = ds.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as Uint8Array);
    total += (value as Uint8Array).byteLength;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

function makeFileId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return 'f-' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function bindNostr(nostrModule: {
  getPool: () => SimplePool | null;
  getKeys: () => { privateKey: Uint8Array | null; publicKey: string | null };
}): void {
  getPoolFn = () => nostrModule.getPool();
  getKeysFn = () => nostrModule.getKeys();
}

async function ensureReady(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (getKeysFn) {
      const k = getKeysFn();
      const p = getPoolFn ? getPoolFn() : null;
      if (k && k.privateKey && k.publicKey && p) {
        privateKey = k.privateKey;
        publicKey = k.publicKey;
        pool = p;
        return;
      }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Não inicializado');
}

export async function loadLocalFiles(): Promise<FileRecord[]> {
  return db.getAll<FileRecord>(STORE_FILES);
}

async function saveLocalFiles(files: FileRecord[]): Promise<void> {
  await db.clear(STORE_FILES);
  await db.putAll(STORE_FILES, files);
}

export async function deleteLocalFile(fileId: string): Promise<void> {
  await db.del(STORE_FILES, fileId);
}

function loadLocalFilesLegacy(): FileRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_FILES_LEGACY);
    return raw ? (JSON.parse(raw) as FileRecord[]) : [];
  } catch {
    return [];
  }
}

export async function migrateFilesFromLegacy(): Promise<boolean> {
  const legacy = loadLocalFilesLegacy();
  if (legacy.length === 0) return false;
  const existing = await db.getAll<FileRecord>(STORE_FILES);
  if (existing.length > 0) {
    localStorage.removeItem(STORAGE_FILES_LEGACY);
    return false;
  }
  await db.putAll(STORE_FILES, legacy);
  localStorage.removeItem(STORAGE_FILES_LEGACY);
  return true;
}

export async function loadFilesWithFallback(): Promise<FileRecord[]> {
  const idb = await loadLocalFiles();
  if (idb.length > 0) {
    const legacy = loadLocalFilesLegacy();
    if (legacy.length > 0 && legacy.length !== idb.length) {
      const ids = new Set(idb.map((f) => f.fileId));
      const merged = [...idb, ...legacy.filter((f) => !ids.has(f.fileId))];
      await saveLocalFiles(merged);
      localStorage.removeItem(STORAGE_FILES_LEGACY);
      return merged;
    }
    return idb;
  }
  const legacy = loadLocalFilesLegacy();
  if (legacy.length > 0) {
    await db.putAll(STORE_FILES, legacy);
    localStorage.removeItem(STORAGE_FILES_LEGACY);
    return legacy;
  }
  return [];
}

async function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

export async function publishFile(
  file: File,
  options: PublishOptions = {},
  onProgress?: (p: DownloadProgress) => void,
  signal?: AbortSignal
): Promise<FileRecord> {
  throwIfAborted(signal);
  const { path = '', skipDedup = false } = options;
  await ensureReady();
  if (!privateKey || !publicKey) throw new Error('Não autenticado');

  const fileId = makeFileId();
  const data = await readFileAsArrayBuffer(file);
  const plainBytes = new Uint8Array(data);
  const totalSize = plainBytes.length;
  const plainHash = await sha256Hex(plainBytes);

  if (!skipDedup) {
    const existing = await findDuplicate(plainHash, file.name, totalSize);
    if (existing) {
      const record: FileRecord = {
        fileId: existing.fileId,
        name: existing.name,
        type: existing.type,
        size: existing.size,
        hash: existing.hash,
        encryptedHash: existing.encryptedHash,
        chunks: existing.chunks,
        headerEventId: existing.headerEventId,
        createdAt: existing.createdAt,
        status: 'referenced',
        encrypted: existing.encrypted,
        path: existing.path || '',
      };
      const files = await loadLocalFiles();
      if (!files.find((f) => f.fileId === existing.fileId)) {
        files.unshift(record);
        await saveLocalFiles(files);
      }
      onProgress?.({ phase: 'deduplicated', current: 1, total: 1 });
      return { ...record, deduplicated: true };
    }
  }

  const { compressed, ratio } = await gzipCompress(plainBytes);
  const useCompression = ratio < 0.98;
  const toEncrypt = useCompression ? compressed : plainBytes;
  const compressionTag = useCompression ? 'gzip' : 'none';

  const { encrypted, key, nonce } = await aesGcmEncrypt(toEncrypt);
  const encryptedSize = encrypted.length;
  const encryptedHash = await sha256Hex(encrypted);
  const wrappedKey = nip44SelfWrap(key, privateKey, publicKey);
  const nonceHex = bytesToHex(nonce);

  const totalChunks = Math.max(1, Math.ceil(encryptedSize / CHUNK_SIZE));
  const createdAt = Math.floor(Date.now() / 1000);

  const headerTags: string[][] = [
    ['d', fileId],
    ['name', file.name],
    ['m', file.type || 'application/octet-stream'],
    ['size', String(totalSize)],
    ['ox', plainHash],
    ['x', encryptedHash],
    ['chunks', String(totalChunks)],
    ['encryption', `aes-gcm-v${ENCRYPTION_VERSION}`],
    ['enc-key', wrappedKey],
    ['enc-nonce', nonceHex],
    ['compression', compressionTag],
    ['client', 'nostr-filesync'],
  ];
  if (path) headerTags.push(['path', normalizePath(path)]);

  const headerTemplate: EventTemplate = {
    kind: KIND_FILE_HEADER,
    content: '',
    tags: headerTags,
    created_at: createdAt,
  };
  const headerEvent = finalizeEvent(headerTemplate, privateKey);

  await uploadState.saveUploadState({
    fileId,
    headerEventId: headerEvent.id || '',
    fileName: file.name,
    fileType: file.type || 'application/octet-stream',
    size: totalSize,
    path,
    chunksDone: 0,
    totalChunks: totalChunks + 1,
    startedAt: Date.now(),
  });

  await publishWithRetry(headerEvent, 3, signal);
  await uploadState.updateUploadState(fileId, { chunksDone: 1, headerPublished: true });
  onProgress?.({ phase: 'header', current: 1, total: totalChunks + 1 });

  for (let i = 0; i < totalChunks; i++) {
    throwIfAborted(signal);
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, encryptedSize);
    const chunkBytes = encrypted.subarray(start, end);
    const b64 = bytesToBase64(chunkBytes);

    const chunkTemplate: EventTemplate = {
      kind: KIND_FILE_CHUNK,
      content: b64,
      tags: [
        ['e', headerEvent.id || ''],
        ['d', fileId],
        ['idx', String(i)],
        ['total', String(totalChunks)],
      ],
      created_at: createdAt + i + 1,
    };
    const chunkEvent = finalizeEvent(chunkTemplate, privateKey);

    await publishWithRetry(chunkEvent, 3, signal);
    await uploadState.updateUploadState(fileId, { chunksDone: i + 2 });
    onProgress?.({ phase: 'chunk', current: i + 2, total: totalChunks + 1 });
  }

await uploadState.markUploadComplete(fileId);

  const record: FileRecord = {
    fileId,
    name: file.name,
    type: file.type || 'application/octet-stream',
    size: totalSize,
    hash: plainHash,
    encryptedHash,
    chunks: totalChunks,
    headerEventId: headerEvent.id || '',
    createdAt,
    status: 'uploaded',
    encrypted: true,
    compression: compressionTag,
    path: path ? normalizePath(path) : '',
  };
  const files = await loadLocalFiles();
  files.unshift(record);
  await saveLocalFiles(files);

  return record;
}

async function findDuplicate(
  plainHash: string,
  name: string,
  size: number
): Promise<FileRecord | null> {
  const local = await loadLocalFiles();
  for (const f of local) {
    if (f.hash === plainHash && f.size === size && f.name === name) {
      return f;
    }
  }
  return null;
}

function normalizePath(p: string): string {
  if (!p) return '';
  return p
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

async function publishWithRetry(
  event: NostrEvent,
  attempts: number,
  signal?: AbortSignal
): Promise<number> {
  if (!pool || !publicKey) throw new Error('Não inicializado');
  const relays = await getRelays(publicKey);
  let lastError: Error | null = null;
  for (let i = 0; i < attempts; i++) {
    throwIfAborted(signal);
    try {
      const pubs = pool.publish(relays, event);
      const results = await Promise.allSettled(pubs);
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      if (ok > 0) return ok;
      throw new Error('Nenhum relay aceitou');
    } catch (e) {
      lastError = e as Error;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastError || new Error('Falha ao publicar');
}

export async function fetchFileHeaders(pubkey: string): Promise<FileHeaders[]> {
  await ensureReady();
  if (!pool || !publicKey) return [];
  const relays = await getRelays(pubkey);
  let events: NostrEvent[] = [];
  try {
    events = await pool.querySync(
      relays,
      { kinds: [KIND_FILE_HEADER, KIND_FILE_DELETE], authors: [pubkey], limit: 200 },
      { maxWait: 10000 }
    );
  } catch (e) {
    console.warn('Falha ao consultar headers', e);
    return [];
  }

  const deletions = new Set<string>();
  for (const ev of events) {
    if (ev.kind === KIND_FILE_DELETE) {
      const eTag = ev.tags.find((t) => t[0] === 'e')?.[1];
      if (eTag) deletions.add(eTag);
    }
  }

  const fileMap = new Map<string, FileHeaders>();
  for (const ev of events) {
    if (ev.kind === KIND_FILE_HEADER) {
      if (!ev.id || deletions.has(ev.id)) continue;
      const dTag = ev.tags.find((t) => t[0] === 'd')?.[1];
      if (!dTag) continue;
      const get = (k: string) => ev.tags.find((t) => t[0] === k)?.[1];
      const existing = fileMap.get(dTag);
      if (!existing || (ev.created_at ?? 0) >= existing.createdAt) {
        const fileHeaders: FileHeaders = {
          fileId: dTag,
          name: get('name') || 'arquivo',
          type: get('m') || 'application/octet-stream',
          size: parseInt(get('size') || '0', 10),
          hash: get('ox') || get('x') || '',
          encryptedHash: get('x') || '',
          chunks: parseInt(get('chunks') || '1', 10),
          headerEventId: ev.id,
          createdAt: ev.created_at ?? 0,
          status: 'remote',
          encrypted: Boolean(get('encryption')),
          encKey: get('enc-key') || null,
          encNonce: get('enc-nonce') || null,
          compression: get('compression') || 'none',
          path: get('path') || '',
        };
        fileMap.set(dTag, fileHeaders);
      }
    }
  }

  return Array.from(fileMap.values()).sort((a, b) => b.createdAt - a.createdAt);
}

export function subscribeToFileHeaders(
  pubkey: string,
  onEvent: (e: NostrEvent) => void
): () => void {
  let cancelled = false;
  let sub: { close: () => void } | null = null;

  const start = async () => {
    try {
      if (!pool && getPoolFn) {
        const p = getPoolFn();
        if (p) pool = p;
      }
      if (cancelled || !pool) return;
      for (let i = 0; i < 100 && !cancelled; i++) {
        const k = getKeysFn ? getKeysFn() : null;
        if (k && k.publicKey && pool) {
          publicKey = k.publicKey;
          const relays = await getRelays(k.publicKey);
          if (cancelled) return;
          sub = pool.subscribeMany(
            relays,
            { kinds: [KIND_FILE_HEADER, KIND_FILE_DELETE], authors: [pubkey] },
            { onevent: onEvent }
          );
          return;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
    } catch (e) {
      console.warn('Falha ao iniciar subscribe de arquivos', e);
    }
  };

  start();

  return () => {
    cancelled = true;
    sub?.close();
  };
}

export async function downloadFile(
  file: FileHeaders,
  onProgress?: (p: DownloadProgress) => void,
  signal?: AbortSignal
): Promise<Blob> {
  throwIfAborted(signal);
  await ensureReady();
  if (!pool || !privateKey || !publicKey) throw new Error('Não inicializado');

  onProgress?.({ phase: 'fetching', current: 0, total: file.chunks });
  const relays = await getRelays(publicKey);

  const events = await pool.querySync(
    relays,
    {
      kinds: [KIND_FILE_CHUNK],
      authors: [publicKey],
      '#e': [file.headerEventId],
    },
    { maxWait: 15000 }
  );
  throwIfAborted(signal);

  const sorted = events
    .map((ev) => ({
      idx: parseInt(ev.tags.find((t) => t[0] === 'idx')?.[1] ?? '-1', 10),
      data: ev.content,
    }))
    .filter((c) => c.idx >= 0)
    .sort((a, b) => a.idx - b.idx);

  if (sorted.length !== file.chunks) {
    throw new Error(
      `Fragmentos incompletos: esperados ${file.chunks}, recebidos ${sorted.length}`
    );
  }

  const parts: Uint8Array[] = [];
  for (let i = 0; i < sorted.length; i++) {
    throwIfAborted(signal);
    parts.push(base64ToBytes(sorted[i].data));
    onProgress?.({ phase: 'assembling', current: i + 1, total: file.chunks });
  }

  let bytes = concatBytes(parts);

  if (file.encrypted) {
    if (!file.encKey || !file.encNonce) {
      throw new Error('Arquivo cifrado mas faltam metadados de criptografia');
    }
    throwIfAborted(signal);
    onProgress?.({ phase: 'decrypting', current: 0, total: file.chunks });
    const key = nip44SelfUnwrap(file.encKey, privateKey, publicKey);
    bytes = await aesGcmDecrypt(bytes, key);
  }

  if (file.compression === 'gzip') {
    throwIfAborted(signal);
    onProgress?.({ phase: 'decompressing', current: 0, total: file.chunks });
    bytes = await gzipDecompress(bytes);
  }

  if (file.hash) {
    const got = await sha256Hex(bytes);
    if (got !== file.hash) {
      throw new Error('Hash do arquivo baixado não confere (arquivo corrompido)');
    }
  }

  const blob = new Blob([bytes as BlobPart], { type: file.type });
  onProgress?.({ phase: 'done', current: file.chunks, total: file.chunks });
  return blob;
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function deleteRemoteFile(file: FileHeaders): Promise<void> {
  await ensureReady();
  if (!privateKey) throw new Error('Não autenticado');
  const template: EventTemplate = {
    kind: KIND_FILE_DELETE,
    content: '',
    tags: [
      ['e', file.headerEventId],
      ['k', String(KIND_FILE_HEADER)],
    ],
    created_at: Math.floor(Date.now() / 1000),
  };
  const event = finalizeEvent(template, privateKey);
  await publishWithRetry(event, 3);
  await deleteLocalFile(file.fileId);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export async function resumePendingUploads(): Promise<ResumeEntry[]> {
  await ensureReady();
  if (!pool || !publicKey) return [];
  const pending = await uploadState.listPendingUploads();
  const results: ResumeEntry[] = [];

  for (const state of pending) {
    try {
      const result = await resumeSingleUpload(state);
      results.push({ fileId: state.fileId, ok: true, result });
    } catch (e) {
      results.push({ fileId: state.fileId, ok: false, error: (e as Error).message });
    }
  }

  return results;
}

async function resumeSingleUpload(state: uploadState.UploadState): Promise<ResumeResult> {
  if (!pool || !publicKey) throw new Error('Não inicializado');
  const { headerEventId, fileId, totalChunks } = state;
  const relays = await getRelays(publicKey);

  let events: NostrEvent[] = [];
  try {
    events = await pool.querySync(
      relays,
      { kinds: [KIND_FILE_CHUNK], authors: [publicKey], '#e': [headerEventId] },
      { maxWait: 10000 }
    );
  } catch {
    events = [];
  }

  const received = new Set<number>();
  for (const ev of events) {
    const idx = parseInt(ev.tags.find((t) => t[0] === 'idx')?.[1] ?? '-1', 10);
    if (idx >= 0) received.add(idx);
  }

  const expectedChunks = totalChunks - 1;
  const allChunksPresent = received.size >= expectedChunks;

  if (allChunksPresent) {
await uploadState.markUploadComplete(fileId);
    return { fileId, status: 'complete', chunksReceived: received.size };
  }

  await uploadState.removeUploadState(fileId);
  return {
    fileId,
    status: 'incomplete',
    chunksReceived: received.size,
    expected: expectedChunks,
  };
}
