import { useEffect, useState } from 'react';

export interface NetworkInfo {
  supported: boolean;
  online: boolean;
  effectiveType: '2g' | '3g' | '4g' | 'slow-2g' | 'unknown';
  downlinkMbps: number | null;
  rttMs: number | null;
  saveData: boolean;
}

interface NetworkConnection extends EventTarget {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
}

const CONN_KEY = 'connection' as unknown as keyof Navigator;

function read(): Omit<NetworkInfo, 'online' | 'supported'> {
  const nav = navigator as Navigator & { connection?: NetworkConnection };
  const conn = nav.connection;
  return {
    effectiveType: (conn?.effectiveType as NetworkInfo['effectiveType']) ?? 'unknown',
    downlinkMbps: conn?.downlink ?? null,
    rttMs: conn?.rtt ?? null,
    saveData: Boolean(conn?.saveData),
  };
}

export function useNetworkInfo(): NetworkInfo {
  const [info, setInfo] = useState<NetworkInfo>(() => ({
    supported: CONN_KEY in navigator,
    online: navigator.onLine,
    ...read(),
  }));

  useEffect(() => {
    const update = () => setInfo({ supported: true, online: navigator.onLine, ...read() });
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    const nav = navigator as Navigator & { connection?: NetworkConnection };
    const conn = nav.connection;
    conn?.addEventListener?.('change', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      conn?.removeEventListener?.('change', update);
    };
  }, []);

  return info;
}

export function shouldDeferHeavyUploads(info: NetworkInfo): boolean {
  if (!info.online) return true;
  if (info.saveData) return true;
  if (info.effectiveType === '2g' || info.effectiveType === 'slow-2g') return true;
  if (info.effectiveType === '3g' && info.rttMs !== null && info.rttMs > 500) return true;
  return false;
}
