import { describe, it, expect } from 'vitest';
import {
  SYNC_STATES,
  SYNC_STATE_LABELS,
  SYNC_STATE_COLORS,
  canTransition,
  assertTransition,
  isTerminalState,
  isInProgress,
  isPending,
  isError,
  isSynced,
  isConflict,
  needsUpload,
  needsDownload,
  initialSyncState,
  transitionOnLocalEdit,
  type SyncState,
} from '../services/sync/states';

describe('Sync States — Constants', () => {
  it('SYNC_STATES contém todos os 9 estados esperados', () => {
    expect(SYNC_STATES).toHaveLength(9);
    expect(SYNC_STATES).toContain('LOCAL_ONLY');
    expect(SYNC_STATES).toContain('PENDING_UPLOAD');
    expect(SYNC_STATES).toContain('UPLOADING');
    expect(SYNC_STATES).toContain('SYNCED');
    expect(SYNC_STATES).toContain('PENDING_DOWNLOAD');
    expect(SYNC_STATES).toContain('DOWNLOADING');
    expect(SYNC_STATES).toContain('CONFLICT');
    expect(SYNC_STATES).toContain('ERROR');
    expect(SYNC_STATES).toContain('DELETED');
  });

  it('SYNC_STATE_LABELS tem label para cada estado', () => {
    for (const state of SYNC_STATES) {
      expect(SYNC_STATE_LABELS[state]).toBeTruthy();
      expect(typeof SYNC_STATE_LABELS[state]).toBe('string');
    }
  });

  it('SYNC_STATE_COLORS tem cor para cada estado', () => {
    for (const state of SYNC_STATES) {
      expect(SYNC_STATE_COLORS[state]).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});

describe('canTransition', () => {
  it('LOCAL_ONLY → PENDING_UPLOAD é válido', () => {
    expect(canTransition('LOCAL_ONLY', 'PENDING_UPLOAD')).toBe(true);
  });

  it('PENDING_UPLOAD → UPLOADING é válido', () => {
    expect(canTransition('PENDING_UPLOAD', 'UPLOADING')).toBe(true);
  });

  it('UPLOADING → SYNCED é válido', () => {
    expect(canTransition('UPLOADING', 'SYNCED')).toBe(true);
  });

  it('UPLOADING → ERROR é válido', () => {
    expect(canTransition('UPLOADING', 'ERROR')).toBe(true);
  });

  it('SYNCED → PENDING_DOWNLOAD é válido', () => {
    expect(canTransition('SYNCED', 'PENDING_DOWNLOAD')).toBe(true);
  });

  it('SYNCED → CONFLICT é válido', () => {
    expect(canTransition('SYNCED', 'CONFLICT')).toBe(true);
  });

  it('CONFLICT → SYNCED é válido', () => {
    expect(canTransition('CONFLICT', 'SYNCED')).toBe(true);
  });

  it('CONFLICT → LOCAL_ONLY é válido', () => {
    expect(canTransition('CONFLICT', 'LOCAL_ONLY')).toBe(true);
  });

  it('DELETED → LOCAL_ONLY é válido (undelete)', () => {
    expect(canTransition('DELETED', 'LOCAL_ONLY')).toBe(true);
  });

  it('LOCAL_ONLY → SYNCED é inválido (skip de estados)', () => {
    expect(canTransition('LOCAL_ONLY', 'SYNCED')).toBe(false);
  });

  it('LOCAL_ONLY → UPLOADING é inválido (precisa de PENDING primeiro)', () => {
    expect(canTransition('LOCAL_ONLY', 'UPLOADING')).toBe(false);
  });

  it('UPLOADING → DELETED é válido (cancela upload e deleta)', () => {
    expect(canTransition('UPLOADING', 'DELETED')).toBe(true);
  });

  it('DELETED → SYNCED é inválido', () => {
    expect(canTransition('DELETED', 'SYNCED')).toBe(false);
  });

  it('PENDING_DOWNLOAD → UPLOADING é inválido', () => {
    expect(canTransition('PENDING_DOWNLOAD', 'UPLOADING')).toBe(false);
  });

  it('transição para o mesmo estado é válida (no-op)', () => {
    for (const state of SYNC_STATES) {
      expect(canTransition(state, state)).toBe(true);
    }
  });
});

describe('assertTransition', () => {
  it('não lança em transição válida', () => {
    expect(() => assertTransition('LOCAL_ONLY', 'PENDING_UPLOAD')).not.toThrow();
  });

  it('lança em transição inválida', () => {
    expect(() => assertTransition('LOCAL_ONLY', 'SYNCED')).toThrow(/inválida/);
  });
});

describe('State predicates', () => {
  it('isTerminalState', () => {
    expect(isTerminalState('DELETED')).toBe(true);
    expect(isTerminalState('SYNCED')).toBe(false);
    expect(isTerminalState('ERROR')).toBe(false);
  });

  it('isInProgress', () => {
    expect(isInProgress('UPLOADING')).toBe(true);
    expect(isInProgress('DOWNLOADING')).toBe(true);
    expect(isInProgress('SYNCED')).toBe(false);
    expect(isInProgress('LOCAL_ONLY')).toBe(false);
  });

  it('isPending', () => {
    expect(isPending('PENDING_UPLOAD')).toBe(true);
    expect(isPending('PENDING_DOWNLOAD')).toBe(true);
    expect(isPending('UPLOADING')).toBe(false);
    expect(isPending('SYNCED')).toBe(false);
  });

  it('isError', () => {
    expect(isError('ERROR')).toBe(true);
    expect(isError('CONFLICT')).toBe(false);
    expect(isError('SYNCED')).toBe(false);
  });

  it('isSynced', () => {
    expect(isSynced('SYNCED')).toBe(true);
    expect(isSynced('UPLOADING')).toBe(false);
  });

  it('isConflict', () => {
    expect(isConflict('CONFLICT')).toBe(true);
    expect(isConflict('ERROR')).toBe(false);
  });
});

describe('needsUpload / needsDownload', () => {
  it('needsUpload: LOCAL_ONLY e PENDING_UPLOAD', () => {
    expect(needsUpload('LOCAL_ONLY')).toBe(true);
    expect(needsUpload('PENDING_UPLOAD')).toBe(true);
    expect(needsUpload('UPLOADING')).toBe(false);
    expect(needsUpload('SYNCED')).toBe(false);
  });

  it('needsDownload: apenas PENDING_DOWNLOAD', () => {
    expect(needsDownload('PENDING_DOWNLOAD')).toBe(true);
    expect(needsDownload('DOWNLOADING')).toBe(false);
    expect(needsDownload('SYNCED')).toBe(false);
  });
});

describe('initialSyncState', () => {
  it('retorna LOCAL_ONLY quando não há dados remotos', () => {
    expect(initialSyncState(false)).toBe('LOCAL_ONLY');
  });

  it('retorna PENDING_DOWNLOAD quando há dados remotos', () => {
    expect(initialSyncState(true)).toBe('PENDING_DOWNLOAD');
  });
});

describe('transitionOnLocalEdit', () => {
  it('SYNCED → PENDING_UPLOAD quando usuário edita', () => {
    expect(transitionOnLocalEdit('SYNCED')).toBe('PENDING_UPLOAD');
  });

  it('PENDING_DOWNLOAD → PENDING_UPLOAD quando usuário edita', () => {
    expect(transitionOnLocalEdit('PENDING_DOWNLOAD')).toBe('PENDING_UPLOAD');
  });

  it('CONFLICT → PENDING_UPLOAD quando usuário edita', () => {
    expect(transitionOnLocalEdit('CONFLICT')).toBe('PENDING_UPLOAD');
  });

  it('LOCAL_ONLY permanece LOCAL_ONLY', () => {
    expect(transitionOnLocalEdit('LOCAL_ONLY')).toBe('LOCAL_ONLY');
  });

  it('PENDING_UPLOAD permanece PENDING_UPLOAD', () => {
    expect(transitionOnLocalEdit('PENDING_UPLOAD')).toBe('PENDING_UPLOAD');
  });

  it('ERROR permanece ERROR (precisa de retry explícito)', () => {
    expect(transitionOnLocalEdit('ERROR')).toBe('ERROR');
  });
});

describe('Cenários completos de transição', () => {
  it('happy path: LOCAL_ONLY → PENDING_UPLOAD → UPLOADING → SYNCED', () => {
    const path: SyncState[] = ['LOCAL_ONLY'];
    expect(canTransition('LOCAL_ONLY', 'PENDING_UPLOAD')).toBe(true);
    path.push('PENDING_UPLOAD');
    expect(canTransition('PENDING_UPLOAD', 'UPLOADING')).toBe(true);
    path.push('UPLOADING');
    expect(canTransition('UPLOADING', 'SYNCED')).toBe(true);
    path.push('SYNCED');
    expect(path).toEqual(['LOCAL_ONLY', 'PENDING_UPLOAD', 'UPLOADING', 'SYNCED']);
  });

  it('cenário de erro com retry: UPLOADING → ERROR → PENDING_UPLOAD → UPLOADING → SYNCED', () => {
    expect(canTransition('UPLOADING', 'ERROR')).toBe(true);
    expect(canTransition('ERROR', 'PENDING_UPLOAD')).toBe(true);
    expect(canTransition('PENDING_UPLOAD', 'UPLOADING')).toBe(true);
    expect(canTransition('UPLOADING', 'SYNCED')).toBe(true);
  });

  it('cenário de conflito: SYNCED → CONFLICT → SYNCED (resolvido)', () => {
    expect(canTransition('SYNCED', 'CONFLICT')).toBe(true);
    expect(canTransition('CONFLICT', 'SYNCED')).toBe(true);
  });

  it('cenário de download: PENDING_DOWNLOAD → DOWNLOADING → SYNCED', () => {
    expect(canTransition('SYNCED', 'PENDING_DOWNLOAD')).toBe(true);
    expect(canTransition('PENDING_DOWNLOAD', 'DOWNLOADING')).toBe(true);
    expect(canTransition('DOWNLOADING', 'SYNCED')).toBe(true);
  });
});
