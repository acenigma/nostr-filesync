import { describe, it, expect, beforeEach } from 'vitest';
import * as storage from '../services/storage';

beforeEach(() => {
  localStorage.clear();
});

describe('Storage Service', () => {
  describe('formatBytes', () => {
    it('formata bytes', () => {
      expect(storage.formatBytes(500)).toBe('500 B');
      expect(storage.formatBytes(1536)).toBe('1.5 KB');
      expect(storage.formatBytes(1572864)).toBe('1.5 MB');
      expect(storage.formatBytes(1610612736)).toBe('1.5 GB');
    });
  });

  describe('StorageState management (8.5)', () => {
    it('retorna available_offline por padrão', () => {
      const state = storage.getStorageState('file-1', 'file');
      expect(state).toBe('available_offline');
    });

    it('setStorageState persiste o estado', () => {
      storage.setStorageState('file-1', 'file', 'online_only');
      expect(storage.getStorageState('file-1', 'file')).toBe('online_only');
    });

    it('setStorageState atualiza estado existente', () => {
      storage.setStorageState('file-1', 'file', 'online_only');
      storage.setStorageState('file-1', 'file', 'pinned');
      expect(storage.getStorageState('file-1', 'file')).toBe('always_offline');
    });

    it('pinned é tratado como always_offline no acesso', () => {
      storage.setStorageState('file-1', 'file', 'pinned');
      expect(storage.getStorageState('file-1', 'file')).toBe('always_offline');
    });

    it('estados são independentes por entityId', () => {
      storage.setStorageState('file-1', 'file', 'online_only');
      storage.setStorageState('file-2', 'file', 'always_offline');
      expect(storage.getStorageState('file-1', 'file')).toBe('online_only');
      expect(storage.getStorageState('file-2', 'file')).toBe('always_offline');
    });

    it('estados de pasta e arquivo são independentes', () => {
      storage.setStorageState('fld-1', 'folder', 'pinned');
      expect(storage.getStorageState('fld-1', 'folder')).toBe('always_offline');
      expect(storage.getStorageState('fld-1', 'file')).toBe('available_offline');
    });

    it('lança erro para estado inválido', () => {
      expect(() => storage.setStorageState('f1', 'file', 'invalid' as any)).toThrow(
        /Estado inválido/
      );
    });

    it('clearStorageStates limpa todos os estados', () => {
      storage.setStorageState('file-1', 'file', 'online_only');
      storage.clearStorageStates();
      expect(storage.getStorageState('file-1', 'file')).toBe('available_offline');
    });

    it('getStorageStates retorna todos os registros', () => {
      storage.setStorageState('file-1', 'file', 'online_only');
      storage.setStorageState('folder-1', 'folder', 'pinned');
      const states = storage.getStorageStates();
      expect(states).toHaveLength(2);
      expect(states.find((s) => s.entityId === 'file-1')?.state).toBe('online_only');
      expect(states.find((s) => s.entityId === 'folder-1')?.state).toBe('pinned');
    });
  });

  describe('StorageEstimate (8.1)', () => {
    it('retorna null quando navigator.storage não existe', async () => {
      const original = (globalThis as any).navigator;
      try {
        (globalThis as any).navigator = { storage: undefined };
        const result = await storage.getStorageEstimate();
        expect(result).toBeNull();
      } finally {
        (globalThis as any).navigator = original;
      }
    });

    it('retorna null quando estimate não é uma função', async () => {
      const original = (globalThis as any).navigator;
      try {
        (globalThis as any).navigator = {
          storage: { estimate: undefined },
        };
        const result = await storage.getStorageEstimate();
        expect(result).toBeNull();
      } finally {
        (globalThis as any).navigator = original;
      }
    });
  });

  describe('Alertas (8.3)', () => {
    it('retorna level "none" quando estimate é null', async () => {
      const alert = await storage.getStorageAlert(null);
      expect(alert.level).toBe('none');
    });

    it('retorna "none" quando quota é 0', async () => {
      const alert = await storage.getStorageAlert({ quota: 0, usage: 0 });
      expect(alert.level).toBe('none');
    });

    it('retorna "warning" quando uso >= 80%', async () => {
      const alert = await storage.getStorageAlert({ quota: 100, usage: 80 });
      expect(alert.level).toBe('warning');
    });

    it('retorna "critical" quando uso >= 90%', async () => {
      const alert = await storage.getStorageAlert({ quota: 100, usage: 90 });
      expect(alert.level).toBe('critical');
    });

    it('retorna "restricted" quando uso >= 95%', async () => {
      const alert = await storage.getStorageAlert({ quota: 100, usage: 95 });
      expect(alert.level).toBe('restricted');
    });

    it('retorna "none" quando uso < 80%', async () => {
      const alert = await storage.getStorageAlert({ quota: 100, usage: 50 });
      expect(alert.level).toBe('none');
      expect(alert.percent).toBe(0.5);
    });
  });

  describe('Alert thresholds', () => {
    it('warning é 80%', () => {
      expect(storage.getAlertThresholds().warning).toBe(0.8);
    });
    it('critical é 90%', () => {
      expect(storage.getAlertThresholds().critical).toBe(0.9);
    });
    it('restricted é 95%', () => {
      expect(storage.getAlertThresholds().restricted).toBe(0.95);
    });
  });
});
