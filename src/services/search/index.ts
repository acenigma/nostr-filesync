import * as db from '../db/index';
const FAVORITES_KEY = 'nostr_filesync_favorites';
const INDEX_KEY = 'nostr_filesync_search_index';

export interface FavoriteInfo {
  id: string;
  entityType: 'file' | 'folder';
  name: string;
  addedAt: number;
}

export interface SearchResultItem {
  fileId: string;
  fileName: string;
  folderId: string | null;
  mimeType: string;
  size: number;
  createdAt: number;
  updatedAt: number;
  contentHash: string;
  score: number;
  matches: string[];
}

export interface SearchOptions {
  query: string;
  limit?: number;
  filters?: {
    mimeType?: string;
    folderId?: string | null;
    minSize?: number;
    maxSize?: number;
    createdBefore?: number;
    createdAfter?: number;
  };
}

export type SearchFilterField = 'name' | 'folder' | 'mimeType' | 'size' | 'created' | 'tags';

export interface SearchQuery {
  text?: string;
  field?: SearchFilterField;
  value?: string;
}

function getFavoritesFromStorage(): FavoriteInfo[] {
  try {
    const stored = localStorage.getItem(FAVORITES_KEY);
    if (stored) return JSON.parse(stored) as FavoriteInfo[];
  } catch {
    // ignore parse errors
  }
  return [];
}

function saveFavoritesToStorage(favorites: FavoriteInfo[]): void {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
}

export function favoriteFile(fileId: string, fileName: string): FavoriteInfo {
  const favorites = getFavoritesFromStorage();
  if (favorites.some((f) => f.id === fileId && f.entityType === 'file')) {
    return favorites.find((f) => f.id === fileId && f.entityType === 'file')!;
  }
  const fav: FavoriteInfo = {
    id: fileId,
    entityType: 'file',
    name: fileName,
    addedAt: Date.now(),
  };
  favorites.push(fav);
  saveFavoritesToStorage(favorites);
  return fav;
}

export function favoriteFolder(folderId: string, folderName: string): FavoriteInfo {
  const favorites = getFavoritesFromStorage();
  if (favorites.some((f) => f.id === folderId && f.entityType === 'folder')) {
    return favorites.find((f) => f.id === folderId && f.entityType === 'folder')!;
  }
  const fav: FavoriteInfo = {
    id: folderId,
    entityType: 'folder',
    name: folderName,
    addedAt: Date.now(),
  };
  favorites.push(fav);
  saveFavoritesToStorage(favorites);
  return fav;
}

export function unfavorite(entityId: string): boolean {
  const favorites = getFavoritesFromStorage();
  const filtered = favorites.filter((f) => f.id !== entityId);
  if (filtered.length === favorites.length) return false;
  saveFavoritesToStorage(filtered);
  return true;
}

export function isFavorited(entityId: string): boolean {
  return getFavoritesFromStorage().some((f) => f.id === entityId);
}

export function listFavorites(): FavoriteInfo[] {
  return getFavoritesFromStorage().slice().sort((a, b) => b.addedAt - a.addedAt);
}

export async function searchMetadata(opts: SearchOptions): Promise<SearchResultItem[]> {
  const { query, limit = 100, filters } = opts;
  const term = query.toLowerCase().trim();
  if (!term) return [];

  const allFiles = await db.getAll<any>(db.STORE_FILES);
  const allFolders = await db.getAll<any>(db.STORE_FOLDERS);

  const folderMap = new Map<string, any>();
  for (const f of allFolders) {
    folderMap.set(f.id, f);
  }

  const results: SearchResultItem[] = [];

  for (const file of allFiles) {
    const matches: string[] = [];
    let score = 0;

    if (term && file.name.toLowerCase().includes(term)) {
      matches.push('name');
      score += 10;
    }

    const folder = file.folderId ? folderMap.get(file.folderId) : null;
    if (folder && term && folder.name.toLowerCase().includes(term)) {
      matches.push('folder');
      score += 5;
    }

    if (term && file.mimeType.toLowerCase().includes(term)) {
      matches.push('mimeType');
      score += 3;
    }

    if (term && file.contentHash.includes(term)) {
      matches.push('contentHash');
      score += 1;
    }

    if (filters) {
      if (filters.mimeType && file.mimeType !== filters.mimeType) continue;
      if (filters.folderId !== undefined && file.folderId !== filters.folderId) continue;
      if (filters.minSize !== undefined && file.size < filters.minSize) continue;
      if (filters.maxSize !== undefined && file.size > filters.maxSize) continue;
      if (filters.createdAfter !== undefined && file.createdAt < filters.createdAfter) continue;
      if (filters.createdBefore !== undefined && file.createdAt > filters.createdBefore) continue;
    }

    if (matches.length > 0) {
      results.push({
        fileId: file.fileId,
        fileName: file.name,
        folderId: file.folderId,
        mimeType: file.mimeType,
        size: file.size,
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
        contentHash: file.contentHash,
        score,
        matches,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

export interface InvertedIndex {
  [term: string]: { fileIds: string[]; freq: number };
}

export async function buildInvertedIndex(): Promise<void> {
  const allFiles = await db.getAll<any>(db.STORE_FILES);
  const allFolders = await db.getAll<any>(db.STORE_FOLDERS);
  const folderMap = new Map<string, any>();
  for (const f of allFolders) {
    folderMap.set(f.id, f);
  }

  const index: InvertedIndex = {};

  const tokenize = (s: string): string[] =>
    s
      .toLowerCase()
      .split(/[\s\-_.]+/)
      .filter((t) => t.length > 0);

  for (const file of allFiles) {
    const tokens = new Set<string>();
    for (const t of tokenize(file.name)) tokens.add(t);
    if (file.mimeType) {
      for (const t of tokenize(file.mimeType)) tokens.add(t);
    }

    const folder = file.folderId ? folderMap.get(file.folderId) : null;
    if (folder?.name) {
      for (const t of tokenize(folder.name)) tokens.add(t);
    }

    for (const token of tokens) {
      if (!index[token]) {
        index[token] = { fileIds: [], freq: 0 };
      }
      index[token].fileIds.push(file.fileId);
      index[token].freq += 1;
    }
  }

  localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

export async function searchWithIndex(opts: SearchOptions): Promise<SearchResultItem[]> {
  const { query, limit = 100, filters } = opts;
  const term = query.toLowerCase().trim();
  if (!term) return [];

  let index: InvertedIndex = {};
  try {
    const stored = localStorage.getItem(INDEX_KEY);
    if (stored) index = JSON.parse(stored) as InvertedIndex;
  } catch {
    // ignore
  }

  if (Object.keys(index).length === 0) {
    await buildInvertedIndex();
    const stored = localStorage.getItem(INDEX_KEY);
    if (stored) index = JSON.parse(stored) as InvertedIndex;
  }

  const tokens = tokenize(term);
  if (tokens.length === 0) return [];

  const fileScores = new Map<string, { score: number; matches: string[] }>();

  for (const token of tokens) {
    const entry = index[token];
    if (entry) {
      for (const fileId of entry.fileIds) {
        const existing = fileScores.get(fileId);
        if (existing) {
          existing.score += entry.freq;
          existing.matches.push(`index:${token}`);
        } else {
          fileScores.set(fileId, { score: entry.freq, matches: [`index:${token}`] });
        }
      }
    }
  }

  const allFiles = await db.getAll<any>(db.STORE_FILES);
  const fileMap = new Map<string, any>();
  for (const f of allFiles) {
    fileMap.set(f.fileId, f);
  }

  const allFolders = await db.getAll<any>(db.STORE_FOLDERS);
  const folderMap = new Map<string, any>();
  for (const f of allFolders) {
    folderMap.set(f.id, f);
  }

  const results: SearchResultItem[] = [];

  for (const [fileId, { score, matches }] of fileScores) {
    const file = fileMap.get(fileId);
    if (!file) continue;

    if (filters) {
      if (filters.mimeType && file.mimeType !== filters.mimeType) continue;
      if (filters.folderId !== undefined && file.folderId !== filters.folderId) continue;
      if (filters.minSize !== undefined && file.size < filters.minSize) continue;
      if (filters.maxSize !== undefined && file.size > filters.maxSize) continue;
      if (filters.createdAfter !== undefined && file.createdAt < filters.createdAfter) continue;
      if (filters.createdBefore !== undefined && file.createdAt > filters.createdBefore) continue;
    }

    const folder = file.folderId ? folderMap.get(file.folderId) : null;
    const folderName = folder?.name ?? '';

    if (term && file.name.toLowerCase().includes(term) && !matches.includes('name')) {
      matches.push('name');
    }
    if (term && folderName.toLowerCase().includes(term) && !matches.includes('folder')) {
      matches.push('folder');
    }

    results.push({
      fileId: file.fileId,
      fileName: file.name,
      folderId: file.folderId,
      mimeType: file.mimeType,
      size: file.size,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
      contentHash: file.contentHash,
      score,
      matches,
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[\s\-_.]+/)
    .filter((t) => t.length > 0);
}

export async function refreshSearchIndex(): Promise<void> {
  await buildInvertedIndex();
}

export function clearSearchIndex(): void {
  localStorage.removeItem(INDEX_KEY);
}

export { tokenize };
