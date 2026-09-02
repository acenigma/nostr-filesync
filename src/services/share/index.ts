import * as db from '../db';
import * as nostr from '../nostr';
import { nip44, type NostrEvent, type EventTemplate, type VerifiedEvent } from 'nostr-tools';

export const KIND_SHARE = 30077;
export const KIND_SHARE_DELETE = 5;
export const SHARE_RECORD_KEY = 'nostr_filesync_shares';

export type Permission = 'viewer' | 'editor' | 'owner';

export interface ShareRecord {
  id: string;
  fileId: string;
  fileName: string;
  folderId: string | null;
  contentHash: string;
  size: number;
  mimeType: string;
  sharedBy: string;
  sharedWith: string;
  permission: Permission;
  eventId: string;
  createdAt: number;
  expiresAt?: number;
  accepted: boolean;
  revoked: boolean;
  isFolder: boolean;
}

interface EncryptedSharePayload {
  fileId?: string;
  folderId?: string;
  fileName?: string;
  contentHash?: string;
  size?: number;
  mimeType?: string;
  permission: Permission;
  nonce?: string;
  expiresAt?: number;
}

interface ShareStoreRecord {
  id: string;
  eventId: string;
  sharedBy: string;
  sharedWith: string;
  fileId: string;
  fileName: string;
  folderId: string | null;
  contentHash: string;
  size: number;
  mimeType: string;
  permission: Permission;
  createdAt: number;
  expiresAt?: number;
  accepted: boolean;
  revoked: boolean;
  isFolder: boolean;
}

function getSharesFromStorage(): ShareStoreRecord[] {
  try {
    const stored = localStorage.getItem(SHARE_RECORD_KEY);
    if (stored) return JSON.parse(stored) as ShareStoreRecord[];
  } catch {
    // ignore parse errors
  }
  return [];
}

function saveSharesToStorage(shares: ShareStoreRecord[]): void {
  localStorage.setItem(SHARE_RECORD_KEY, JSON.stringify(shares));
}

export function listShares(): ShareRecord[] {
  return getSharesFromStorage().map((s) => ({
    id: s.id,
    fileId: s.fileId,
    fileName: s.fileName,
    folderId: s.folderId,
    contentHash: s.contentHash,
    size: s.size,
    mimeType: s.mimeType,
    sharedBy: s.sharedBy,
    sharedWith: s.sharedWith,
    permission: s.permission,
    eventId: s.eventId,
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
    accepted: s.accepted,
    revoked: s.revoked,
    isFolder: s.isFolder,
  }));
}

export function getShare(id: string): ShareRecord | null {
  const shares = getSharesFromStorage();
  const found = shares.find((s) => s.id === id);
  if (!found) return null;
  return {
    id: found.id,
    fileId: found.fileId,
    fileName: found.fileName,
    folderId: found.folderId,
    contentHash: found.contentHash,
    size: found.size,
    mimeType: found.mimeType,
    sharedBy: found.sharedBy,
    sharedWith: found.sharedWith,
    permission: found.permission,
    eventId: found.eventId,
    createdAt: found.createdAt,
    expiresAt: found.expiresAt,
    accepted: found.accepted,
    revoked: found.revoked,
    isFolder: found.isFolder,
  };
}

export function getIncomingShares(): ShareRecord[] {
  const pub = nostr.getKeys().publicKey;
  if (!pub) return [];
  return listShares().filter((s) => s.sharedWith === pub && !s.revoked && !isShareExpired(s));
}

export function getOutgoingShares(): ShareRecord[] {
  const pub = nostr.getKeys().publicKey;
  if (!pub) return [];
  return listShares().filter((s) => s.sharedBy === pub && !s.revoked);
}

export async function createShare(
  fileId: string,
  recipientPubkey: string,
  permission: Permission = 'viewer',
  expiresInMs?: number
): Promise<ShareRecord> {
  const keys = nostr.getKeys();
  if (!keys.privateKey) {
    throw new Error('Usuário não autenticado. Desbloqueie primeiro.');
  }
  if (!keys.publicKey) {
    throw new Error('Public key não disponível');
  }

  const file = await db.get<db.FileRecord>(db.STORE_FILES, fileId);
  if (!file) {
    throw new Error(`Arquivo não encontrado: ${fileId}`);
  }

  const shareId = `shr-${fileId}-${Date.now()}`;
  const expiresAt = expiresInMs ? Date.now() + expiresInMs : undefined;

  const payload: EncryptedSharePayload = {
    fileId: file.fileId,
    fileName: file.name,
    folderId: file.folderId ?? undefined,
    contentHash: file.contentHash,
    size: file.size,
    mimeType: file.mimeType,
    permission,
    expiresAt,
  };

  const conversationKey = nip44.getConversationKey(keys.privateKey, recipientPubkey);
  const encryptedContent = nip44.encrypt(
    JSON.stringify(payload),
    conversationKey
  );

  const tags: string[][] = [
    ['p', recipientPubkey],
    ['file', file.fileId],
    ['d', shareId],
  ];

  if (expiresAt) {
    tags.push(['expiration', Math.floor(expiresAt / 1000).toString()]);
  }

  const eventTemplate: EventTemplate = {
    kind: KIND_SHARE,
    content: encryptedContent,
    tags,
    created_at: Math.floor(Date.now() / 1000),
  };

  let signedEvent: VerifiedEvent;
  try {
    signedEvent = nostr.signEventWithKey(keys.privateKey, eventTemplate);
  } catch (e) {
    throw new Error(`Falha ao assinar evento de compartilhamento: ${(e as Error).message}`);
  }

  const eventId = await nostr.publishEvent(signedEvent as NostrEvent);
  if (eventId === 0) {
    throw new Error('Falha ao publicar evento de compartilhamento');
  }

  const record: ShareStoreRecord = {
    id: shareId,
    eventId: signedEvent.id,
    sharedBy: keys.publicKey,
    sharedWith: recipientPubkey,
    fileId: file.fileId,
    fileName: file.name,
    folderId: file.folderId,
    contentHash: file.contentHash,
    size: file.size,
    mimeType: file.mimeType,
    permission,
    createdAt: Date.now(),
    expiresAt,
    accepted: false,
    revoked: false,
    isFolder: false,
  };

  const shares = getSharesFromStorage();
  shares.push(record);
  saveSharesToStorage(shares);

  return {
    id: shareId,
    fileId: file.fileId,
    fileName: file.name,
    folderId: file.folderId,
    contentHash: file.contentHash,
    size: file.size,
    mimeType: file.mimeType,
    sharedBy: keys.publicKey,
    sharedWith: recipientPubkey,
    permission,
    eventId: signedEvent.id,
    createdAt: record.createdAt,
    expiresAt,
    accepted: false,
    revoked: false,
    isFolder: false,
  };
}

export async function discoverIncomingShares(): Promise<ShareRecord[]> {
  const keys = nostr.getKeys();
  if (!keys.publicKey) {
    throw new Error('Usuário não autenticado');
  }

  const pool = nostr.getPool();
  if (!pool) {
    return getIncomingShares();
  }

  const relays = await nostr.getRelays(keys.publicKey);

  try {
    const events = await pool.querySync(
      relays,
      {
        kinds: [KIND_SHARE],
        limit: 100,
      } as any,
      { maxWait: 10000 }
    );

    const shares: ShareStoreRecord[] = [];

    for (const event of events) {
      const senderPubkey = event.pubkey;
      if (!senderPubkey || !keys.privateKey) continue;

      const pTag = event.tags.find((t) => t[0] === 'p');
      if (!pTag || pTag[1] !== keys.publicKey) continue;

      try {
        const conversationKey = nip44.getConversationKey(
          keys.privateKey,
          senderPubkey
        );
        const decrypted = nip44.decrypt(event.content, conversationKey);
        const payload = JSON.parse(decrypted) as EncryptedSharePayload;

        const expirationTag = event.tags.find(
          (t) => t[0] === 'expiration'
        );
        const expiresAt = expirationTag
          ? parseInt(expirationTag[1]) * 1000
          : payload.expiresAt;

        const dTag = event.tags.find((t) => t[0] === 'd');
        const shareId = dTag ? dTag[1] : event.id;

        const folderTag = event.tags.find((t) => t[0] === 'folder');
        const isFolder = !!folderTag;

        const record: ShareStoreRecord = {
          id: shareId,
          eventId: event.id,
          sharedBy: senderPubkey,
          sharedWith: keys.publicKey,
          fileId: payload.fileId ?? '',
          fileName: payload.fileName ?? '',
          folderId: payload.folderId ?? (folderTag ? folderTag[1] : null) ?? null,
          contentHash: payload.contentHash ?? '',
          size: payload.size ?? 0,
          mimeType: payload.mimeType ?? '',
          permission: payload.permission,
          createdAt: event.created_at * 1000,
          expiresAt,
          accepted: !!getSharesFromStorage().find((s) => s.eventId === event.id),
          revoked: false,
          isFolder,
        };

        shares.push(record);
      } catch {
        // ignorar eventos que não podem ser decriptados
      }
    }

    const existing = getSharesFromStorage();
    const merged = [...existing];
    for (const share of shares) {
      const existingIdx = merged.findIndex((s) => s.eventId === share.eventId);
      if (existingIdx >= 0) {
        merged[existingIdx] = share;
      } else {
        merged.push(share);
      }
    }
    saveSharesToStorage(merged);

    return shares;
  } catch {
    return getIncomingShares();
  }
}

export async function acceptShare(shareId: string, targetFolderId: string | null = null): Promise<db.FileRecord> {
  const share = getShare(shareId);
  if (!share) {
    throw new Error(`Share não encontrada: ${shareId}`);
  }
  if (share.expiresAt && share.expiresAt < Date.now()) {
    throw new Error('Este convite de compartilhamento expirou');
  }

  const existing = await db.get<db.FileRecord>(db.STORE_FILES, share.fileId);
  if (existing) {
    throw new Error('Este arquivo já existe na sua biblioteca');
  }

  const now = Date.now();
  const file: db.FileRecord = {
    fileId: share.fileId,
    folderId: targetFolderId,
    name: share.fileName,
    mimeType: share.mimeType,
    size: share.size,
    contentHash: share.contentHash,
    chunks: 1,
    headerEventId: share.eventId,
    createdAt: now,
    updatedAt: now,
    version: 1,
    encrypted: false,
  };

  await db.put(db.STORE_FILES, file);

  const shares = getSharesFromStorage();
  const idx = shares.findIndex((s) => s.id === shareId);
  if (idx >= 0) {
    shares[idx] = { ...shares[idx], accepted: true };
    saveSharesToStorage(shares);
  }

  return file;
}

export async function revokeShare(shareId: string): Promise<void> {
  const share = getShare(shareId);
  if (!share) {
    throw new Error(`Share não encontrada: ${shareId}`);
  }

  const keys = nostr.getKeys();
  if (!keys.privateKey) {
    throw new Error('Usuário não autenticado');
  }

  const deleteEvent: EventTemplate = {
    kind: KIND_SHARE_DELETE,
    content: '',
    tags: [
      ['e', share.eventId],
      ['k', String(KIND_SHARE)],
    ],
    created_at: Math.floor(Date.now() / 1000),
  };

  try {
    const signedEvent = nostr.signEventWithKey(keys.privateKey, deleteEvent);
    await nostr.publishEvent(signedEvent);
  } catch (e) {
    throw new Error(`Falha ao revogar compartilhamento: ${(e as Error).message}`);
  }

  const shares = getSharesFromStorage();
  const idx = shares.findIndex((s) => s.id === shareId);
  if (idx >= 0) {
    shares[idx] = { ...shares[idx], revoked: true };
    saveSharesToStorage(shares);
  }
}

export function removeShareRecord(shareId: string): boolean {
  const shares = getSharesFromStorage();
  const filtered = shares.filter((s) => s.id !== shareId);
  if (filtered.length === shares.length) return false;
  saveSharesToStorage(filtered);
  return true;
}

export function isShareExpired(share: ShareRecord): boolean {
  return share.expiresAt !== undefined && share.expiresAt < Date.now();
}

export function generateShareLink(shareId: string): string {
  const share = getShare(shareId);
  if (!share) throw new Error(`Share não encontrada: ${shareId}`);
  return `nostrsync://share/${share.eventId}?from=${share.sharedBy}&id=${shareId}`;
}

export function parseShareLink(link: string): { eventId: string; from: string; shareId: string } | null {
  try {
    const url = new URL(link);
    if (url.protocol !== 'nostrsync:') return null;
    if (url.hostname !== 'share') return null;
    const eventId = url.pathname.slice(1);
    const from = url.searchParams.get('from');
    const shareId = url.searchParams.get('id');
    if (!eventId || !from || !shareId) return null;
    return { eventId, from, shareId };
  } catch {
    return null;
  }
}

export async function acceptShareFromLink(
  link: string,
  targetFolderId: string | null = null
): Promise<db.FileRecord | db.FolderRecord | null> {
  const parsed = parseShareLink(link);
  if (!parsed) throw new Error('Link de compartilhamento inválido');

  const shares = getSharesFromStorage();
  const share = shares.find((s) => s.id === parsed.shareId);
  if (!share) {
    throw new Error('Compartilhamento não encontrado localmente. Execute descoberta primeiro.');
  }

  if (share.isFolder) {
    return acceptFolderShare(parsed.shareId, targetFolderId);
  }
  return acceptShare(parsed.shareId, targetFolderId);
}

export async function shareFolder(
  folderId: string,
  recipientPubkey: string,
  permission: Permission = 'viewer',
  expiresInMs?: number
): Promise<ShareRecord> {
  const keys = nostr.getKeys();
  if (!keys.privateKey) {
    throw new Error('Usuário não autenticado. Desbloqueie primeiro.');
  }
  if (!keys.publicKey) {
    throw new Error('Public key não disponível');
  }

  const folder = await db.get<db.FolderRecord>(db.STORE_FOLDERS, folderId);
  if (!folder) {
    throw new Error(`Pasta não encontrada: ${folderId}`);
  }

  const shareId = `shr-folder-${folderId}-${Date.now()}`;
  const expiresAt = expiresInMs ? Date.now() + expiresInMs : undefined;

  const payload: EncryptedSharePayload = {
    folderId: folder.id,
    fileName: folder.name,
    permission,
    expiresAt,
  };

  const conversationKey = nip44.getConversationKey(keys.privateKey, recipientPubkey);
  const encryptedContent = nip44.encrypt(
    JSON.stringify(payload),
    conversationKey
  );

  const tags: string[][] = [
    ['p', recipientPubkey],
    ['folder', folder.id],
    ['d', shareId],
  ];

  if (expiresAt) {
    tags.push(['expiration', Math.floor(expiresAt / 1000).toString()]);
  }

  const eventTemplate: EventTemplate = {
    kind: KIND_SHARE,
    content: encryptedContent,
    tags,
    created_at: Math.floor(Date.now() / 1000),
  };

  const signedEvent = nostr.signEventWithKey(keys.privateKey, eventTemplate);
  const eventId = await nostr.publishEvent(signedEvent);
  if (eventId === 0) {
    throw new Error('Falha ao publicar evento de compartilhamento de pasta');
  }

  const record: ShareStoreRecord & { isFolder: boolean } = {
    id: shareId,
    eventId: signedEvent.id,
    sharedBy: keys.publicKey,
    sharedWith: recipientPubkey,
    fileId: '',
    fileName: folder.name,
    folderId: folder.id,
    contentHash: '',
    size: 0,
    mimeType: 'application/vnd.folder',
    permission,
    createdAt: Date.now(),
    expiresAt,
    accepted: false,
    revoked: false,
    isFolder: true,
  };

  const shares = getSharesFromStorage();
  shares.push(record as ShareStoreRecord);
  saveSharesToStorage(shares);

  return {
    id: shareId,
    fileId: '',
    fileName: folder.name,
    folderId: folder.id,
    contentHash: '',
    size: 0,
    mimeType: 'application/vnd.folder',
    sharedBy: keys.publicKey,
    sharedWith: recipientPubkey,
    permission,
    eventId: signedEvent.id,
    createdAt: Date.now(),
    expiresAt,
    accepted: false,
    revoked: false,
    isFolder: true,
  };
}

export async function acceptFolderShare(
  shareId: string,
  targetParentId: string | null = null
): Promise<db.FolderRecord> {
  const share = getShare(shareId);
  if (!share) {
    throw new Error(`Share não encontrada: ${shareId}`);
  }
  if (!share.isFolder) {
    throw new Error('Esta share não é uma pasta');
  }
  if (share.expiresAt && share.expiresAt < Date.now()) {
    throw new Error('Este convite de compartilhamento expirou');
  }

  const existing = await db.get<db.FolderRecord>(db.STORE_FOLDERS, share.folderId!);
  if (existing) {
    throw new Error('Esta pasta já existe na sua biblioteca');
  }

  const now = Date.now();
  const folder: db.FolderRecord = {
    id: share.folderId!,
    parentId: targetParentId,
    name: share.fileName,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };

  await db.put(db.STORE_FOLDERS, folder);

  const shares = getSharesFromStorage();
  const idx = shares.findIndex((s) => s.id === shareId);
  if (idx >= 0) {
    shares[idx] = { ...shares[idx], accepted: true };
    saveSharesToStorage(shares);
  }

  return folder;
}
