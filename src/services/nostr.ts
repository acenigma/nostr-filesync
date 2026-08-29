import { SimplePool, finalizeEvent, getPublicKey, nip19, type NostrEvent } from 'nostr-tools';
import * as nip49 from 'nostr-tools/nip49';
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

const FALLBACK_RELAYS: string[] = [
  'wss://relay.primal.net',
  'wss://relay.damus.io',
  'wss://offchain.pub',
  'wss://nostr.bitcoiner.social',
  'wss://nos.lol',
];

const KIND_TODO = 30000;
const KIND_DELETE = 5;
const KIND_RELAY_LIST = 10002;
const STORAGE_KEY = 'nostr_todo_privkey';
const STORAGE_MNEMONIC = 'nostr_todo_mnemonic_hint';
const RELAY_CACHE_TTL_MS = 10 * 60 * 1000;

export type AuthPhase = 'unknown' | 'setup' | 'locked' | 'plain' | 'unlocked';

export interface AuthState {
  phase: AuthPhase;
  credential?: string;
}

export interface IdentityInfo {
  publicKey: string;
  npub: string;
  nsec?: string;
  ncryptsec?: string;
  mnemonic?: string;
  source?: string;
}

let pool: SimplePool | null = null;
let privateKey: Uint8Array | null = null;
let publicKey: string | null = null;
let storedCredential: string | null = null;
const connectedRelays = new Set<string>();

interface RelayCache {
  relays: string[];
  ts: number;
}

const relayCache = new Map<string, RelayCache>();

const authListeners = new Set<(s: AuthState) => void>();
let authState: AuthState = { phase: 'unknown' };

function emitAuth() {
  for (const l of authListeners) l({ ...authState });
}

export function onAuthChange(listener: (s: AuthState) => void): () => void {
  authListeners.add(listener);
  listener({ ...authState });
  return () => authListeners.delete(listener);
}

export function getAuthState(): AuthState {
  return { ...authState };
}

export async function checkStoredCredential(): Promise<AuthState> {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    authState = { phase: 'setup' };
    emitAuth();
    return authState;
  }
  if (stored.startsWith('ncryptsec1')) {
    storedCredential = stored;
    authState = { phase: 'locked' };
    emitAuth();
    return authState;
  }
  if (stored.startsWith('nsec1')) {
    storedCredential = stored;
    authState = { phase: 'plain', credential: stored };
    emitAuth();
    return authState;
  }
  authState = { phase: 'unknown' };
  emitAuth();
  return authState;
}

export function hasStoredCredential(): boolean {
  const stored = localStorage.getItem(STORAGE_KEY);
  return !!stored && (stored.startsWith('ncryptsec1') || stored.startsWith('nsec1'));
}

export function getStoredCredentialPreview(): { kind: 'ncryptsec' | 'nsec' } | null {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return null;
  if (stored.startsWith('ncryptsec1')) return { kind: 'ncryptsec' };
  if (stored.startsWith('nsec1')) return { kind: 'nsec' };
  return null;
}

export async function initNostr(): Promise<{ publicKey: string | null; npub: string | null }> {
  if (!pool) {
    pool = new SimplePool();
  }
  if (publicKey) {
    pingRelays().catch(() => {});
  }
  return { publicKey, npub: publicKey ? nip19.npubEncode(publicKey) : null };
}

export async function unlockWithPassword(password: string): Promise<IdentityInfo> {
  if (!storedCredential || !storedCredential.startsWith('ncryptsec1')) {
    throw new Error('Nenhuma credencial criptografada para desbloquear');
  }
  const sec = nip49.decrypt(storedCredential, password);
  privateKey = sec;
  publicKey = getPublicKey(sec);
  await initNostr();
  authState = { phase: 'unlocked' };
  emitAuth();
  return { publicKey, npub: nip19.npubEncode(publicKey) };
}

export async function createNewIdentity(password: string): Promise<IdentityInfo> {
  const mnemonic = generateFreshMnemonic();
  const sec = await mnemonicToSecretKey(mnemonic);
  const nsec = nip19.nsecEncode(sec);
  const ncryptsec = nip49.encrypt(sec, password, 16, 2);
  const ncryptMnemonic = nip49.encrypt(new TextEncoder().encode(mnemonic), password, 16, 2);
  localStorage.setItem(STORAGE_KEY, ncryptsec);
  localStorage.setItem(STORAGE_MNEMONIC, ncryptMnemonic);
  storedCredential = ncryptsec;
  privateKey = sec;
  publicKey = getPublicKey(sec);
  await initNostr();
  authState = { phase: 'unlocked' };
  emitAuth();
  return { publicKey, npub: nip19.npubEncode(publicKey), nsec, ncryptsec, mnemonic };
}

export function generateFreshMnemonic(): string {
  return generateMnemonic(wordlist, 128);
}

export function isValidMnemonic(phrase: string): boolean {
  const words = phrase.trim().split(/\s+/);
  if (words.length !== 12) return false;
  return validateMnemonic(words.join(' '), wordlist);
}

export async function mnemonicToSecretKey(phrase: string): Promise<Uint8Array> {
  if (!isValidMnemonic(phrase)) {
    throw new Error('Frase de recuperação inválida (12 palavras BIP-39 esperadas)');
  }
  const seed = mnemonicToSeedSync(phrase.trim());
  const digest = await crypto.subtle.digest('SHA-256', seed as BufferSource);
  return new Uint8Array(digest).slice(0, 32);
}

export async function unlockWithMnemonic(phrase: string): Promise<IdentityInfo> {
  const sec = await mnemonicToSecretKey(phrase);
  const npubNow = nip19.npubEncode(getPublicKey(sec));
  const storedNpub = await getStoredNpub();
  if (storedNpub && storedNpub !== npubNow) {
    throw new Error('Esta frase não corresponde à identidade salva neste device');
  }
  privateKey = sec;
  publicKey = getPublicKey(sec);
  await initNostr();
  authState = { phase: 'unlocked' };
  emitAuth();
  return { publicKey, npub: npubNow };
}

async function getStoredNpub(): Promise<string | null> {
  if (!storedCredential) return null;
  try {
    if (storedCredential.startsWith('ncryptsec1')) {
      return null;
    }
    if (storedCredential.startsWith('nsec1')) {
      const decoded = nip19.decode(storedCredential);
      if (decoded.type === 'nsec') {
        return nip19.npubEncode(getPublicKey(decoded.data));
      }
    }
  } catch {}
  return null;
}

export function hasMnemonicBackup(): boolean {
  return !!localStorage.getItem(STORAGE_MNEMONIC);
}

export function revealMnemonic(password: string): string {
  const stored = localStorage.getItem(STORAGE_MNEMONIC);
  if (!stored || !stored.startsWith('ncryptsec1')) {
    throw new Error('Nenhum backup de frase disponível para esta identidade');
  }
  const bytes = nip49.decrypt(stored, password);
  return new TextDecoder().decode(bytes);
}

function isHex64(s: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(s.trim());
}

function looksLikeMnemonic(value: string): boolean {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length < 12 || words.length > 24) return false;
  if (value.includes(':') || value.startsWith('http')) return false;
  return true;
}

async function parseCredential(
  input: string,
  currentPassword?: string
): Promise<{ sec: Uint8Array; source: string }> {
  const value = input.trim();
  if (!value) {
    throw new Error('Cole uma chave válida');
  }
  if (value.startsWith('nsec1')) {
    const decoded = nip19.decode(value);
    if (decoded.type !== 'nsec') {
      throw new Error('nsec inválido');
    }
    return { sec: decoded.data, source: 'nsec' };
  }
  if (value.startsWith('ncryptsec1')) {
    if (!currentPassword) {
      throw new Error('Esta chave está criptografada. Informe a senha que a protege.');
    }
    const sec = nip49.decrypt(value, currentPassword);
    return { sec, source: 'ncryptsec' };
  }
  if (isHex64(value)) {
    return { sec: hexToBytes(value), source: 'hex' };
  }
  if (looksLikeMnemonic(value)) {
    if (!isValidMnemonic(value)) {
      throw new Error('Frase de recuperação inválida (precisa de 12 palavras BIP-39 válidas)');
    }
    const sec = await mnemonicToSecretKey(value);
    return { sec, source: 'mnemonic' };
  }
  throw new Error(
    'Formato não reconhecido. Use 12 palavras, nsec1..., ncryptsec1... ou hex de 64 caracteres.'
  );
}

export async function importCredential(
  input: string,
  newPassword: string,
  currentPassword?: string
): Promise<IdentityInfo> {
  const { sec, source } = await parseCredential(input, currentPassword);
  if (!newPassword || newPassword.length < 6) {
    throw new Error('Defina uma senha (mínimo 6 caracteres) para proteger localmente');
  }
  const ncryptsec = nip49.encrypt(sec, newPassword, 16, 2);
  localStorage.setItem(STORAGE_KEY, ncryptsec);
  if (source === 'mnemonic') {
    const phrase = input.trim();
    const ncryptMnemonic = nip49.encrypt(new TextEncoder().encode(phrase), newPassword, 16, 2);
    localStorage.setItem(STORAGE_MNEMONIC, ncryptMnemonic);
  } else {
    localStorage.removeItem(STORAGE_MNEMONIC);
  }
  storedCredential = ncryptsec;
  privateKey = sec;
  publicKey = getPublicKey(sec);
  await initNostr();
  authState = { phase: 'unlocked' };
  emitAuth();
  return {
    publicKey,
    npub: nip19.npubEncode(publicKey),
    nsec: nip19.nsecEncode(sec),
    ncryptsec,
    source,
  };
}

export async function importNsec(nsec: string, password: string): Promise<IdentityInfo> {
  return importCredential(nsec, password);
}

export async function migratePlainToEncrypted(password: string): Promise<string> {
  if (!storedCredential || !storedCredential.startsWith('nsec1')) {
    throw new Error('Não há credencial em texto claro para migrar');
  }
  const decoded = nip19.decode(storedCredential);
  const sec = decoded.data as Uint8Array;
  const ncryptsec = nip49.encrypt(sec, password, 16, 2);
  localStorage.setItem(STORAGE_KEY, ncryptsec);
  storedCredential = ncryptsec;
  authState = { phase: 'unlocked' };
  emitAuth();
  return ncryptsec;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  if (!storedCredential || !storedCredential.startsWith('ncryptsec1')) {
    throw new Error('Nada criptografado para alterar');
  }
  const sec = nip49.decrypt(storedCredential, currentPassword);
  const ncryptsec = nip49.encrypt(sec, newPassword, 16, 2);
  localStorage.setItem(STORAGE_KEY, ncryptsec);
  storedCredential = ncryptsec;
}

export function lock(): void {
  privateKey = null;
  publicKey = null;
  authState = { phase: 'locked' };
  emitAuth();
}

export function getNsec(): string | null {
  if (!privateKey) return null;
  return nip19.nsecEncode(privateKey);
}

export function getNcryptsec(): string | null {
  return storedCredential && storedCredential.startsWith('ncryptsec1') ? storedCredential : null;
}

export function getNpub(): string | null {
  return publicKey ? nip19.npubEncode(publicKey) : null;
}

const connectionListeners = new Set<(info: ConnectionInfo) => void>();

export interface ConnectionInfo {
  connected: boolean;
  relays: string[];
}

export function getConnectionInfo(): ConnectionInfo {
  return {
    connected: connectedRelays.size > 0,
    relays: [...connectedRelays],
  };
}

export function onConnectionChange(listener: (info: ConnectionInfo) => void): () => void {
  connectionListeners.add(listener);
  listener(getConnectionInfo());
  return () => connectionListeners.delete(listener);
}

export interface Keys {
  privateKey: Uint8Array | null;
  publicKey: string | null;
}

export function getKeys(): Keys {
  return {
    privateKey,
    publicKey,
  };
}

export function getPool(): SimplePool | null {
  return pool;
}

export interface TodoRecord {
  id: string;
  text: string;
  done: boolean;
  eventId: string;
  createdAt: number;
}

export function createTodoEvent(text: string): { event: NostrEvent; todoId: string } {
  if (!privateKey) throw new Error('Não autenticado');
  const todoId = makeTodoId();
  const event = finalizeEvent(
    {
      kind: KIND_TODO,
      content: JSON.stringify({ text, done: false }),
      tags: [['d', todoId]],
      created_at: Math.floor(Date.now() / 1000),
    },
    privateKey
  );
  return { event, todoId };
}

export function createUpdateEvent(todoId: string, text: string, done: boolean): NostrEvent {
  if (!privateKey) throw new Error('Não autenticado');
  return finalizeEvent(
    {
      kind: KIND_TODO,
      content: JSON.stringify({ text, done }),
      tags: [['d', todoId]],
      created_at: Math.floor(Date.now() / 1000),
    },
    privateKey
  );
}

export function createDeleteEvent(_todoId: string, targetEventId: string): NostrEvent {
  if (!privateKey) throw new Error('Não autenticado');
  return finalizeEvent(
    {
      kind: KIND_DELETE,
      content: '',
      tags: [
        ['e', targetEventId],
        ['k', String(KIND_TODO)],
      ],
      created_at: Math.floor(Date.now() / 1000),
    },
    privateKey
  );
}

export async function fetchTodos(pubkey: string): Promise<TodoRecord[]> {
  if (!pool) return [];
  const relays = await getRelays(pubkey);
  const [todoResults, delResults] = await Promise.allSettled([
    pool.querySync(
      relays,
      { kinds: [KIND_TODO], authors: [pubkey], limit: 200 },
      { maxWait: 8000 }
    ),
    pool.querySync(
      relays,
      { kinds: [KIND_DELETE], authors: [pubkey], limit: 200 },
      { maxWait: 8000 }
    ),
  ]);

  const events = todoResults.status === 'fulfilled' ? todoResults.value : [];
  if (todoResults.status === 'rejected') {
    console.warn('Falha ao consultar tarefas', todoResults.reason);
  }

  const deletions = new Set<string>();
  if (delResults.status === 'fulfilled') {
    for (const d of delResults.value) {
      const eTag = d.tags.find((t) => t[0] === 'e')?.[1];
      if (eTag) deletions.add(eTag);
    }
  }

  const todoMap = new Map<string, TodoRecord>();
  for (const event of events) {
    if (!event.id || deletions.has(event.id)) continue;
    const dTag = event.tags.find((t) => t[0] === 'd')?.[1];
    if (!dTag) continue;
    const existing = todoMap.get(dTag);
    if (!existing || (event.created_at ?? 0) >= existing.createdAt) {
      const payload = parseTodoPayload(event.content);
      if (!payload) continue;
      todoMap.set(dTag, {
        id: dTag,
        text: payload.text,
        done: payload.done,
        eventId: event.id,
        createdAt: event.created_at ?? 0,
      });
    }
  }

  return Array.from(todoMap.values()).sort((a, b) => b.createdAt - a.createdAt);
}

export function parseTodoPayload(content: string): { text: string; done: boolean } | null {
  try {
    const data = JSON.parse(content) as { text?: unknown; done?: unknown };
    if (typeof data.text !== 'string' || typeof data.done !== 'boolean') return null;
    return { text: data.text, done: data.done };
  } catch {
    return null;
  }
}

export function subscribeToTodos(pubkey: string, onEvent: (e: NostrEvent) => void): () => void {
  if (!pool) return () => {};
  let cancelled = false;
  let sub: { close: () => void } | null = null;
  (async () => {
    try {
      const relays = await getRelays(pubkey);
      if (cancelled || !pool) return;
      sub = pool.subscribeMany(
        relays,
        { kinds: [KIND_TODO, KIND_DELETE], authors: [pubkey] },
        { onevent: (e: NostrEvent) => onEvent(e) }
      );
    } catch (e) {
      console.warn('Falha ao iniciar subscribe de tarefas', e);
    }
  })();
  return () => {
    cancelled = true;
    sub?.close();
  };
}

export async function publishEvent(event: NostrEvent): Promise<number> {
  if (!pool || !publicKey) return 0;
  const relays = await getRelays(publicKey);
  const results = await Promise.allSettled(pool.publish(relays, event));
  const ok = results.filter((r) => r.status === 'fulfilled').length;
  if (ok === 0) {
    throw new Error('Nenhum relay aceitou o evento');
  }
  return ok;
}

export function closePool(): void {
  if (pool) {
    pool.destroy();
    pool = null;
  }
  connectedRelays.clear();
}

export const FALLBACK_RELAY_LIST = FALLBACK_RELAYS;

export async function pingRelays(): Promise<string[]> {
  if (!pool) return [];
  const relays = await getRelays(publicKey ?? '');
  const ok: string[] = [];
  await Promise.allSettled(
    relays.map(async (url) => {
      try {
        await pool!.querySync([url], { kinds: [0], limit: 1 }, { maxWait: 3000 });
        ok.push(url);
      } catch {}
    })
  );
  connectedRelays.clear();
  for (const r of ok) connectedRelays.add(r);
  for (const l of connectionListeners) l(getConnectionInfo());
  return ok;
}

export async function getRelays(pubkey: string): Promise<string[]> {
  if (!pubkey) return FALLBACK_RELAYS;
  const cached = relayCache.get(pubkey);
  if (cached && Date.now() - cached.ts < RELAY_CACHE_TTL_MS && cached.relays.length > 0) {
    return cached.relays;
  }
  const fromKind = await fetchRelayListFromRelays(pubkey);
  const finalList = fromKind.length > 0 ? fromKind : FALLBACK_RELAYS;
  if (fromKind.length > 0) {
    relayCache.set(pubkey, { relays: fromKind, ts: Date.now() });
  }
  return finalList;
}

export function clearRelayCache(pubkey?: string): void {
  if (pubkey) relayCache.delete(pubkey);
  else relayCache.clear();
}

async function fetchRelayListFromRelays(pubkey: string): Promise<string[]> {
  if (!pool) return [];
  try {
    const events = await pool.querySync(
      FALLBACK_RELAYS,
      { kinds: [KIND_RELAY_LIST], authors: [pubkey], limit: 1 },
      { maxWait: 5000 }
    );
    if (!events.length) return [];
    const latest = events.sort(
      (a, b) => (b.created_at ?? 0) - (a.created_at ?? 0)
    )[0];
    const relays: string[] = [];
    for (const tag of latest.tags) {
      if (tag[0] !== 'r') continue;
      const url = tag[1];
      if (!url) continue;
      if (tag[2] === 'write') continue;
      relays.push(url);
    }
    return relays;
  } catch (e) {
    console.warn('Falha ao buscar kind:10002', e);
    return [];
  }
}

function makeTodoId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return 't-' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}
