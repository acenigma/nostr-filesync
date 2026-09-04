import { useState, useEffect, useCallback, useRef } from 'react';
import * as nostr from '../services/nostr';
import * as filesync from '../services/filesync';
import * as uploadState from '../services/uploadState';
import * as notifications from '../services/notifications';
import type { FileHeaders, FileRecord, DownloadProgress } from '../services/filesync';
import type { UploadState } from '../services/uploadState';
import { useT } from './useT';

export interface ProgressState {
  name: string;
  current: number;
  total: number;
}

export interface UseFileSyncResult {
  files: (FileRecord | FileHeaders)[];
  loading: boolean;
  uploading: ProgressState | null;
  downloading: ProgressState | null;
  error: string | null;
  dedupNotice: string | null;
  pendingUploads: UploadState[];
  setError: (e: string | null) => void;
  setDedupNotice: (n: string | null) => void;
  refresh: () => Promise<void>;
  handleFiles: (fileList: FileList | null, path: string) => Promise<void>;
  onDownload: (file: FileRecord | FileHeaders) => Promise<void>;
  onDelete: (file: FileRecord | FileHeaders) => Promise<void>;
  onResume: () => Promise<void>;
  onClearPending: () => Promise<void>;
}

export function useFileSync(options?: { onProgress?: (p: { pct: number; label: string } | null) => void }): UseFileSyncResult {
  const [files, setFiles] = useState<(FileRecord | FileHeaders)[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<ProgressState | null>(null);
  const [downloading, setDownloading] = useState<ProgressState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dedupNotice, setDedupNotice] = useState<string | null>(null);
  const [pendingUploads, setPendingUploads] = useState<UploadState[]>([]);
  const mountedRef = useRef(true);
  const { t } = useT();
  const tRef = useRef(t);
  tRef.current = t;

  const refresh = useCallback(async () => {
    const keys = nostr.getKeys();
    if (!keys.publicKey) return;
    const local = await filesync.loadFilesWithFallback();
    let remote: FileHeaders[] = [];
    try {
      remote = await filesync.fetchFileHeaders(keys.publicKey);
    } catch (e) {
      console.warn('Falha ao buscar arquivos remotos', e);
    }
    if (!mountedRef.current) return;
    setFiles(mergeFiles(local, remote));
  }, []);

  const refreshPending = useCallback(async () => {
    const list = await uploadState.listAllUploads();
    if (mountedRef.current) setPendingUploads(list);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const init = async () => {
      filesync.bindNostr(nostr);
      await refresh();
      await refreshPending();
      if (mountedRef.current) setLoading(false);
    };
    init();

    const keys = nostr.getKeys();
    const closeSub = keys.publicKey
      ? filesync.subscribeToFileHeaders(keys.publicKey, () => {
          refresh();
        })
      : () => {};

    const interval = setInterval(refreshPending, 3000);

    return () => {
      mountedRef.current = false;
      closeSub();
      clearInterval(interval);
    };
  }, [refresh, refreshPending]);

  useEffect(() => {
    const cb = options?.onProgress;
    if (!cb) return;
    if (uploading && uploading.total > 0) {
      cb({ pct: (uploading.current / uploading.total) * 100, label: `Enviando ${uploading.name}` });
    } else if (downloading && downloading.total > 0) {
      cb({ pct: (downloading.current / downloading.total) * 100, label: `Baixando ${downloading.name}` });
    } else {
      cb(null);
    }
  }, [uploading, downloading, options]);
  const handleFiles = useCallback(
    async (fileList: FileList | null, path: string) => {
      if (!fileList || fileList.length === 0) return;
      setError(null);
      setDedupNotice(null);
      const uploadAbortController = new AbortController();
      const entries = Array.from(fileList);
      for (const file of entries) {
        if (uploadAbortController.signal.aborted) {
          return;
        }
        setUploading({ name: file.name, current: 0, total: 1 });
        try {
          let effectivePath = path;
          const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
          if (rel) {
            const normalizedRel = rel.replace(/\\/g, '/');
            if (normalizedRel.includes('/')) {
              const parts = normalizedRel.split('/');
              const relDir = parts.slice(0, -1).join('/');
              effectivePath = path ? (path + '/' + relDir) : relDir;
            }
          }
          const result = await filesync.publishFile(
            file,
            { path: effectivePath },
            (p: DownloadProgress) => {
              if (mountedRef.current) {
                setUploading({ name: file.name, current: p.current, total: p.total });
              }
            },
            uploadAbortController.signal
          );
          if (result.deduplicated) {
            setDedupNotice(`"${file.name}" — ${tRef.current('dedup_notice')}`);
            setTimeout(() => setDedupNotice(null), 3000);
          }
          await refresh();
          await refreshPending();
        } catch (e) {
          if ((e as Error).name === 'AbortError') return;
          console.error('Falha ao enviar arquivo', e);
          setError(tRef.current('upload_failed', { name: file.name, msg: (e as Error).message }));
        }
      }
      setUploading(null);
    },
    [refresh, refreshPending]
  );

  const onDownload = useCallback(
    async (file: FileRecord | FileHeaders) => {
      setError(null);
      setDownloading({ name: file.name, current: 0, total: file.chunks });
      const downloadAbortController = new AbortController();
      try {
        const blob = await filesync.downloadFile(
          file as FileHeaders,
          (p: DownloadProgress) => {
            if (mountedRef.current) {
              setDownloading({ name: file.name, current: p.current, total: p.total });
            }
          },
          downloadAbortController.signal
        );
        filesync.triggerDownload(blob, file.name);
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        console.error('Falha ao baixar', e);
        setError(tRef.current('download_failed', { name: file.name, msg: (e as Error).message }));
      } finally {
        setDownloading(null);
      }
    },
    []
  );

  const onDelete = useCallback(
    async (file: FileRecord | FileHeaders) => {
      if (!confirm(tRef.current('delete_confirm', { name: file.name }))) return;
      setError(null);
      try {
        await filesync.deleteRemoteFile(file as FileHeaders);
        await filesync.deleteLocalFile(file.fileId);
        await notifications.notifyFileEvent({
          type: 'deleted',
          fileId: file.fileId,
          fileName: file.name,
        });
        await refresh();
      } catch (e) {
        console.error('Falha ao excluir', e);
        setError(tRef.current('delete_failed', { msg: (e as Error).message }));
        await notifications.notifySyncEvent({
          type: 'sync-error',
          message: `Falha ao excluir ${file.name}: ${(e as Error).message}`,
          fileId: file.fileId,
          fileName: file.name,
        });
      }
    },
    [refresh]
  );

  const onResume = useCallback(async () => {
    const results = await filesync.resumePendingUploads();
    await refreshPending();
    const completed = results.filter((r) => r.ok && r.result?.status === 'complete').length;
    const removed = results.filter((r) => r.ok && r.result?.status === 'incomplete').length;
    setError(tRef.current('resume_report', { completed, removed }));
  }, [refreshPending]);

  const onClearPending = useCallback(async () => {
    await uploadState.clearAllUploadStates();
    await refreshPending();
  }, [refreshPending]);

  return {
    files,
    loading,
    uploading,
    downloading,
    error,
    dedupNotice,
    pendingUploads,
    setError,
    setDedupNotice,
    refresh,
    handleFiles,
    onDownload,
    onDelete,
    onResume,
    onClearPending,
  };
}

export function mergeFiles(
  local: FileRecord[],
  remote: FileHeaders[]
): (FileRecord | FileHeaders)[] {
  const byId = new Map<string, FileRecord | FileHeaders>();
  for (const r of remote) byId.set(r.fileId, r);
  for (const l of local) {
    const existing = byId.get(l.fileId);
    if (!existing) {
      byId.set(l.fileId, l);
    } else {
      byId.set(l.fileId, { ...existing, ...l, status: 'uploaded' });
    }
  }
  return Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt);
}