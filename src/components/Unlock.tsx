import { useState, useEffect, useMemo } from 'react';
import * as nostr from '../services/nostr';
import QRScanner from './QRScanner';
import MnemonicSetup from './MnemonicSetup';
import './Unlock.css';

type Mode = 'loading' | 'setup' | 'locked' | 'migrate' | 'import' | 'unlocked';
type UnlockTab = 'password' | 'mnemonic';
type DetectedFormat = 'nsec' | 'ncryptsec' | 'hex' | 'mnemonic' | 'invalid';

interface Info {
  npub: string;
  source?: string;
}

export default function Unlock() {
  const [mode, setMode] = useState<Mode>('loading');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [importInput, setImportInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<Info | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [createdMnemonic, setCreatedMnemonic] = useState<string | null>(null);
  const [unlockTab, setUnlockTab] = useState<UnlockTab>('password');
  const [mnemonicInput, setMnemonicInput] = useState('');
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);

  useEffect(() => {
    const unsub = nostr.onAuthChange((s) => {
      if (s.phase === 'setup') setMode('setup');
      else if (s.phase === 'locked') setMode('locked');
      else if (s.phase === 'plain') setMode('migrate');
      else if (s.phase === 'unlocked') setMode('unlocked');
    });
    nostr.checkStoredCredential();
    return unsub;
  }, []);

  const detectedFormat = useMemo<DetectedFormat | null>(
    () => detectFormat(importInput),
    [importInput]
  );

  function validatePasswordPair(password: string, confirm: string): string | null {
  if (password.length < 6) return 'Senha deve ter pelo menos 6 caracteres';
  if (password !== confirm) return 'As senhas não coincidem';
  return null;
}

const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const pwError = validatePasswordPair(password, confirmPassword);
    if (pwError) {
      setError(pwError);
      return;
    }
    setBusy(true);
    try {
      const result = await nostr.createNewIdentity(password);
      setInfo({ npub: result.npub });
      setCreatedMnemonic(result.mnemonic || null);
    } catch {
      setError('Falha ao criar identidade');
    } finally {
      setBusy(false);
    }
  };

  const handleUnlockMnemonic = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const phrase = mnemonicInput.trim();
    if (!nostr.isValidMnemonic(phrase)) {
      setError('Frase inválida — verifique as 12 palavras e o checksum');
      return;
    }
    setBusy(true);
    try {
      await nostr.unlockWithMnemonic(phrase);
    } catch (e) {
      setError((e as Error).message || 'Frase não corresponde a esta identidade');
    } finally {
      setBusy(false);
    }
  };

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await nostr.unlockWithPassword(password);
    } catch {
      setError('Senha incorreta ou credencial corrompida');
    } finally {
      setBusy(false);
    }
  };

  const handleMigrate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const pwError = validatePasswordPair(password, confirmPassword);
    if (pwError) {
      setError(pwError);
      return;
    }
    setBusy(true);
    try {
      await nostr.migratePlainToEncrypted(password);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const pwError = validatePasswordPair(password, confirmPassword);
    if (pwError) {
      setError(pwError);
      return;
    }
    if (detectedFormat === 'ncryptsec' && !currentPassword) {
      setError('Esta chave está criptografada — informe a senha original');
      return;
    }
    if (nostr.hasStoredCredential() && !confirmOverwrite) {
      setConfirmOverwrite(true);
      return;
    }
    await doImport();
  };

  const doImport = async () => {
    setBusy(true);
    try {
      const result = await nostr.importCredential(importInput.trim(), password, currentPassword);
      setInfo({ npub: result.npub, source: result.source });
      setConfirmOverwrite(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleScannerResult = (text: string) => {
    setShowScanner(false);
    setImportInput(text.trim());
    setMode('import');
    setError(null);
  };

  const resetImport = () => {
    setImportInput('');
    setPassword('');
    setConfirmPassword('');
    setCurrentPassword('');
    setError(null);
    setInfo(null);
    setConfirmOverwrite(false);
  };

  if (mode === 'loading') {
    return <div className="unlock-screen">Carregando...</div>;
  }

  if (mode === 'unlocked') {
    return null;
  }

  return (
    <div className="unlock-screen">
      <div className="unlock-card">
        <h1>🔐 Nostr FileSync</h1>

        {mode === 'setup' && createdMnemonic && (
          <MnemonicSetup
            mnemonic={createdMnemonic}
            onConfirm={() => setCreatedMnemonic(null)}
          />
        )}

        {mode === 'setup' && !createdMnemonic && (
          <>
            <p className="unlock-subtitle">Bem-vindo! Crie sua identidade Nostr local.</p>
            <div className="setup-info-banner">
              🔑 Ao criar, você receberá <strong>12 palavras de recuperação</strong> (BIP-39).
              Anote-as — são a única forma de recuperar a conta se esquecer a senha.
            </div>
            <form onSubmit={handleCreate} className="unlock-form">
              <label>Senha (criptografa sua chave localmente)</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                autoComplete="new-password"
                disabled={busy}
              />
              <label>Confirme a senha</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repita a senha"
                autoComplete="new-password"
                disabled={busy}
              />
              {error && <div className="unlock-error">{error}</div>}
              <button type="submit" className="unlock-btn" disabled={busy}>
                {busy ? 'Criando...' : 'Criar identidade'}
              </button>
            </form>
            <div className="unlock-divider">ou</div>
            <button
              className="unlock-link-btn"
              onClick={() => {
                setMode('import');
                setError(null);
              }}
            >
              Importar chave existente
            </button>
            {info && !createdMnemonic && (
              <div className="unlock-info">
                <strong>Identidade criada!</strong>
                <p>Sua chave pública (anote para referência):</p>
                <code>{info.npub}</code>
              </div>
            )}
          </>
        )}

        {mode === 'locked' && (
          <>
            <p className="unlock-subtitle">Desbloqueie sua identidade</p>
            <div className="tab-bar">
              <button
                className={`tab-btn ${unlockTab === 'password' ? 'active' : ''}`}
                onClick={() => {
                  setUnlockTab('password');
                  setError(null);
                }}
              >
                Senha
              </button>
              <button
                className={`tab-btn ${unlockTab === 'mnemonic' ? 'active' : ''}`}
                onClick={() => {
                  setUnlockTab('mnemonic');
                  setError(null);
                }}
              >
                Frase de 12 palavras
              </button>
            </div>
            {unlockTab === 'password' ? (
              <form onSubmit={handleUnlock} className="unlock-form">
                <label>Senha</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Sua senha"
                  autoComplete="current-password"
                  autoFocus
                  disabled={busy}
                />
                {error && <div className="unlock-error">{error}</div>}
                <button type="submit" className="unlock-btn" disabled={busy}>
                  {busy ? 'Desbloqueando...' : 'Desbloquear'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleUnlockMnemonic} className="unlock-form">
                <label>Cole as 12 palavras separadas por espaço</label>
                <textarea
                  value={mnemonicInput}
                  onChange={(e) => setMnemonicInput(e.target.value)}
                  placeholder="palavra1 palavra2 ... palavra12"
                  rows={3}
                  autoFocus
                  disabled={busy}
                  spellCheck={false}
                />
                {error && <div className="unlock-error">{error}</div>}
                <button
                  type="submit"
                  className="unlock-btn"
                  disabled={busy || !nostr.isValidMnemonic(mnemonicInput)}
                >
                  {busy ? 'Desbloqueando...' : 'Desbloquear com frase'}
                </button>
              </form>
            )}
            <div className="unlock-divider">ou</div>
            <button
              className="unlock-link-btn"
              onClick={() => {
                setMode('import');
                resetImport();
              }}
            >
              Importar outra chave
            </button>
            <button
              className="unlock-link-btn danger"
              onClick={() => {
                if (confirm('Isso vai apagar sua identidade atual e gerar uma nova. Continuar?')) {
                  localStorage.removeItem('nostr_todo_privkey');
                  localStorage.removeItem('nostr_todo_mnemonic_hint');
                  window.location.reload();
                }
              }}
            >
              Esqueci tudo (resetar)
            </button>
          </>
        )}

        {mode === 'migrate' && (
          <>
            <p className="unlock-subtitle">
              Sua chave está salva sem criptografia. Defina uma senha para protegê-la.
            </p>
            <form onSubmit={handleMigrate} className="unlock-form">
              <label>Senha</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                autoComplete="new-password"
                disabled={busy}
              />
              <label>Confirme a senha</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repita a senha"
                autoComplete="new-password"
                disabled={busy}
              />
              {error && <div className="unlock-error">{error}</div>}
              <button type="submit" className="unlock-btn" disabled={busy}>
                {busy ? 'Criptografando...' : 'Proteger com senha'}
              </button>
              <button
                type="button"
                className="unlock-link-btn"
                onClick={() => {
                  setMode('setup');
                  setPassword('');
                  setConfirmPassword('');
                }}
              >
                Cancelar
              </button>
            </form>
          </>
        )}

        {mode === 'import' && (
          <>
            <p className="unlock-subtitle">
              Importe uma chave de outro app, device ou backup
            </p>
            <form onSubmit={handleImport} className="unlock-form">
              <div className="input-with-action">
                <label>Chave (12 palavras, nsec, ncryptsec ou hex de 64 caracteres)</label>
                <button
                  type="button"
                  className="qr-btn"
                  onClick={() => setShowScanner(true)}
                  disabled={busy}
                >
                  📷 Ler QR
                </button>
              </div>
              <textarea
                value={importInput}
                onChange={(e) => setImportInput(e.target.value)}
                placeholder="Cole aqui ou escaneie um QR"
                rows={3}
                disabled={busy}
                autoFocus
              />
              {detectedFormat && (
                <div className="format-hint">
                  <span className={`format-badge ${detectedFormat}`}>
                    {formatLabel(detectedFormat)}
                  </span>
                  {detectedFormat === 'ncryptsec' && (
                    <span> — informe a senha original abaixo</span>
                  )}
                </div>
              )}
              {detectedFormat === 'ncryptsec' && (
                <>
                  <label>Senha da chave original</label>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Senha usada para criptografar"
                    autoComplete="current-password"
                    disabled={busy}
                  />
                </>
              )}
              <label>Nova senha para proteger localmente</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                autoComplete="new-password"
                disabled={busy}
              />
              <label>Confirme a nova senha</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repita a senha"
                autoComplete="new-password"
                disabled={busy}
              />
              {error && <div className="unlock-error">{error}</div>}
              <button
                type="submit"
                className="unlock-btn"
                disabled={busy || !isImportSubmittable(detectedFormat, importInput)}
              >
                {busy ? 'Importando...' : 'Importar'}
              </button>
              <button
                type="button"
                className="unlock-link-btn"
                onClick={() => {
                  setMode('setup');
                  resetImport();
                }}
              >
                Voltar
              </button>
            </form>
            {info && (
              <div className="unlock-info">
                <strong>Importado com sucesso!</strong>
                <p>Fonte: {formatLabel(info.source as DetectedFormat)}</p>
                <p>Sua chave pública:</p>
                <code>{info.npub}</code>
              </div>
            )}
            {confirmOverwrite && (
              <div className="confirm-overlay" role="dialog" aria-modal="true">
                <div className="confirm-card">
                  <h3>Substituir identidade atual?</h3>
                  <p>
                    Já existe uma identidade salva neste dispositivo. Importar outra chave
                    removerá a atual <strong>permanentemente deste dispositivo</strong> (os
                    relays continuam com seus eventos).
                  </p>
                  <div className="confirm-actions">
                    <button
                      type="button"
                      className="unlock-link-btn"
                      onClick={() => setConfirmOverwrite(false)}
                      disabled={busy}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      className="unlock-btn danger"
                      onClick={() => {
                        setConfirmOverwrite(false);
                        void doImport();
                      }}
                      disabled={busy}
                    >
                      {busy ? 'Importando...' : 'Substituir'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {showScanner && (
        <QRScanner
          onResult={handleScannerResult}
          onClose={() => setShowScanner(false)}
        />
      )}
    </div>
  );
}

function detectFormat(input: string): DetectedFormat | null {
  const v = input.trim();
  if (!v) return null;
  if (v.startsWith('nsec1')) return 'nsec';
  if (v.startsWith('ncryptsec1')) return 'ncryptsec';
  if (/^[0-9a-fA-F]{64}$/.test(v)) return 'hex';
  const words = v.split(/\s+/).filter(Boolean);
  if (words.length === 12 || words.length === 24) return 'mnemonic';
  return 'invalid';
}

function isImportSubmittable(fmt: DetectedFormat | null, input: string): boolean {
  if (!fmt || fmt === 'invalid') return false;
  if (fmt === 'mnemonic') return nostr.isValidMnemonic(input);
  return true;
}

function formatLabel(fmt: DetectedFormat | string | undefined): string {
  if (fmt === 'nsec') return 'nsec (texto claro)';
  if (fmt === 'ncryptsec') return 'ncryptsec (criptografada)';
  if (fmt === 'hex') return 'hex (64 caracteres)';
  if (fmt === 'mnemonic') return 'frase de 12 palavras';
  return 'formato não reconhecido';
}
