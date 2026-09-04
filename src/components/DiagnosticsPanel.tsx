import { useEffect, useState } from 'react';
import * as diag from '../services/diagnostics';
import * as repair from '../services/repair';
import './DiagnosticsPanel.css';

interface Props {
  onClose: () => void;
}

const LEVEL_COLOR: Record<string, string> = {
  debug: '#9ca3af',
  info: '#3b82f6',
  warn: '#f59e0b',
  error: '#ef4444',
};

function formatTs(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

export default function DiagnosticsPanel({ onClose }: Props) {
  const [tab, setTab] = useState<'events' | 'relays' | 'repair'>('events');
  const [events, setEvents] = useState<diag.DiagnosticEvent[]>([]);
  const [relays, setRelays] = useState<diag.RelayHealth[]>([]);
  const [stats, setStats] = useState<diag.AggregateStats | null>(null);
  const [repairResults, setRepairResults] = useState<repair.RepairResult[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const refresh = () => {
      setEvents(diag.listEvents().slice(-200).reverse());
      setRelays(diag.listRelayHealth().sort((a, b) => b.score - a.score));
      setStats(diag.getAggregateStats());
    };
    refresh();
    const off = diag.onDiagnosticChange(refresh);
    return off;
  }, []);

  const handleExport = () => {
    const data = diag.exportDiagnostics('Nostr FileSync', '1.0.0');
    const json = diag.formatDiagnosticsJson(data);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRepair = async (tool: () => Promise<repair.RepairResult>) => {
    setBusy(true);
    try {
      const result = await tool();
      setRepairResults((prev) => [result, ...prev]);
    } finally {
      setBusy(false);
    }
  };

  const handleRunAll = async () => {
    setBusy(true);
    try {
      const all = await repair.runAllRepairs();
      setRepairResults((prev) => [...all, ...prev]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="diag-overlay" onClick={onClose}>
      <div className="diag-panel" onClick={(e) => e.stopPropagation()}>
        <header className="diag-header">
          <h2>🩺 Diagnóstico</h2>
          <button className="close-btn" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </header>

        {stats && (
          <div className="diag-stats">
            <div className="stat">
              <div className="stat-value">{stats.totalEvents}</div>
              <div className="stat-label">Eventos</div>
            </div>
            <div className="stat">
              <div className="stat-value">{stats.relayCount}</div>
              <div className="stat-label">Relays</div>
            </div>
            <div className="stat">
              <div className="stat-value">{stats.byLevel.error}</div>
              <div className="stat-label">Erros</div>
            </div>
            <div className="stat">
              <div className="stat-value">{stats.byLevel.warn}</div>
              <div className="stat-label">Avisos</div>
            </div>
          </div>
        )}

        <div className="diag-tabs" role="tablist">
          <button
            className={`diag-tab ${tab === 'events' ? 'active' : ''}`}
            onClick={() => setTab('events')}
          >
            Eventos
          </button>
          <button
            className={`diag-tab ${tab === 'relays' ? 'active' : ''}`}
            onClick={() => setTab('relays')}
          >
            Relays
          </button>
          <button
            className={`diag-tab ${tab === 'repair' ? 'active' : ''}`}
            onClick={() => setTab('repair')}
          >
            Reparo
          </button>
        </div>

        {tab === 'events' && (
          <>
            <div className="diag-toolbar">
              <button className="text-btn" onClick={handleExport}>
                Exportar diagnóstico
              </button>
              <button
                className="text-btn danger"
                onClick={() => {
                  if (confirm('Limpar todos os eventos?')) {
                    diag.clearEvents();
                  }
                }}
              >
                Limpar
              </button>
            </div>
            <ul className="diag-event-list">
              {events.length === 0 && <li className="diag-empty">Nenhum evento.</li>}
              {events.map((e) => (
                <li key={e.id} className="diag-event-item">
                  <span className="diag-event-ts">{formatTs(e.ts)}</span>
                  <span
                    className="diag-event-level"
                    style={{ color: LEVEL_COLOR[e.level] }}
                  >
                    {e.level.toUpperCase()}
                  </span>
                  <span className="diag-event-cat">{e.category}</span>
                  <span className="diag-event-msg">{e.message}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        {tab === 'relays' && (
          <ul className="diag-relay-list">
            {relays.length === 0 && <li className="diag-empty">Nenhum relay registrado.</li>}
            {relays.map((r) => (
              <li key={r.url} className="diag-relay-item">
                <div className="relay-url">{r.url}</div>
                <div className="relay-bar-wrap">
                  <div
                    className="relay-bar"
                    style={{
                      width: `${r.score * 100}%`,
                      background: r.score > 0.7 ? '#22c55e' : r.score > 0.4 ? '#f59e0b' : '#ef4444',
                    }}
                  />
                </div>
                <div className="relay-stats">
                  score: {(r.score * 100).toFixed(0)}% · {r.successCount}/{r.samples} ok
                  {r.avgLatencyMs !== null && ` · ${r.avgLatencyMs.toFixed(0)}ms`}
                </div>
                {r.lastError && <div className="relay-error">{r.lastError}</div>}
              </li>
            ))}
          </ul>
        )}

        {tab === 'repair' && (
          <>
            <div className="diag-toolbar">
              <button
                className="action-btn primary"
                onClick={handleRunAll}
                disabled={busy}
              >
                {busy ? 'Rodando...' : 'Rodar todos os reparos'}
              </button>
            </div>
            <div className="repair-grid">
              <button
                className="repair-card"
                onClick={() => void handleRepair(repair.checkIntegrity)}
                disabled={busy}
              >
                <strong>🔍 Verificar integridade</strong>
                <p>Detecta uploads órfãos, blobs faltantes, referências quebradas</p>
              </button>
              <button
                className="repair-card"
                onClick={() => void handleRepair(repair.rebuildIndex)}
                disabled={busy}
              >
                <strong>🗂 Reconstruir índice</strong>
                <p>Reconstrói índices de busca e metadata de arquivos/pastas</p>
              </button>
              <button
                className="repair-card"
                onClick={() => void handleRepair(repair.rebuildManifest)}
                disabled={busy}
              >
                <strong>📋 Reconstruir manifesto</strong>
                <p>Reconstrói o manifesto de arquivos usado pelo sync engine</p>
              </button>
              <button
                className="repair-card"
                onClick={() => void handleRepair(repair.retryFailed)}
                disabled={busy}
              >
                <strong>🔁 Reenviar operações falhas</strong>
                <p>Retenta uploads pendentes e operações na fila de sync</p>
              </button>
            </div>
            {repairResults.length > 0 && (
              <ul className="repair-results">
                {repairResults.map((r, i) => (
                  <li key={i} className={`repair-result status-${r.status}`}>
                    <strong>{r.tool}</strong>: {r.message}
                    <span className="repair-duration">
                      {r.durationMs.toFixed(0)}ms
                    </span>
                    {r.details && (
                      <pre className="repair-details">
                        {JSON.stringify(r.details, null, 2)}
                      </pre>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
