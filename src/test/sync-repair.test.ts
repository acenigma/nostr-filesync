import { describe, it, expect, beforeEach } from 'vitest';
import * as db from '../services/db';
import * as fileEntity from '../services/file-entity';
import * as folders from '../services/folders';
import * as repair from '../services/sync/repair';
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

beforeEach(async () => {
  db.__useIsolatedDatabaseForTesting();
  localStorage.clear();
  await db.clear(db.STORE_FILES);
  await db.clear(db.STORE_FOLDERS);
  await db.clear(db.STORE_TOMBSTONES);
});

describe('planRepair', () => {
  it('classifica entries corretamente', () => {
    const remote = makeManifest([
      makeEntry('f-1', 1),
      makeEntry('f-2', 1, 'folder'),
      makeEntry('f-3', 1, 'file', true), // tombstone
    ]);
    const plan = repair.planRepair(remote);
    expect(plan.toDownload).toHaveLength(2); // f-1 e f-2
    expect(plan.toRecreate).toHaveLength(2);
    expect(plan.toKeep).toHaveLength(1); // tombstone
  });
});

describe('executeRepair', () => {
  it('recreia entidades e baixa conteúdo', async () => {
    const remote = makeManifest([
      makeEntry('f-1', 1),
      makeEntry('f-2', 1, 'folder'),
    ]);

    const fetchContent = async () => new Uint8Array([1, 2, 3]);
    const result = await repair.executeRepair(remote, { fetchContent });

    expect(result.downloaded).toBe(2);
    expect(result.recreated).toBe(2);
    expect(result.failed).toBe(0);
  });

  it('respeita confirmBeforeApply=false', async () => {
    const remote = makeManifest([makeEntry('f-1', 1)]);
    const result = await repair.executeRepair(remote, {
      confirmBeforeApply: async () => false,
    });
    expect(result.recreated).toBe(0);
  });

  it('respeita confirmBeforeApply=true', async () => {
    const remote = makeManifest([makeEntry('f-1', 1)]);
    const result = await repair.executeRepair(remote, {
      confirmBeforeApply: async () => true,
    });
    expect(result.recreated).toBe(1);
  });

  it('chama backupLocal antes de aplicar', async () => {
    const remote = makeManifest([makeEntry('f-1', 1)]);
    let backupCalled = false;
    await repair.executeRepair(remote, {
      backupLocal: async () => {
        backupCalled = true;
      },
    });
    expect(backupCalled).toBe(true);
  });

  it('fetchContent lançando exceção conta como falha', async () => {
    const remote = makeManifest([makeEntry('f-1', 1)]);
    const fetchContent = async () => {
      throw new Error('network');
    };
    const result = await repair.executeRepair(remote, { fetchContent });
    expect(result.downloaded).toBe(0);
    expect(result.failed).toBe(1);
  });

  it('applyRemote customizado é usado em vez do default', async () => {
    const remote = makeManifest([makeEntry('f-1', 1)]);
    let customCalled = false;
    await repair.executeRepair(remote, {
      applyRemote: async () => {
        customCalled = true;
      },
    });
    expect(customCalled).toBe(true);
  });
});

describe('rebuildFromManifest', () => {
  it('alias para executeRepair', async () => {
    const remote = makeManifest([makeEntry('f-1', 1)]);
    const result = await repair.rebuildFromManifest(remote);
    expect(result.recreated).toBe(1);
  });
});

describe('verifyManifestConsistency', () => {
  it('manifest vazio: consistent', async () => {
    const r = await repair.verifyManifestConsistency(makeManifest([]));
    expect(r.consistent).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it('manifest válido: consistent', async () => {
    const remote = makeManifest([makeEntry('f-1', 1)]);
    const r = await repair.verifyManifestConsistency(remote);
    expect(r.consistent).toBe(true);
  });

  it('entry com version inválida: issue reportado', async () => {
    const remote = makeManifest([makeEntry('f-1', 0)]);
    const r = await repair.verifyManifestConsistency(remote);
    expect(r.consistent).toBe(false);
    expect(r.issues.length).toBeGreaterThan(0);
  });
});

describe('defaultApplyRemoteEntry (via executeRepair)', () => {
  it('cria file entry mínimo quando não existe', async () => {
    const remote = makeManifest([makeEntry('f-new', 1)]);
    await repair.executeRepair(remote);
    const f = await fileEntity.getFile('f-new');
    expect(f).not.toBeNull();
    expect(f?.fileId).toBe('f-new');
  });

  it('cria folder entry mínimo quando não existe', async () => {
    const remote = makeManifest([makeEntry('fld-new', 1, 'folder')]);
    await repair.executeRepair(remote);
    const f = await folders.getFolder('fld-new');
    expect(f).not.toBeNull();
  });

  it('não sobrescreve entidades existentes', async () => {
    const existing = await fileEntity.createFile({
      name: 'original.txt',
      mimeType: 'text/plain',
      size: 100,
      contentHash: 'h-orig',
      chunks: 1,
      headerEventId: 'h-orig',
      encrypted: true,
    });
    const remote = makeManifest([makeEntry(existing.fileId, 1)]);
    await repair.executeRepair(remote);
    const f = await fileEntity.getFile(existing.fileId);
    expect(f?.name).toBe('original.txt');
  });
});
