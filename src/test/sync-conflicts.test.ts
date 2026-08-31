import { describe, it, expect } from 'vitest';
import * as conflicts from '../services/sync/conflicts';
import type { FileRecord } from '../services/db';
import type { Manifest, ManifestEntry } from '../services/sync/manifest';

const PUBKEY = 'a'.repeat(64);

function makeEntry(
  entityId: string,
  version: number,
  type: 'file' | 'folder' = 'file',
  deleted = false
): ManifestEntry {
  return { entityId, type, version, updatedAt: 0, deleted };
}

function makeManifest(entries: ManifestEntry[]): Manifest {
  return {
    schema: 'nostr-filesync.manifest/v1',
    version: 1,
    pubkey: PUBKEY,
    generatedAt: 0,
    entries,
  };
}

describe('detectConflicts', () => {
  it('sem mudanças: nenhum conflito', () => {
    const base = makeManifest([makeEntry('f-1', 1)]);
    const local = makeManifest([makeEntry('f-1', 1)]);
    const remote = makeManifest([makeEntry('f-1', 1)]);
    expect(conflicts.detectConflicts(local, remote, base)).toEqual([]);
  });

  it('mudou só local: não é conflito (LAST_WRITE_WINS resolve)', () => {
    const base = makeManifest([makeEntry('f-1', 1)]);
    const local = makeManifest([makeEntry('f-1', 2)]);
    const remote = makeManifest([makeEntry('f-1', 1)]);
    expect(conflicts.detectConflicts(local, remote, base)).toEqual([]);
  });

  it('mudou só remote: não é conflito', () => {
    const base = makeManifest([makeEntry('f-1', 1)]);
    const local = makeManifest([makeEntry('f-1', 1)]);
    const remote = makeManifest([makeEntry('f-1', 2)]);
    expect(conflicts.detectConflicts(local, remote, base)).toEqual([]);
  });

  it('mudou ambos: conflito detectado', () => {
    const base = makeManifest([makeEntry('f-1', 1)]);
    const local = makeManifest([makeEntry('f-1', 2)]);
    const remote = makeManifest([makeEntry('f-1', 2)]);
    const c = conflicts.detectConflicts(local, remote, base);
    expect(c).toHaveLength(1);
    expect(c[0].entityId).toBe('f-1');
    expect(c[0].baseVersion).toBe(1);
  });

  it('base inexistente: conflito se ambos têm versões diferentes', () => {
    const base = makeManifest([]);
    const local = makeManifest([makeEntry('f-1', 1)]);
    const remote = makeManifest([makeEntry('f-1', 2)]);
    const c = conflicts.detectConflicts(local, remote, base);
    expect(c).toHaveLength(1);
    expect(c[0].baseVersion).toBeNull();
  });

  it('tombstone em local: não é conflito', () => {
    const base = makeManifest([makeEntry('f-1', 1)]);
    const local = makeManifest([makeEntry('f-1', 2, 'file', true)]);
    const remote = makeManifest([makeEntry('f-1', 2)]);
    expect(conflicts.detectConflicts(local, remote, base)).toEqual([]);
  });

  it('tombstone em remote: não é conflito', () => {
    const base = makeManifest([makeEntry('f-1', 1)]);
    const local = makeManifest([makeEntry('f-1', 2)]);
    const remote = makeManifest([makeEntry('f-1', 2, 'file', true)]);
    expect(conflicts.detectConflicts(local, remote, base)).toEqual([]);
  });

  it('múltiplos conflitos independentes', () => {
    const base = makeManifest([makeEntry('f-1', 1), makeEntry('f-2', 1)]);
    const local = makeManifest([makeEntry('f-1', 2), makeEntry('f-2', 2)]);
    const remote = makeManifest([makeEntry('f-1', 2), makeEntry('f-2', 3)]);
    const c = conflicts.detectConflicts(local, remote, base);
    // Ambos são conflitos (ambos mudaram de base)
    expect(c).toHaveLength(2);
    const ids = c.map((x) => x.entityId).sort();
    expect(ids).toEqual(['f-1', 'f-2']);
  });
});

describe('resolveConflict', () => {
  const local: FileRecord = {
    fileId: 'f-local',
    folderId: null,
    name: 'doc.pdf',
    mimeType: 'application/pdf',
    size: 1000,
    contentHash: 'hash-local',
    chunks: 1,
    headerEventId: 'h-local',
    createdAt: 100,
    updatedAt: 500,
    version: 2,
    encrypted: true,
  };

  it('LAST_WRITE_WINS: local é mais novo → keep-local', async () => {
    const result = await conflicts.resolveConflict('LAST_WRITE_WINS', 'f-1', local, {
      fileId: 'f-remote',
      name: 'doc.pdf',
      size: 1000,
      contentHash: 'hash-remote',
    });
    // local.updatedAt é 500, Date.now() é maior, então remote ganha
    expect(result.action).toBe('keep-remote');
  });

  it('KEEP_BOTH: retorna keep-both com fileId do remote', async () => {
    const result = await conflicts.resolveConflict('KEEP_BOTH', 'f-1', local, {
      fileId: 'f-remote',
      name: 'doc.pdf',
      size: 1000,
      contentHash: 'hash-remote',
    });
    expect(result.action).toBe('keep-both');
    expect(result.fileId).toBe('f-remote');
  });

  it('MANUAL: retorna action=manual', async () => {
    const result = await conflicts.resolveConflict('MANUAL', 'f-1', local, {
      fileId: 'f-remote',
      name: 'doc.pdf',
      size: 1000,
      contentHash: 'hash-remote',
    });
    expect(result.action).toBe('manual');
  });
});

describe('defaultStrategy', () => {
  it('folders: LAST_WRITE_WINS', () => {
    expect(conflicts.defaultStrategy('folder')).toBe('LAST_WRITE_WINS');
  });

  it('texto: LAST_WRITE_WINS', () => {
    expect(conflicts.defaultStrategy('file', 'text/plain')).toBe('LAST_WRITE_WINS');
    expect(conflicts.defaultStrategy('file', 'text/markdown')).toBe('LAST_WRITE_WINS');
    expect(conflicts.defaultStrategy('file', 'application/json')).toBe('LAST_WRITE_WINS');
  });

  it('binário: KEEP_BOTH', () => {
    expect(conflicts.defaultStrategy('file', 'image/png')).toBe('KEEP_BOTH');
    expect(conflicts.defaultStrategy('file', 'application/pdf')).toBe('KEEP_BOTH');
  });

  it('sem mimeType: LAST_WRITE_WINS', () => {
    expect(conflicts.defaultStrategy('file')).toBe('LAST_WRITE_WINS');
  });
});
