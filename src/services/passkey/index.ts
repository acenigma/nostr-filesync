const PASSKEYS_KEY = 'nostr_filesync_passkeys';
const PASSKEY_PRF_CONTEXT = 'nostr-filesync-passkey-v1';
const DEFAULT_PRF_SALT_LENGTH = 32;

export interface PasskeyInfo {
  id: string;
  credentialId: string;
  name: string;
  createdAt: number;
  lastUsed: number;
  prfSalt: string;
}

export interface AuthenticationResult {
  credentialId: string;
  prfOutput: Uint8Array;
}

export const AUTO_LOCK_DURATIONS: { label: string; ms: number | null; key: string }[] = [
  { label: 'Never', ms: null, key: 'never' },
  { label: '5 min', ms: 5 * 60 * 1000, key: '5min' },
  { label: '15 min', ms: 15 * 60 * 1000, key: '15min' },
  { label: '30 min', ms: 30 * 60 * 1000, key: '30min' },
  { label: '1 hour', ms: 60 * 60 * 1000, key: '1hour' },
];

export const AUTO_LOCK_STORAGE_KEY = 'nostr_filesync_auto_lock';

function base64UrlToBytes(b64: string): Uint8Array {
  const b64Clean = b64.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64Clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toBase64Url(bytes: Uint8Array): string {
  const binary = String.fromCharCode(...Array.from(bytes));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(DEFAULT_PRF_SALT_LENGTH));
}

export function isPasskeySupported(): boolean {
  if (typeof window === 'undefined') return false;
  if (!(window as any).PublicKeyCredential) return false;
  if (typeof (window as any).credentials?.create !== 'function') return false;
  if (typeof (window as any).credentials?.get !== 'function') return false;
  return true;
}

function getPasskeysFromStorage(): PasskeyInfo[] {
  try {
    const stored = localStorage.getItem(PASSKEYS_KEY);
    if (stored) return JSON.parse(stored) as PasskeyInfo[];
  } catch {
    // ignorar erros de parse
  }
  return [];
}

function savePasskeysToStorage(passkeys: PasskeyInfo[]): void {
  localStorage.setItem(PASSKEYS_KEY, JSON.stringify(passkeys));
}

export function listPasskeys(): PasskeyInfo[] {
  return getPasskeysFromStorage()
    .slice()
    .sort((a, b) => b.lastUsed - a.lastUsed);
}

export function getPasskey(id: string): PasskeyInfo | null {
  return getPasskeysFromStorage().find((p) => p.id === id) ?? null;
}

export async function registerPasskey(name: string): Promise<PasskeyInfo> {
  if (!isPasskeySupported()) {
    throw new Error('WebAuthn não suportado neste navegador/dispositivo');
  }

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(32));
  const prfSalt = generateSalt();
  const prfSaltBase64 = toBase64Url(prfSalt);

  const creationOptions = {
    challenge,
    rp: { id: window.location.hostname, name: 'Nostr FileSync' },
    user: {
      id: userId,
      name,
      displayName: name,
    },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    timeout: 60000,
    attestation: 'none',
    excludeCredentials: [],
    supportedExtensions: [
      {
        type: 'PRF',
        id: 'PRF',
        prf: {
          enabled: true,
          salt: prfSaltBase64,
        },
      },
    ],
  } as PublicKeyCredentialCreationOptions;

  let credential: PublicKeyCredential;
  try {
    credential = (await (window as any).credentials.create({
      publicKey: creationOptions,
    })) as PublicKeyCredential;
  } catch (e) {
    throw new Error(`Falha ao registrar passkey: ${(e as Error).message}`);
  }

  if (!credential) {
    throw new Error('Nenhuma credencial retornada');
  }

  const rawId = credential.rawId;
  let credId: string;
  if (rawId instanceof ArrayBuffer) {
    credId = toBase64Url(new Uint8Array(rawId));
  } else {
    credId = toBase64Url(rawId as Uint8Array);
  }

  const passkey: PasskeyInfo = {
    id: `${credId}-${Date.now()}`,
    credentialId: credId,
    name,
    createdAt: Date.now(),
    lastUsed: Date.now(),
    prfSalt: prfSaltBase64,
  };

  const passkeys = getPasskeysFromStorage();
  passkeys.push(passkey);
  savePasskeysToStorage(passkeys);

  return passkey;
}

export async function authenticatePasskey(
  credentialId?: string
): Promise<AuthenticationResult> {
  if (!isPasskeySupported()) {
    throw new Error('WebAuthn não suportado neste navegador/dispositivo');
  }

  const passkeys = getPasskeysFromStorage();
  const passkey = credentialId
    ? passkeys.find((p) => p.id === credentialId) ?? passkeys[0]
    : passkeys[0];

  if (!passkey) {
    throw new Error('Nenhuma passkey registrada. Registre uma primeiro.');
  }

  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const publicKeyOptions = {
    challenge,
    timeout: 60000,
    allowCredentials: [
      {
        id: base64UrlToBytes(passkey.credentialId),
        type: 'public-key',
        transports: ['internal', 'hybrid', 'usb', 'nfc', 'ble'],
      },
    ],
    userVerification: 'preferred',
    extensions: {
      prf: {
        eval: {
          first: {
            salt: passkey.prfSalt,
          },
        },
      },
    },
  } as unknown as PublicKeyCredentialRequestOptions;

  let assertion: PublicKeyCredential;
  try {
    assertion = (await (window as any).credentials.get({
      publicKey: publicKeyOptions,
    })) as PublicKeyCredential;
  } catch (e) {
    const err = e as Error;
    if (err.name === 'NotAllowedError') {
      throw new Error('Autenticação cancelada pelo usuário');
    }
    throw new Error(`Falha na autenticação: ${err.message}`);
  }

  const clientExt = (assertion as PublicKeyCredential).getClientExtensionResults?.();
  const prfResult = (clientExt as any)?.prf?.enabled;

  if (!prfResult) {
    throw new Error('PRF não retornado pelo autenticador');
  }

  const prfOutput = base64UrlToBytes(prfResult.first.output as string);

  passkey.lastUsed = Date.now();
  const updatedPasskeys = getPasskeysFromStorage().map((p) =>
    p.id === passkey.id ? passkey : p
  );
  savePasskeysToStorage(updatedPasskeys);

  return {
    credentialId: passkey.credentialId,
    prfOutput,
  };
}

export async function deriveKeyFromPRF(
  prfOutput: Uint8Array,
  context: string = PASSKEY_PRF_CONTEXT,
  outputLength: number = 32
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const contextInfo = encoder.encode(context);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    prfOutput as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const combined = new Uint8Array(contextInfo.length + prfOutput.length);
  combined.set(contextInfo, 0);
  combined.set(prfOutput, contextInfo.length);

  const signature = await crypto.subtle.sign(
    'HMAC',
    keyMaterial,
    combined as BufferSource
  );
  const fullHash = new Uint8Array(signature);

  return fullHash.slice(0, outputLength);
}

export function removePasskey(id: string): boolean {
  const passkeys = getPasskeysFromStorage();
  const filtered = passkeys.filter((p) => p.id !== id);
  if (filtered.length === passkeys.length) return false;
  savePasskeysToStorage(filtered);
  return true;
}

export function renamePasskey(id: string, name: string): PasskeyInfo {
  if (!name || !name.trim()) {
    throw new Error('Nome não pode ser vazio');
  }
  const passkeys = getPasskeysFromStorage();
  const idx = passkeys.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error(`Passkey não encontrada: ${id}`);
  passkeys[idx] = { ...passkeys[idx], name: name.trim() };
  savePasskeysToStorage(passkeys);
  return passkeys[idx];
}

export async function unlockWithPasskey(
  credentialId?: string
): Promise<{ keyMaterial: Uint8Array; credentialId: string }> {
  const auth = await authenticatePasskey(credentialId);
  const keyMaterial = await deriveKeyFromPRF(auth.prfOutput);
  return { keyMaterial, credentialId: auth.credentialId };
}

export function getAutoLockDuration(): { label: string; ms: number | null; key: string } {
  const stored = localStorage.getItem(AUTO_LOCK_STORAGE_KEY);
  if (stored) {
    const found = AUTO_LOCK_DURATIONS.find((d) => d.key === stored);
    if (found) return found;
  }
  return AUTO_LOCK_DURATIONS[0];
}

export function setAutoLockDuration(key: string): void {
  const found = AUTO_LOCK_DURATIONS.find((d) => d.key === key);
  if (!found) throw new Error(`Duração inválida: ${key}`);
  localStorage.setItem(AUTO_LOCK_STORAGE_KEY, found.key);
}
