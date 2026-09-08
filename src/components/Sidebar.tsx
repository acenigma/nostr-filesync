import { useEffect, useState } from 'react';
import { useT } from '../hooks/useT';
import './Sidebar.css';

export interface NavItem {
  id: string;
  label: string;
  icon: string;
  badge?: number;
  active?: boolean;
  onClick: () => void;
}

interface SidebarProps {
  items: NavItem[];
  userNpub?: string;
  onUpload?: () => void;
  onSettings?: () => void;
  onThemeToggle: () => void;
  theme: 'light' | 'dark';
}

export function Sidebar({
  items,
  userNpub,
  onUpload,
  onSettings,
  onThemeToggle,
  theme,
}: SidebarProps) {
  const { t } = useT();
  const [storageUsed, setStorageUsed] = useState(0);
  const [storageTotal] = useState(10 * 1024 * 1024 * 1024);

  useEffect(() => {
    let mounted = true;
    const tick = async () => {
      try {
        const { getStorageEstimate } = await import('../services/storage');
        const est = await getStorageEstimate();
        if (mounted && est) setStorageUsed(est.usage);
      } catch {
        /* ignore */
      }
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  const pct = storageTotal > 0 ? Math.min(100, (storageUsed / storageTotal) * 100) : 0;

  return (
    <aside className="sidebar" aria-label="Navegação principal">
      <div className="sidebar-logo">
        <span className="sidebar-logo-mark">✦</span>
        <span className="sidebar-logo-text">Nostr FileSync</span>
      </div>

      <nav className="sidebar-nav" aria-label="Seções">
        <ul className="sidebar-nav-list">
          {items.map((item) => (
            <li key={item.id}>
              <button
                className={`sidebar-item ${item.active ? 'active' : ''}`}
                onClick={item.onClick}
                aria-current={item.active ? 'page' : undefined}
              >
                <span className="sidebar-item-icon" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="sidebar-item-label">{item.label}</span>
                {item.badge != null && item.badge > 0 && (
                  <span className="sidebar-item-badge">{item.badge > 99 ? '99+' : item.badge}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="sidebar-footer">
        <button className="sidebar-fab" onClick={onUpload} title={t('upload_title')} aria-label={t('upload_title')}>
          <span aria-hidden="true">⬆</span>
        </button>

        <div className="sidebar-storage">
          <div className="sidebar-storage-head">
            <span className="sidebar-storage-label">{t('storage')}</span>
            <span className="sidebar-storage-pct">{Math.round(pct)}%</span>
          </div>
          <div className="sidebar-storage-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="sidebar-storage-bar-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>

        <div className="sidebar-user" title={userNpub}>
          <span className="sidebar-user-avatar" aria-hidden="true">
            {(userNpub || '?').slice(0, 1).toUpperCase()}
          </span>
          <span className="sidebar-user-npub">
            {userNpub ? `${userNpub.slice(0, 8)}…${userNpub.slice(-4)}` : '—'}
          </span>
        </div>

        <div className="sidebar-actions">
          <button
            className="sidebar-action"
            onClick={onThemeToggle}
            title={theme === 'dark' ? t('theme_dark_to') : t('theme_light_to')}
            aria-label={theme === 'dark' ? t('theme_dark_to') : t('theme_light_to')}
          >
            <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
          </button>
          <button
            className="sidebar-action"
            onClick={onSettings}
            title={t('settings_title')}
            aria-label={t('settings_title')}
          >
            <span aria-hidden="true">⚙</span>
          </button>
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;