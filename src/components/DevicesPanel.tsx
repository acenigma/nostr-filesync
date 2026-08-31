import { useState, useEffect, useMemo } from 'react';
import * as devices from '../services/devices';
import type { Device } from '../services/db';

const ONLINE_THRESHOLD_MS = 5 * 60 * 1000;

export type DeviceStatus = 'online' | 'recent' | 'offline';

export function getDeviceStatus(lastSeen: number, now: number = Date.now()): DeviceStatus {
  const elapsed = now - lastSeen;
  if (elapsed < ONLINE_THRESHOLD_MS) return 'online';
  if (elapsed < 24 * 60 * 60 * 1000) return 'recent';
  return 'offline';
}

export function formatLastSeen(lastSeen: number, now: number = Date.now()): string {
  const elapsed = now - lastSeen;
  if (elapsed < 60 * 1000) return 'agora';
  if (elapsed < 60 * 60 * 1000) return `${Math.floor(elapsed / 60000)} min atrás`;
  if (elapsed < 24 * 60 * 60 * 1000) return `${Math.floor(elapsed / 3600000)} h atrás`;
  return `${Math.floor(elapsed / 86400000)} dia(s) atrás`;
}

export function getStatusColor(status: DeviceStatus): string {
  switch (status) {
    case 'online':
      return '#22c55e';
    case 'recent':
      return '#eab308';
    case 'offline':
      return '#6b7280';
  }
}

export function getStatusLabel(status: DeviceStatus): string {
  switch (status) {
    case 'online':
      return 'Online';
    case 'recent':
      return 'Recente';
    case 'offline':
      return 'Offline';
  }
}

export interface DevicesPanelProps {
  pubkey: string;
  onRename?: (deviceId: string, newName: string) => Promise<void>;
  onRemove?: (deviceId: string) => Promise<void>;
  refreshIntervalMs?: number;
}

export default function DevicesPanel({
  pubkey,
  onRename,
  onRemove,
  refreshIntervalMs = 10000,
}: DevicesPanelProps) {
  const [deviceList, setDeviceList] = useState<Device[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useMemo(
    () => async () => {
      const all = await devices.listDevicesByPubkey(pubkey);
      setDeviceList(all.sort((a, b) => b.lastSeen - a.lastSeen));
      setLoading(false);
    },
    [pubkey]
  );

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, refreshIntervalMs);
    return () => clearInterval(interval);
  }, [refresh, refreshIntervalMs]);

  const handleRename = async (id: string) => {
    if (!onRename || !editingName.trim()) return;
    await onRename(id, editingName.trim());
    setEditingId(null);
    setEditingName('');
    await refresh();
  };

  const handleRemove = async (id: string) => {
    if (!onRemove) return;
    await onRemove(id);
    await refresh();
  };

  if (loading) {
    return <div className="devices-panel loading">Carregando devices...</div>;
  }

  if (deviceList.length === 0) {
    return (
      <div className="devices-panel empty">
        <p>Nenhum device conhecido ainda.</p>
      </div>
    );
  }

  return (
    <div className="devices-panel">
      <h3>Devices ({deviceList.length})</h3>
      <ul className="device-list">
        {deviceList.map((d) => {
          const status = getDeviceStatus(d.lastSeen);
          const color = getStatusColor(status);
          const statusLabel = getStatusLabel(status);
          const isEditing = editingId === d.id;
          return (
            <li key={d.id} className="device-item" data-status={status}>
              <div className="device-header">
                <span className="device-status-dot" style={{ background: color }} aria-hidden />
                {isEditing ? (
                  <input
                    type="text"
                    className="device-name-input"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    autoFocus
                    maxLength={64}
                  />
                ) : (
                  <span className="device-name">{d.name}</span>
                )}
                {d.isLocal && <span className="device-badge">Este device</span>}
              </div>
              <div className="device-meta">
                <span className="device-platform">{d.platform}</span>
                <span className="device-version">v{d.appVersion}</span>
                <span className="device-seen">
                  {statusLabel} · {formatLastSeen(d.lastSeen)}
                </span>
              </div>
              <div className="device-actions">
                {!d.isLocal && !isEditing && onRename && (
                  <button
                    className="small-btn"
                    onClick={() => {
                      setEditingId(d.id);
                      setEditingName(d.name);
                    }}
                  >
                    Renomear
                  </button>
                )}
                {isEditing && (
                  <>
                    <button className="small-btn primary" onClick={() => handleRename(d.id)}>
                      Salvar
                    </button>
                    <button
                      className="small-btn"
                      onClick={() => {
                        setEditingId(null);
                        setEditingName('');
                      }}
                    >
                      Cancelar
                    </button>
                  </>
                )}
                {!d.isLocal && onRemove && (
                  <button className="small-btn danger" onClick={() => handleRemove(d.id)}>
                    Remover
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
