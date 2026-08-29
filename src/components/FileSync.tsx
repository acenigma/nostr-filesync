import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import * as nostr from '../services/nostr';
import * as filesync from '../services/filesync';
import * as uploadState from '../services/uploadState';
import type { FileHeaders, FileRecord, DownloadProgress } from '../services/filesync';
import Thumbnail from './Thumbnail';
import { useAbort } from '../hooks/useAbort';
import './FileSync.css';

type ViewMode = 'tree' | 'flat';

interface ProgressState {
  name: string;
  current: number;
  total: number;
}

interface FolderNode {
  path: string;
  folders: FolderNode[];
  files: (FileRecord | FileHeaders)[];
  folderCount: number;
  fileCount: number;
}

export default function FileSync() {
  const [files, setFiles] = useState<(FileRecord | FileHeaders)[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<ProgressState | null>(null);
  const [downloading, setDownloading] = useState<ProgressState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('tree');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set(['']));
  const [uploadPath, setUploadPath] = useState('');
  const [pendingUploads, setPendingUploads] = useState<uploadState.UploadState[]>([]);
  const [dedupNotice, setDedupNotice] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const operationAbort = useAbort();

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
    const merged = mergeFiles(local, remote);
    setFiles(merged);
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

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setError(null);
    setDedupNotice(null);
    for (const file of Array.from(fileList)) {
      if (operationAbort.signal.aborted) return;
      setUploading({ name: file.name, current: 0, total: 1 });
      try {
        const result = await filesync.publishFile(
          file,
          { path: uploadPath },
          (p: DownloadProgress) => {
            if (mountedRef.current) {
              setUploading({ name: file.name, current: p.current, total: p.total });
            }
          },
          operationAbort.signal
        );
        if (result.deduplicated) {
          setDedupNotice(`"${file.name}" já existe — referência criada`);
          setTimeout(() => setDedupNotice(null), 3000);
        }
        await refresh();
        await refreshPending();
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        console.error('Falha ao enviar arquivo', e);
        setError(`Falha ao enviar ${file.name}: ${(e as Error).message}`);
      }
    }
    setUploading(null);
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFiles(e.target.files);
    e.target.value = '';
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  const onDownload = async (file: FileRecord | FileHeaders) => {
    setError(null);
    setDownloading({ name: file.name, current: 0, total: file.chunks });
    try {
      const blob = await filesync.downloadFile(
        file as FileHeaders,
        (p: DownloadProgress) => {
          if (mountedRef.current) {
            setDownloading({ name: file.name, current: p.current, total: p.total });
          }
        },
        operationAbort.signal
      );
      filesync.triggerDownload(blob, file.name);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      console.error('Falha ao baixar', e);
      setError(`Falha ao baixar ${file.name}: ${(e as Error).message}`);
    } finally {
      setDownloading(null);
    }
  };

  const onDelete = async (file: FileRecord | FileHeaders) => {
    if (!confirm(`Excluir ${file.name}? Isso também remove dos relays.`)) return;
    setError(null);
    try {
      await filesync.deleteRemoteFile(file as FileHeaders);
      await filesync.deleteLocalFile(file.fileId);
      await refresh();
    } catch (e) {
      console.error('Falha ao excluir', e);
      setError(`Falha ao excluir: ${(e as Error).message}`);
    }
  };

  const onResume = async () => {
    const results = await filesync.resumePendingUploads();
    await refreshPending();
    const completed = results.filter((r) => r.ok && r.result?.status === 'complete').length;
    const removed = results.filter((r) => r.ok && r.result?.status === 'incomplete').length;
    setError(
      `Retomada: ${completed} completo(s), ${removed} removido(s) por incompletude`
    );
  };

  const onClearPending = async () => {
    if (!confirm('Limpar todos os estados de upload pendentes?')) return;
    await uploadState.clearAllUploadStates();
    await refreshPending();
  };

  const filteredFiles = useMemo(() => {
    if (!search.trim()) return files;
    const q = search.toLowerCase();
    return files.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        (f.path || '').toLowerCase().includes(q)
    );
  }, [files, search]);

  const tree = useMemo(() => buildTree(filteredFiles), [filteredFiles]);

  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  if (loading) {
    return <div className="filesync-container loading">Carregando arquivos...</div>;
  }

  return (
    <div className="filesync-container">
      <header className="filesync-header">
        <h1>📁 Nostr FileSync</h1>
        <p className="subtitle">Sincronize arquivos entre seus dispositivos via relays Nostr</p>
      </header>

      <div className="upload-bar">
        <div className="path-input-wrap">
          <label>Pasta (opcional)</label>
          <input
            type="text"
            value={uploadPath}
            onChange={(e) => setUploadPath(e.target.value)}
            placeholder="ex: fotos/viagem"
            spellCheck={false}
          />
        </div>
      </div>

      <div
        className={`drop-zone ${dragOver ? 'drag-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <p>Arraste arquivos aqui ou</p>
        <label className="upload-btn">
          escolher arquivos
          <input
            type="file"
            multiple
            onChange={onInputChange}
            style={{ display: 'none' }}
          />
        </label>
        <p className="hint">
          Criptografados (AES-256-GCM) + comprimidos (gzip) antes de enviar
        </p>
      </div>

      {dedupNotice && <div className="dedup-notice">♻ {dedupNotice}</div>}

      {uploading && (
        <div className="progress-card">
          <div className="progress-info">
            <span>Enviando: {uploading.name}</span>
            <span>
              {uploading.current} / {uploading.total}
            </span>
          </div>
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${(uploading.current / uploading.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {downloading && (
        <div className="progress-card">
          <div className="progress-info">
            <span>Baixando: {downloading.name}</span>
            <span>
              {downloading.current} / {downloading.total}
            </span>
          </div>
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${(downloading.current / downloading.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      {pendingUploads.length > 0 && (
        <div className="pending-banner">
          <div className="pending-text">
            <strong>{pendingUploads.length}</strong> upload(s) em background
          </div>
          <div className="pending-actions">
            <button className="text-btn" onClick={onResume}>
              Verificar
            </button>
            <button className="text-btn danger" onClick={onClearPending}>
              Limpar
            </button>
          </div>
        </div>
      )}

      <div className="list-toolbar">
        <input
          type="text"
          className="search-input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 Buscar por nome ou pasta..."
        />
        <div className="view-toggle">
          <button
            className={`view-btn ${viewMode === 'tree' ? 'active' : ''}`}
            onClick={() => setViewMode('tree')}
            title="Árvore"
          >
            🌳
          </button>
          <button
            className={`view-btn ${viewMode === 'flat' ? 'active' : ''}`}
            onClick={() => setViewMode('flat')}
            title="Lista plana"
          >
            ☰
          </button>
        </div>
      </div>

      {viewMode === 'tree' ? (
        <TreeView
          tree={tree}
          expanded={expandedFolders}
          onToggle={toggleFolder}
          onDownload={onDownload}
          onDelete={onDelete}
        />
      ) : (
        <FlatList
          files={filteredFiles}
          onDownload={onDownload}
          onDelete={onDelete}
        />
      )}
    </div>
  );
}

interface TreeViewProps {
  tree: FolderNode;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onDownload: (f: FileRecord | FileHeaders) => void;
  onDelete: (f: FileRecord | FileHeaders) => void;
}

function TreeView({ tree, expanded, onToggle, onDownload, onDelete }: TreeViewProps) {
  if (!tree.folders.length && !tree.files.length) {
    return (
      <ul className="file-list">
        <li className="empty-state">Nenhum arquivo sincronizado ainda.</li>
      </ul>
    );
  }

  return (
    <ul className="file-list tree">
      {tree.folders.map((folder) => {
        const isOpen = expanded.has(folder.path);
        return (
          <li key={`folder-${folder.path}`} className="folder-item">
            <button className="folder-row" onClick={() => onToggle(folder.path)}>
              <span className="folder-icon">{isOpen ? '📂' : '📁'}</span>
              <span className="folder-name">{folder.path || '/'}</span>
              <span className="folder-count">{folder.fileCount + folder.folderCount}</span>
            </button>
            {isOpen && (
              <div className="folder-contents">
                <TreeView
                  tree={folder}
                  expanded={expanded}
                  onToggle={onToggle}
                  onDownload={onDownload}
                  onDelete={onDelete}
                />
              </div>
            )}
          </li>
        );
      })}
      {tree.files.map((file) => (
        <FileRow key={file.fileId} file={file} onDownload={onDownload} onDelete={onDelete} />
      ))}
    </ul>
  );
}

interface FlatListProps {
  files: (FileRecord | FileHeaders)[];
  onDownload: (f: FileRecord | FileHeaders) => void;
  onDelete: (f: FileRecord | FileHeaders) => void;
}

function FlatList({ files, onDownload, onDelete }: FlatListProps) {
  if (!files.length) {
    return (
      <ul className="file-list">
        <li className="empty-state">Nenhum arquivo sincronizado ainda.</li>
      </ul>
    );
  }
  return (
    <ul className="file-list">
      {files.map((file) => (
        <FileRow key={file.fileId} file={file} onDownload={onDownload} onDelete={onDelete} />
      ))}
    </ul>
  );
}

interface FileRowProps {
  file: FileRecord | FileHeaders;
  onDownload: (f: FileRecord | FileHeaders) => void;
  onDelete: (f: FileRecord | FileHeaders) => void;
}

function FileRow({ file, onDownload, onDelete }: FileRowProps) {
  return (
    <li className="file-item">
      <Thumbnail file={file as FileHeaders} />
      <div className="file-info">
        <div className="file-name" title={file.name}>
          {file.name}
        </div>
        <div className="file-meta">
          {file.path && <span className="file-path">{file.path}/</span>}
          {filesync.formatBytes(file.size)} · {file.status === 'uploaded' ? 'enviado' : 'remoto'}
          {file.compression === 'gzip' && ' · gzip'}
          {' · '}
          {new Date(file.createdAt * 1000).toLocaleString()}
        </div>
      </div>
      <div className="file-actions">
        <button className="action-btn download" onClick={() => onDownload(file)}>
          ⬇
        </button>
        <button className="action-btn delete" onClick={() => onDelete(file)}>
          🗑
        </button>
      </div>
    </li>
  );
}

function buildTree(files: (FileRecord | FileHeaders)[]): FolderNode {
  const root: FolderNode = {
    path: '',
    folders: [],
    files: [],
    folderCount: 0,
    fileCount: 0,
  };

  const byPath = new Map<string, FolderNode>();
  byPath.set('', root);

  for (const file of files) {
    const parts = (file.path || '').split('/').filter(Boolean);
    let current = root;
    let acc = '';
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      if (!byPath.has(acc)) {
        const folder: FolderNode = {
          path: acc,
          folders: [],
          files: [],
          folderCount: 0,
          fileCount: 0,
        };
        byPath.set(acc, folder);
        current.folders.push(folder);
        current.folderCount += 1;
      }
      current = byPath.get(acc)!;
    }
    current.files.push(file);
    current.fileCount += 1;
  }

  const sortRecursive = (node: FolderNode) => {
    node.folders.sort((a, b) => a.path.localeCompare(b.path));
    node.files.sort((a, b) => b.createdAt - a.createdAt);
    node.folders.forEach(sortRecursive);
  };
  sortRecursive(root);

  return root;
}

function mergeFiles(local: FileRecord[], remote: FileHeaders[]): (FileRecord | FileHeaders)[] {
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
