import { useEffect, useState, useCallback } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export interface UsePWAInstallResult {
  installable: boolean;
  installed: boolean;
  ios: boolean;
  promptInstall: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
}

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document);
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const standalone = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  return Boolean(standalone) || window.matchMedia('(display-mode: standalone)').matches;
}

export function usePWAInstall(): UsePWAInstallResult {
  const [installable, setInstallable] = useState(false);
  const [installed, setInstalled] = useState<boolean>(() => isStandalone());
  const [ios] = useState<boolean>(() => isIos());
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
      setInstallable(true);
    };
    const onAppInstalled = () => {
      setInstalled(true);
      setInstallable(false);
      setEvt(null);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    if (!evt) return 'unavailable';
    await evt.prompt();
    const choice = await evt.userChoice;
    setEvt(null);
    if (choice.outcome === 'accepted') {
      setInstalled(true);
      setInstallable(false);
    }
    return choice.outcome;
  }, [evt]);

  return { installable, installed, ios, promptInstall };
}
