import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

(function applyInitialTheme() {
  const stored = localStorage.getItem('nostr_filesync_theme');
  const theme =
    stored === 'light' || stored === 'dark'
      ? stored
      : window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
  document.documentElement.setAttribute('data-theme', theme);
})();

const root = document.getElementById('root');
if (!root) throw new Error('root element não encontrado');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
