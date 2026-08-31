import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as db from '../services/db';
import * as queue from '../services/sync/queue';
import * as retry from '../services/sync/retry';

beforeEach(async () => {
  db.__useIsolatedDatabaseForTesting();
  localStorage.clear();
  await db.clear(db.STORE_SYNC_QUEUE);
});

describe('executeWithRetry', () => {
  it('marca como completed quando executor tem sucesso', async () => {
    const op = await queue.enqueue({ type: 'CREATE', entityId: 'f-1', entityType: 'file' });
    const executor = vi.fn().mockResolvedValue(undefined);

    const result = await retry.executeWithRetry(op.id, executor, {
      baseDelayMs: 10,
      jitter: false,
    });

    expect(result.status).toBe('completed');
    expect(result.attempts).toBe(1);
    expect(executor).toHaveBeenCalledOnce();

    const refetched = await queue.getOperation(op.id);
    expect(refetched?.status).toBe('completed');
  });

  it('em caso de erro, reagenda com backoff', async () => {
    const op = await queue.enqueue({ type: 'CREATE', entityId: 'f-1', entityType: 'file' });
    const executor = vi.fn().mockRejectedValue(new Error('relay error'));

    const result = await retry.executeWithRetry(op.id, executor, {
      baseDelayMs: 100,
      maxAttempts: 3,
      jitter: false,
    });

    expect(result.status).toBe('pending');
    expect(result.attempts).toBe(1);
    expect(result.error).toBe('relay error');

    const refetched = await queue.getOperation(op.id);
    expect(refetched?.status).toBe('pending');
    expect(refetched?.lastError).toBe('relay error');
    expect(refetched?.nextAttemptAt).toBeGreaterThan(Date.now());
  });

  it('após maxAttempts, marca como failed permanente', async () => {
    const op = await queue.enqueue({ type: 'CREATE', entityId: 'f-1', entityType: 'file' });
    const executor = vi.fn().mockRejectedValue(new Error('persistent'));

    const result = await retry.executeWithRetry(op.id, executor, {
      baseDelayMs: 10,
      maxAttempts: 1,
      jitter: false,
    });

    expect(result.status).toBe('failed');
    expect(result.attempts).toBe(1);

    const refetched = await queue.getOperation(op.id);
    expect(refetched?.status).toBe('failed');
  });

  it('incrementa attempts a cada retry', async () => {
    const op = await queue.enqueue({ type: 'CREATE', entityId: 'f-1', entityType: 'file' });
    const executor = vi.fn().mockRejectedValue(new Error('fail'));

    await retry.executeWithRetry(op.id, executor, { baseDelayMs: 1, jitter: false });
    const op2 = await queue.getOperation(op.id);
    expect(op2?.attempts).toBe(1);

    await retry.executeWithRetry(op.id, executor, { baseDelayMs: 1, jitter: false });
    const op3 = await queue.getOperation(op.id);
    expect(op3?.attempts).toBe(2);
  });

  it('respeita AbortSignal', async () => {
    const op = await queue.enqueue({ type: 'CREATE', entityId: 'f-1', entityType: 'file' });
    const controller = new AbortController();
    controller.abort();

    const executor = vi.fn();
    const result = await retry.executeWithRetry(op.id, executor, {
      signal: controller.signal,
    });

    expect(result.status).toBe('aborted');
    expect(executor).not.toHaveBeenCalled();
  });
});

describe('processQueue', () => {
  it('processa operações prontas', async () => {
    const op1 = await queue.enqueue({ type: 'CREATE', entityId: 'f-1', entityType: 'file' });
    const op2 = await queue.enqueue({ type: 'UPDATE', entityId: 'f-2', entityType: 'file' });
    await queue.enqueue({
      type: 'CREATE',
      entityId: 'f-3',
      entityType: 'file',
      initialDelayMs: 60000,
    });

    const executor = vi.fn().mockResolvedValue(undefined);
    const result = await retry.processQueue(executor, { baseDelayMs: 10, jitter: false });

    expect(result.processed).toBe(2);
    expect(result.completed).toBe(2);
    expect(executor).toHaveBeenCalledTimes(2);

    expect((await queue.getOperation(op1.id))?.status).toBe('completed');
    expect((await queue.getOperation(op2.id))?.status).toBe('completed');
  });

  it('respeita limit', async () => {
    for (let i = 0; i < 5; i++) {
      await queue.enqueue({ type: 'CREATE', entityId: `f-${i}`, entityType: 'file' });
    }

    const executor = vi.fn().mockResolvedValue(undefined);
    const result = await retry.processQueue(executor, { limit: 2, baseDelayMs: 10, jitter: false });

    expect(result.processed).toBe(2);
    expect(executor).toHaveBeenCalledTimes(2);
  });

  it('conta completed, pending, failed separadamente', async () => {
    const ok = await queue.enqueue({ type: 'CREATE', entityId: 'f-ok', entityType: 'file' });
    const fail = await queue.enqueue({ type: 'CREATE', entityId: 'f-fail', entityType: 'file' });

    const executor = vi.fn().mockImplementation(async (op: queue.SyncOperation) => {
      if (op.entityId === 'f-fail') {
        throw new Error('failed');
      }
    });

    const result = await retry.processQueue(executor, {
      baseDelayMs: 10,
      maxAttempts: 1,
      jitter: false,
    });

    expect(result.completed).toBe(1);
    expect(result.failed).toBe(1);
    expect((await queue.getOperation(ok.id))?.status).toBe('completed');
    expect((await queue.getOperation(fail.id))?.status).toBe('failed');
  });

  it('respeita AbortSignal entre operações', async () => {
    for (let i = 0; i < 5; i++) {
      await queue.enqueue({ type: 'CREATE', entityId: `f-${i}`, entityType: 'file' });
    }

    const controller = new AbortController();
    const executor = vi.fn().mockImplementation(async () => {
      controller.abort();
    });

    const result = await retry.processQueue(executor, {
      signal: controller.signal,
    });

    expect(result.processed).toBe(1);
    expect(executor).toHaveBeenCalledOnce();
  });

  it('retorna zeros quando não há operações prontas', async () => {
    await queue.enqueue({
      type: 'CREATE',
      entityId: 'f-1',
      entityType: 'file',
      initialDelayMs: 60000,
    });

    const executor = vi.fn();
    const result = await retry.processQueue(executor);

    expect(result.processed).toBe(0);
    expect(executor).not.toHaveBeenCalled();
  });
});

describe('executeNext', () => {
  it('executa a próxima operação pronta', async () => {
    const op = await queue.enqueue({ type: 'CREATE', entityId: 'f-1', entityType: 'file' });
    const executor = vi.fn().mockResolvedValue(undefined);

    const result = await retry.executeNext(executor, { baseDelayMs: 10, jitter: false });
    expect(result).not.toBeNull();
    expect(result?.status).toBe('completed');
    expect((await queue.getOperation(op.id))?.status).toBe('completed');
  });

  it('retorna null quando não há operações prontas', async () => {
    await queue.enqueue({
      type: 'CREATE',
      entityId: 'f-1',
      entityType: 'file',
      initialDelayMs: 60000,
    });

    const result = await retry.executeNext(vi.fn());
    expect(result).toBeNull();
  });
});

describe('Cenários completos de retry', () => {
  it('retry com sucesso após 2 falhas', async () => {
    const op = await queue.enqueue({ type: 'CREATE', entityId: 'f-1', entityType: 'file' });

    let attempts = 0;
    const executor = vi.fn().mockImplementation(async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error(`tentativa ${attempts} falhou`);
      }
    });

    // Tentativa 1
    const r1 = await retry.executeWithRetry(op.id, executor, {
      baseDelayMs: 1,
      maxAttempts: 5,
      jitter: false,
    });
    expect(r1.status).toBe('pending');
    expect(attempts).toBe(1);

    // Aguardar backoff
    const refetched = await queue.getOperation(op.id);
    await new Promise((r) => setTimeout(r, refetched!.nextAttemptAt - Date.now() + 10));

    // Tentativa 2
    const r2 = await retry.executeWithRetry(op.id, executor, {
      baseDelayMs: 1,
      maxAttempts: 5,
      jitter: false,
    });
    expect(r2.status).toBe('pending');
    expect(attempts).toBe(2);

    // Aguardar
    const refetched2 = await queue.getOperation(op.id);
    await new Promise((r) => setTimeout(r, refetched2!.nextAttemptAt - Date.now() + 10));

    // Tentativa 3 — sucesso
    const r3 = await retry.executeWithRetry(op.id, executor, {
      baseDelayMs: 1,
      maxAttempts: 5,
      jitter: false,
    });
    expect(r3.status).toBe('completed');
    expect(attempts).toBe(3);
  });
});
