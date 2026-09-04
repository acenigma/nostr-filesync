import { describe, it, expect, beforeEach, vi } from 'vitest';

const fakeFiles: { fileId: string; name: string; size: number; folderId: string; createdAt: number }[] = [];
const fakeUploads: { fileId: string }[] = [];
const fakeBlobs: { contentHash: string }[] = [];
const fakeFolders: { id: string }[] = [];

vi.mock('../services/db', () => ({
  STORE_FILES: 'files',
  STORE_UPLOADS: 'uploads',
  STORE_BLOBS: 'blobs',
  STORE_FOLDERS: 'folders',
  getAll: vi.fn(async (store: string) => {
    if (store === 'files') return fakeFiles;
    if (store === 'uploads') return fakeUploads;
    if (store === 'blobs') return fakeBlobs;
    if (store === 'folders') return fakeFolders;
    return [];
  }),
}));

vi.mock('../services/filesync', () => ({
  resumePendingUploads: vi.fn(async () => [
    { fileId: 'f1', ok: true, result: {} },
    { fileId: 'f2', ok: false, error: 'relay down' },
  ]),
}));

vi.mock('../services/diagnostics', () => ({
  recordEvent: vi.fn(),
}));

import * as repair from '../services/repair';

beforeEach(() => {
  fakeFiles.length = 0;
  fakeUploads.length = 0;
  fakeBlobs.length = 0;
  fakeFolders.length = 0;
  vi.clearAllMocks();
});

describe('repair service', () => {
  it('checkIntegrity reports counts and orphans', async () => {
    fakeFiles.push({ fileId: 'f1', name: 'a', size: 100, folderId: '', createdAt: 1 });
    fakeUploads.push({ fileId: 'orphan' });
    const r = await repair.checkIntegrity();
    expect(r.status).toBe('ok');
    expect(r.details).toMatchObject({ files: 1, uploads: 1, orphanedUploads: 1 });
  });

  it('rebuildIndex reports counts', async () => {
    fakeFiles.push({ fileId: 'f1', name: 'a', size: 100, folderId: '', createdAt: 1 });
    fakeFolders.push({ id: 'd1' });
    const r = await repair.rebuildIndex();
    expect(r.status).toBe('ok');
    expect(r.details).toMatchObject({ files: 1, folders: 1 });
  });

  it('rebuildManifest reports entries', async () => {
    fakeFiles.push({ fileId: 'f1', name: 'a', size: 100, folderId: 'd1', createdAt: 1 });
    const r = await repair.rebuildManifest();
    expect(r.status).toBe('ok');
    expect((r.details as { entries: number }).entries).toBe(1);
  });

  it('retryFailed invokes resumePendingUploads', async () => {
    const r = await repair.retryFailed();
    expect(r.status).toBe('ok');
    expect(r.details).toMatchObject({ total: 2, ok: 1, failed: 1 });
  });

  it('runAllRepairs runs all tools', async () => {
    const all = await repair.runAllRepairs();
    expect(all.length).toBe(4);
    for (const r of all) {
      expect(r.tool).toBeTruthy();
      expect(r.status).toBeTruthy();
    }
  });

  it('RepairResult has durationMs', async () => {
    const r = await repair.checkIntegrity();
    expect(typeof r.durationMs).toBe('number');
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });
});
