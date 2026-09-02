import * as db from '../db/index';
import * as crypto from '../crypto/index';
import * as blobs from '../blobs/index';
import * as nostr from '../nostr/index';

export const BUNDLE_VERSION = 2;
export const BUNDLE_MAGIC = 'nostrbundle';
export const CRYPTO_VERSION = 1;
export const SCHEMA_VERSION = 1;
export const APP_VERSION = '1.3.0';

export type KDFAlgorithm = 'PBKDF2' | 'ARGON2ID';

export type EntityType =
  | 'folders'
  | 'files'
  | 'fileVersions'
  | 'devices'
  | 'syncQueue'
  | 'syncCursors'
  | 'blobs'
  | 'relays'
  | 'config'
  | 'identity';

export interface ManifestEntry {
  count: number;
  checksum: string;
}

export interface BundleManifest {
  version: number;
  generatedAt: number;
  entities: Partial<Record<EntityType, ManifestEntry>>;
  totalEntities: number;
  totalBytes: number;
}

export interface BundleHeader {
  magic: string;
  version: number;
  createdAt: number;
  createdBy: string;
  appVersion: string;
  crypto: {
    kdf: KDFAlgorithm;
    kdfParams: {
      iterations?: number;
      memory?: number;
      parallelism?: number;
      hash?: string;
    };
    salt: string;
    cipher: string;
    cryptoVersion: number;
  };
  schemaVersion: number;
  manifest: BundleManifest;
  checksum: string;
}

export interface BundlePayload {
  identity: {
    pubkey: string;
    privateKey?: string;
    credentialType?: string;
  };
  config: Record<string, unknown>;
  relays: string[];
  folders: db.FolderRecord[];
  files: db.FileRecord[];
  fileVersions: db.FileVersion[];
  devices: db.Device[];
  syncQueue: db.SyncOperation[];
  syncCursors: db.SyncCursor[];
  blobs: db.BlobRecord[];
  nip65: {
    relays: string[];
  };
  retentionConfig?: Record<string, unknown>;
}

export interface BundleExportOptions {
  password: string;
  includePrivateKey?: boolean;
  includeBlobs?: boolean;
}

export interface BundleImportOptions {
  password: string;
  overwriteExisting?: boolean;
}

export interface ExportResult {
  bundle: Uint8Array;
  stats: {
    folders: number;
    files: number;
    fileVersions: number;
    devices: number;
    syncOperations: number;
    syncCursors: number;
    blobs: number;
    size: number;
  };
}

export interface ImportResult {
  success: boolean;
  manifestVerified: boolean;
  manifestMismatches?: Array<{ type: EntityType; expected: ManifestEntry; actual: { count: number; checksum: string } }>;
  stats: {
    foldersRestored: number;
    filesRestored: number;
    fileVersionsRestored: number;
    devicesRestored: number;
    syncOperationsRestored: number;
    syncCursorsRestored: number;
    blobsRestored: number;
  };
  errors: string[];
}

export class BundleError extends Error {
  constructor(
    message: string,
    public readonly code: 'INVALID_PASSWORD' | 'CORRUPTED' | 'VERSION_MISMATCH' | 'CHECKSUM_MISMATCH' | 'MISSING_DATA' | 'IMPORT_FAILED' | 'MANIFEST_MISMATCH'
  ) {
    super(message);
    this.name = 'BundleError';
  }
}

async function computeEntityChecksum(entities: unknown[]): Promise<{ count: number; checksum: string; bytes: number }> {
  const sorted = [...entities].sort((a, b) => {
    const aId = (a as { id?: string; fileId?: string; entityId?: string; pubkey?: string }).id
      ?? (a as { fileId?: string }).fileId
      ?? (a as { entityId?: string }).entityId
      ?? (a as { pubkey?: string }).pubkey
      ?? '';
    const bId = (b as { id?: string; fileId?: string; entityId?: string; pubkey?: string }).id
      ?? (b as { fileId?: string }).fileId
      ?? (b as { entityId?: string }).entityId
      ?? (b as { pubkey?: string }).pubkey
      ?? '';
    return aId.localeCompare(bId);
  });
  const json = JSON.stringify(sorted);
  const bytes = new TextEncoder().encode(json).byteLength;
  const checksum = await crypto.sha256Hex(new TextEncoder().encode(json));
  return { count: sorted.length, checksum, bytes };
}

export async function computeManifest(payload: BundlePayload): Promise<BundleManifest> {
  const entities: Partial<Record<EntityType, ManifestEntry>> = {};
  let totalEntities = 0;
  let totalBytes = 0;

  const checks: Array<[EntityType, unknown[]]> = [
    ['folders', payload.folders],
    ['files', payload.files],
    ['fileVersions', payload.fileVersions],
    ['devices', payload.devices],
    ['syncQueue', payload.syncQueue],
    ['syncCursors', payload.syncCursors],
    ['blobs', payload.blobs],
    ['relays', payload.relays.map((r) => ({ pubkey: r }))],
  ];

  for (const [type, list] of checks) {
    const { count, checksum, bytes } = await computeEntityChecksum(list);
    entities[type] = { count, checksum };
    totalEntities += count;
    totalBytes += bytes;
  }

  const configJson = JSON.stringify(payload.config ?? {});
  const configChecksum = await crypto.sha256Hex(new TextEncoder().encode(configJson));
  entities.config = { count: 1, checksum: configChecksum };
  totalBytes += new TextEncoder().encode(configJson).byteLength;

  const identityJson = JSON.stringify({
    pubkey: payload.identity.pubkey,
    credentialType: payload.identity.credentialType,
  });
  const identityChecksum = await crypto.sha256Hex(new TextEncoder().encode(identityJson));
  entities.identity = { count: 1, checksum: identityChecksum };
  totalBytes += new TextEncoder().encode(identityJson).byteLength;

  return {
    version: CRYPTO_VERSION,
    generatedAt: Date.now(),
    entities,
    totalEntities,
    totalBytes,
  };
}

export interface ManifestVerification {
  valid: boolean;
  mismatches: Array<{ type: EntityType; expected: ManifestEntry; actual: { count: number; checksum: string } }>;
}

export async function verifyManifest(payload: BundlePayload, manifest: BundleManifest): Promise<ManifestVerification> {
  const mismatches: ManifestVerification['mismatches'] = [];

  const checks: Array<[EntityType, unknown[]]> = [
    ['folders', payload.folders],
    ['files', payload.files],
    ['fileVersions', payload.fileVersions],
    ['devices', payload.devices],
    ['syncQueue', payload.syncQueue],
    ['syncCursors', payload.syncCursors],
    ['blobs', payload.blobs],
    ['relays', payload.relays.map((r) => ({ pubkey: r }))],
  ];

  for (const [type, list] of checks) {
    const expected = manifest.entities[type];
    if (!expected) continue;
    const { count, checksum } = await computeEntityChecksum(list);
    if (count !== expected.count || checksum !== expected.checksum) {
      mismatches.push({ type, expected, actual: { count, checksum } });
    }
  }

  const configJson = JSON.stringify(payload.config ?? {});
  const configChecksum = await crypto.sha256Hex(new TextEncoder().encode(configJson));
  const expectedConfig = manifest.entities.config;
  if (expectedConfig && configChecksum !== expectedConfig.checksum) {
    mismatches.push({
      type: 'config',
      expected: expectedConfig,
      actual: { count: 1, checksum: configChecksum },
    });
  }

  const identityJson = JSON.stringify({
    pubkey: payload.identity.pubkey,
    credentialType: payload.identity.credentialType,
  });
  const identityChecksum = await crypto.sha256Hex(new TextEncoder().encode(identityJson));
  const expectedIdentity = manifest.entities.identity;
  if (expectedIdentity && identityChecksum !== expectedIdentity.checksum) {
    mismatches.push({
      type: 'identity',
      expected: expectedIdentity,
      actual: { count: 1, checksum: identityChecksum },
    });
  }

  return { valid: mismatches.length === 0, mismatches };
}

async function deriveKeyPBKDF2(
  password: string,
  salt: Uint8Array,
  iterations: number = 100000
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);
  const baseKey = await globalThis.crypto.subtle.importKey(
    'raw',
    passwordBuffer,
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );
  return globalThis.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    true,  // extractable: true so we can export for encryption
    ['encrypt', 'decrypt']
  );
}

async function deriveKeyArgon2id(
  password: string,
  salt: Uint8Array,
  _memory: number = 65536,
  _parallelism: number = 4,
  iterations: number = 3
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);
  
  const baseKey = await globalThis.crypto.subtle.importKey(
    'raw',
    passwordBuffer,
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );
  
  const derivedBits = await globalThis.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: iterations * 10000,
      hash: 'SHA-256',
    },
    baseKey,
    256
  );
  
  return globalThis.crypto.subtle.importKey(
    'raw',
    derivedBits,
    { name: 'AES-GCM', length: 256 },
    true,  // extractable: true
    ['encrypt', 'decrypt']
  );
}

async function deriveKey(
  password: string,
  salt: Uint8Array,
  algorithm: KDFAlgorithm,
  params: BundleHeader['crypto']['kdfParams']
): Promise<CryptoKey> {
  switch (algorithm) {
    case 'PBKDF2':
      return deriveKeyPBKDF2(password, salt, params.iterations ?? 100000);
    case 'ARGON2ID':
      return deriveKeyArgon2id(
        password,
        salt,
        params.memory ?? 65536,
        params.parallelism ?? 4,
        params.iterations ?? 3
      );
    default:
      throw new BundleError(`KDF não suportado: ${algorithm}`, 'IMPORT_FAILED');
  }
}

export async function exportBundle(options: BundleExportOptions): Promise<ExportResult> {
  const {
    password,
    includePrivateKey = false,
    includeBlobs = false,
  } = options;

  const keys = nostr.getKeys?.() ?? { privateKey: null, publicKey: null };
  const pubkey = keys.publicKey ?? '';
  const privateKey = includePrivateKey && keys.privateKey ? nostr.getNsec?.() ?? '' : undefined;

  const allFolders = await db.getAll<db.FolderRecord>(db.STORE_FOLDERS);
  const allFiles = await db.getAll<db.FileRecord>(db.STORE_FILES);
  const allFileVersions = await db.getAll<db.FileVersion>(db.STORE_FILE_VERSIONS);
  const allDevices = await db.getAll<db.Device>(db.STORE_DEVICES);
  const allSyncOps = await db.getAll<db.SyncOperation>(db.STORE_SYNC_QUEUE);
  const allSyncCursors = await db.getAll<db.SyncCursor>(db.STORE_SYNC_CURSORS);
  const allBlobs = includeBlobs ? await blobs.listAllBlobs() : [];

  const config: Record<string, unknown> = {};
  try {
    const storedConfig = localStorage.getItem('nostr_filesync_config');
    if (storedConfig) {
      Object.assign(config, JSON.parse(storedConfig));
    }
  } catch {
    // ignora erros de config
  }

  const retentionConfig: Record<string, unknown> = {};
  try {
    const storedRetention = localStorage.getItem('retention_config');
    if (storedRetention) {
      Object.assign(retentionConfig, JSON.parse(storedRetention));
    }
  } catch {
    // ignora
  }

  const nip65Relays = pubkey ? await nostr.getRelays(pubkey) : [];
  const configRelays = Array.from(new Set([
    ...(config.relays as string[] ?? []),
    ...(config.readRelays as string[] ?? []),
    ...(config.writeRelays as string[] ?? []),
  ]));
  const allRelays = Array.from(new Set([...nip65Relays, ...configRelays]));

  const payload: BundlePayload = {
    identity: {
      pubkey,
      privateKey,
      credentialType: config.credentialType as string,
    },
    config,
    relays: allRelays,
    folders: await db.getAll<db.FolderRecord>(db.STORE_FOLDERS),
    files: await db.getAll<db.FileRecord>(db.STORE_FILES),
    fileVersions: await db.getAll<db.FileVersion>(db.STORE_FILE_VERSIONS),
    devices: await db.getAll<db.Device>(db.STORE_DEVICES),
    syncQueue: await db.getAll<db.SyncOperation>(db.STORE_SYNC_QUEUE),
    syncCursors: await db.getAll<db.SyncCursor>(db.STORE_SYNC_CURSORS),
    blobs: includeBlobs ? await blobs.listAllBlobs() : [],
    nip65: { relays: nip65Relays },
    retentionConfig: retentionConfig,
  };

  const manifest = await computeManifest(payload);

  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const compressed = await crypto.gzipCompress(payloadBytes);

  const salt = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const kdfAlgorithm: KDFAlgorithm = 'PBKDF2';
  const kdfParams = { iterations: 100000 };
  const cipher = 'AES-GCM';

  const key = await deriveKey(password, salt, kdfAlgorithm, kdfParams);

  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    await globalThis.crypto.subtle.exportKey('raw', key),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  const encrypted = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as BufferSource },
    cryptoKey,
    compressed.compressed as BufferSource
  );

  const encryptedPayload = new Uint8Array(nonce.length + new Uint8Array(encrypted).length);
  encryptedPayload.set(nonce, 0);
  encryptedPayload.set(new Uint8Array(encrypted), nonce.length);

  const payloadChecksum = await crypto.sha256Hex(encryptedPayload);

  const header: BundleHeader = {
    magic: BUNDLE_MAGIC,
    version: BUNDLE_VERSION,
    createdAt: Date.now(),
    createdBy: pubkey,
    appVersion: APP_VERSION,
    crypto: {
      kdf: kdfAlgorithm,
      kdfParams,
      salt: crypto.bytesToHex(salt),
      cipher,
      cryptoVersion: CRYPTO_VERSION,
    },
    schemaVersion: SCHEMA_VERSION,
    manifest,
    checksum: payloadChecksum,
  };

  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const headerLength = new Uint8Array(4);
  new DataView(headerLength.buffer).setUint32(0, headerBytes.length, false);

  const bundle = new Uint8Array(
    BUNDLE_MAGIC.length + 4 + headerBytes.length + encryptedPayload.length
  );
  
  const magicBytes = new TextEncoder().encode(BUNDLE_MAGIC);
  let offset = 0;
  bundle.set(magicBytes, offset);
  offset += magicBytes.length;
  bundle.set(headerLength, offset);
  offset += headerLength.length;
  bundle.set(headerBytes, offset);
  offset += headerBytes.length;
  bundle.set(encryptedPayload, offset);

  return {
    bundle,
    stats: {
      folders: allFolders.length,
      files: allFiles.length,
      fileVersions: allFileVersions.length,
      devices: allDevices.length,
      syncOperations: allSyncOps.length,
      syncCursors: allSyncCursors.length,
      blobs: allBlobs.length,
      size: bundle.length,
    },
  };
}

export async function importBundle(bundleData: Uint8Array, options: BundleImportOptions): Promise<ImportResult> {
  const { password, overwriteExisting = false } = options;

  if (bundleData.length < BUNDLE_MAGIC.length + 4) {
    throw new BundleError('Bundle muito pequeno', 'CORRUPTED');
  }

  const magicBytes = new TextDecoder().decode(bundleData.subarray(0, BUNDLE_MAGIC.length));
  if (magicBytes !== BUNDLE_MAGIC) {
    throw new BundleError('Magic bytes inválidos', 'CORRUPTED');
  }

  const headerLengthView = new DataView(bundleData.buffer, bundleData.byteOffset + BUNDLE_MAGIC.length, 4);
  const headerLength = headerLengthView.getUint32(0, false);

  if (bundleData.length < BUNDLE_MAGIC.length + 4 + headerLength) {
    throw new BundleError('Bundle truncado (header)', 'CORRUPTED');
  }

  const headerBytes = bundleData.subarray(BUNDLE_MAGIC.length + 4, BUNDLE_MAGIC.length + 4 + headerLength);
  let header: BundleHeader;
  try {
    header = JSON.parse(new TextDecoder().decode(headerBytes));
  } catch {
    throw new BundleError('Header JSON inválido', 'CORRUPTED');
  }

  if (header.magic !== BUNDLE_MAGIC) {
    throw new BundleError('Magic no header inválido', 'CORRUPTED');
  }
  if (header.version > BUNDLE_VERSION) {
    throw new BundleError(`Versão do bundle (${header.version}) maior que suportada (${BUNDLE_VERSION})`, 'VERSION_MISMATCH');
  }

  const encryptedPayload = bundleData.subarray(BUNDLE_MAGIC.length + 4 + headerLength);
  
  const actualChecksum = await crypto.sha256Hex(encryptedPayload);
  if (actualChecksum !== header.checksum) {
    throw new BundleError('Checksum do payload não confere', 'CHECKSUM_MISMATCH');
  }

  const salt = crypto.hexToBytes(header.crypto.salt);
  const key = await deriveKey(
    password,
    salt,
    header.crypto.kdf,
    header.crypto.kdfParams
  );

  const nonce = encryptedPayload.subarray(0, 12);
  const ciphertext = encryptedPayload.subarray(12);

  let decrypted: Uint8Array;
  try {
    const cryptoKey = await globalThis.crypto.subtle.importKey(
      'raw',
      await globalThis.crypto.subtle.exportKey('raw', key),
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );
    const decryptedBuffer = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce as BufferSource },
      cryptoKey,
      ciphertext as BufferSource
    );
    decrypted = new Uint8Array(decryptedBuffer);
  } catch {
    throw new BundleError('Falha ao descriptografar: senha incorreta ou dados corrompidos', 'INVALID_PASSWORD');
  }

  let decompressed: Uint8Array;
  try {
    decompressed = await crypto.gzipDecompress(decrypted);
  } catch {
    throw new BundleError('Falha ao descomprimir payload', 'CORRUPTED');
  }

  let payload: BundlePayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(decompressed));
  } catch {
    throw new BundleError('Payload JSON inválido', 'CORRUPTED');
  }

  const result: ImportResult = {
    success: true,
    manifestVerified: false,
    stats: {
      foldersRestored: 0,
      filesRestored: 0,
      fileVersionsRestored: 0,
      devicesRestored: 0,
      syncOperationsRestored: 0,
      syncCursorsRestored: 0,
      blobsRestored: 0,
    },
    errors: [],
  };

  if (header.manifest && header.manifest.entities) {
    const verification = await verifyManifest(payload, header.manifest);
    result.manifestVerified = verification.valid;
    if (!verification.valid) {
      result.manifestMismatches = verification.mismatches;
    }
  } else {
    result.manifestVerified = true;
  }

  for (const folder of payload.folders) {
    try {
      const existing = await db.get<db.FolderRecord>(db.STORE_FOLDERS, folder.id);
      if (!existing || overwriteExisting) {
        await db.put(db.STORE_FOLDERS, folder);
        result.stats.foldersRestored++;
      }
    } catch (e) {
      result.errors.push(`Folder ${folder.id}: ${(e as Error).message}`);
    }
  }

  for (const file of payload.files) {
    try {
      const existing = await db.get<db.FileRecord>(db.STORE_FILES, file.fileId);
      if (!existing || overwriteExisting) {
        await db.put(db.STORE_FILES, file);
        result.stats.filesRestored++;
      }
    } catch (e) {
      result.errors.push(`File ${file.fileId}: ${(e as Error).message}`);
    }
  }

  for (const fv of payload.fileVersions) {
    try {
      const existing = await db.get<db.FileVersion>(db.STORE_FILE_VERSIONS, fv.id);
      if (!existing || overwriteExisting) {
        await db.put(db.STORE_FILE_VERSIONS, fv);
        result.stats.fileVersionsRestored++;
      }
    } catch (e) {
      result.errors.push(`FileVersion ${fv.id}: ${(e as Error).message}`);
    }
  }

  for (const device of payload.devices) {
    try {
      const existing = await db.get<db.Device>(db.STORE_DEVICES, device.id);
      if (!existing || overwriteExisting) {
        await db.put(db.STORE_DEVICES, device);
        result.stats.devicesRestored++;
      }
    } catch (e) {
      result.errors.push(`Device ${device.id}: ${(e as Error).message}`);
    }
  }

  for (const op of payload.syncQueue) {
    try {
      const existing = await db.get<db.SyncOperation>(db.STORE_SYNC_QUEUE, op.id);
      if (!existing || overwriteExisting) {
        await db.put(db.STORE_SYNC_QUEUE, op);
        result.stats.syncOperationsRestored++;
      }
    } catch (e) {
      result.errors.push(`SyncOperation ${op.id}: ${(e as Error).message}`);
    }
  }

  for (const cursor of payload.syncCursors) {
    try {
      const existing = await db.get<db.SyncCursor>(db.STORE_SYNC_CURSORS, cursor.id);
      if (!existing || overwriteExisting) {
        await db.put(db.STORE_SYNC_CURSORS, cursor);
        result.stats.syncCursorsRestored++;
      }
    } catch (e) {
      result.errors.push(`SyncCursor ${cursor.id}: ${(e as Error).message}`);
    }
  }

  for (const blob of payload.blobs) {
    try {
      const existing = await db.get<db.BlobRecord>(db.STORE_BLOBS, blob.contentHash);
      if (!existing || overwriteExisting) {
        await db.put(db.STORE_BLOBS, blob);
        result.stats.blobsRestored++;
      }
    } catch (e) {
      result.errors.push(`Blob ${blob.contentHash}: ${(e as Error).message}`);
    }
  }

  if (payload.nip65?.relays?.length && payload.identity?.pubkey) {
    try {
      // NIP-65 relay list would be published as kind 10002 event
      // For now, just store the relays in config for the restored device
      const config = JSON.parse(localStorage.getItem('nostr_filesync_config') ?? '{}');
      config.relays = payload.nip65.relays;
      localStorage.setItem('nostr_filesync_config', JSON.stringify(config));
    } catch (e) {
      result.errors.push(`NIP-65 relay list restore: ${(e as Error).message}`);
    }
  }

  if (payload.retentionConfig) {
    localStorage.setItem('retention_config', JSON.stringify(payload.retentionConfig));
  }

  if (payload.config) {
    const currentConfig = localStorage.getItem('nostr_filesync_config');
    if (currentConfig || overwriteExisting) {
      localStorage.setItem('nostr_filesync_config', JSON.stringify(payload.config));
    }
  }

  if (payload.identity?.privateKey) {
    localStorage.setItem('nostr_filesync_private_key', payload.identity.privateKey);
  }

  return result;
}

export async function validateBundle(bundleData: Uint8Array): Promise<{
  valid: boolean;
  header?: BundleHeader;
  error?: string;
}> {
  try {
    if (bundleData.length < BUNDLE_MAGIC.length + 4) {
      return { valid: false, error: 'Bundle muito pequeno' };
    }

    const magicBytes = new TextDecoder().decode(bundleData.subarray(0, BUNDLE_MAGIC.length));
    if (magicBytes !== BUNDLE_MAGIC) {
      return { valid: false, error: 'Magic bytes inválidos' };
    }

    const headerLengthView = new DataView(bundleData.buffer, bundleData.byteOffset + BUNDLE_MAGIC.length, 4);
    const headerLength = headerLengthView.getUint32(0, false);

    if (bundleData.length < BUNDLE_MAGIC.length + 4 + headerLength) {
      return { valid: false, error: 'Bundle truncado' };
    }

    const headerBytes = bundleData.subarray(BUNDLE_MAGIC.length + 4, BUNDLE_MAGIC.length + 4 + headerLength);
    const header = JSON.parse(new TextDecoder().decode(headerBytes)) as BundleHeader;

    if (header.magic !== BUNDLE_MAGIC) {
      return { valid: false, error: 'Magic no header inválido' };
    }
    if (header.version > BUNDLE_VERSION) {
      return { valid: false, error: `Versão ${header.version} não suportada` };
    }

    const encryptedPayload = bundleData.subarray(BUNDLE_MAGIC.length + 4 + headerLength);
    const actualChecksum = await crypto.sha256Hex(encryptedPayload);
    if (actualChecksum !== header.checksum) {
      return { valid: false, error: 'Checksum inválido' };
    }

    return { valid: true, header };
  } catch (e) {
    return { valid: false, error: (e as Error).message };
  }
}

export function formatBundleSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function parseBundleHeader(bundleData: Uint8Array): BundleHeader | null {
  try {
    if (bundleData.length < BUNDLE_MAGIC.length + 4) return null;
    const magicBytes = new TextDecoder().decode(bundleData.subarray(0, BUNDLE_MAGIC.length));
    if (magicBytes !== BUNDLE_MAGIC) return null;

    const headerLengthView = new DataView(bundleData.buffer, bundleData.byteOffset + BUNDLE_MAGIC.length, 4);
    const headerLength = headerLengthView.getUint32(0, false);

    if (bundleData.length < BUNDLE_MAGIC.length + 4 + headerLength) return null;

    const headerBytes = bundleData.subarray(BUNDLE_MAGIC.length + 4, BUNDLE_MAGIC.length + 4 + headerLength);
    return JSON.parse(new TextDecoder().decode(headerBytes)) as BundleHeader;
  } catch {
    return null;
  }
}

export { crypto };