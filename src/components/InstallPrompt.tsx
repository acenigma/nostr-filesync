import { useState } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import './InstallPrompt.css';

interface Props {
  onClose: () => void;
}

export default function InstallPrompt({ onClose }: Props) {
  const { installable, ios, promptInstall } = usePWAInstall();
  const [busy, setBusy] = useState(false);
  const [showIosHelp, setShowIosHelp] = useState(false);

  if (!installable && !ios) {
    return null;
  }

  const handleInstall = async () => {
    if (ios) {
      setShowIosHelp(true);
      return;
    }
    setBusy(true);
    try {
      await promptInstall();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="install-prompt-overlay" role="dialog" aria-modal="true">
      <div className="install-prompt-card">
        <button className="install-prompt-close" onClick={onClose} aria-label="Fechar">
          ×
        </button>
        <h2>📲 Instalar Nostr FileSync</h2>
        <p className="install-prompt-desc">
          Instale o app para acesso rápido, funcionamento offline e sincronização em segundo plano.
        </p>

        {showIosHelp ? (
          <div className="ios-instructions">
            <p>
              No Safari, toque em <strong>Compartilhar</strong> <span aria-hidden>⬆️</span> e depois em{' '}
              <strong>Adicionar à Tela de Início</strong> <span aria-hidden>➕</span>.
            </p>
            <p className="hint">
              Abra esta página no Safari (iOS) para instalar. Outros navegadores no iOS não suportam instalação.
            </p>
            <button className="action-btn" onClick={onClose}>
              Entendi
            </button>
          </div>
        ) : (
          <div className="install-prompt-actions">
            <button
              className="action-btn primary"
              onClick={() => void handleInstall()}
              disabled={busy}
            >
              {busy ? 'Instalando...' : 'Instalar'}
            </button>
            <button className="action-btn" onClick={onClose}>
              Agora não
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
