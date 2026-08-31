import { describe, it, expect, beforeEach } from 'vitest';
import * as db from '../services/db';
import * as queue from '../services/sync/queue';
import { computeBackoff, computeFullJitterBackoff } from '../services/sync/backoff';

beforeEach(async () => {
  db.__useIsolatedDatabaseForTesting();
  localStorage.clear();
  await db.clear(db.STORE_SYNC_QUEUE);
});

describe('computeBackoff', () => {
  it('attempt 1 retorna ~baseDelay', () => {
    const delay = computeBackoff(1, 1000, false);
    expect(delay).toBe(1000);
  });

  it('attempt 2 retorna 2x baseDelay', () => {
    const delay = computeBackoff(2, 1000, false);
    expect(delay).toBe(2000);
  });

  it('attempt 3 retorna 4x baseDelay', () => {
    const delay = computeBackoff(3, 1000, false);
    expect(delay).toBe(4000);
  });

  it('respeita maxDelay', () => {
    const delay = computeBackoff(20, 1000, false, 5000);
    expect(delay).toBe(5000);
  });

  it('com jitter, valor está entre 50% e 100% do exponencial', () => {
    for (let i = 0; i < 20; i++) {
      const delay = computeBackoff(3, 1000, true, 60000);
      expect(delay).toBeGreaterThanOrEqual(2000);
      expect(delay).toBeLessThanOrEqual(4000);
    }
  });

  it('full jitter retorna entre 0 e exponencial', () => {
    for (let i = 0; i < 20; i++) {
      const delay = computeFullJitterBackoff(3, 1000, 60000);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(4000);
    }
  });
});

describe('enqueue', () => {
  it('cria operação com id único', async () => {
    const op = await queue.enqueue({
      type: 'CREATE',
      entityId: 'f-1',
      entityType: 'file',
    });
    expect(op.id).toMatch(/^op-/);
    expect(op.type).toBe('CREATE');
    expect(op.entityId).toBe('f-1');
    expect(op.entityType).toBe('file');
    expect(op.attempts).toBe(0);
    expect(op.status).toBe('pending');
    expect(op.nextAttemptAt).toBe(op.createdAt);
  });

  it('aceita payload', async () => {
    const op = await queue.enqueue({
      type: 'UPDATE',
      entityId: 'f-1',
      entityType: 'file',
      payload: { name: 'new.txt' },
    });
    expect(op.payload).toEqual({ name: 'new.txt' });
  });

  it('respeita initialDelayMs', async () => {
    const op = await queue.enqueue({
      type: 'UPLOAD',
      entityId: 'f-1',
      entityType: 'file',
      initialDelayMs: 5000,
    });
    expect(op.nextAttemptAt - op.createdAt).toBe(5000);
  });

  it('cria múltiplas operações independentes', async () => {
    const op1 = await queue.enqueue({ type: 'CREATE', entityId: 'f-1', entityType: 'file' });
    const op2 = await queue.enqueue({ type: 'CREATE', entityId: 'f-2', entityType: 'file' });
    expect(op1.id).not.toBe(op2.id);
    const all = await queue.listAll();
    expect(all).toHaveLength(2);
  });
});

describe('getOperation / listByStatus / listReadyForExecution', () => {
  it('getOperation retorna null para id inexistente', async () => {
    expect(await queue.getOperation('nope')).toBeNull();
  });

  it('listByStatus filtra corretamente', async () => {
    await queue.enqueue({ type: 'CREATE', entityId: 'f-1', entityType: 'file' });
    await queue.enqueue({ type: 'UPDATE', entityId: 'f-2', entityType: 'file' });
    const op3 = await queue.enqueue({ type: 'DELETE', entityId: 'f-3', entityType: 'file' });
    await queue.markCompleted(op3.id);

    const pending = await queue.listByStatus('pending');
    expect(pending).toHaveLength(2);
    const completed = await queue.listByStatus('completed');
    expect(completed).toHaveLength(1);
  });

  it('listReadyForExecution respeita nextAttemptAt', async () => {
    const immediate = await queue.enqueue({
      type: 'CREATE',
      entityId: 'f-1',
      entityType: 'file',
    });
    await queue.enqueue({
      type: 'CREATE',
      entityId: 'f-2',
      entityType: 'file',
      initialDelayMs: 10000,
    });

    const ready = await queue.listReadyForExecution();
    expect(ready).toHaveLength(1);
    expect(ready[0].id).toBe(immediate.id);
  });

  it('listReadyForExecution aceita timestamp customizado', async () => {
    const op = await queue.enqueue({
      type: 'CREATE',
      entityId: 'f-1',
      entityType: 'file',
      initialDelayMs: 5000,
    });

    const before = await queue.listReadyForExecution(op.createdAt + 4000);
    expect(before).toHaveLength(0);

    const after = await queue.listReadyForExecution(op.createdAt + 6000);
    expect(after).toHaveLength(1);
  });
});

describe('markInProgress / markCompleted', () => {
  it('markInProgress transiciona de pending', async () => {
    const op = await queue.enqueue({ type: 'CREATE', entityId: 'f-1', entityType: 'file' });
    const inProgress = await queue.markInProgress(op.id);
    expect(inProgress.status).toBe('in_progress');
    expect(inProgress.attempts).toBe(1);
  });

  it('markInProgress lança se não está pending', async () => {
    const op = await queue.enqueue({ type: 'CREATE', entityId: 'f-1', entityType: 'file' });
    await queue.markInProgress(op.id);
    await expect(queue.markInProgress(op.id)).rejects.toThrow(/in_progress/);
  });

  it('markCompleted transiciona para completed', async () => {
    const op = await queue.enqueue({ type: 'CREATE', entityId: 'f-1', entityType: 'file' });
    await queue.markInProgress(op.id);
    await queue.markCompleted(op.id);
    const refetched = await queue.getOperation(op.id);
    expect(refetched?.status).toBe('completed');
  });
});

describe('markFailed — retry com backoff', () => {
  it('transiciona para pending com nextAttemptAt futuro', async () => {
    const op = await queue.enqueue({ type: 'UPLOAD', entityId: 'f-1', entityType: 'file' });
    await queue.markInProgress(op.id);
    const failed = await queue.markFailed(op.id, 'relay error', {
      baseDelayMs: 1000,
      jitter: false,
    });
    expect(failed.status).toBe('pending');
    expect(failed.lastError).toBe('relay error');
    expect(failed.attempts).toBe(1);
    expect(failed.nextAttemptAt).toBeGreaterThan(Date.now());
  });

  it('após maxAttempts, marca como failed permanente', async () => {
    const op = await queue.enqueue({ type: 'UPLOAD', entityId: 'f-1', entityType: 'file' });
    await queue.markInProgress(op.id);
    const permanent = await queue.markFailed(op.id, 'persistent', {
      baseDelayMs: 100,
      maxAttempts: 1,
      jitter: false,
    });
    expect(permanent.status).toBe('failed');
    expect(permanent.lastError).toBe('persistent');
  });

  it('incrementa attempts a cada falha', async () => {
    const op = await queue.enqueue({ type: 'UPLOAD', entityId: 'f-1', entityType: 'file' });
    await queue.markInProgress(op.id);
    const f1 = await queue.markFailed(op.id, 'err1', { baseDelayMs: 10, jitter: false });
    expect(f1.attempts).toBe(1);
    await queue.markInProgress(op.id);
    const f2 = await queue.markFailed(op.id, 'err2', { baseDelayMs: 10, jitter: false });
    expect(f2.attempts).toBe(2);
  });
});

describe('cancel / cancelByEntity', () => {
  it('cancel muda status para cancelled', async () => {
    const op = await queue.enqueue({ type: 'CREATE', entityId: 'f-1', entityType: 'file' });
    await queue.cancel(op.id);
    const refetched = await queue.getOperation(op.id);
    expect(refetched?.status).toBe('cancelled');
  });

  it('cancel é idempotente para completed', async () => {
    const op = await queue.enqueue({ type: 'CREATE', entityId: 'f-1', entityType: 'file' });
    await queue.markInProgress(op.id);
    await queue.markCompleted(op.id);
    await queue.cancel(op.id);
    const refetched = await queue.getOperation(op.id);
    expect(refetched?.status).toBe('completed');
  });

  it('cancelByEntity cancela todas operações pendentes da entidade', async () => {
    await queue.enqueue({ type: 'CREATE', entityId: 'f-1', entityType: 'file' });
    await queue.enqueue({ type: 'UPDATE', entityId: 'f-1', entityType: 'file' });
    await queue.enqueue({ type: 'CREATE', entityId: 'f-2', entityType: 'file' });

    const cancelled = await queue.cancelByEntity('f-1');
    expect(cancelled).toBe(2);

    const all = await queue.listAll();
    const f1 = all.filter((op) => op.entityId === 'f-1');
    expect(f1.every((op) => op.status === 'cancelled')).toBe(true);
    const f2 = all.filter((op) => op.entityId === 'f-2');
    expect(f2[0].status).toBe('pending');
  });
});

describe('pruneOld / getStats / clearAll', () => {
  it('pruneOld remove apenas completed/cancelled/failed antigos', async () => {
    const op1 = await queue.enqueue({ type: 'CREATE', entityId: 'f-1', entityType: 'file' });
    await queue.markInProgress(op1.id);
    await queue.markCompleted(op1.id);
    const oldCompleted = await db.get<db.SyncOperation>(db.STORE_SYNC_QUEUE, op1.id);
    if (oldCompleted) {
      await db.put(db.STORE_SYNC_QUEUE, {
        ...oldCompleted,
        updatedAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
      });
    }

    const op2 = await queue.enqueue({ type: 'CREATE', entityId: 'f-2', entityType: 'file' });
    expect(op2.status).toBe('pending');

    const result = await queue.pruneOld(7 * 24 * 60 * 60 * 1000);
    expect(result.removed).toBe(1);
    expect(result.remaining).toBe(1);
  });

  it('getStats conta por status', async () => {
    const op1 = await queue.enqueue({ type: 'CREATE', entityId: 'f-1', entityType: 'file' });
    const op2 = await queue.enqueue({ type: 'UPDATE', entityId: 'f-2', entityType: 'file' });
    await queue.markInProgress(op1.id);
    await queue.markInProgress(op2.id);
    await queue.markCompleted(op1.id);
    await queue.markFailed(op2.id, 'err', { maxAttempts: 1, baseDelayMs: 10, jitter: false });

    const stats = await queue.getStats();
    expect(stats.total).toBe(2);
    expect(stats.completed).toBe(1);
    expect(stats.failed).toBe(1);
  });

  it('clearAll remove tudo', async () => {
    await queue.enqueue({ type: 'CREATE', entityId: 'f-1', entityType: 'file' });
    await queue.enqueue({ type: 'CREATE', entityId: 'f-2', entityType: 'file' });
    await queue.clearAll();
    expect(await queue.listAll()).toEqual([]);
  });
});

describe('Tipos de operação', () => {
  const types: queue.SyncOperationType[] = [
    'CREATE',
    'UPDATE',
    'MOVE',
    'RENAME',
    'DELETE',
    'RESTORE',
    'UPLOAD',
    'DOWNLOAD',
  ];

  for (const type of types) {
    it(`enqueue aceita type=${type}`, async () => {
      const op = await queue.enqueue({ type, entityId: 'f-1', entityType: 'file' });
      expect(op.type).toBe(type);
    });
  }
});
