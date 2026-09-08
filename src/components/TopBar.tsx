import { useState, useEffect, useCallback } from 'react';
import { useT } from '../hooks/useT';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import './TopBar.css';

export interface TopBarProps {
  onMenu: () => void;
  onSearch: (q: string) => void;
  onNotifications: () => void;
  onUpload: () => void;
  onSettings: () => void;
  onThemeToggle: () => void;
  theme: 'light' | 'dark';
  unreadCount: number;
  userNpub?: string;
  searchValue?: string;
}

export function TopBar({
  onMenu,
  onSearch,
  onNotifications,
  onUpload,
  onSettings,
  onThemeToggle,
  theme,
  unreadCount,
  userNpub,
  searchValue = '',
}: TopBarProps) {
  const { t } = useT();
  const { online } = useOnlineStatus();
  const [query, setQuery] = useState(searchValue);

  useEffect(() => {
    setQuery(searchValue);
  }, [searchValue]);

  const commitSearch = useCallback(
    (v: string) => {
      setQuery(v);
      onSearch(v);
    },
    [onSearch]
  );

  return (
    <header className="topbar" role="banner">
      <div className="topbar-row">
        <button
          className="topbar-menu"
          onClick={onMenu}
          aria-label={t('menu')}
          aria-expanded={false}
        >
          <span aria-hidden="true">☰</span>
        </button>

        <button className="topbar-logo" onClick={onUpload} aria-label={t('upload_title')}>
          <span aria-hidden="true">✦</span>
          <span className="topbar-logo-text">Nostr FileSync</span>
        </button>

        <div className="topbar-actions">
          {!online && (
            <span className="topbar-offline" title="Offline" aria-label="Offline">
              ●
            </span>
          )}
          <button
            className="topbar-icon"
            onClick={onThemeToggle}
            title={theme === 'dark' ? t('theme_dark_to') : t('theme_light_to')}
            aria-label={theme === 'dark' ? t('theme_dark_to') : t('theme_light_to')}
          >
            <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
          </button>
          <button
            className="topbar-icon topbar-bell"
            onClick={onNotifications}
            title="Notificações"
            aria-label="Notificações"
          >
            <span aria-hidden="true">🔔</span>
            {unreadCount > 0 && (
              <span className="topbar-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
            )}
          </button>
          <button
            className="topbar-icon"
            onClick={onSettings}
            title={t('settings_title')}
            aria-label={t('settings_title')}
          >
            <span aria-hidden="true">⚙</span>
          </button>
        </div>
      </div>

      <div className="topbar-search">
        <input
          type="search"
          className="topbar-search-input"
          placeholder={t('search')}
          value={query}
          onChange={(e) => commitSearch(e.target.value)}
          aria-label={t('search')}
        />
        <button className="topbar-search-btn" onClick={onUpload} aria-label={t('upload_title')}>
          <span aria-hidden="true">⬆</span>
        </button>
      </div>

      {userNpub && (
        <div className="topbar-user" title={userNpub}>
          <span className="topbar-user-avatar" aria-hidden="true">
            {userNpub.slice(0, 1).toUpperCase()}
          </span>
          <span className="topbar-user-npub">
            {userNpub.slice(0, 6)}…{userNpub.slice(-4)}
          </span>
        </div>
      )}
    </header>
  );
}

export default TopBar;