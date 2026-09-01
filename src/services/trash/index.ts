import * as db from '../db/index';
import * as fileEntity from '../file-entity/index';
import * as folders from '../folders/index';
import * as tombstones from '../tombstones/index';
import * as versions from '../versions/index';

export type { TrashRecord } from '../db/index';

export class TrashError extends Error {
  constructor(
    message: string,
    public readonly code: 'NOT_FOUND' | 'ALREADY_IN_TRASH' | 'CONFLICT'
  ) {
    super(message);
    this.name = 'TrashError';
  }
}

async function findFileByFolderAndName(
  folderId: string | null,
  name: string
): Promise<db.FileRecord | null> {
  const all = await db.getAll<db.FileRecord>(db.STORE_FILES);
  return all.find((f) => f.folderId === folderId && f.name === name) ?? null;
}

export async function moveToTrash(fileId: string, deletedBy: string = 'local'): Promise<db.TrashRecord> {
  const file = await fileEntity.getFile(fileId);
  if (!file) {
    throw new TrashError(`Arquivo não encontrado: ${fileId}`, 'NOT_FOUND');
  }

  const existing = await db.get<db.TrashRecord>(db.STORE_TRASH, fileId);
  if (existing) {
    throw new TrashError(`Arquivo já está na lixeira: ${fileId}`, 'ALREADY_IN_TRASH');
  }

  await versions.deleteVersions(fileId);

  const now = Date.now();
  const record: db.TrashRecord = {
    id: fileId,
    entityType: 'file',
    entityId: fileId,
    originalData: {
      name: file.name,
      folderId: file.folderId,
      mimeType: file.mimeType,
      size: file.size,
      contentHash: file.contentHash,
      encryptedHash: file.encryptedHash,
      chunks: file.chunks,
      headerEventId: file.headerEventId,
      encrypted: file.encrypted,
      compression: file.compression,
    },
    deletedAt: now,
    deletedBy,
    originalVersion: file.version,
  };
  await db.put(db.STORE_TRASH, record);

  await fileEntity.deleteFile(fileId, { permanent: true });
  await tombstones.createTombstone({ entityId: fileId, entityType: 'file', deletedBy });

  return record;
}

export async function moveFolderToTrash(folderId: string, deletedBy: string = 'local'): Promise<db.TrashRecord> {
  const folder = await folders.getFolder(folderId);
  if (!folder) {
    throw new TrashError(`Pasta não encontrada: ${folderId}`, 'NOT_FOUND');
  }

  const existing = await db.get<db.TrashRecord>(db.STORE_TRASH, folderId);
  if (existing) {
    throw new TrashError(`Pasta já está na lixeira: ${folderId}`, 'ALREADY_IN_TRASH');
  }

  const now = Date.now();
  const record: db.TrashRecord = {
    id: folderId,
    entityType: 'folder',
    entityId: folderId,
    originalData: {
      name: folder.name,
      parentId: folder.parentId,
    },
    deletedAt: now,
    deletedBy,
    originalVersion: folder.version,
  };
  await db.put(db.STORE_TRASH, record);

  await folders.deleteFolder(folderId, { permanent: true });
  await tombstones.createTombstone({ entityId: folderId, entityType: 'folder', deletedBy });

  return record;
}

export async function getTrashItem(trashId: string): Promise<db.TrashRecord | null> {
  const record = await db.get<db.TrashRecord>(db.STORE_TRASH, trashId);
  return record ?? null;
}

export async function listTrash(options: { entityType?: 'file' | 'folder' } = {}): Promise<db.TrashRecord[]> {
  const all = await db.getAll<db.TrashRecord>(db.STORE_TRASH);
  let result = all;
  if (options.entityType) {
    result = result.filter((t) => t.entityType === options.entityType);
  }
  return result.sort((a, b) => b.deletedAt - a.deletedAt);
}

export async function restoreFromTrash(trashId: string): Promise<db.FileRecord | db.FolderRecord | null> {
  const trash = await getTrashItem(trashId);
  if (!trash) return null;

  if (trash.entityType === 'file') {
    const originalData = trash.originalData as {
      name: string;
      folderId: string | null;
      mimeType: string;
      size: number;
      contentHash: string;
      encryptedHash?: string;
      chunks: number;
      headerEventId: string;
      encrypted: boolean;
      compression?: string;
    };

    const existing = await findFileByFolderAndName(originalData.folderId, originalData.name);
    if (existing) {
      throw new TrashError(`Já existe um arquivo com o nome "${originalData.name}" na pasta de destino`, 'CONFLICT');
    }

    const file: db.FileRecord = {
      fileId: trash.entityId,
      folderId: originalData.folderId,
      name: originalData.name,
      mimeType: originalData.mimeType,
      size: originalData.size,
      contentHash: originalData.contentHash,
      encryptedHash: originalData.encryptedHash,
      chunks: originalData.chunks,
      headerEventId: originalData.headerEventId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: trash.originalVersion,
      encrypted: originalData.encrypted,
      compression: originalData.compression,
    };
    await db.put(db.STORE_FILES, file);
    await tombstones.deleteTombstone(trash.entityId);
  } else if (trash.entityType === 'folder') {
    const originalData = trash.originalData as {
      name: string;
      parentId: string | null;
    };

    const folder: db.FolderRecord = {
      id: trash.entityId,
      parentId: originalData.parentId,
      name: originalData.name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: trash.originalVersion,
    };
    await db.put(db.STORE_FOLDERS, folder);
    await tombstones.deleteTombstone(trash.entityId);
  }

  await db.del(db.STORE_TRASH, trashId);

  if (trash.entityType === 'file') {
    const file = await fileEntity.getFile(trash.entityId);
    return file;
  } else {
    const folder = await folders.getFolder(trash.entityId);
    return folder;
  }
}

export async function emptyTrash(olderThanMs?: number): Promise<number> {
  const all = await listTrash();
  const now = Date.now();
  let removed = 0;

  for (const item of all) {
    if (olderThanMs && now - item.deletedAt < olderThanMs) continue;
    await db.del(db.STORE_TRASH, item.id);
    removed++;
  }
  return removed;
}

export async function getTrashStats(): Promise<{
  totalFiles: number;
  totalFolders: number;
  totalSize: number;
  oldestItem: number | null;
}> {
  const all = await listTrash();
  const files = all.filter((t) => t.entityType === 'file');
  const folders = all.filter((t) => t.entityType === 'folder');
  const totalSize = files.reduce((sum, f) => sum + (f.originalData as { size: number }).size, 0);
  const oldestItem = all.length > 0 ? Math.min(...all.map((t) => t.deletedAt)) : null;

  return {
    totalFiles: files.length,
    totalFolders: folders.length,
    totalSize,
    oldestItem,
  };
}