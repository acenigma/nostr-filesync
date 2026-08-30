import * as db from '../db/index';
import type { FileRecord, FolderRecord } from '../db/index';
import * as folders from '../folders/index';

const MIGRATION_FLAG_KEY = 'migration.path-to-folders.v1.completed';

export interface MigrationResult {
  foldersCreated: number;
  filesMigrated: number;
  alreadyMigrated: boolean;
}

function pathSegments(path: string): string[] {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
}

interface FolderMap {
  byPath: Map<string, FolderRecord>;
  byName: Map<string, FolderRecord>;
}

async function buildFolderMap(): Promise<FolderMap> {
  const all = await folders.listAllFolders();
  const byPath = new Map<string, FolderRecord>();
  const byName = new Map<string, FolderRecord>();
  for (const f of all) {
    byName.set(`${f.parentId ?? ''}::${f.name}`, f);
  }
  return { byPath, byName };
}

function getOrCreateFolder(
  map: FolderMap,
  parentId: string | null,
  name: string
): FolderRecord {
  const key = `${parentId ?? ''}::${name}`;
  const existing = map.byName.get(key);
  if (existing) return existing;
  return {
    id: '',
    parentId,
    name,
    createdAt: 0,
    updatedAt: 0,
    version: 0,
  };
}

function isMigrationDone(): boolean {
  return localStorage.getItem(MIGRATION_FLAG_KEY) === '1';
}

function markMigrationDone(): void {
  localStorage.setItem(MIGRATION_FLAG_KEY, '1');
}

export async function migratePathToFolders(): Promise<MigrationResult> {
  if (isMigrationDone()) {
    return { foldersCreated: 0, filesMigrated: 0, alreadyMigrated: true };
  }

  const allFiles = await db.getAll<FileRecord>(db.STORE_FILES);
  const map = await buildFolderMap();
  let foldersCreated = 0;
  let filesMigrated = 0;

  for (const file of allFiles) {
    if (!file.path) continue;
    const segments = pathSegments(file.path);
    if (segments.length === 0) continue;

    const dirSegments = segments;

    let parentId: string | null = null;
    for (const seg of dirSegments) {
      const key = `${parentId ?? ''}::${seg}`;
      let folder = map.byName.get(key);
      if (!folder) {
        folder = await folders.createFolder({ name: seg, parentId });
        map.byName.set(key, folder);
        foldersCreated++;
      }
      parentId = folder.id;
    }

    const updated: FileRecord = {
      ...file,
      folderId: parentId,
      path: undefined,
      updatedAt: Date.now(),
      version: (file.version ?? 1) + 1,
    };
    await db.put(db.STORE_FILES, updated);
    filesMigrated++;
  }

  markMigrationDone();
  return { foldersCreated, filesMigrated, alreadyMigrated: false };
}

export function resetMigrationFlag(): void {
  localStorage.removeItem(MIGRATION_FLAG_KEY);
}

export function hasLegacyPathFiles(): Promise<boolean> {
  return db.getAll<FileRecord>(db.STORE_FILES).then((all) =>
    all.some((f) => !!f.path && f.path.length > 0)
  );
}

export { pathSegments, getOrCreateFolder };
