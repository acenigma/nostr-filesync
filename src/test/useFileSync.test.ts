import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import * as nostr from '../services/nostr';
import * as filesync from '../services/filesync';
import * as uploadState from '../services/uploadState';
import * as db from '../services/db';
import { useFileSync } from '../hooks/useFileSync';
import type { FileRecord, FileHeaders } from '../services/filesync';

vi.mock('../services/filesync', async () => {
  const actual = await vi.importActual<typeof filesync>('../services/filesync');
  return {
    ...actual,
    fetchFileHeaders: vi.fn(),
    loadFilesWithFallback: vi.fn(),
    loadLocalFiles: vi.fn(),
    deleteLocalFile: vi.fn(),
    deleteRemoteFile: vi.fn(),
    resumePendingUploads: vi.fn(),
    publishFile: vi.fn(),
    downloadFile: vi.fn(),
    bindNostr: vi.fn(),
    subscribeToFileHeaders: vi.fn(() => () => {}),
    triggerDownload: vi.fn(),
    sha256Hex: actual.sha256Hex,
    aesGcmEncrypt: actual.aesGcmEncrypt,
    aesGcmDecrypt: actual.aesGcmDecrypt,
    gzipCompress: actual.gzipCompress,
    gzipDecompress: actual.gzipDecompress,
    nip44SelfWrap: actual.nip44SelfWrap,
    nip44SelfUnwrap: actual.nip44SelfUnwrap,
    migrateFilesFromLegacy: vi.fn().mockResolvedValue(false),
    formatBytes: actual.formatBytes,
    triggerDownloadByAnchor: vi.fn(),
  };
});

vi.mock('../services/uploadState', () => ({
  listAllUploads: vi.fn().mockResolvedValue([]),
  listPendingUploads: vi.fn().mockResolvedValue([]),
  saveUploadState: vi.fn().mockResolvedValue(undefined),
  updateUploadState: vi.fn().mockResolvedValue(undefined),
  clearAllUploadStates: vi.fn().mockResolvedValue(undefined),
  markUploadComplete: vi.fn().mockResolvedValue(undefined),
  removeUploadState: vi.fn().mockResolvedValue(undefined),
  getUploadState: vi.fn().mockResolvedValue(null),
  migrateFromLegacy: vi.fn().mockResolvedValue(false),
}));

const mockFileRecord = (overrides: Partial<FileRecord> = {}): FileRecord => ({
  fileId: 'f-1',
  name: 'doc.pdf',
  type: 'application/pdf',
  size: 1024,
  hash: 'h1',
  chunks: 1,
  headerEventId: 'h-evt',
  createdAt: 100,
  status: 'uploaded',
  encrypted: true,
  path: '',
  ...overrides,
});

const mockFileHeaders = (overrides: Partial<FileHeaders> = {}): FileHeaders => ({
  fileId: 'f-2',
  name: 'remote.png',
  type: 'image/png',
  size: 2048,
  hash: 'h2',
  encryptedHash: 'h2x',
  chunks: 1,
  headerEventId: 'h-evt2',
  createdAt: 200,
  status: 'remote',
  encrypted: true,
  encKey: null,
  encNonce: null,
  compression: 'none',
  path: '',
  ...overrides,
});

describe('useFileSync', () => {
  beforeEach(() => {
    db.__useIsolatedDatabaseForTesting();
    vi.clearAllMocks();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(nostr, 'getKeys').mockReturnValue({
      privateKey: null,
      publicKey: 'pk-test',
    });
    vi.mocked(filesync.subscribeToFileHeaders).mockReturnValue(() => {});
    vi.mocked(filesync.loadFilesWithFallback).mockResolvedValue([]);
    vi.mocked(filesync.fetchFileHeaders).mockResolvedValue([]);
    vi.mocked(uploadState.listAllUploads).mockResolvedValue([]);
    vi.mocked(uploadState.listPendingUploads).mockResolvedValue([]);
    vi.mocked(uploadState.clearAllUploadStates).mockResolvedValue(undefined);
    vi.mocked(uploadState.saveUploadState).mockResolvedValue(undefined);
    vi.mocked(uploadState.updateUploadState).mockResolvedValue(undefined);
    vi.mocked(uploadState.markUploadComplete).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('carrega files local + remote e atualiza estado', async () => {
    vi.mocked(filesync.loadFilesWithFallback).mockResolvedValue([mockFileRecord()]);
    vi.mocked(filesync.fetchFileHeaders).mockResolvedValue([mockFileHeaders()]);

    const { result } = renderHook(() => useFileSync());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(result.current.files).toHaveLength(2);
    expect(result.current.loading).toBe(false);
  });

  it('onDelete remove arquivo remoto e local', async () => {
    vi.mocked(filesync.deleteRemoteFile).mockResolvedValue(undefined);
    vi.mocked(filesync.deleteLocalFile).mockResolvedValue(undefined);

    const { result } = renderHook(() => useFileSync());

    await act(async () => {
      await result.current.onDelete(mockFileHeaders({ fileId: 'f-remote' }));
    });

    expect(filesync.deleteRemoteFile).toHaveBeenCalled();
    expect(filesync.deleteLocalFile).toHaveBeenCalledWith('f-remote');
  });

  it('onClearPending limpa todos os uploads', async () => {
    const { result } = renderHook(() => useFileSync());
    await act(async () => {
      await result.current.onClearPending();
    });
    expect(uploadState.clearAllUploadStates).toHaveBeenCalled();
  });

  it('handleFiles publica arquivo e atualiza lista', async () => {
    vi.mocked(filesync.publishFile).mockResolvedValue(mockFileRecord() as never);

    const { result } = renderHook(() => useFileSync({ onProgress: () => {} }));

    await act(async () => {
      const file = new File(['conteudo'], 'test.txt', { type: 'text/plain' });
      await result.current.handleFiles(makeFileList([file]), '');
    });

    expect(filesync.publishFile).toHaveBeenCalled();
    expect(result.current.uploading).toBeNull();
  });

  it('handleFiles mostra erro quando publish falha', async () => {
    vi.mocked(filesync.publishFile).mockRejectedValue(new Error('falhou'));

    const { result } = renderHook(() => useFileSync());

    await act(async () => {
      const file = new File(['x'], 'x.txt', { type: 'text/plain' });
      await result.current.handleFiles(makeFileList([file]), '');
    });

    expect(result.current.error).toMatch(/falhou/);
  });
});

function makeFileList(files: File[]): FileList {
  const arr = files as unknown as FileList;
  arr.item = (i: number) => arr[i] ?? null;
  return arr;
}