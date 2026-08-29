import { useState, useEffect, useMemo } from 'react';
import * as nostr from '../services/nostr';
import QRScanner from './QRScanner';
import MnemonicSetup from './MnemonicSetup';
import { useT } from '../hooks/useT';
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
  const { t } = useT();
  const tRef = useMemo(() => ({ current: t }), [t]);
  const formatLabel = useMemo(() => formatLabelWith(t), [t]);

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
    if (password.length < 6) return tRef.current('unlock_pw_short');
    if (password !== confirm) return tRef.current('unlock_pw_mismatch');
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
      setError(tRef.current('unlock_create_failed'));
    } finally {
      setBusy(false);
    }
  };

  const handleUnlockMnemonic = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const phrase = mnemonicInput.trim();
    if (!nostr.isValidMnemonic(phrase)) {
      setError(tRef.current('unlock_mnemonic_invalid'));
      return;
    }
    setBusy(true);
    try {
      await nostr.unlockWithMnemonic(phrase);
    } catch (e) {
      setError((e as Error).message || tRef.current('unlock_mnemonic_nomatch'));
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
      setError(tRef.current('unlock_unlock_failed'));
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
      setError(tRef.current('unlock_import_needs_currpw'));
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
    return <div className="unlock-screen">{t('unlock_loading')}</div>;
  }

  if (mode === 'unlocked') {
    return null;
  }

  return (
    <div className="unlock-screen">
      <div className="unlock-card">
        <h1>{t('unlock_setup_title')}</h1>

        {mode === 'setup' && createdMnemonic && (
          <MnemonicSetup
            mnemonic={createdMnemonic}
            onConfirm={() => setCreatedMnemonic(null)}
          />
        )}

        {mode === 'setup' && !createdMnemonic && (
          <>
            <p className="unlock-subtitle">{t('unlock_setup_subtitle')}</p>
            <div className="setup-info-banner">{t('unlock_setup_banner')}</div>
            <form onSubmit={handleCreate} className="unlock-form">
              <label>{t('unlock_password_label')}</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('unlock_password_placeholder')}
                autoComplete="new-password"
                disabled={busy}
              />
              <label>{t('unlock_confirm_label')}</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t('unlock_confirm_placeholder')}
                autoComplete="new-password"
                disabled={busy}
              />
              {error && <div className="unlock-error">{error}</div>}
              <button type="submit" className="unlock-btn" disabled={busy}>
                {busy ? t('unlock_creating') : t('unlock_create')}
              </button>
            </form>
            <div className="unlock-divider">{t('unlock_or')}</div>
            <button
              className="unlock-link-btn"
              onClick={() => {
                setMode('import');
                setError(null);
              }}
            >
              {t('unlock_import_link')}
            </button>
            {info && !createdMnemonic && (
              <div className="unlock-info">
                <strong>{t('unlock_info_created')}</strong>
                <p>{t('unlock_info_pubkey')}</p>
                <code>{info.npub}</code>
              </div>
            )}
          </>
        )}

        {mode === 'locked' && (
          <>
            <p className="unlock-subtitle">{t('unlock_locked_subtitle')}</p>
            <div className="tab-bar">
              <button
                className={`tab-btn ${unlockTab === 'password' ? 'active' : ''}`}
                onClick={() => {
                  setUnlockTab('password');
                  setError(null);
                }}
              >
                {t('unlock_tab_password')}
              </button>
              <button
                className={`tab-btn ${unlockTab === 'mnemonic' ? 'active' : ''}`}
                onClick={() => {
                  setUnlockTab('mnemonic');
                  setError(null);
                }}
              >
                {t('unlock_tab_mnemonic')}
              </button>
            </div>
            {unlockTab === 'password' ? (
              <form onSubmit={handleUnlock} className="unlock-form">
                <label>{t('unlock_tab_password')}</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('unlock_password_only_placeholder')}
                  autoComplete="current-password"
                  autoFocus
                  disabled={busy}
                />
                {error && <div className="unlock-error">{error}</div>}
                <button type="submit" className="unlock-btn" disabled={busy}>
                  {busy ? t('unlock_unlocking') : t('unlock_unlock')}
                </button>
              </form>
            ) : (
              <form onSubmit={handleUnlockMnemonic} className="unlock-form">
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
                  {busy ? t('unlock_unlocking') : t('unlock_unlock_with_phrase')}
                </button>
              </form>
            )}
            <div className="unlock-divider">{t('unlock_or')}</div>
            <button
              className="unlock-link-btn"
              onClick={() => {
                setMode('import');
                resetImport();
              }}
            >
              {t('unlock_import_other')}
            </button>
            <button
              className="unlock-link-btn danger"
              onClick={() => {
                if (confirm(t('unlock_reset_confirm'))) {
                  localStorage.removeItem('nostr_todo_privkey');
                  localStorage.removeItem('nostr_todo_mnemonic_hint');
                  window.location.reload();
                }
              }}
            >
              {t('unlock_reset')}
            </button>
          </>
        )}

        {mode === 'migrate' && (
          <>
            <p className="unlock-subtitle">{t('unlock_migrate_subtitle')}</p>
            <form onSubmit={handleMigrate} className="unlock-form">
              <label>{t('unlock_migrate_password_label')}</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('unlock_password_placeholder')}
                autoComplete="new-password"
                disabled={busy}
              />
              <label>{t('unlock_migrate_confirm_label')}</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t('unlock_confirm_placeholder')}
                autoComplete="new-password"
                disabled={busy}
              />
              {error && <div className="unlock-error">{error}</div>}
              <button type="submit" className="unlock-btn" disabled={busy}>
                {busy ? t('unlock_migrating') : t('unlock_migrate_button')}
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
                {t('unlock_cancel')}
              </button>
            </form>
          </>
        )}

        {mode === 'import' && (
          <>
            <p className="unlock-subtitle">{t('unlock_import_subtitle')}</p>
            <form onSubmit={handleImport} className="unlock-form">
              <div className="input-with-action">
                <label>{t('unlock_import_label')}</label>
                <button
                  type="button"
                  className="qr-btn"
                  onClick={() => setShowScanner(true)}
                  disabled={busy}
                >
                  {t('unlock_scan_qr')}
                </button>
              </div>
              <textarea
                value={importInput}
                onChange={(e) => setImportInput(e.target.value)}
                placeholder={t('unlock_import_placeholder')}
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
                    <span>{t('unlock_format_with_currpw')}</span>
                  )}
                </div>
              )}
              {detectedFormat === 'ncryptsec' && (
                <>
                  <label>{t('unlock_import_current_pw_label')}</label>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder={t('unlock_import_current_pw_placeholder')}
                    autoComplete="current-password"
                    disabled={busy}
                  />
                </>
              )}
              <label>{t('unlock_import_new_pw_label')}</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('unlock_password_placeholder')}
                autoComplete="new-password"
                disabled={busy}
              />
              <label>{t('unlock_import_confirm_label')}</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t('unlock_confirm_placeholder')}
                autoComplete="new-password"
                disabled={busy}
              />
              {error && <div className="unlock-error">{error}</div>}
              <button
                type="submit"
                className="unlock-btn"
                disabled={busy || !isImportSubmittable(detectedFormat, importInput)}
              >
                {busy ? t('unlock_importing') : t('unlock_import_button')}
              </button>
              <button
                type="button"
                className="unlock-link-btn"
                onClick={() => {
                  setMode('setup');
                  resetImport();
                }}
              >
                {t('unlock_back')}
              </button>
            </form>
            {info && (
              <div className="unlock-info">
                <strong>{t('unlock_import_success')}</strong>
                <p>
                  {t('unlock_import_source')} {formatLabel(info.source as DetectedFormat)}
                </p>
                <p>{t('unlock_import_pubkey')}</p>
                <code>{info.npub}</code>
              </div>
            )}
            {confirmOverwrite && (
              <div className="confirm-overlay" role="dialog" aria-modal="true">
                <div className="confirm-card">
                  <h3>{t('unlock_overwrite_title')}</h3>
                  <p>{t('unlock_overwrite_body')}</p>
                  <div className="confirm-actions">
                    <button
                      type="button"
                      className="unlock-link-btn"
                      onClick={() => setConfirmOverwrite(false)}
                      disabled={busy}
                    >
                      {t('unlock_cancel')}
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
                      {busy ? t('unlock_replace_importing') : t('unlock_replace')}
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

function formatLabelWith(t: (key: import('../i18n').TranslationKey) => string) {
  return (fmt: DetectedFormat | string | undefined): string => {
    if (fmt === 'nsec') return t('unlock_format_nsec');
    if (fmt === 'ncryptsec') return t('unlock_format_ncryptsec');
    if (fmt === 'hex') return t('unlock_format_hex');
    if (fmt === 'mnemonic') return t('unlock_format_mnemonic');
    return t('unlock_format_invalid');
  };
}
