import { nip44 } from 'nostr-tools';

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

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return bytesToHex(new Uint8Array(digest));
}

export interface AesResult {
  encrypted: Uint8Array;
  key: Uint8Array;
  nonce: Uint8Array;
}

export async function aesGcmEncrypt(plainBytes: Uint8Array): Promise<AesResult> {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await crypto.subtle.importKey('raw', key as BufferSource, 'AES-GCM', false, ['encrypt']);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, cryptoKey, plainBytes as BufferSource);
  const out = new Uint8Array(nonce.length + ct.byteLength);
  out.set(nonce, 0);
  out.set(new Uint8Array(ct), nonce.length);
  return { encrypted: out, key, nonce };
}

export async function aesGcmDecrypt(combinedBytes: Uint8Array, keyBytes: Uint8Array): Promise<Uint8Array> {
  const nonce = combinedBytes.subarray(0, 12);
  const ciphertext = combinedBytes.subarray(12);
  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes as BufferSource, 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, cryptoKey, ciphertext as BufferSource);
  return new Uint8Array(plain);
}

export function nip44SelfWrap(keyBytes: Uint8Array, sec: Uint8Array, pub: string): string {
  const convKey = nip44.getConversationKey(sec, pub);
  return nip44.encrypt(bytesToHex(keyBytes), convKey);
}

export function nip44SelfUnwrap(payload: string, sec: Uint8Array, pub: string): Uint8Array {
  const convKey = nip44.getConversationKey(sec, pub);
  const hex = nip44.decrypt(payload, convKey);
  return hexToBytes(hex);
}

export interface CompressResult {
  compressed: Uint8Array;
  ratio: number;
}

export async function gzipCompress(bytes: Uint8Array): Promise<CompressResult> {
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

export async function gzipDecompress(bytes: Uint8Array): Promise<Uint8Array> {
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

export { bytesToHex, hexToBytes, concatBytes, bytesToBase64, base64ToBytes };
