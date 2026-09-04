import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../services/db', () => {
  const store: Record<string, Record<string, unknown>> = {};
  return {
    getAll: vi.fn(async (storeName: string) => Object.values(store[storeName] || {})),
    get: vi.fn(async (storeName: string, key: string) => store[storeName]?.[key]),
    put: vi.fn(async (storeName: string, value: { id: string }) => {
      if (!store[storeName]) store[storeName] = {};
      store[storeName][value.id] = value;
    }),
    del: vi.fn(async (storeName: string, key: string) => {
      if (store[storeName]) delete store[storeName][key];
    }),
    clear: vi.fn(async (storeName: string) => {
      store[storeName] = {};
    }),
    __clearStore: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
  };
});

import * as notifications from '../services/notifications';
import * as dbMock from '../services/db';

beforeEach(() => {
  (dbMock as unknown as { __clearStore: () => void }).__clearStore();
  vi.clearAllMocks();
});

describe('notifications service', () => {
  it('createNotification persists a new notification', async () => {
    const n = await notifications.createNotification({
      category: 'file',
      severity: 'info',
      title: 'Hello',
      message: 'World',
    });
    expect(n.id).toMatch(/^notif-/);
    expect(n.status).toBe('unread');
    expect(n.createdAt).toBeGreaterThan(0);
  });

  it('listNotifications returns all when no filter', async () => {
    await notifications.createNotification({ category: 'file', title: 'a', message: 'x' });
    await notifications.createNotification({ category: 'sync', title: 'b', message: 'y' });
    const all = await notifications.listNotifications();
    expect(all.length).toBe(2);
  });

  it('listNotifications filters by status', async () => {
    const n1 = await notifications.createNotification({ category: 'file', title: 'a', message: 'x' });
    await notifications.createNotification({ category: 'file', title: 'b', message: 'y' });
    await notifications.markAsRead(n1.id);
    const unread = await notifications.listNotifications({ status: 'unread' });
    expect(unread.length).toBe(1);
    expect(unread[0].title).toBe('b');
  });

  it('listNotifications filters by category and limits', async () => {
    await notifications.createNotification({ category: 'file', title: 'a', message: 'x' });
    await notifications.createNotification({ category: 'sync', title: 'b', message: 'y' });
    await notifications.createNotification({ category: 'file', title: 'c', message: 'z' });
    const files = await notifications.listNotifications({ category: 'file', limit: 1 });
    expect(files.length).toBe(1);
    expect(files[0].category).toBe('file');
  });

  it('getUnreadCount returns count', async () => {
    expect(await notifications.getUnreadCount()).toBe(0);
    const n1 = await notifications.createNotification({ category: 'file', title: 'a', message: 'x' });
    const n2 = await notifications.createNotification({ category: 'file', title: 'b', message: 'y' });
    expect(await notifications.getUnreadCount()).toBe(2);
    await notifications.markAsRead(n1.id);
    expect(await notifications.getUnreadCount()).toBe(1);
    await notifications.markAsRead(n2.id);
    expect(await notifications.getUnreadCount()).toBe(0);
  });

  it('markAsRead is idempotent', async () => {
    const n = await notifications.createNotification({ category: 'file', title: 'a', message: 'x' });
    await notifications.markAsRead(n.id);
    const read = (await notifications.get(n.id))!;
    const firstReadAt = read.readAt;
    await notifications.markAsRead(n.id);
    const read2 = (await notifications.get(n.id))!;
    expect(read2.readAt).toBe(firstReadAt);
  });

  it('markAllAsRead returns count and updates state', async () => {
    await notifications.createNotification({ category: 'file', title: 'a', message: 'x' });
    await notifications.createNotification({ category: 'file', title: 'b', message: 'y' });
    const count = await notifications.markAllAsRead();
    expect(count).toBe(2);
    expect(await notifications.getUnreadCount()).toBe(0);
  });

  it('archive moves notification to archived status', async () => {
    const n = await notifications.createNotification({ category: 'file', title: 'a', message: 'x' });
    await notifications.archive(n.id);
    const found = (await notifications.get(n.id))!;
    expect(found.status).toBe('archived');
    expect(found.archivedAt).not.toBeNull();
  });

  it('archiveAll returns count', async () => {
    await notifications.createNotification({ category: 'file', title: 'a', message: 'x' });
    await notifications.createNotification({ category: 'file', title: 'b', message: 'y' });
    const count = await notifications.archiveAll();
    expect(count).toBe(2);
  });

  it('deleteNotification removes from store', async () => {
    const n = await notifications.createNotification({ category: 'file', title: 'a', message: 'x' });
    await notifications.deleteNotification(n.id);
    expect(await notifications.get(n.id)).toBeUndefined();
  });

  it('clearAll removes everything', async () => {
    await notifications.createNotification({ category: 'file', title: 'a', message: 'x' });
    await notifications.createNotification({ category: 'file', title: 'b', message: 'y' });
    await notifications.clearAll();
    expect(await notifications.listNotifications()).toEqual([]);
  });

  it('onNotificationsChange notifies on changes and unsubscribes', async () => {
    const received: notifications.AppNotification[][] = [];
    const off = notifications.onNotificationsChange((all) => received.push(all));
    await notifications.createNotification({ category: 'file', title: 'a', message: 'x' });
    off();
    const beforeCount = received.length;
    await notifications.createNotification({ category: 'file', title: 'b', message: 'y' });
    expect(received.length).toBe(beforeCount);
  });

  it('notifyFileEvent creates the right category/severity', async () => {
    await notifications.notifyFileEvent({ type: 'new-file', fileId: 'f1', fileName: 'doc.txt' });
    const all = await notifications.listNotifications();
    expect(all[0].category).toBe('file');
    expect(all[0].severity).toBe('success');
    expect(all[0].title).toBe('Novo arquivo');
    expect(all[0].message).toBe('doc.txt');
  });

  it('notifyFileEvent handles all event types', async () => {
    await notifications.notifyFileEvent({ type: 'new-version', fileId: 'f1', fileName: 'doc.txt' });
    await notifications.notifyFileEvent({ type: 'deleted', fileId: 'f2', fileName: 'old.txt' });
    await notifications.notifyFileEvent({ type: 'restored', fileId: 'f3', fileName: 'back.txt' });
    const all = await notifications.listNotifications();
    expect(all.length).toBe(3);
    expect(all.map((n) => n.title).sort()).toEqual([
      'Arquivo excluído',
      'Arquivo restaurado',
      'Nova versão',
    ]);
  });

  it('notifySyncEvent handles all event types', async () => {
    await notifications.notifySyncEvent({ type: 'sync-error', message: 'relay down' });
    await notifications.notifySyncEvent({ type: 'sync-recovered', message: 'back online' });
    await notifications.notifySyncEvent({ type: 'conflict', message: 'concurrent edit', fileId: 'f1', fileName: 'a.txt' });
    await notifications.notifySyncEvent({ type: 'queued', message: 'pending' });
    await notifications.notifySyncEvent({ type: 'completed', message: 'done' });
    const all = await notifications.listNotifications();
    expect(all.length).toBe(5);
  });

  it('get returns undefined for missing', async () => {
    expect(await notifications.get('missing')).toBeUndefined();
  });
});
