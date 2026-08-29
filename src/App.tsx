import { useState, useEffect, useRef } from 'react';
import * as nostr from './services/nostr';
import * as filesync from './services/filesync';
import * as uploadState from './services/uploadState';
import TodoList from './components/TodoList';
import FileSync from './components/FileSync';
import Unlock from './components/Unlock';
import Settings from './components/Settings';
import { useTheme } from './hooks/useTheme';
import { useShortcuts } from './hooks/useShortcuts';
import { useT } from './hooks/useT';
import './App.css';

type View = 'sync' | 'todo';

function App() {
  const [authPhase, setAuthPhase] = useState<nostr.AuthPhase>('unknown');
  const [view, setView] = useState<View>(() => {
    const params = new URLSearchParams(window.location.search);
    const v = params.get('view');
    return v === 'todo' ? 'todo' : 'sync';
  });
  const [showSettings, setShowSettings] = useState(false);
  const [npub, setNpub] = useState('');
  const [globalProgress, setGlobalProgress] = useState<{ pct: number; label: string } | null>(null);
  const { theme, toggle: toggleTheme } = useTheme();
  const { t } = useT();
  const viewRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    filesync.migrateFilesFromLegacy().catch(() => {});
    uploadState.migrateFromLegacy().catch(() => {});
  }, []);

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
      <div ref={viewRef} className="view-root">
        <ViewSlot view={view} onProgress={setGlobalProgress} />
      </div>
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
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