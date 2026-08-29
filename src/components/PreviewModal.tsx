import { useEffect, useRef, useState } from 'react';
import * as filesync from '../services/filesync';
import type { FileHeaders } from '../services/filesync';
import { useAbort } from '../hooks/useAbort';
import './PreviewModal.css';

interface Props {
  file: FileHeaders;
  onClose: () => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
}

export default function PreviewModal({ file, onClose, onPrev, onNext }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const objectUrlRef = useRef<string | null>(null);
  const abort = useAbort();

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setLoading(true);
    setSrc(null);
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    (async () => {
      try {
        const blob = await filesync.downloadFile(file, undefined, abort.signal);
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        setSrc(url);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          setError((e as Error).message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, [file.fileId, file.headerEventId, abort.signal]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && onPrev) onPrev();
      if (e.key === 'ArrowRight' && onNext) onNext();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, onPrev, onNext]);

  return (
    <div
      className="preview-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${file.name}`}
    >
      <button
        className="preview-close"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Close"
      >
        ✕
      </button>
      {onPrev && (
        <button
          className="preview-nav prev"
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
          aria-label="Previous"
        >
          ‹
        </button>
      )}
      {onNext && (
        <button
          className="preview-nav next"
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
          aria-label="Next"
        >
          ›
        </button>
      )}
      <div className="preview-content" onClick={(e) => e.stopPropagation()}>
        {loading && <div className="preview-loading">⏳</div>}
        {error && <div className="preview-error">{error}</div>}
        {src && file.type?.startsWith('image/') && (
          <img src={src} alt={file.name} className="preview-media" />
        )}
        {src && file.type?.startsWith('video/') && (
          <video src={src} controls autoPlay className="preview-media" />
        )}
        <div className="preview-caption">{file.name}</div>
      </div>
    </div>
  );
}