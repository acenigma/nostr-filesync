import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import * as nostr from './services/nostr';
import * as filesync from './services/filesync';
import * as uploadState from './services/uploadState';
import * as swMessaging from './services/swMessaging';
import * as backgroundSync from './services/backgroundSync';
import * as notifications from './services/notifications';
import * as blossomHealth from './services/blossom/healthScheduler';
import * as blossom from './services/blossom';
import Unlock from './components/Unlock';
import InstallPrompt from './components/InstallPrompt';
import OnlineIndicator from './components/OnlineIndicator';
import MobileResourceIndicator from './components/MobileResourceIndicator';
import { useTheme } from './hooks/useTheme';
import { useShortcuts } from './hooks/useShortcuts';
import { useT } from './hooks/useT';
import { usePWAInstall } from './hooks/usePWAInstall';
import './App.css';

const FileSync = lazy(() => import('./components/FileSync'));
const TodoList = lazy(() => import('./components/TodoList'));
const Settings = lazy(() => import('./components/Settings'));
const NotificationCenter = lazy(() => import('./components/NotificationCenter'));

type View = 'sync' | 'todo';

function App() {
  const [authPhase, setAuthPhase] = useState<nostr.AuthPhase>('unknown');
  const [view, setView] = useState<View>(() => {
    const params = new URLSearchParams(window.location.search);
    const v = params.get('view');
    return v === 'todo' ? 'todo' : 'sync';
  });
  const [showSettings, setShowSettings] = useState(false);
  const [showNotif, setShowNotif] = useState(false);
  const [npub, setNpub] = useState('');
  const [globalProgress, setGlobalProgress] = useState<{ pct: number; label: string } | null>(null);
  const [showInstall, setShowInstall] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const { theme, toggle: toggleTheme } = useTheme();
  const { t } = useT();
  const { installable, installed } = usePWAInstall();
  const viewRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (authPhase !== 'unlocked') return;
    backgroundSync.startBackgroundSync();
    blossomHealth.startHealthScheduler();
    void blossom.runHealthChecks();
    return () => {
      backgroundSync.stopBackgroundSync();
      blossomHealth.stopHealthScheduler();
    };
  }, [authPhase]);

  useEffect(() => {
    if (authPhase !== 'unlocked') return;
    void notifications.getUnreadCount().then(setUnreadCount);
    const off = notifications.onNotificationsChange((all) => {
      setUnreadCount(all.filter((n) => n.status === 'unread').length);
    });
    return off;
  }, [authPhase]);

  useEffect(() => {
    swMessaging.initServiceWorkerMessaging();
    const off = swMessaging.onSwMessage((msg) => {
      if (msg.type === 'SYNC_NOW') {
        filesync.resumePendingUploads().catch(() => {});
      }
    });
    return off;
  }, []);

  useEffect(() => {
    filesync.migrateFilesFromLegacy().catch(() => {});
    uploadState.migrateFromLegacy().catch(() => {});
  }, []);

  useEffect(() => {
    if (authPhase !== 'unlocked') return;
    if (installed) return;
    const dismissed = sessionStorage.getItem('nostr_filesync_install_dismissed');
    if (dismissed) return;
    const t = setTimeout(() => {
      if (installable && !installed) setShowInstall(true);
    }, 30000);
    return () => clearTimeout(t);
  }, [authPhase, installable, installed]);

  useEffect(() => {
    const unsubAuth = nostr.onAuthChange((s) => {
      setAuthPhase(s.phase);
      if (s.phase === 'unlocked') {
        setNpub(nostr.getNpub() || '');
      }
    });
    nostr.checkStoredCredential();
    return unsubAuth;
  }, []);

  useEffect(() => {
    if (authPhase !== 'unlocked') return;
    filesync.bindNostr(nostr);
    filesync.resumePendingUploads().catch(() => {});
  }, [authPhase]);

  useShortcuts(
    [
      {
        key: 'n',
        when: () => view === 'todo',
        handler: () => {
          const input = viewRef.current?.querySelector<HTMLInputElement>('.todo-input');
          input?.focus();
        },
      },
      {
        key: '/',
        when: () => view === 'sync',
        handler: () => {
          const input = viewRef.current?.querySelector<HTMLInputElement>('.search-input');
          input?.focus();
          input?.select();
        },
      },
      {
        key: 'Escape',
        handler: () => {
          if (showSettings) setShowSettings(false);
        },
      },
    ],
    authPhase === 'unlocked'
  );

  if (authPhase !== 'unlocked') {
    return <Unlock />;
  }

  return (
    <div className="app">
      {globalProgress && (
        <div
          className="global-progress"
          role="progressbar"
          aria-valuenow={Math.round(globalProgress.pct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={globalProgress.label}
        >
          <div className="global-progress-fill" style={{ width: `${globalProgress.pct}%` }} />
        </div>
      )}
      <nav className="top-nav">
        <button
          className={`nav-btn ${view === 'sync' ? 'active' : ''}`}
          onClick={() => setView('sync')}
        >
          {t('nav_files')}
        </button>
        <button
          className={`nav-btn ${view === 'todo' ? 'active' : ''}`}
          onClick={() => setView('todo')}
        >
          {t('nav_tasks')}
        </button>
        <div className="nav-spacer" />
        <button
          className="nav-icon-btn nav-bell-btn"
          onClick={() => setShowNotif(true)}
          title="Notificações"
          aria-label="Notificações"
        >
          🔔
          {unreadCount > 0 && <span className="nav-bell-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
        </button>
        {installable && !installed && (
          <button
            className="nav-icon-btn"
            onClick={() => setShowInstall(true)}
            title="Instalar app"
            aria-label="Instalar app"
          >
            📲
          </button>
        )}
        <button
          className="nav-icon-btn"
          onClick={toggleTheme}
          title={theme === 'dark' ? t('theme_dark_to') : t('theme_light_to')}
          aria-label={theme === 'dark' ? t('theme_dark_to') : t('theme_light_to')}
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
        <button
          className="nav-icon-btn"
          onClick={() => setShowSettings(true)}
          title={t('settings_title')}
          aria-label={t('settings_title')}
        >
          ⚙
        </button>
      </nav>
      <div className="app-npub" title={npub}>
        {npub.slice(0, 12)}…{npub.slice(-6)}
      </div>
      <OnlineIndicator />
      <MobileResourceIndicator />
      <div ref={viewRef} className="view-root">
        <Suspense fallback={<div className="view-loading">Carregando...</div>}>
          <ViewSlot view={view} onProgress={setGlobalProgress} />
        </Suspense>
      </div>
      {showSettings && (
        <Suspense fallback={null}>
          <Settings onClose={() => setShowSettings(false)} />
        </Suspense>
      )}
      {showNotif && (
        <Suspense fallback={null}>
          <NotificationCenter onClose={() => setShowNotif(false)} />
        </Suspense>
      )}
      {showInstall && (
        <InstallPrompt
          onClose={() => {
            sessionStorage.setItem('nostr_filesync_install_dismissed', '1');
            setShowInstall(false);
          }}
        />
      )}
    </div>
  );
}

interface ViewSlotProps {
  view: View;
  onProgress: (p: { pct: number; label: string } | null) => void;
}

function ViewSlot({ view, onProgress }: ViewSlotProps) {
  if (view === 'sync') {
    return <FileSync onProgress={onProgress} />;
  }
  return <TodoList />;
}

export default App;