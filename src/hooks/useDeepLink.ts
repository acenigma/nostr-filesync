import { useEffect, useState } from 'react';

export type DeepLinkRoute =
  | { type: 'home' }
  | { type: 'view'; view: 'sync' | 'todo' }
  | { type: 'share'; eventId: string; from: string; shareId: string }
  | { type: 'settings' }
  | { type: 'install' };

export function parseDeepLink(href: string): DeepLinkRoute | null {
  try {
    const url = new URL(href);
    if (url.protocol === 'nostrsync:') {
      if (url.hostname === 'share') {
        const eventId = url.pathname.replace(/^\//, '');
        const from = url.searchParams.get('from') || '';
        const shareId = url.searchParams.get('id') || '';
        if (eventId && from && shareId) {
          return { type: 'share', eventId, from, shareId };
        }
        return null;
      }
      if (url.hostname === 'settings') return { type: 'settings' };
      if (url.hostname === 'install') return { type: 'install' };
      return null;
    }
    if (url.protocol === 'https:' || url.protocol === 'http:') {
      const v = url.searchParams.get('view');
      if (v === 'todo' || v === 'sync') return { type: 'view', view: v };
      if (url.pathname === '/settings') return { type: 'settings' };
      if (url.pathname === '/install') return { type: 'install' };
    }
    return null;
  } catch {
    return null;
  }
}

export function getInitialDeepLink(): DeepLinkRoute {
  if (typeof window === 'undefined') return { type: 'home' };
  return parseDeepLink(window.location.href) || { type: 'home' };
}

export function useDeepLink(): {
  route: DeepLinkRoute;
  setRoute: (r: DeepLinkRoute) => void;
} {
  const [route, setRoute] = useState<DeepLinkRoute>(() => getInitialDeepLink());

  useEffect(() => {
    const onPop = () => {
      setRoute(parseDeepLink(window.location.href) || { type: 'home' });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  return { route, setRoute };
}
