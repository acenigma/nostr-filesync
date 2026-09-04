import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let notificationInstances: Array<{
  title: string;
  options: NotificationOptions;
  onclick: (() => void) | null;
  close: () => void;
}> = [];

class MockNotification {
  static permission: NotificationPermission = 'default';
  static requestPermission = vi.fn().mockResolvedValue('granted');
  title: string;
  onclick: (() => void) | null = null;
  close = vi.fn();
  constructor(title: string, options?: NotificationOptions) {
    this.title = title;
    notificationInstances.push({
      title,
      options: options || {},
      onclick: null,
      close: this.close,
    });
    (this as unknown as { onclick: (() => void) | null }).onclick = null;
    Object.defineProperty(this, 'onclick', {
      get: () => notificationInstances[notificationInstances.length - 1].onclick,
      set: (v: (() => void) | null) => {
        notificationInstances[notificationInstances.length - 1].onclick = v;
      },
    });
  }
}

vi.mock('../services/notifications', () => ({
  onNotificationsChange: vi.fn(),
  markAsRead: vi.fn(),
}));

import * as notifications from '../services/notifications';
import { renderHook, act } from '@testing-library/react';
import { useBrowserNotifications } from '../hooks/useBrowserNotifications';

beforeEach(() => {
  notificationInstances = [];
  (globalThis as unknown as { Notification: typeof MockNotification }).Notification =
    MockNotification;
  MockNotification.permission = 'default';
  vi.mocked(notifications.onNotificationsChange).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useBrowserNotifications', () => {
  it('reports unsupported when Notification is missing', async () => {
    delete (globalThis as unknown as { Notification?: typeof MockNotification }).Notification;
    const { result } = renderHook(() => useBrowserNotifications());
    expect(result.current.supported).toBe(false);
    expect(result.current.permission).toBe('unavailable');
  });

  it('reports current permission', async () => {
    MockNotification.permission = 'granted';
    const { result } = renderHook(() => useBrowserNotifications());
    expect(result.current.supported).toBe(true);
    expect(result.current.permission).toBe('granted');
  });

  it('request() updates permission', async () => {
    MockNotification.permission = 'default';
    const { result } = renderHook(() => useBrowserNotifications());
    let perm: NotificationPermission = 'default';
    await act(async () => {
      perm = await result.current.request();
    });
    expect(perm).toBe('granted');
    expect(result.current.permission).toBe('granted');
  });

  it('showBrowserNotification fires on new notifications when permission granted', async () => {
    MockNotification.permission = 'granted';
    let handler: ((n: unknown[]) => void) | null = null;
    vi.mocked(notifications.onNotificationsChange).mockImplementation((h) => {
      handler = h as (n: unknown[]) => void;
      return () => {};
    });
    renderHook(() => useBrowserNotifications());
    expect(handler).not.toBeNull();
    act(() => {
      handler!([
        { id: '1', status: 'unread', title: 'Hello', message: 'World', createdAt: Date.now() },
      ] as unknown[]);
    });
    expect(notificationInstances.length).toBe(1);
    expect(notificationInstances[0].title).toBe('Hello');
  });

  it('does not fire when permission is not granted', async () => {
    MockNotification.permission = 'default';
    let handler: ((n: unknown[]) => void) | null = null;
    vi.mocked(notifications.onNotificationsChange).mockImplementation((h) => {
      handler = h as (n: unknown[]) => void;
      return () => {};
    });
    renderHook(() => useBrowserNotifications());
    act(() => {
      handler!([
        { id: '1', status: 'unread', title: 'X', message: 'Y', createdAt: Date.now() },
      ] as unknown[]);
    });
    expect(notificationInstances.length).toBe(0);
  });

  it('does not fire when there are no unread notifications', async () => {
    MockNotification.permission = 'granted';
    let handler: ((n: unknown[]) => void) | null = null;
    vi.mocked(notifications.onNotificationsChange).mockImplementation((h) => {
      handler = h as (n: unknown[]) => void;
      return () => {};
    });
    renderHook(() => useBrowserNotifications());
    act(() => {
      handler!([] as unknown[]);
    });
    expect(notificationInstances.length).toBe(0);
  });
});
