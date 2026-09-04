import { useEffect, useState, useCallback } from 'react';
import * as notifications from '../services/notifications';
import type { AppNotification } from '../services/notifications';

export interface BrowserNotificationState {
  supported: boolean;
  permission: NotificationPermission | 'unavailable';
  request: () => Promise<NotificationPermission>;
}

export function useBrowserNotifications(): BrowserNotificationState {
  const [permission, setPermission] = useState<NotificationPermission | 'unavailable'>(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unavailable';
    return Notification.permission;
  });

  const supported = permission !== 'unavailable';

  const request = useCallback(async (): Promise<NotificationPermission> => {
    if (!supported) return 'denied';
    const result = await Notification.requestPermission();
    setPermission(result);
    return result;
  }, [supported]);

  useEffect(() => {
    if (!supported) return;
    const off = notifications.onNotificationsChange((all) => {
      const unread = all.filter((n) => n.status === 'unread');
      if (unread.length === 0) return;
      if (Notification.permission !== 'granted') return;
      const latest = unread[0];
      showBrowserNotification(latest);
    });
    return off;
  }, [supported]);

  return { supported, permission, request };
}

function showBrowserNotification(n: AppNotification): void {
  try {
    const notif = new Notification(n.title, {
      body: n.message,
      tag: n.id,
      icon: '/icon.svg',
      badge: '/pwa-192x192.png',
    });
    notif.onclick = () => {
      window.focus();
      notif.close();
      if (n.actionUrl) {
        window.history.pushState(null, '', n.actionUrl);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
      void notifications.markAsRead(n.id);
    };
  } catch {
    /* swallow */
  }
}
