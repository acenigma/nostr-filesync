import { describe, it, expect } from 'vitest';
import * as delta from '../services/sync/delta';
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

describe('computeDelta', () => {
  it('manifests idênticos: tudo unchanged', () => {
    const entries = [makeEntry('f-1', 1), makeEntry('f-2', 1)];
    const local = makeManifest(entries);
    const remote = makeManifest(entries);
    const d = delta.computeDelta(local, remote);
    expect(d.unchanged).toHaveLength(2);
    expect(d.toAdd).toHaveLength(0);
    expect(d.toUpdate).toHaveLength(0);
    expect(d.toDelete).toHaveLength(0);
  });

  it('remote tem entidade nova: toAdd', () => {
    const local = makeManifest([makeEntry('f-1', 1)]);
    const remote = makeManifest([makeEntry('f-1', 1), makeEntry('f-2', 1)]);
    const d = delta.computeDelta(local, remote);
    expect(d.toAdd).toHaveLength(1);
    expect(d.toAdd[0].entityId).toBe('f-2');
  });

  it('local tem entidade que remote não tem: toAdd (push para remote)', () => {
    const local = makeManifest([makeEntry('f-1', 1), makeEntry('f-2', 1)]);
    const remote = makeManifest([makeEntry('f-1', 1)]);
    const d = delta.computeDelta(local, remote);
    expect(d.toAdd).toHaveLength(1);
    expect(d.toAdd[0].entityId).toBe('f-2');
  });

  it('remote tem versão maior: toUpdate', () => {
    const local = makeManifest([makeEntry('f-1', 1)]);
    const remote = makeManifest([makeEntry('f-1', 2)]);
    const d = delta.computeDelta(local, remote);
    expect(d.toUpdate).toHaveLength(1);
    expect(d.toUpdate[0].version).toBe(2);
  });

  it('remote tem versão menor: unchanged (local é mais novo)', () => {
    const local = makeManifest([makeEntry('f-1', 2)]);
    const remote = makeManifest([makeEntry('f-1', 1)]);
    const d = delta.computeDelta(local, remote);
    expect(d.unchanged).toHaveLength(1);
  });

  it('remote tem tombstone e local tem entidade viva: toDelete', () => {
    const local = makeManifest([makeEntry('f-1', 1)]);
    const remote = makeManifest([makeEntry('f-1', 2, 'file', true)]);
    const d = delta.computeDelta(local, remote);
    expect(d.toDelete).toHaveLength(1);
  });

  it('remote tem tombstone e local já tem tombstone: ignored', () => {
    const local = makeManifest([makeEntry('f-1', 1, 'file', true)]);
    const remote = makeManifest([makeEntry('f-1', 2, 'file', true)]);
    const d = delta.computeDelta(local, remote);
    expect(d.toDelete).toHaveLength(0);
    expect(d.toAdd).toHaveLength(0);
  });

  it('local tem tombstone mas remote quer ressuscitar: toAdd', () => {
    const local = makeManifest([makeEntry('f-1', 1, 'file', true)]);
    const remote = makeManifest([makeEntry('f-1', 2, 'file', false)]);
    const d = delta.computeDelta(local, remote);
    expect(d.toAdd).toHaveLength(1);
  });

  it('manifest vazio em ambos: delta vazio', () => {
    const d = delta.computeDelta(makeManifest([]), makeManifest([]));
    expect(delta.isEmpty(d)).toBe(true);
  });

  it('mistura de operações', () => {
    const local = makeManifest([
      makeEntry('f-1', 1), // unchanged
      makeEntry('f-2', 1), // update (remote v2)
      makeEntry('f-3', 1), // só local → toAdd
      makeEntry('f-7', 1), // só local, remote tem tombstone → toDelete
    ]);
    const remote = makeManifest([
      makeEntry('f-1', 1), // unchanged
      makeEntry('f-2', 2), // update
      makeEntry('f-4', 1), // só remote → toAdd
      makeEntry('f-7', 1, 'file', true), // tombstone do f-7 que local tem vivo
      makeEntry('f-6', 1), // só remote → toAdd
    ]);
    const d = delta.computeDelta(local, remote);
    expect(d.unchanged).toHaveLength(1);
    expect(d.toUpdate).toHaveLength(1);
    expect(d.toAdd).toHaveLength(3); // f-3 (local-only), f-4 (remote-only), f-6 (remote-only)
    expect(d.toDelete).toHaveLength(1); // f-7 tombstone
  });
});

describe('deltaStats', () => {
  it('conta corretamente', () => {
    const d = {
      toAdd: [makeEntry('a', 1)],
      toUpdate: [makeEntry('b', 2), makeEntry('c', 3)],
      toDelete: [makeEntry('d', 1, 'file', true)],
      unchanged: [makeEntry('e', 1), makeEntry('f', 1), makeEntry('g', 1)],
    };
    const stats = delta.deltaStats(d);
    expect(stats).toEqual({ toAdd: 1, toUpdate: 2, toDelete: 1, unchanged: 3 });
  });
});

describe('isEmpty', () => {
  it('retorna true quando sem alterações', () => {
    expect(delta.isEmpty({ toAdd: [], toUpdate: [], toDelete: [], unchanged: [] })).toBe(true);
  });

  it('retorna false quando há toAdd', () => {
    expect(delta.isEmpty({ toAdd: [makeEntry('a', 1)], toUpdate: [], toDelete: [], unchanged: [] })).toBe(false);
  });

  it('retorna false quando há toUpdate', () => {
    expect(delta.isEmpty({ toAdd: [], toUpdate: [makeEntry('a', 2)], toDelete: [], unchanged: [] })).toBe(false);
  });

  it('retorna false quando há toDelete', () => {
    expect(delta.isEmpty({ toAdd: [], toUpdate: [], toDelete: [makeEntry('a', 1, 'file', true)], unchanged: [] })).toBe(false);
  });

  it('retorna true quando só unchanged', () => {
    expect(delta.isEmpty({ toAdd: [], toUpdate: [], toDelete: [], unchanged: [makeEntry('a', 1)] })).toBe(true);
  });
});
