/**
 * Sync States — estados possíveis de uma entidade (file/folder) durante sincronização.
 *
 * Diagrama de transições:
 *
 *   LOCAL_ONLY ──────► PENDING_UPLOAD ──────► UPLOADING ──────► SYNCED
 *        ▲                  │                    │               │
 *        │                  ▼                    ▼               │
 *        └────────────── ERROR ◄────────── ERROR                │
 *                                                                ▼
 *                                              SYNCED ──────► PENDING_DOWNLOAD
 *                                                                │
 *                                                                ▼
 *                                                           DOWNLOADING
 *                                                                │
 *                                                                ▼
 *   CONFLICT ◄────── (remote + local changed simultaneously)     SYNCED
 *      │
 *      └──► MANUAL / KEEP_BOTH / LAST_WRITE_WINS ──► SYNCED
 *
 *   DELETED ─── tombstone publicado ───► removido do estado ativo
 */

export const SYNC_STATES = [
  'LOCAL_ONLY',
  'PENDING_UPLOAD',
  'UPLOADING',
  'SYNCED',
  'PENDING_DOWNLOAD',
  'DOWNLOADING',
  'CONFLICT',
  'ERROR',
  'DELETED',
] as const;

export type SyncState = (typeof SYNC_STATES)[number];

export const SYNC_STATE_LABELS: Record<SyncState, string> = {
  LOCAL_ONLY: 'Apenas local',
  PENDING_UPLOAD: 'Aguardando envio',
  UPLOADING: 'Enviando...',
  SYNCED: 'Sincronizado',
  PENDING_DOWNLOAD: 'Aguardando download',
  DOWNLOADING: 'Baixando...',
  CONFLICT: 'Conflito',
  ERROR: 'Erro de sincronização',
  DELETED: 'Deletado',
};

export const SYNC_STATE_COLORS: Record<SyncState, string> = {
  LOCAL_ONLY: '#888888',
  PENDING_UPLOAD: '#eab308',
  UPLOADING: '#3b82f6',
  SYNCED: '#22c55e',
  PENDING_DOWNLOAD: '#eab308',
  DOWNLOADING: '#3b82f6',
  CONFLICT: '#ef4444',
  ERROR: '#ef4444',
  DELETED: '#6b7280',
};

const VALID_TRANSITIONS: Record<SyncState, SyncState[]> = {
  LOCAL_ONLY: ['PENDING_UPLOAD', 'DELETED'],
  PENDING_UPLOAD: ['UPLOADING', 'LOCAL_ONLY', 'ERROR', 'DELETED'],
  UPLOADING: ['SYNCED', 'PENDING_UPLOAD', 'ERROR', 'DELETED'],
  SYNCED: ['PENDING_DOWNLOAD', 'CONFLICT', 'DELETED', 'LOCAL_ONLY'],
  PENDING_DOWNLOAD: ['DOWNLOADING', 'SYNCED', 'ERROR'],
  DOWNLOADING: ['SYNCED', 'PENDING_DOWNLOAD', 'ERROR'],
  CONFLICT: ['SYNCED', 'LOCAL_ONLY', 'PENDING_UPLOAD'],
  ERROR: ['PENDING_UPLOAD', 'PENDING_DOWNLOAD', 'LOCAL_ONLY', 'DELETED'],
  DELETED: ['LOCAL_ONLY'],
};

const TERMINAL_STATES: ReadonlySet<SyncState> = new Set(['DELETED']);
const IN_PROGRESS_STATES: ReadonlySet<SyncState> = new Set([
  'UPLOADING',
  'DOWNLOADING',
]);
const PENDING_STATES: ReadonlySet<SyncState> = new Set([
  'PENDING_UPLOAD',
  'PENDING_DOWNLOAD',
]);

export function canTransition(from: SyncState, to: SyncState): boolean {
  if (from === to) return true;
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: SyncState, to: SyncState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Transição inválida: ${from} → ${to}`);
  }
}

export function isTerminalState(state: SyncState): boolean {
  return TERMINAL_STATES.has(state);
}

export function isInProgress(state: SyncState): boolean {
  return IN_PROGRESS_STATES.has(state);
}

export function isPending(state: SyncState): boolean {
  return PENDING_STATES.has(state);
}

export function isError(state: SyncState): boolean {
  return state === 'ERROR';
}

export function isSynced(state: SyncState): boolean {
  return state === 'SYNCED';
}

export function isConflict(state: SyncState): boolean {
  return state === 'CONFLICT';
}

export function needsUpload(state: SyncState): boolean {
  return state === 'LOCAL_ONLY' || state === 'PENDING_UPLOAD';
}

export function needsDownload(state: SyncState): boolean {
  return state === 'PENDING_DOWNLOAD';
}

/**
 * Retorna o estado inicial baseado na presença/ausência de dados remotos.
 */
export function initialSyncState(hasRemote: boolean): SyncState {
  return hasRemote ? 'PENDING_DOWNLOAD' : 'LOCAL_ONLY';
}

/**
 * Reseta para LOCAL_ONLY quando o usuário edita uma entidade SYNCED.
 */
export function transitionOnLocalEdit(current: SyncState): SyncState {
  if (current === 'SYNCED') return 'PENDING_UPLOAD';
  if (current === 'PENDING_DOWNLOAD') return 'PENDING_UPLOAD';
  if (current === 'CONFLICT') return 'PENDING_UPLOAD';
  return current;
}
