import { useEffect, useState } from 'react';

export interface UseOnlineStatusResult {
  online: boolean;
  lastOfflineAt: number | null;
  lastOnlineAt: number | null;
  justCameOnline: boolean;
}

export function useOnlineStatus(): UseOnlineStatusResult {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  const [lastOfflineAt, setLastOfflineAt] = useState<number | null>(null);
  const [lastOnlineAt, setLastOnlineAt] = useState<number | null>(null);
  const [justCameOnline, setJustCameOnline] = useState(false);

  useEffect(() => {
    const onOnline = () => {
      const now = Date.now();
      setOnline(true);
      setLastOnlineAt(now);
      setJustCameOnline(true);
      const t = setTimeout(() => setJustCameOnline(false), 4000);
      return () => clearTimeout(t);
    };
    const onOffline = () => {
      setOnline(false);
      setLastOfflineAt(Date.now());
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return { online, lastOfflineAt, lastOnlineAt, justCameOnline };
}
