import * as db from '../db';

export type NotificationCategory = 'file' | 'version' | 'conflict' | 'sync' | 'share' | 'system';
export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error';
export type NotificationStatus = 'unread' | 'read' | 'archived';

export interface AppNotification {
  id: string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  title: string;
  message: string;
  createdAt: number;
  readAt: number | null;
  archivedAt: number | null;
  status: NotificationStatus;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
}

const STORE_NOTIFICATIONS = 'notifications';

let listeners: Array<(n: AppNotification[]) => void> = [];

function genId(): string {
  return `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sortByDate(a: AppNotification, b: AppNotification): number {
  return b.createdAt - a.createdAt;
}

async function loadAll(): Promise<AppNotification[]> {
  const items = await db.getAll<AppNotification>(STORE_NOTIFICATIONS);
  return items.sort(sortByDate);
}

async function emit(): Promise<void> {
  const all = await loadAll();
  listeners.forEach((l) => l(all));
}

export interface CreateNotificationInput {
  category: NotificationCategory;
  severity?: NotificationSeverity;
  title: string;
  message: string;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
}

export async function createNotification(input: CreateNotificationInput): Promise<AppNotification> {
  const n: AppNotification = {
    id: genId(),
    category: input.category,
    severity: input.severity || 'info',
    title: input.title,
    message: input.message,
    createdAt: Date.now(),
    readAt: null,
    archivedAt: null,
    status: 'unread',
    actionUrl: input.actionUrl,
    metadata: input.metadata,
  };
  await db.put<AppNotification>(STORE_NOTIFICATIONS, n);
  await emit();
  return n;
}

export async function listNotifications(filter?: {
  status?: NotificationStatus;
  category?: NotificationCategory;
  limit?: number;
}): Promise<AppNotification[]> {
  let all = await loadAll();
  if (filter?.status) all = all.filter((n) => n.status === filter.status);
  if (filter?.category) all = all.filter((n) => n.category === filter.category);
  if (filter?.limit) all = all.slice(0, filter.limit);
  return all;
}

export async function get(id: string): Promise<AppNotification | undefined> {
  return db.get<AppNotification>(STORE_NOTIFICATIONS, id);
}

export async function getUnreadCount(): Promise<number> {
  const all = await loadAll();
  return all.filter((n) => n.status === 'unread').length;
}

export async function markAsRead(id: string): Promise<void> {
  const n = await db.get<AppNotification>(STORE_NOTIFICATIONS, id);
  if (!n) return;
  if (n.status === 'unread') {
    n.status = 'read';
    n.readAt = Date.now();
    await db.put<AppNotification>(STORE_NOTIFICATIONS, n);
    await emit();
  }
}

export async function markAllAsRead(): Promise<number> {
  const all = await loadAll();
  const now = Date.now();
  let count = 0;
  for (const n of all) {
    if (n.status === 'unread') {
      n.status = 'read';
      n.readAt = now;
      await db.put<AppNotification>(STORE_NOTIFICATIONS, n);
      count++;
    }
  }
  if (count > 0) await emit();
  return count;
}

export async function archive(id: string): Promise<void> {
  const n = await db.get<AppNotification>(STORE_NOTIFICATIONS, id);
  if (!n) return;
  n.status = 'archived';
  n.archivedAt = Date.now();
  await db.put<AppNotification>(STORE_NOTIFICATIONS, n);
  await emit();
}

export async function archiveAll(): Promise<number> {
  const all = await loadAll();
  const now = Date.now();
  let count = 0;
  for (const n of all) {
    if (n.status !== 'archived') {
      n.status = 'archived';
      n.archivedAt = now;
      await db.put<AppNotification>(STORE_NOTIFICATIONS, n);
      count++;
    }
  }
  if (count > 0) await emit();
  return count;
}

export async function deleteNotification(id: string): Promise<void> {
  await db.del(STORE_NOTIFICATIONS, id);
  await emit();
}

export async function clearAll(): Promise<void> {
  await db.clear(STORE_NOTIFICATIONS);
  await emit();
}

export function onNotificationsChange(handler: (n: AppNotification[]) => void): () => void {
  listeners.push(handler);
  void loadAll().then((all) => handler(all));
  return () => {
    listeners = listeners.filter((l) => l !== handler);
  };
}

export interface FileEvent {
  type: 'new-file' | 'new-version' | 'deleted' | 'restored';
  fileId: string;
  fileName: string;
}

export async function notifyFileEvent(ev: FileEvent): Promise<void> {
  const map: Record<FileEvent['type'], { title: string; severity: NotificationSeverity; category: NotificationCategory }> = {
    'new-file': { title: 'Novo arquivo', severity: 'success', category: 'file' },
    'new-version': { title: 'Nova versão', severity: 'info', category: 'version' },
    deleted: { title: 'Arquivo excluído', severity: 'warning', category: 'file' },
    restored: { title: 'Arquivo restaurado', severity: 'success', category: 'file' },
  };
  const m = map[ev.type];
  await createNotification({
    category: m.category,
    severity: m.severity,
    title: m.title,
    message: ev.fileName,
    actionUrl: `/files/${ev.fileId}`,
    metadata: { fileId: ev.fileId, eventType: ev.type },
  });
}

export interface SyncEvent {
  type: 'sync-error' | 'sync-recovered' | 'conflict' | 'queued' | 'completed';
  message: string;
  fileId?: string;
  fileName?: string;
}

export async function notifySyncEvent(ev: SyncEvent): Promise<void> {
  const map: Record<SyncEvent['type'], { title: string; severity: NotificationSeverity; category: NotificationCategory }> = {
    'sync-error': { title: 'Erro de sincronização', severity: 'error', category: 'sync' },
    'sync-recovered': { title: 'Sincronização recuperada', severity: 'success', category: 'sync' },
    conflict: { title: 'Conflito detectado', severity: 'warning', category: 'conflict' },
    queued: { title: 'Operação na fila', severity: 'info', category: 'sync' },
    completed: { title: 'Sincronização concluída', severity: 'success', category: 'sync' },
  };
  const m = map[ev.type];
  await createNotification({
    category: m.category,
    severity: m.severity,
    title: m.title,
    message: ev.message,
    actionUrl: ev.fileId ? `/files/${ev.fileId}` : undefined,
    metadata: { fileId: ev.fileId, eventType: ev.type },
  });
}
