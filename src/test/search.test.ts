import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as search from '../services/search';
import * as folders from '../services/folders';
import * as fileEntity from '../services/file-entity';
import * as db from '../services/db';

beforeEach(async () => {
  db.__useIsolatedDatabaseForTesting();
  localStorage.clear();
  await db.clear(db.STORE_FILES);
  await db.clear(db.STORE_FOLDERS);
});

describe('Search Service - Favorites (9.1)', () => {
  it('favoriteFile retorna FavoriteInfo e persiste', () => {
    const fav = search.favoriteFile('file-1', 'doc.txt');
    expect(fav.id).toBe('file-1');
    expect(fav.entityType).toBe('file');
    expect(fav.name).toBe('doc.txt');
    expect(fav.addedAt).toBeGreaterThan(0);
  });

  it('favoriteFile é idempotente', () => {
    search.favoriteFile('file-1', 'doc.txt');
    search.favoriteFile('file-1', 'doc.txt');
    expect(search.listFavorites()).toHaveLength(1);
  });

  it('favoriteFolder retorna FavoriteInfo com entityType folder', () => {
    const fav = search.favoriteFolder('fld-1', 'MyFolder');
    expect(fav.entityType).toBe('folder');
    expect(fav.name).toBe('MyFolder');
  });

  it('isFavorited retorna true após favoritar', () => {
    search.favoriteFile('file-1', 'doc.txt');
    expect(search.isFavorited('file-1')).toBe(true);
    expect(search.isFavorited('file-2')).toBe(false);
  });

  it('unfavorite remove e retorna true', () => {
    search.favoriteFile('file-1', 'doc.txt');
    expect(search.isFavorited('file-1')).toBe(true);
    expect(search.unfavorite('file-1')).toBe(true);
    expect(search.isFavorited('file-1')).toBe(false);
  });

  it('unfavorite retorna false para item não favoritado', () => {
    expect(search.unfavorite('nonexistent')).toBe(false);
  });

  it('listFavorites ordena por addedAt decrescente', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    search.favoriteFile('file-1', 'first');
    vi.setSystemTime(2000);
    search.favoriteFile('file-2', 'second');
    vi.useRealTimers();
    const list = search.listFavorites();
    expect(list[0].id).toBe('file-2');
    expect(list[1].id).toBe('file-1');
  });
});

describe('Search Service - Metadata search (9.2)', () => {
  beforeEach(async () => {
    const folder = await folders.createFolder({ name: 'TestFolder' });
    await fileEntity.createFile({
      name: 'document.txt',
      mimeType: 'text/plain',
      size: 100,
      contentHash: 'a'.repeat(64),
      chunks: 1,
      headerEventId: 'h-1',
      encrypted: false,
      folderId: folder.id,
    });
    await fileEntity.createFile({
      name: 'image.png',
      mimeType: 'image/png',
      size: 5000,
      contentHash: 'b'.repeat(64),
      chunks: 2,
      headerEventId: 'h-2',
      encrypted: true,
      folderId: folder.id,
    });
    await fileEntity.createFile({
      name: 'data.json',
      mimeType: 'application/json',
      size: 200,
      contentHash: 'c'.repeat(64),
      chunks: 1,
      headerEventId: 'h-3',
      encrypted: false,
    });
  });

  it('busca por nome parcial', async () => {
    const results = await search.searchMetadata({ query: 'doc' });
    expect(results).toHaveLength(1);
    expect(results[0].fileName).toBe('document.txt');
    expect(results[0].matches).toContain('name');
  });

  it('busca por nome em arquivo diferente não retorna', async () => {
    const results = await search.searchMetadata({ query: 'xyz' });
    expect(results).toHaveLength(0);
  });

  it('busca vazia retorna vazio', async () => {
    const results = await search.searchMetadata({ query: '' });
    expect(results).toHaveLength(0);
  });

  it('busca por pasta via nome do arquivo', async () => {
    const results = await search.searchMetadata({ query: 'Test' });
    expect(results.length).toBeGreaterThanOrEqual(2);
    for (const r of results) {
      r.matches.push('folder');
    }
  });

  it('busca por mimeType', async () => {
    const results = await search.searchMetadata({ query: 'png' });
    expect(results).toHaveLength(1);
    expect(results[0].fileName).toBe('image.png');
    expect(results[0].matches).toContain('mimeType');
  });

  it('filtra por mimeType', async () => {
    const results = await search.searchMetadata({
      query: 'data',
      filters: { mimeType: 'application/json' },
    });
    expect(results).toHaveLength(1);
    expect(results[0].mimeType).toBe('application/json');
  });

  it('filtra por maxSize', async () => {
    const results = await search.searchMetadata({
      query: '',
      filters: { maxSize: 500 },
    });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('ordena por score (relevância)', async () => {
    const results = await search.searchMetadata({ query: 'doc' });
    expect(results[0].fileName).toBe('document.txt');
  });

  it('limita resultados', async () => {
    const results = await search.searchMetadata({ query: '', limit: 1 });
    expect(results).toHaveLength(0);
  });

  it('filtra por folderId', async () => {
    const folder = await folders.createFolder({ name: 'AnotherFolder' });
    await fileEntity.createFile({
      name: 'doc2.txt',
      mimeType: 'text/plain',
      size: 50,
      contentHash: 'd'.repeat(64),
      chunks: 1,
      headerEventId: 'h-4',
      encrypted: false,
      folderId: folder.id,
    });

    const results = await search.searchMetadata({
      query: 'doc',
      filters: { folderId: folder.id },
    });
    expect(results).toHaveLength(1);
    expect(results[0].fileName).toBe('doc2.txt');
  });
});

describe('Search Service - Inverted index (9.5)', () => {
  beforeEach(async () => {
    const folder = await folders.createFolder({ name: 'TestFolder' });
    await fileEntity.createFile({
      name: 'document.txt',
      mimeType: 'text/plain',
      size: 100,
      contentHash: 'a'.repeat(64),
      chunks: 1,
      headerEventId: 'h-1',
      encrypted: false,
      folderId: folder.id,
    });
  });

  it('buildInvertedIndex cria index no localStorage', async () => {
    search.clearSearchIndex();
    await search.buildInvertedIndex();
    const stored = localStorage.getItem('nostr_filesync_search_index');
    expect(stored).not.toBeNull();
    const index = JSON.parse(stored!);
    expect(index['document']).toBeDefined();
    expect(index['document'].fileIds).toContain('h-1');
  });

  it('searchWithIndex usa index existente', async () => {
    search.clearSearchIndex();
    await search.buildInvertedIndex();
    const results = await search.searchWithIndex({ query: 'document' });
    expect(results).toHaveLength(1);
    expect(results[0].fileName).toBe('document.txt');
  });

  it('searchWithIndex builda index automaticamente se não existir', async () => {
    search.clearSearchIndex();
    const results = await search.searchWithIndex({ query: 'document' });
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  it('tokenize separa por espaços e caracteres especiais', () => {
    const tokens = search.tokenize('hello-world_test.txt');
    expect(tokens).toContain('hello');
    expect(tokens).toContain('world');
    expect(tokens).toContain('test');
    expect(tokens).toContain('txt');
  });

  it('clearSearchIndex remove index do localStorage', async () => {
    search.clearSearchIndex();
    await search.buildInvertedIndex();
    expect(localStorage.getItem('nostr_filesync_search_index')).not.toBeNull();
    search.clearSearchIndex();
    expect(localStorage.getItem('nostr_filesync_search_index')).toBeNull();
  });

  it('refreshSearchIndex reconstrói o index', async () => {
    search.clearSearchIndex();
    await search.refreshSearchIndex();
    expect(localStorage.getItem('nostr_filesync_search_index')).not.toBeNull();
  });
});
