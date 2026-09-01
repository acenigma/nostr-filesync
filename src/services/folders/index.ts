import * as db from '../db/index';
import type { FolderRecord } from '../db/index';
import * as trash from '../trash/index';

export type { FolderRecord };

export class FolderError extends Error {
  constructor(
    message: string,
    public readonly code: 'INVALID_NAME' | 'NOT_FOUND' | 'CYCLE' | 'DUPLICATE_NAME'
  ) {
    super(message);
    this.name = 'FolderError';
  }
}

function makeFolderId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return 'fld-' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function validateName(name: string): void {
  if (!name || !name.trim()) {
    throw new FolderError('Nome da pasta não pode ser vazio', 'INVALID_NAME');
  }
  if (name.length > 255) {
    throw new FolderError('Nome da pasta muito longo (máx 255 caracteres)', 'INVALID_NAME');
  }
  if (name.includes('/') || name.includes('\0')) {
    throw new FolderError('Nome da pasta não pode conter "/" ou caracteres nulos', 'INVALID_NAME');
  }
}

export interface CreateFolderInput {
  name: string;
  parentId?: string | null;
}

export async function createFolder(input: CreateFolderInput): Promise<FolderRecord> {
  const name = input.name.trim();
  validateName(name);
  const parentId = input.parentId ?? null;

  if (parentId !== null) {
    const parent = await getFolder(parentId);
    if (!parent) {
      throw new FolderError(`Pasta pai não encontrada: ${parentId}`, 'NOT_FOUND');
    }
  }

  const existing = await findByParentAndName(parentId, name);
  if (existing) {
    throw new FolderError(
      `Já existe uma pasta com o nome "${name}" neste local`,
      'DUPLICATE_NAME'
    );
  }

  const now = Date.now();
  const folder: FolderRecord = {
    id: makeFolderId(),
    parentId,
    name,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  await db.put(db.STORE_FOLDERS, folder);
  return folder;
}

export async function getFolder(id: string): Promise<FolderRecord | null> {
  const folder = await db.get<FolderRecord>(db.STORE_FOLDERS, id);
  return folder ?? null;
}

export async function listFolders(parentId?: string | null): Promise<FolderRecord[]> {
  const all = await db.getAll<FolderRecord>(db.STORE_FOLDERS);
  return all.filter((f) => f.parentId === (parentId ?? null));
}

export async function listAllFolders(): Promise<FolderRecord[]> {
  return db.getAll<FolderRecord>(db.STORE_FOLDERS);
}

async function findByParentAndName(
  parentId: string | null,
  name: string
): Promise<FolderRecord | null> {
  const all = await db.getAll<FolderRecord>(db.STORE_FOLDERS);
  return all.find((f) => f.parentId === parentId && f.name === name) ?? null;
}

export interface UpdateFolderInput {
  name?: string;
  parentId?: string | null;
}

export async function updateFolder(
  id: string,
  patch: UpdateFolderInput
): Promise<FolderRecord> {
  const existing = await getFolder(id);
  if (!existing) {
    throw new FolderError(`Pasta não encontrada: ${id}`, 'NOT_FOUND');
  }

  const nextName = patch.name?.trim() ?? existing.name;
  validateName(nextName);
  const nextParentId =
    patch.parentId === undefined ? existing.parentId : patch.parentId;

  if (nextParentId === id) {
    throw new FolderError('Uma pasta não pode ser pai dela mesma', 'CYCLE');
  }

  if (nextParentId !== null) {
    const parent = await getFolder(nextParentId);
    if (!parent) {
      throw new FolderError(`Pasta pai não encontrada: ${nextParentId}`, 'NOT_FOUND');
    }
    if (await isDescendant(nextParentId, id)) {
      throw new FolderError('Operação criaria um ciclo na árvore de pastas', 'CYCLE');
    }
  }

  if (nextName !== existing.name || nextParentId !== existing.parentId) {
    const conflict = await findByParentAndName(nextParentId, nextName);
    if (conflict && conflict.id !== id) {
      throw new FolderError(
        `Já existe uma pasta com o nome "${nextName}" neste local`,
        'DUPLICATE_NAME'
      );
    }
  }

  const updated: FolderRecord = {
    ...existing,
    name: nextName,
    parentId: nextParentId,
    updatedAt: Date.now(),
    version: existing.version + 1,
  };
  await db.put(db.STORE_FOLDERS, updated);
  return updated;
}

async function isDescendant(candidateParentId: string, ancestorId: string): Promise<boolean> {
  let currentId: string | null = candidateParentId;
  const visited = new Set<string>();
  while (currentId !== null) {
    if (currentId === ancestorId) return true;
    if (visited.has(currentId)) return false;
    visited.add(currentId);
    const folder = await getFolder(currentId);
    if (!folder) return false;
    currentId = folder.parentId;
  }
  return false;
}

export async function deleteFolder(id: string, options: { permanent?: boolean } = {}): Promise<string[]> {
  const folder = await getFolder(id);
  if (!folder) {
    throw new FolderError(`Pasta não encontrada: ${id}`, 'NOT_FOUND');
  }

  const all = await db.getAll<FolderRecord>(db.STORE_FOLDERS);
  const toDelete = collectDescendants(all, id);
  toDelete.push(id);

  if (options.permanent) {
    for (const folderId of toDelete) {
      await db.del(db.STORE_FOLDERS, folderId);
    }
  } else {
    for (const folderId of toDelete) {
      await trash.moveFolderToTrash(folderId);
    }
  }
  return toDelete;
}

function collectDescendants(folders: FolderRecord[], parentId: string): string[] {
  const result: string[] = [];
  const queue = [parentId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const f of folders) {
      if (f.parentId === current) {
        result.push(f.id);
        queue.push(f.id);
      }
    }
  }
  return result;
}

export interface FolderNode {
  folder: FolderRecord;
  children: FolderNode[];
  depth: number;
}

export async function buildFolderTree(): Promise<FolderNode | null> {
  const all = await listAllFolders();
  const roots = all.filter((f) => f.parentId === null);
  if (roots.length === 0) return null;

  const childrenMap = new Map<string | null, FolderRecord[]>();
  for (const f of all) {
    const list = childrenMap.get(f.parentId) ?? [];
    list.push(f);
    childrenMap.set(f.parentId, list);
  }

  const buildNode = (folder: FolderRecord, depth: number): FolderNode => ({
    folder,
    depth,
    children: (childrenMap.get(folder.id) ?? [])
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => buildNode(c, depth + 1)),
  });

  if (roots.length === 1) {
    return buildNode(roots[0], 0);
  }
  return {
    folder: {
      id: '__virtual_root__',
      parentId: null,
      name: '/',
      createdAt: 0,
      updatedAt: 0,
      version: 0,
    },
    depth: -1,
    children: roots
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((r) => buildNode(r, 0)),
  };
}
