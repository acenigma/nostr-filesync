import { describe, it, expect, beforeEach } from 'vitest';
import * as db from '../services/db';
import * as retention from '../services/retention';
import * as trash from '../services/trash';
import * as versions from '../services/versions';
import * as fileEntity from '../services/file-entity';

beforeEach(async () => {
  db.__useIsolatedDatabaseForTesting();
  localStorage.clear();
  await db.clear(db.STORE_FILES);
  await db.clear(db.STORE_FILE_VERSIONS);
  await db.clear(db.STORE_TRASH);
});

describe('Retention Service', () => {
  describe('getRetentionConfig / setRetentionConfig', () => {
    it('retorna config padrão quando não há config salva', async () => {
      const config = await retention.getRetentionConfig();
      expect(config.trashRetention).toBe('30d');
      expect(config.versionRetention).toBe('1y');
      expect(config.maxVersionsPerFile).toBe(50);
      expect(config.enabled).toBe(true);
    });

    it('salva e carrega config personalizada', async () => {
      await retention.setRetentionConfig({
        trashRetention: '90d',
        versionRetention: '30d',
        maxVersionsPerFile: 100,
        enabled: false,
      });

      const config = await retention.getRetentionConfig();
      expect(config.trashRetention).toBe('90d');
      expect(config.versionRetention).toBe('30d');
      expect(config.maxVersionsPerFile).toBe(100);
      expect(config.enabled).toBe(false);
    });

    it('merge com config padrão', async () => {
      await retention.setRetentionConfig({ trashRetention: '1y' });
      const config = await retention.getRetentionConfig();
      expect(config.trashRetention).toBe('1y');
      expect(config.versionRetention).toBe('1y');
      expect(config.maxVersionsPerFile).toBe(50);
    });
  });

  describe('formatPeriod', () => {
    it('formata períodos conhecidos', () => {
      expect(retention.formatPeriod('30d')).toBe('30 dias');
      expect(retention.formatPeriod('90d')).toBe('90 dias');
      expect(retention.formatPeriod('1y')).toBe('1 ano');
      expect(retention.formatPeriod('indefinite')).toBe('Indefinido');
    });

    it('formata período customizado', () => {
      expect(retention.formatPeriod('custom', 60)).toBe('60 dias');
      expect(retention.formatPeriod('custom')).toBe('30 dias');
    });
  });

  describe('periodToMs (via applyTrashRetention)', () => {
    it('remove lixo antigo com retenção de 30 dias', async () => {
      const file = await fileEntity.createFile({
        name: 'old.txt',
        mimeType: 'text/plain',
        size: 100,
        contentHash: 'a'.repeat(64),
        chunks: 1,
        headerEventId: 'h-retention-1',
        encrypted: false,
      });

      await fileEntity.deleteFile(file.fileId);

      const trashItem = await trash.getTrashItem(file.fileId);
      expect(trashItem).not.toBeNull();

      await retention.setRetentionConfig({ trashRetention: '30d', enabled: true });

      const oldDate = Date.now() - 31 * 24 * 60 * 60 * 1000;
      if (trashItem) {
        await db.put(db.STORE_TRASH, { ...trashItem, deletedAt: oldDate });
      }

      const removed = await retention.applyTrashRetention();
      expect(removed).toBe(1);

      const remaining = await trash.getTrashItem(file.fileId);
      expect(remaining).toBeNull();
    });

    it('não remove lixo recente', async () => {
      const file = await fileEntity.createFile({
        name: 'recent.txt',
        mimeType: 'text/plain',
        size: 100,
        contentHash: 'b'.repeat(64),
        chunks: 1,
        headerEventId: 'h-retention-2',
        encrypted: false,
      });

      await fileEntity.deleteFile(file.fileId);

      await retention.setRetentionConfig({ trashRetention: '30d', enabled: true });

      const removed = await retention.applyTrashRetention();
      expect(removed).toBe(0);

      const remaining = await trash.getTrashItem(file.fileId);
      expect(remaining).not.toBeNull();
    });

    it('não remove quando retenção é indefinida', async () => {
      const file = await fileEntity.createFile({
        name: 'indef.txt',
        mimeType: 'text/plain',
        size: 100,
        contentHash: 'c'.repeat(64),
        chunks: 1,
        headerEventId: 'h-retention-3',
        encrypted: false,
      });

      await fileEntity.deleteFile(file.fileId);

      const trashItem = await trash.getTrashItem(file.fileId);
      if (trashItem) {
        await db.put(db.STORE_TRASH, { ...trashItem, deletedAt: Date.now() - 400 * 24 * 60 * 60 * 1000 });
      }

      await retention.setRetentionConfig({ trashRetention: 'indefinite', enabled: true });

      const removed = await retention.applyTrashRetention();
      expect(removed).toBe(0);
    });

    it('não remove quando desabilitado', async () => {
      const file = await fileEntity.createFile({
        name: 'disabled.txt',
        mimeType: 'text/plain',
        size: 100,
        contentHash: 'd'.repeat(64),
        chunks: 1,
        headerEventId: 'h-retention-4',
        encrypted: false,
      });

      await fileEntity.deleteFile(file.fileId);

      await retention.setRetentionConfig({ trashRetention: '30d', enabled: false });

      const removed = await retention.applyTrashRetention();
      expect(removed).toBe(0);
    });
  });

  describe('applyVersionRetention', () => {
    it('remove versões antigas além do limite de versões por arquivo', async () => {
      const file = await fileEntity.createFile({
        name: 'versioned.txt',
        mimeType: 'text/plain',
        size: 100,
        contentHash: 'e'.repeat(64),
        chunks: 1,
        headerEventId: 'h-retention-5',
        encrypted: false,
      });

      for (let i = 0; i < 10; i++) {
        await fileEntity.renameFile(file.fileId, `v${i}.txt`);
        await new Promise(r => setTimeout(r, 2));
      }

      const vers = await versions.listVersions(file.fileId);
      expect(vers.length).toBe(10);

      await retention.setRetentionConfig({
        versionRetention: '30d',
        maxVersionsPerFile: 5,
        enabled: true,
      });

      const oldDate = Date.now() - 31 * 24 * 60 * 60 * 1000;
      const allVersions = await versions.listVersions(file.fileId);
      for (let i = 0; i < 6; i++) {
        await db.put(db.STORE_FILE_VERSIONS, { ...allVersions[i], createdAt: oldDate - i * 1000 });
      }

      const removed = await retention.applyVersionRetention();
      expect(removed).toBeGreaterThan(0);

      const remaining = await versions.listVersions(file.fileId);
      expect(remaining.length).toBeLessThanOrEqual(5);
    });

    it('não remove quando retenção de versões é indefinida', async () => {
      const file = await fileEntity.createFile({
        name: 'versioned2.txt',
        mimeType: 'text/plain',
        size: 100,
        contentHash: 'f'.repeat(64),
        chunks: 1,
        headerEventId: 'h-retention-6',
        encrypted: false,
      });

      for (let i = 0; i < 10; i++) {
        await fileEntity.renameFile(file.fileId, `v${i}.txt`);
      }

      await retention.setRetentionConfig({
        versionRetention: 'indefinite',
        maxVersionsPerFile: 5,
        enabled: true,
      });

      const removed = await retention.applyVersionRetention();
      expect(removed).toBe(0);
    });
  });

  describe('applyRetention', () => {
    it('executa retenção completa', async () => {
      const file1 = await fileEntity.createFile({
        name: 'trash.txt',
        mimeType: 'text/plain',
        size: 100,
        contentHash: 'g'.repeat(64),
        chunks: 1,
        headerEventId: 'h-retention-7',
        encrypted: false,
      });
      await fileEntity.deleteFile(file1.fileId);
      const trashItem = await trash.getTrashItem(file1.fileId);
      if (trashItem) {
        await db.put(db.STORE_TRASH, { ...trashItem, deletedAt: Date.now() - 31 * 24 * 60 * 60 * 1000 });
      }

      const file2 = await fileEntity.createFile({
        name: 'versioned.txt',
        mimeType: 'text/plain',
        size: 100,
        contentHash: 'h'.repeat(64),
        chunks: 1,
        headerEventId: 'h-retention-8',
        encrypted: false,
      });
      for (let i = 0; i < 10; i++) {
        await fileEntity.renameFile(file2.fileId, `v${i}.txt`);
      }
      const vers = await versions.listVersions(file2.fileId);
      const oldDate = Date.now() - 31 * 24 * 60 * 60 * 1000;
      for (let i = 0; i < 6; i++) {
        await db.put(db.STORE_FILE_VERSIONS, { ...vers[i], createdAt: oldDate - i * 1000 });
      }

      await retention.setRetentionConfig({
        trashRetention: '30d',
        versionRetention: '30d',
        maxVersionsPerFile: 5,
        enabled: true,
      });

      const result = await retention.applyRetention();
      expect(result.trashRemoved).toBe(1);
      expect(result.versionsRemoved).toBeGreaterThan(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('retorna zeros quando desabilitado', async () => {
      await retention.setRetentionConfig({ enabled: false });
      const result = await retention.applyRetention();
      expect(result.trashRemoved).toBe(0);
      expect(result.versionsRemoved).toBe(0);
      expect(result.durationMs).toBe(0);
    });
  });

  describe('scheduleRetention / cancelScheduledRetention', () => {
    it('agenda e cancela retenção', async () => {
      expect(retention.isRetentionScheduled()).toBe(false);
      retention.scheduleRetention(100);
      expect(retention.isRetentionScheduled()).toBe(true);
      retention.cancelScheduledRetention();
      expect(retention.isRetentionScheduled()).toBe(false);
    });
  });
});