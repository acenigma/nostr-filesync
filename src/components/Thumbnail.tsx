import { useState, useEffect, useRef } from 'react';
import * as filesync from '../services/filesync';
import type { FileHeaders } from '../services/filesync';
import { useAbort } from '../hooks/useAbort';

const cache = new Map<string, string>();

function readFromCache(fileId: string): string | null {
  return cache.get(fileId) ?? null;
}

interface Props {
  file: FileHeaders;
}

export default function Thumbnail({ file }: Props) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const triedRef = useRef(false);
  const abort = useAbort();

  const isImage = !!file.type && file.type.startsWith('image/');
  const isVideo = !!file.type && file.type.startsWith('video/');
  const isMedia = isImage || isVideo;

  useEffect(() => {
    if (!isMedia) return;
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setVisible(true);
            io.disconnect();
            return;
          }
        }
      },
      { rootMargin: '120px' }
    );
    io.observe(node);
    return () => io.disconnect();
  }, [isMedia]);

  useEffect(() => {
    if (!visible) return;
    if (!isMedia) return;
    if (readFromCache(file.fileId) !== null) {
      return;
    }
    if (triedRef.current) return;
    triedRef.current = true;

    let cancelled = false;
    let objectUrl: string | null = null;

    (async () => {
      setLoading(true);
      try {
        const blob = await filesync.downloadFile(file, undefined, abort.signal);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        cache.set(file.fileId, objectUrl);
        if (!cancelled) {
          setRevision((r) => r + 1);
        }
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          triedRef.current = false;
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl && !cache.has(file.fileId)) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [visible, file, isMedia, abort.signal]);

  const resolvedSrc = isMedia ? readFromCache(file.fileId) : null;

  if (isImage && resolvedSrc) {
    return (
      <span className="thumb-wrap" ref={ref}>
        <img className="thumb-img" src={resolvedSrc} alt="" loading="lazy" />
      </span>
    );
  }

  if (isVideo && resolvedSrc) {
    return (
      <span className="thumb-wrap" ref={ref}>
        <video className="thumb-img" src={resolvedSrc} muted preload="metadata" />
        <span className="thumb-overlay" aria-hidden>▶</span>
      </span>
    );
  }

  return (
    <span className="thumb-icon" ref={ref}>
      {loading && isMedia ? '⏳' : fileIcon(file.type)}
    </span>
  );
}

function fileIcon(mime: string): string {
  if (!mime) return '📄';
  if (mime.startsWith('image/')) return '🖼';
  if (mime.startsWith('video/')) return '🎬';
  if (mime.startsWith('audio/')) return '🎵';
  if (mime.includes('pdf')) return '📕';
  if (mime.includes('zip') || mime.includes('tar') || mime.includes('gz')) return '📦';
  return '📄';
}