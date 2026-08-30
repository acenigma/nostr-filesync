import { useState, useMemo } from 'react';
import type { FileHeaders, FileRecord } from '../services/filesync';
import Thumbnail from './Thumbnail';
import PreviewModal from './PreviewModal';
import { useFileSync } from '../hooks/useFileSync';
import { useT } from '../hooks/useT';
import './FileSync.css';

type ViewMode = 'tree' | 'flat';

interface FolderNode {
  path: string;
  folders: FolderNode[];
  files: (FileRecord | FileHeaders)[];
  folderCount: number;
  fileCount: number;
}

interface FileSyncProps {
  onProgress?: (p: { pct: number; label: string } | null) => void;
}

export default function FileSync({ onProgress }: FileSyncProps = {}) {
  const {
    files,
    loading,
    uploading,
    downloading,
    error,
    dedupNotice,
    pendingUploads,
    setError,
    handleFiles,
    onDownload,
    onDelete,
    onResume,
    onClearPending,
  } = useFileSync({ onProgress });
  const { t } = useT();

  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('tree');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set(['']));
  const [uploadPath, setUploadPath] = useState('');
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);

  const previewable = useMemo(() => {
    const list = files.filter(
      (f) => f.type && (f.type.startsWith('image/') || f.type.startsWith('video/'))
    );
    return list;
  }, [files]);

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    void handleFiles(e.target.files, uploadPath);
    e.target.value = '';
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const items = e.dataTransfer.items;
    const files: File[] = [];
    if (items && items.length > 0) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind !== 'file') continue;
        const entry =
          typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
        if (entry) {
          await collectFromEntry(entry, '', files);
        } else {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length > 0) {
        const dt = new DataTransfer();
        for (const f of files) dt.items.add(f);
        await handleFiles(dt.files, uploadPath);
        return;
      }
    }
    await handleFiles(e.dataTransfer.files, uploadPath);
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
        className={`drop-zone`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        <p>{t('upload_dropzone')}</p>
        <div className="upload-actions">
          <label className="upload-btn">
            {t('upload_choose')}
            <input
              type="file"
              multiple
              onChange={onInputChange}
              style={{ display: 'none' }}
              data-testid="file-input"
            />
          </label>
          <label className="upload-btn secondary" title="Selecionar pasta inteira">
            {t('upload_choose_folder')}
            <input
              type="file"
              // @ts-expect-error webkitdirectory é não-padrão mas amplamente suportado
              webkitdirectory=""
              directory=""
              multiple
              onChange={onInputChange}
              style={{ display: 'none' }}
              data-testid="folder-input"
            />
          </label>
        </div>
        <p className="hint">{t('upload_hint')}</p>
      </div>

      {dedupNotice && <div className="dedup-notice">♻ {dedupNotice}</div>}

      {uploading && (
        <div className="progress-card">
          <div className="progress-info">
            <span>
              {t('sending')}: {uploading.name}
            </span>
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
            <span>
              {t('downloading')}: {downloading.name}
            </span>
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

      {error && (
        <div className="error-banner" onClick={() => setError(null)} role="button" tabIndex={0}>
          {error}
        </div>
      )}

      {pendingUploads.length > 0 && (
        <div className="pending-banner">
          <div className="pending-text">
            <strong>{pendingUploads.length}</strong> {t('pending_uploads')}
          </div>
          <div className="pending-actions">
            <button className="text-btn" onClick={() => void onResume()}>
              {t('action_check')}
            </button>
            <button className="text-btn danger" onClick={() => void onClearPending()}>
              {t('action_clear')}
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
          placeholder={t('search_placeholder')}
        />
        <div className="view-toggle">
          <button
            className={`view-btn ${viewMode === 'tree' ? 'active' : ''}`}
            onClick={() => setViewMode('tree')}
            title="Tree"
          >
            🌳
          </button>
          <button
            className={`view-btn ${viewMode === 'flat' ? 'active' : ''}`}
            onClick={() => setViewMode('flat')}
            title="Flat list"
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
          onPreview={(file) => {
            const idx = previewable.findIndex((f) => f.fileId === file.fileId);
            if (idx >= 0) setPreviewIdx(idx);
          }}
        />
      ) : (
        <FlatList
          files={filteredFiles}
          onDownload={onDownload}
          onDelete={onDelete}
          onPreview={(file) => {
            const idx = previewable.findIndex((f) => f.fileId === file.fileId);
            if (idx >= 0) setPreviewIdx(idx);
          }}
        />
      )}

      {previewIdx !== null && previewable[previewIdx] && (
        <PreviewModal
          file={previewable[previewIdx] as FileHeaders}
          onClose={() => setPreviewIdx(null)}
          onPrev={previewIdx > 0 ? () => setPreviewIdx(previewIdx - 1) : null}
          onNext={
            previewIdx < previewable.length - 1 ? () => setPreviewIdx(previewIdx + 1) : null
          }
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
  onPreview: (f: FileRecord | FileHeaders) => void;
}

function TreeView({ tree, expanded, onToggle, onDownload, onDelete, onPreview }: TreeViewProps) {
  const { t } = useT();
  if (!tree.folders.length && !tree.files.length) {
    return (
      <ul className="file-list">
        <li className="empty-state">{t('empty_files')}</li>
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
              <span className="folder-name">{folder.path || t('folder_root')}</span>
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
                  onPreview={onPreview}
                />
              </div>
            )}
          </li>
        );
      })}
      {tree.files.map((file) => (
        <FileRow
          key={file.fileId}
          file={file}
          onDownload={onDownload}
          onDelete={onDelete}
          onPreview={onPreview}
        />
      ))}
    </ul>
  );
}

interface FlatListProps {
  files: (FileRecord | FileHeaders)[];
  onDownload: (f: FileRecord | FileHeaders) => void;
  onDelete: (f: FileRecord | FileHeaders) => void;
  onPreview: (f: FileRecord | FileHeaders) => void;
}

function FlatList({ files, onDownload, onDelete, onPreview }: FlatListProps) {
  const { t } = useT();
  if (!files.length) {
    return (
      <ul className="file-list">
        <li className="empty-state">{t('empty_files')}</li>
      </ul>
    );
  }
  return (
    <ul className="file-list">
      {files.map((file) => (
        <FileRow
          key={file.fileId}
          file={file}
          onDownload={onDownload}
          onDelete={onDelete}
          onPreview={onPreview}
        />
      ))}
    </ul>
  );
}

interface FileRowProps {
  file: FileRecord | FileHeaders;
  onDownload: (f: FileRecord | FileHeaders) => void;
  onDelete: (f: FileRecord | FileHeaders) => void;
  onPreview: (f: FileRecord | FileHeaders) => void;
}

function FileRow({ file, onDownload, onDelete, onPreview }: FileRowProps) {
  const { t } = useT();
  const isPreviewable =
    !!file.type && (file.type.startsWith('image/') || file.type.startsWith('video/'));
  return (
    <li className="file-item">
      <button
        className="thumb-button"
        onClick={() => isPreviewable && onPreview(file)}
        disabled={!isPreviewable}
        aria-label={isPreviewable ? `Preview ${file.name}` : file.name}
      >
        <Thumbnail file={file as FileHeaders} />
      </button>
      <div className="file-info">
        <div className="file-name" title={file.name}>
          {file.name}
        </div>
        <div className="file-meta">
          {file.path && <span className="file-path">{file.path}/</span>}
          {filesync_formatBytes(file.size)} · {file.status === 'uploaded' ? '✓' : '☁'}
          {file.compression === 'gzip' && ' · gzip'}
          {' · '}
          {new Date(file.createdAt * 1000).toLocaleString()}
        </div>
      </div>
      <div className="file-actions">
        <button
          className="action-btn download"
          onClick={() => onDownload(file)}
          title={t('downloading')}
        >
          ⬇
        </button>
        <button
          className="action-btn delete"
          onClick={() => onDelete(file)}
          title={t('delete_confirm').replace('{name}', file.name)}
        >
          🗑
        </button>
      </div>
    </li>
  );
}

function filesync_formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
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

interface FsEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file?: (cb: (f: File) => void, err: (e: unknown) => void) => void;
  createReader?: () => {
    readEntries: (cb: (entries: FsEntryLike[]) => void, err: (e: unknown) => void) => void;
  };
}

async function collectFromEntry(
  entry: FsEntryLike,
  prefix: string,
  out: File[]
): Promise<void> {
  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((resolve, reject) => {
      entry.file!(resolve, reject);
    });
    const path = prefix;
    if (path) {
      Object.defineProperty(file, 'webkitRelativePath', {
        value: path + '/' + entry.name,
        configurable: true,
      });
    }
    out.push(file);
    return;
  }
  if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    const children = await new Promise<FsEntryLike[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    const nextPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
    for (const child of children) {
      await collectFromEntry(child, nextPrefix, out);
    }
  }
}