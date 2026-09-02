const STORAGE_STATE_KEY = 'nostr_filesync_storage_states';

export type StorageState =
  | 'always_offline'
  | 'available_offline'
  | 'online_only'
  | 'pinned';

export interface StorageEstimate {
  quota: number;
  usage: number;
  usageDetails?: Record<string, number>;
}

export type AlertLevel = 'none' | 'warning' | 'critical' | 'restricted';

export interface StorageAlert {
  level: AlertLevel;
  percent: number;
  message: string;
}

export interface StorageBreakdownItem {
  label: string;
  bytes: number;
  percent: number;
}

export interface StorageBreakdown {
  items: StorageBreakdownItem[];
  totalBytes: number;
}

export interface StorageStateRecord {
  entityId: string;
  entityType: 'file' | 'folder';
  state: StorageState;
}

const ALERT_THRESHOLDS = {
  warning: 0.8,
  critical: 0.9,
  restricted: 0.95,
};

export function getAlertThresholds() {
  return ALERT_THRESHOLDS;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export async function getStorageEstimate(): Promise<StorageEstimate | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return null;
  }
  const estimate = await navigator.storage.estimate();
  const details = (estimate as unknown as { usageDetails?: Record<string, number> }).usageDetails;
  return {
    quota: estimate.quota ?? 0,
    usage: estimate.usage ?? 0,
    usageDetails: details,
  };
}

export async function getStorageAlert(
  estimateArg?: StorageEstimate | null
): Promise<StorageAlert> {
  const estimate = estimateArg ?? (await getStorageEstimate());
  if (!estimate || estimate.quota === 0) {
    return { level: 'none', percent: 0, message: 'Estimativa de armazenamento indisponível' };
  }

  const percent = estimate.usage / estimate.quota;
  const pctStr = `${Math.round(percent * 100)}%`;

  if (percent >= ALERT_THRESHOLDS.restricted) {
    return {
      level: 'restricted',
      percent,
      message: `Armazenamento quase cheio (${pctStr}). Operações restritas.`,
    };
  }
  if (percent >= ALERT_THRESHOLDS.critical) {
    return {
      level: 'critical',
      percent,
      message: `Armazenamento quase cheio (${pctStr}). Libere espaço urgentemente.`,
    };
  }
  if (percent >= ALERT_THRESHOLDS.warning) {
    return {
      level: 'warning',
      percent,
      message: `Armazenamento em ${pctStr} de uso. Considere liberar espaço.`,
    };
  }

  return {
    level: 'none',
    percent,
    message: `Armazenamento em ${pctStr} de uso.`,
  };
}

export function getStorageStates(): StorageStateRecord[] {
  try {
    const stored = localStorage.getItem(STORAGE_STATE_KEY);
    if (stored) return JSON.parse(stored) as StorageStateRecord[];
  } catch {
    // ignore
  }
  return [];
}

export function setStorageState(
  entityId: string,
  entityType: 'file' | 'folder',
  state: StorageState
): void {
  if (!['always_offline', 'available_offline', 'online_only', 'pinned'].includes(state)) {
    throw new Error(`Estado inválido: ${state}`);
  }
  const states = getStorageStates();
  const idx = states.findIndex(
    (s) => s.entityId === entityId && s.entityType === entityType
  );
  if (idx >= 0) {
    states[idx] = { entityId, entityType, state };
  } else {
    states.push({ entityId, entityType, state });
  }
  localStorage.setItem(STORAGE_STATE_KEY, JSON.stringify(states));
}

export function getStorageState(
  entityId: string,
  entityType: 'file' | 'folder'
): StorageState {
  const states = getStorageStates();
  const found = states.find(
    (s) => s.entityId === entityId && s.entityType === entityType
  );
  if (!found) return 'available_offline';
  if (found.state === 'pinned') return 'always_offline';
  if (found.state === 'always_offline') return 'always_offline';
  if (found.state === 'online_only') return 'online_only';
  return 'available_offline';
}

export function clearStorageStates(): void {
  localStorage.removeItem(STORAGE_STATE_KEY);
}

export { formatBytes };
