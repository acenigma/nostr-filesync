import { useEffect, useState, useCallback } from 'react';
import * as notifications from '../services/notifications';
import type { AppNotification, NotificationStatus } from '../services/notifications';
import { useBrowserNotifications } from '../hooks/useBrowserNotifications';
import './NotificationCenter.css';

interface Props {
  onClose: () => void;
}

type Tab = 'unread' | 'read' | 'archived';

const SEVERITY_ICON: Record<string, string> = {
  info: 'ℹ️',
  success: '✅',
  warning: '⚠️',
  error: '❌',
};

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'agora';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}min`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

export default function NotificationCenter({ onClose }: Props) {
  const [list, setList] = useState<AppNotification[]>([]);
  const [tab, setTab] = useState<Tab>('unread');
  const [busy, setBusy] = useState(false);
  const browser = useBrowserNotifications();

  const refresh = useCallback(async () => {
    const status: NotificationStatus = tab;
    const items = await notifications.listNotifications({ status });
    setList(items);
  }, [tab]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const off = notifications.onNotificationsChange(() => {
      void refresh();
    });
    return off;
  }, [refresh]);

  const unreadCount = list.filter((n) => n.status === 'unread').length;

  const handleMarkAll = async () => {
    setBusy(true);
    try {
      await notifications.markAllAsRead();
    } finally {
      setBusy(false);
    }
  };

  const handleArchiveAll = async () => {
    setBusy(true);
    try {
      await notifications.archiveAll();
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    if (!confirm('Excluir todas as notificações?')) return;
    setBusy(true);
    try {
      await notifications.clearAll();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="notification-center-overlay" onClick={onClose}>
      <div className="notification-center" onClick={(e) => e.stopPropagation()}>
        <header className="notification-center-header">
          <h2>🔔 Notificações</h2>
          <button className="close-btn" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </header>

        {!browser.supported && (
          <div className="notif-hint">Notificações do navegador não suportadas neste dispositivo.</div>
        )}
        {browser.supported && browser.permission === 'default' && (
          <button
            className="action-btn primary"
            onClick={() => void browser.request()}
            style={{ width: '100%', marginBottom: 12 }}
          >
            🔔 Ativar notificações do navegador
          </button>
        )}
        {browser.supported && browser.permission === 'granted' && (
          <div className="notif-hint success">✅ Notificações do navegador ativadas</div>
        )}
        {browser.supported && browser.permission === 'denied' && (
          <div className="notif-hint warning">Notificações do navegador bloqueadas.</div>
        )}

        <div className="notif-tabs" role="tablist">
          <button
            className={`notif-tab ${tab === 'unread' ? 'active' : ''}`}
            onClick={() => setTab('unread')}
            role="tab"
            aria-selected={tab === 'unread'}
          >
            Não lidas
          </button>
          <button
            className={`notif-tab ${tab === 'read' ? 'active' : ''}`}
            onClick={() => setTab('read')}
            role="tab"
            aria-selected={tab === 'read'}
          >
            Lidas
          </button>
          <button
            className={`notif-tab ${tab === 'archived' ? 'active' : ''}`}
            onClick={() => setTab('archived')}
            role="tab"
            aria-selected={tab === 'archived'}
          >
            Arquivadas
          </button>
        </div>

        <div className="notif-toolbar">
          {tab === 'unread' && unreadCount > 0 && (
            <button className="text-btn" onClick={handleMarkAll} disabled={busy}>
              Marcar todas como lidas
            </button>
          )}
          {tab !== 'archived' && list.length > 0 && (
            <button className="text-btn" onClick={handleArchiveAll} disabled={busy}>
              Arquivar todas
            </button>
          )}
          {list.length > 0 && (
            <button className="text-btn danger" onClick={handleClear} disabled={busy}>
              Excluir todas
            </button>
          )}
        </div>

        <ul className="notif-list">
          {list.length === 0 && <li className="notif-empty">Nenhuma notificação.</li>}
          {list.map((n) => (
            <li key={n.id} className={`notif-item severity-${n.severity}`}>
              <span className="notif-icon">{SEVERITY_ICON[n.severity] || 'ℹ️'}</span>
              <div className="notif-body">
                <div className="notif-title">{n.title}</div>
                <div className="notif-message">{n.message}</div>
                <div className="notif-meta">
                  {n.category} · {formatRelative(n.createdAt)}
                </div>
              </div>
              <div className="notif-actions">
                {n.status === 'unread' && (
                  <button
                    className="text-btn"
                    onClick={() => void notifications.markAsRead(n.id)}
                  >
                    Marcar lida
                  </button>
                )}
                {n.status !== 'archived' && (
                  <button
                    className="text-btn"
                    onClick={() => void notifications.archive(n.id)}
                  >
                    Arquivar
                  </button>
                )}
                <button
                  className="text-btn danger"
                  onClick={() => void notifications.deleteNotification(n.id)}
                >
                  Excluir
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
