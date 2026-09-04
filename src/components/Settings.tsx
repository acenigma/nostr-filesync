import { useState, useMemo, lazy, Suspense } from 'react';
import * as nostr from '../services/nostr';
import * as nip46 from '../services/nip46';
import { getBandwidthConfig, setBandwidthProfile } from '../services/bandwidth';
import QRCode from 'qrcode';
import QRScanner from './QRScanner';
import MnemonicSetup from './MnemonicSetup';
import { useT } from '../hooks/useT';
import { setLocale, getLocale } from '../hooks/useT';
import { SUPPORTED_LOCALES, LOCALE_LABELS } from '../i18n';
import './Settings.css';

const DiagnosticsPanel = lazy(() => import('./DiagnosticsPanel'));

type DetectedFormat = 'nsec' | 'ncryptsec' | 'hex' | 'mnemonic' | 'invalid';

interface Props {
  onClose: () => void;
}

export default function Settings({ onClose }: Props) {
  const { t } = useT();
  const [locale, setLocaleState] = useState(() => getLocale());
  const [npub] = useState<string>(() => nostr.getNpub() || '');
  const [nsec] = useState<string>(() => nostr.getNsec() || '');
  const [ncryptsec] = useState<string>(() => nostr.getNcryptsec() || '');
  const [showNsec, setShowNsec] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrTarget, setQrTarget] = useState<{ text: string; label: string } | null>(null);
  const [changeMode, setChangeMode] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [importMode, setImportMode] = useState(false);
  const [importInput, setImportInput] = useState('');
  const [importCurrentPw, setImportCurrentPw] = useState('');
  const [importNewPw, setImportNewPw] = useState('');
  const [importConfirm, setImportConfirm] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [revealedMnemonic, setRevealedMnemonic] = useState<string | null>(null);
  const [mnemonicPw, setMnemonicPw] = useState('');
  const [activeRelays, setActiveRelays] = useState<string[]>(nostr.FALLBACK_RELAY_LIST);
  const [relaySource, setRelaySource] = useState<'custom' | 'fallback'>('fallback');
  const [refreshingRelays, setRefreshingRelays] = useState(false);
  const [bunkerInput, setBunkerInput] = useState('');
  const [bunkerBusy, setBunkerBusy] = useState(false);
  const [bunkerInfo, setBunkerInfo] = useState<string | null>(null);
  const [autoLockDuration, setAutoLockDuration] = useState(
    () => nostr.getAutoLockDuration().key
  );
  const [bandwidthProfile, setBandwidthProfileState] = useState(
    () => getBandwidthConfig().profile
  );
  const [showDiag, setShowDiag] = useState(false);

  const importFormat = useMemo<DetectedFormat | null>(
    () => detectFormat(importInput),
    [importInput]
  );
  const hasMnemonic = nostr.hasMnemonicBackup();

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setSuccess(`${label} copiado!`);
      setTimeout(() => setSuccess(null), 2000);
    } catch {
      setError('Falha ao copiar');
    }
  };

  const generateQR = async (text: string, label: string) => {
    try {
      const url = await QRCode.toDataURL(text, {
        margin: 1,
        width: 256,
        color: { dark: '#000000', light: '#ffffff' },
      });
      setQrUrl(url);
      setQrTarget({ text, label });
    } catch (e) {
      setError('Falha ao gerar QR: ' + (e as Error).message);
    }
  };

  const closeQR = () => {
    setQrUrl(null);
    setQrTarget(null);
  };

  const refreshRelays = async () => {
    if (!npub) return;
    setRefreshingRelays(true);
    setError(null);
    try {
      nostr.clearRelayCache(npub);
      const relays = await nostr.getRelays(npub);
      setActiveRelays(relays);
      const isFallback = relays.length === nostr.FALLBACK_RELAY_LIST.length &&
        relays.every((r, i) => r === nostr.FALLBACK_RELAY_LIST[i]);
      setRelaySource(isFallback ? 'fallback' : 'custom');
      setSuccess(`${relays.length} relay(s) ativo(s)`);
      setTimeout(() => setSuccess(null), 2000);
    } catch (e) {
      setError('Falha ao atualizar relays: ' + (e as Error).message);
    } finally {
      setRefreshingRelays(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPw.length < 6) {
      setError('Nova senha deve ter pelo menos 6 caracteres');
      return;
    }
    if (newPw !== confirmPw) {
      setError('Senhas não coincidem');
      return;
    }
    try {
      await nostr.changePassword(currentPw, newPw);
      setChangeMode(false);
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
      setSuccess('Senha alterada!');
      setTimeout(() => setSuccess(null), 2000);
    } catch {
      setError('Senha atual incorreta ou credencial corrompida');
    }
  };

  const handleLock = () => {
    nostr.lock();
    window.location.reload();
  };

  const handleBunkerConnect = async () => {
    if (!bunkerInput.trim()) return;
    setBunkerBusy(true);
    setError(null);
    try {
      const result = await nip46.connectToBunker(bunkerInput);
      setBunkerInfo(result.npub);
      setBunkerInput('');
      setSuccess('Bunker conectado');
      setTimeout(() => setSuccess(null), 2000);
    } catch (e) {
      setError('Falha ao conectar bunker: ' + (e as Error).message);
    } finally {
      setBunkerBusy(false);
    }
  };

  const handleBunkerDisconnect = async () => {
    const signer = nip46.getActiveRemoteSigner();
    if (!signer) return;
    await signer.close();
    setBunkerInfo(null);
    setSuccess('Bunker desconectado');
    setTimeout(() => setSuccess(null), 2000);
  };

  const handleRevealMnemonic = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const phrase = nostr.revealMnemonic(mnemonicPw);
      setRevealedMnemonic(phrase);
      setMnemonicPw('');
    } catch {
      setError('Senha incorreta');
    }
  };

  const closeMnemonicView = () => {
    setRevealedMnemonic(null);
  };

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (importNewPw.length < 6) {
      setError('Nova senha deve ter pelo menos 6 caracteres');
      return;
    }
    if (importNewPw !== importConfirm) {
      setError('Senhas não coincidem');
      return;
    }
    if (importFormat === 'ncryptsec' && !importCurrentPw) {
      setError('Esta chave está criptografada — informe a senha original');
      return;
    }
    if (!importFormat || importFormat === 'invalid') {
      setError('Formato não reconhecido');
      return;
    }
    setImportBusy(true);
    try {
      const result = await nostr.importCredential(
        importInput.trim(),
        importNewPw,
        importCurrentPw
      );
      setSuccess(`Identidade trocada para ${result.npub.slice(0, 16)}…`);
      setImportMode(false);
      setImportInput('');
      setImportCurrentPw('');
      setImportNewPw('');
      setImportConfirm('');
      setTimeout(() => {
        onClose();
        window.location.reload();
      }, 1500);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImportBusy(false);
    }
  };

  const handleScannerResult = (text: string) => {
    setShowScanner(false);
    setImportInput(text.trim());
    setError(null);
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>⚙ {t('settings_title_modal')}</h2>
          <button
            className="settings-close"
            onClick={onClose}
            aria-label={t('settings_close')}
          >
            ✕
          </button>
        </div>

        {error && <div className="settings-error">{error}</div>}
        {success && <div className="settings-success">{success}</div>}

        <section className="settings-section">
          <h3>{t('settings_appearance')}</h3>
          <div className="field">
            <label>{t('settings_language')}</label>
            <select
              className="settings-select"
              value={locale}
              onChange={(e) => {
                const next = e.target.value as typeof locale;
                setLocaleState(next);
                setLocale(next);
              }}
            >
              {SUPPORTED_LOCALES.map((l) => (
                <option key={l} value={l}>
                  {LOCALE_LABELS[l]}
                </option>
              ))}
            </select>
          </div>
        </section>

        <section className="settings-section">
          <h3>Remote signer (NIP-46)</h3>
          {bunkerInfo ? (
            <div className="field">
              <label>Bunker ativo</label>
              <code className="value-mono">{bunkerInfo}</code>
              <button className="small-btn danger" onClick={handleBunkerDisconnect}>
                Disconnect
              </button>
            </div>
          ) : (
            <div className="field">
              <label>bunker:// ou nostrconnect:// URL</label>
              <div className="field-row">
                <input
                  className="settings-input"
                  value={bunkerInput}
                  onChange={(e) => setBunkerInput(e.target.value)}
                  placeholder="bunker://npub...?relay=wss://..."
                  spellCheck={false}
                  disabled={bunkerBusy}
                />
                <button className="small-btn" onClick={handleBunkerConnect} disabled={bunkerBusy}>
                  {bunkerBusy ? 'Connecting...' : 'Connect'}
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="settings-section">
          <h3>{t('settings_export_identity')}</h3>
          <div className="field">
            <label>{t('settings_pubkey')}</label>
            <div className="field-row">
              <code className="value-mono">{npub}</code>
              <button className="small-btn" onClick={() => copy(npub, t('settings_pubkey'))}>
                {t('settings_copy')}
              </button>
            </div>
            <p className="field-hint">Use para receber arquivos de outros devices ou pessoas.</p>
          </div>

          <div className="export-card">
            <div className="export-title">
              <strong>🔑 Frase de recuperação (12 palavras)</strong>
              <span className="badge ok">BIP-39</span>
            </div>
            <p className="export-desc">
              12 palavras que podem recuperar sua conta se você esquecer a senha.
              Funciona em qualquer app Nostr compatível (Amethyst, Damus, Iris, etc.).
            </p>
            {hasMnemonic ? (
              !revealedMnemonic ? (
                <form onSubmit={handleRevealMnemonic} className="reveal-form">
                  <input
                    type="password"
                    value={mnemonicPw}
                    onChange={(e) => setMnemonicPw(e.target.value)}
                    placeholder="Sua senha para revelar a frase"
                    autoComplete="current-password"
                  />
                  <button type="submit" className="action-btn primary">
                    🔓 Mostrar frase
                  </button>
                </form>
              ) : null
            ) : (
              <div className="export-desc" style={{ fontStyle: 'italic', opacity: 0.7 }}>
                Sem frase de recuperação para esta identidade.
              </div>
            )}
          </div>

          {!importMode ? (
            <button
              className="text-btn"
              onClick={() => {
                setImportMode(true);
                setError(null);
                setSuccess(null);
              }}
            >
              Importar / trocar identidade
            </button>
          ) : (
            <form onSubmit={handleImport} className="change-pw-form">
              <p className="field-hint" style={{ marginBottom: 8 }}>
                Substitui a identidade atual. Os arquivos sincronizados no app pertencem à pubkey
                antiga — importe a mesma chave no outro device para ver os mesmos arquivos.
              </p>
              <div className="input-with-action">
                <label>Chave (12 palavras, nsec, ncryptsec ou hex)</label>
                <button
                  type="button"
                  className="qr-btn-inline"
                  onClick={() => setShowScanner(true)}
                  disabled={importBusy}
                >
                  📷 QR
                </button>
              </div>
              <textarea
                value={importInput}
                onChange={(e) => setImportInput(e.target.value)}
                placeholder="Cole aqui ou escaneie um QR"
                rows={2}
                disabled={importBusy}
              />
              {importFormat && (
                <div className="format-hint">
                  <span className={`format-badge ${importFormat}`}>
                    {formatLabel(importFormat)}
                  </span>
                </div>
              )}
              {importFormat === 'ncryptsec' && (
                <input
                  type="password"
                  value={importCurrentPw}
                  onChange={(e) => setImportCurrentPw(e.target.value)}
                  placeholder="Senha da chave original"
                  autoComplete="current-password"
                  disabled={importBusy}
                />
              )}
              <input
                type="password"
                value={importNewPw}
                onChange={(e) => setImportNewPw(e.target.value)}
                placeholder="Nova senha local (mín. 6)"
                autoComplete="new-password"
                disabled={importBusy}
              />
              <input
                type="password"
                value={importConfirm}
                onChange={(e) => setImportConfirm(e.target.value)}
                placeholder="Confirme a nova senha"
                autoComplete="new-password"
                disabled={importBusy}
              />
              <div className="form-actions">
                <button
                  type="submit"
                  className="action-btn primary"
                  disabled={importBusy || !isImportSubmittable(importFormat, importInput)}
                >
                  {importBusy ? 'Importando...' : 'Trocar identidade'}
                </button>
                <button
                  type="button"
                  className="action-btn"
                  onClick={() => {
                    setImportMode(false);
                    setImportInput('');
                    setError(null);
                  }}
                >
                  Cancelar
                </button>
              </div>
            </form>
          )}
        </section>

        <section className="settings-section">
          <h3>Relays</h3>
          <p className="section-desc">
            Lidos automaticamente do seu <code>kind:10002</code> (NIP-65). Configure em outro app
            Nostr (Amethyst, Damus, etc.) e os relays serão detectados aqui.
          </p>
          <div className="field-row" style={{ marginBottom: 8 }}>
            <span className="badge" style={{ background: relaySource === 'custom' ? 'rgba(34,197,94,0.15)' : 'var(--social-bg)', color: 'var(--text-h)' }}>
              {relaySource === 'custom' ? 'NIP-65 (kind:10002)' : 'Lista padrão (fallback)'}
            </span>
            <span className="field-hint" style={{ flex: 1 }}>
              {activeRelays.length} relay(s)
            </span>
            <button
              className="small-btn"
              onClick={refreshRelays}
              disabled={refreshingRelays}
            >
              {refreshingRelays ? '⟳' : '🔄'} Recarregar
            </button>
          </div>
          {activeRelays.length > 0 && (
            <details>
              <summary className="field-hint" style={{ cursor: 'pointer' }}>
                Ver relays ({activeRelays.length})
              </summary>
              <ul style={{ fontSize: 11, fontFamily: 'var(--mono)', marginTop: 6, paddingLeft: 18, wordBreak: 'break-all' }}>
                {activeRelays.map((r) => (
                  <li key={r} style={{ color: 'var(--text)' }}>{r}</li>
                ))}
              </ul>
            </details>
          )}
        </section>

        <section className="settings-section">
          <h3>Exportar chave (para outros devices)</h3>
          <p className="section-desc">
            Use para mover sua identidade para outro navegador ou compartilhar com apps Nostr.
          </p>

          <div className="export-card">
            <div className="export-title">
              <strong>nsec</strong>
              <span className="badge warn">texto claro</span>
            </div>
            <p className="export-desc">
              Sua chave privada em texto claro. <strong>Não compartilhe.</strong> Use apenas para
              backup offline seguro.
            </p>
            <div className="field-row">
              <code className="value-mono secret">
                {showNsec ? nsec : '••••••••••••••••••••••••••••••••'}
              </code>
              <button className="small-btn" onClick={() => setShowNsec((s) => !s)}>
                {showNsec ? 'Ocultar' : 'Mostrar'}
              </button>
            </div>
            {showNsec && (
              <div className="export-actions">
                <button className="action-btn" onClick={() => copy(nsec, 'nsec')}>
                  Copiar
                </button>
                <button className="action-btn" onClick={() => generateQR(nsec, 'nsec')}>
                  QR Code
                </button>
              </div>
            )}
          </div>

          {ncryptsec && (
            <div className="export-card">
              <div className="export-title">
                <strong>ncryptsec</strong>
                <span className="badge ok">criptografado</span>
              </div>
              <p className="export-desc">
                Sua chave criptografada com sua senha. Pode ser compartilhada e importada em outros
                devices (a senha será pedida).
              </p>
              <div className="field-row">
                <code className="value-mono">{ncryptsec.slice(0, 40)}…</code>
                <button className="small-btn" onClick={() => copy(ncryptsec, 'ncryptsec')}>
                  Copiar
                </button>
                <button className="small-btn" onClick={() => generateQR(ncryptsec, 'ncryptsec')}>
                  QR
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="settings-section">
          <h3>Segurança</h3>

          {!changeMode ? (
            <button className="text-btn" onClick={() => setChangeMode(true)}>
              Mudar senha
            </button>
          ) : (
            <form onSubmit={handleChangePassword} className="change-pw-form">
              <input
                type="password"
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                placeholder="Senha atual"
                autoComplete="current-password"
              />
              <input
                type="password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                placeholder="Nova senha (mín. 6)"
                autoComplete="new-password"
              />
              <input
                type="password"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                placeholder="Confirme a nova senha"
                autoComplete="new-password"
              />
              <div className="form-actions">
                <button type="submit" className="action-btn primary">
                  Salvar
                </button>
                <button
                  type="button"
                  className="action-btn"
                  onClick={() => {
                    setChangeMode(false);
                    setError(null);
                  }}
                >
                  Cancelar
                </button>
              </div>
            </form>
          )}

          <button className="text-btn danger" onClick={handleLock}>
            🔒 Bloquear agora
          </button>

          <div className="auto-lock-row">
            <label>Auto-lock após</label>
            <select
              className="lock-duration-select"
              value={autoLockDuration}
              onChange={(e) => {
                const key = e.target.value;
                nostr.setAutoLockDuration(key);
                setAutoLockDuration(key);
              }}
            >
              <option value="never">Nunca</option>
              <option value="5min">5 min</option>
              <option value="15min">15 min</option>
              <option value="30min">30 min</option>
              <option value="1hour">1 hora</option>
            </select>
          </div>

          {nostr.isPasskeySupported() && (
            <button
              className="text-btn"
              onClick={async () => {
                const passkeys = await nostr.listPasskeys();
                if (passkeys.length > 0) {
                  setSuccess('Passkeys registrados. Use no desbloqueio.');
                } else {
                  setSuccess('Nenhuma passkey registrada.');
                }
              }}
            >
              Gerenciar passkeys
            </button>
          )}

          <button
            className="text-btn"
            onClick={() => setShowDiag(true)}
          >
            🩺 Diagnóstico &amp; Reparo
          </button>
        </section>

        <section className="settings-section">
          <h3>Performance</h3>
          <div className="auto-lock-row">
            <label>Limite de banda</label>
            <select
              className="lock-duration-select"
              value={bandwidthProfile}
              onChange={(e) => {
                const profile = e.target.value as 'unlimited' | 'high' | 'medium' | 'low';
                setBandwidthProfile(profile);
                setBandwidthProfileState(profile);
              }}
            >
              <option value="unlimited">Ilimitado (6 paralelos)</option>
              <option value="high">Alto (4 paralelos)</option>
              <option value="medium">Médio (2 paralelos)</option>
              <option value="low">Baixo (1 paralelo)</option>
            </select>
          </div>
          <p className="settings-hint">
            Reduz paralelismo em conexões lentas ou instáveis. CDC é usado para deduplicar
            conteúdo que já existe nos relays.
          </p>
        </section>

        <section className="settings-section">
          <h3>Backup &amp; Recuperação</h3>
          <div className="backup-actions">
            <button
              className="text-btn"
              onClick={async () => {
                try {
                  const pw = prompt('Senha para backup:');
                  if (!pw) return;
                  const bytes = await nostr.exportBundleFile(pw);
                  const ab = new ArrayBuffer(bytes.byteLength);
                  new Uint8Array(ab).set(bytes);
                  const blob = new Blob([ab], { type: 'application/octet-stream' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'backup.nostrbundle';
                  a.click();
                  URL.revokeObjectURL(url);
                } catch (e) {
                  setError(`Export falhou: ${e}`);
                }
              }}
            >
              Exportar backup
            </button>
          </div>
        </section>

        {showScanner && (
          <QRScanner
            onResult={handleScannerResult}
            onClose={() => setShowScanner(false)}
          />
        )}

        {qrUrl && (
          <div className="qr-modal" onClick={closeQR}>
            <div className="qr-card" onClick={(e) => e.stopPropagation()}>
              <h3>{qrTarget?.label}</h3>
              <img src={qrUrl} alt="QR Code" />
              <p className="qr-hint">
                Aponte a câmera de outro device com app Nostr (Amethyst, Damus, etc.) para importar.
              </p>
              <button className="action-btn" onClick={closeQR}>
                Fechar
              </button>
            </div>
          </div>
        )}

        {revealedMnemonic && (
          <MnemonicSetup mnemonic={revealedMnemonic} onConfirm={closeMnemonicView} />
        )}

        {showDiag && (
          <Suspense fallback={null}>
            <DiagnosticsPanel onClose={() => setShowDiag(false)} />
          </Suspense>
        )}
      </div>
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
