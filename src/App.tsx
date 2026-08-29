import { useState, useEffect } from 'react';
import * as nostr from './services/nostr';
import * as filesync from './services/filesync';
import * as uploadState from './services/uploadState';
import TodoList from './components/TodoList';
import FileSync from './components/FileSync';
import Unlock from './components/Unlock';
import Settings from './components/Settings';
import { useTheme } from './hooks/useTheme';
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
  const { theme, toggle: toggleTheme } = useTheme();

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

  if (authPhase !== 'unlocked') {
    return <Unlock />;
  }

  return (
    <div className="app">
      <nav className="top-nav">
        <button
          className={`nav-btn ${view === 'sync' ? 'active' : ''}`}
          onClick={() => setView('sync')}
        >
          📁 Arquivos
        </button>
        <button
          className={`nav-btn ${view === 'todo' ? 'active' : ''}`}
          onClick={() => setView('todo')}
        >
          📝 Tarefas
        </button>
        <div className="nav-spacer" />
        <button
          className="nav-icon-btn"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
          aria-label="Alternar tema"
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
        <button
          className="nav-icon-btn"
          onClick={() => setShowSettings(true)}
          title="Configurações"
          aria-label="Configurações"
        >
          ⚙
        </button>
      </nav>
      <div className="app-npub" title={npub}>
        {npub.slice(0, 12)}…{npub.slice(-6)}
      </div>
      {view === 'sync' ? <FileSync /> : <TodoList />}
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
    </div>
  );
}

export default App;