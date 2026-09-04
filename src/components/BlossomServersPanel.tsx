import { useEffect, useState } from 'react';
import * as blossom from '../services/blossom';
import * as repair from '../services/blossom/repair';
import * as health from '../services/blossom/healthScheduler';
import type { BlossomServer } from '../services/blossom/types';
import './BlossomServersPanel.css';

export default function BlossomServersPanel() {
  const [servers, setServers] = useState<BlossomServer[]>([]);
  const [newUrl, setNewUrl] = useState('');
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCheck, setLastCheck] = useState<{ at: number; healthy: number; total: number } | null>(null);
  const [repairing, setRepairing] = useState(false);
  const [lastRepair, setLastRepair] = useState<string | null>(null);
  const [trackedCount, setTrackedCount] = useState(0);

  useEffect(() => {
    const off = blossom.onServersChange((s) => setServers(s.slice()));
    setTrackedCount(repair.getTrackedBlobs().length);
    const offHealth = health.onHealthSchedulerChange((s) => {
      if (s.lastRunAt && s.lastResult) {
        setLastCheck({
          at: s.lastRunAt,
          healthy: s.lastResult.healthy,
          total: s.lastResult.total,
        });
      }
    });
    return () => {
      off();
      offHealth();
    };
  }, []);

  const handleAdd = async () => {
    setError(null);
    const url = newUrl.trim();
    if (!url) {
      setError('Informe uma URL');
      return;
    }
    if (!/^https?:\/\//.test(url)) {
      setError('URL precisa começar com http:// ou https://');
      return;
    }
    setBusy(true);
    try {
      blossom.addCustomServer(url, newName.trim() || undefined);
      setNewUrl('');
      setNewName('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = (server: BlossomServer) => {
    if (server.source === 'fallback') {
      if (!confirm(`Remover servidor padrão ${server.url}?`)) return;
    }
    blossom.removeServer(server.url);
  };

  const handleToggle = (server: BlossomServer) => {
    blossom.toggleServerTrusted(server.url, !server.trusted);
  };

  const handleCheckAll = async () => {
    setBusy(true);
    setError(null);
    try {
      await blossom.runHealthChecks();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleRepair = async () => {
    if (repairing) return;
    setRepairing(true);
    setError(null);
    setLastRepair(null);
    try {
      const r = await repair.repairBlobs({ maxBlobs: 20 });
      setLastRepair(
        `Verificados: ${r.checked} | Reparados: ${r.repaired} | Falhas: ${r.failed} | Faltantes: ${r.missing.length}`
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRepairing(false);
    }
  };

  const formatRelative = (ts: number): string => {
    const diff = Date.now() - ts;
    if (diff < 60_000) return 'agora';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}min atrás`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h atrás`;
    return `${Math.floor(diff / 86_400_000)}d atrás`;
  };

  const formatLastCheck = (): string => {
    if (!lastCheck) return 'nunca';
    return formatRelative(lastCheck.at);
  };

  return (
    <div className="blossom-panel">
      <div className="blossom-summary">
        <div className="blossom-stat">
          <div className="blossom-stat-value">
            {servers.filter((s) => s.trusted && s.healthy).length}
          </div>
          <div className="blossom-stat-label">Saudáveis</div>
        </div>
        <div className="blossom-stat">
          <div className="blossom-stat-value">{servers.filter((s) => s.trusted).length}</div>
          <div className="blossom-stat-label">Confiáveis</div>
        </div>
        <div className="blossom-stat">
          <div className="blossom-stat-value">{servers.length}</div>
          <div className="blossom-stat-label">Total</div>
        </div>
        <div className="blossom-stat">
          <div className="blossom-stat-value">{trackedCount}</div>
          <div className="blossom-stat-label">Blobs</div>
        </div>
      </div>

      <div className="blossom-toolbar">
        <button
          className="action-btn primary"
          onClick={() => void handleCheckAll()}
          disabled={busy}
        >
          {busy ? 'Verificando...' : '🔍 Verificar agora'}
        </button>
        <button
          className="action-btn"
          onClick={() => void handleRepair()}
          disabled={repairing || trackedCount === 0}
          title="Verificar blobs faltantes e re-mirrorar de servidores saudáveis"
        >
          {repairing ? 'Reparando...' : '🔧 Reparar blobs'}
        </button>
        <span className="blossom-last-check">Última verificação: {formatLastCheck()}</span>
      </div>

      {error && <div className="blossom-error">{error}</div>}
      {lastRepair && <div className="blossom-info">{lastRepair}</div>}

      <div className="blossom-add">
        <h4>Adicionar servidor custom</h4>
        <div className="blossom-add-row">
          <input
            type="text"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder="https://meu-blossom.example.com"
            disabled={busy}
            data-testid="blossom-url-input"
          />
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nome (opcional)"
            disabled={busy}
          />
          <button
            className="action-btn primary"
            onClick={() => void handleAdd()}
            disabled={busy || !newUrl.trim()}
            data-testid="blossom-add-btn"
          >
            Adicionar
          </button>
        </div>
        <p className="blossom-hint">
          Adiciona um servidor Blossom público compatível com BUD-02. Sem cadastro — auth via NIP-42.
        </p>
      </div>

      <ul className="blossom-server-list">
        {servers.map((s) => (
          <li
            key={s.url}
            className={`blossom-server ${s.trusted ? 'trusted' : 'untrusted'} ${
              s.healthy ? 'healthy' : 'unhealthy'
            }`}
          >
            <div className="blossom-server-row">
              <div className="blossom-server-status">
                <span
                  className="blossom-dot"
                  data-healthy={s.healthy}
                  data-trusted={s.trusted}
                  aria-label={s.healthy ? 'saudável' : 'indisponível'}
                />
              </div>
              <div className="blossom-server-info">
                <div className="blossom-server-name">
                  {s.name || new URL(s.url).hostname}
                  {s.source === 'fallback' && (
                    <span className="blossom-tag">padrão</span>
                  )}
                  {s.source === 'custom' && (
                    <span className="blossom-tag custom">custom</span>
                  )}
                </div>
                <div className="blossom-server-url">{s.url}</div>
                <div className="blossom-server-meta">
                  {s.avgLatencyMs !== null && (
                    <span>latência ~{s.avgLatencyMs.toFixed(0)}ms</span>
                  )}
                  {s.lastCheckAt && (
                    <span> · check: {formatRelative(s.lastCheckAt)}</span>
                  )}
                </div>
              </div>
              <div className="blossom-server-actions">
                <label className="blossom-trust-toggle">
                  <input
                    type="checkbox"
                    checked={s.trusted}
                    onChange={() => handleToggle(s)}
                    aria-label="Confiável"
                  />
                  <span>Confiável</span>
                </label>
                {s.source !== 'fallback' && (
                  <button
                    className="text-btn danger"
                    onClick={() => handleRemove(s)}
                    title="Remover servidor"
                  >
                    Remover
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
