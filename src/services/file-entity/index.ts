import * as db from '../db/index';
import type { FileRecord } from '../db/index';
import * as folders from '../folders/index';

export type { FileRecord };

export class FileEntityError extends Error {
  constructor(
    message: string,
    public readonly code: 'INVALID_NAME' | 'NOT_FOUND' | 'DUPLICATE_NAME' | 'FOLDER_NOT_FOUND'
  ) {
    super(message);
    this.name = 'FileEntityError';
  }
}

function validateName(name: string): void {
  if (!name || !name.trim()) {
    throw new FileEntityError('Nome do arquivo não pode ser vazio', 'INVALID_NAME');
  }
  if (name.length > 255) {
    throw new FileEntityError('Nome do arquivo muito longo (máx 255 caracteres)', 'INVALID_NAME');
  }
  if (name.includes('/') || name.includes('\0')) {
    throw new FileEntityError('Nome do arquivo não pode conter "/" ou caracteres nulos', 'INVALID_NAME');
  }
}

export interface CreateFileInput {
  name: string;
  folderId?: string | null;
  mimeType: string;
  size: number;
  contentHash: string;
  encryptedHash?: string;
  chunks: number;
  headerEventId: string;
  encrypted: boolean;
  compression?: string;
}

export async function createFile(input: CreateFileInput): Promise<FileRecord> {
  const name = input.name.trim();
  validateName(name);
  const folderId = input.folderId ?? null;

  if (folderId !== null) {
    const folder = await folders.getFolder(folderId);
    if (!folder) {
      throw new FileEntityError(`Pasta não encontrada: ${folderId}`, 'FOLDER_NOT_FOUND');
    }
  }

  const existing = await findByFolderAndName(folderId, name);
  if (existing) {
    throw new FileEntityError(
      `Já existe um arquivo com o nome "${name}" nesta pasta`,
      'DUPLICATE_NAME'
    );
  }

  const now = Date.now();
  const file: FileRecord = {
    fileId: input.headerEventId ? extractFileIdFromHeader(input.headerEventId) : generateFileId(),
    folderId,
    name,
    mimeType: input.mimeType,
    size: input.size,
    contentHash: input.contentHash,
    encryptedHash: input.encryptedHash,
    chunks: input.chunks,
    headerEventId: input.headerEventId,
    createdAt: now,
    updatedAt: now,
    version: 1,
    encrypted: input.encrypted,
    compression: input.compression,
  };
  await db.put(db.STORE_FILES, file);
  return file;
}

function generateFileId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return 'f-' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function extractFileIdFromHeader(headerEventId: string): string {
  return headerEventId;
}

export async function getFile(fileId: string): Promise<FileRecord | null> {
  const file = await db.get<FileRecord>(db.STORE_FILES, fileId);
  return file ?? null;
}

export async function listFiles(folderId?: string | null): Promise<FileRecord[]> {
  const all = await db.getAll<FileRecord>(db.STORE_FILES);
  return all.filter((f) => f.folderId === (folderId ?? null));
}

export async function listAllFiles(): Promise<FileRecord[]> {
  return db.getAll<FileRecord>(db.STORE_FILES);
}

async function findByFolderAndName(
  folderId: string | null,
  name: string
): Promise<FileRecord | null> {
  const all = await db.getAll<FileRecord>(db.STORE_FILES);
  return all.find((f) => f.folderId === folderId && f.name === name) ?? null;
}

export interface UpdateFileInput {
  name?: string;
  folderId?: string | null;
}

export async function updateFile(
  fileId: string,
  patch: UpdateFileInput
): Promise<FileRecord> {
  const existing = await getFile(fileId);
  if (!existing) {
    throw new FileEntityError(`Arquivo não encontrado: ${fileId}`, 'NOT_FOUND');
  }

  const nextName = patch.name?.trim() ?? existing.name;
  validateName(nextName);
  const nextFolderId =
    patch.folderId === undefined ? existing.folderId : patch.folderId;

  if (nextFolderId !== null) {
    const folder = await folders.getFolder(nextFolderId);
    if (!folder) {
      throw new FileEntityError(`Pasta não encontrada: ${nextFolderId}`, 'FOLDER_NOT_FOUND');
    }
  }

  if (nextName !== existing.name || nextFolderId !== existing.folderId) {
    const conflict = await findByFolderAndName(nextFolderId, nextName);
    if (conflict && conflict.fileId !== fileId) {
      throw new FileEntityError(
        `Já existe um arquivo com o nome "${nextName}" na pasta de destino`,
        'DUPLICATE_NAME'
      );
    }
  }

  const updated: FileRecord = {
    ...existing,
    name: nextName,
    folderId: nextFolderId,
    updatedAt: Date.now(),
    version: existing.version + 1,
  };
  await db.put(db.STORE_FILES, updated);
  return updated;
}

export async function moveFile(fileId: string, newFolderId: string | null): Promise<FileRecord> {
  return updateFile(fileId, { folderId: newFolderId });
}

export async function renameFile(fileId: string, newName: string): Promise<FileRecord> {
  return updateFile(fileId, { name: newName });
}

export async function deleteFile(fileId: string): Promise<void> {
  const existing = await getFile(fileId);
  if (!existing) {
    throw new FileEntityError(`Arquivo não encontrado: ${fileId}`, 'NOT_FOUND');
  }
  await db.del(db.STORE_FILES, fileId);
}

export async function findByContentHash(contentHash: string): Promise<FileRecord | null> {
  const all = await db.getAll<FileRecord>(db.STORE_FILES);
  return all.find((f) => f.contentHash === contentHash) ?? null;
}

export async function findDuplicates(
  contentHash: string,
  size: number
): Promise<FileRecord[]> {
  const all = await db.getAll<FileRecord>(db.STORE_FILES);
  return all.filter((f) => f.contentHash === contentHash && f.size === size);
}
