import * as queue from './queue';

export type OperationExecutor = (op: queue.SyncOperation) => Promise<void>;

export interface ExecuteOptions {
  baseDelayMs?: number;
  maxAttempts?: number;
  jitter?: boolean;
  signal?: AbortSignal;
}

export interface ExecuteResult {
  operationId: string;
  status: 'completed' | 'pending' | 'failed' | 'aborted';
  attempts: number;
  error?: string;
}

export async function executeWithRetry(
  operationId: string,
  executor: OperationExecutor,
  options: ExecuteOptions = {}
): Promise<ExecuteResult> {
  if (options.signal?.aborted) {
    return { operationId, status: 'aborted', attempts: 0 };
  }

  const op = await queue.markInProgress(operationId);
  try {
    await executor(op);
    await queue.markCompleted(operationId);
    return { operationId, status: 'completed', attempts: op.attempts };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const failed = await queue.markFailed(operationId, error, {
      baseDelayMs: options.baseDelayMs,
      maxAttempts: options.maxAttempts,
      jitter: options.jitter,
    });
    return {
      operationId,
      status: failed.status === 'failed' ? 'failed' : 'pending',
      attempts: failed.attempts,
      error,
    };
  }
}

export interface ProcessOptions extends ExecuteOptions {
  limit?: number;
}

export interface ProcessResult {
  processed: number;
  completed: number;
  pending: number;
  failed: number;
  aborted: number;
}

export async function processQueue(
  executor: OperationExecutor,
  options: ProcessOptions = {}
): Promise<ProcessResult> {
  const limit = options.limit ?? 10;
  const ready = await queue.listReadyForExecution();
  const toProcess = ready.slice(0, limit);

  const result: ProcessResult = {
    processed: 0,
    completed: 0,
    pending: 0,
    failed: 0,
    aborted: 0,
  };

  for (const op of toProcess) {
    if (options.signal?.aborted) break;
    const execResult = await executeWithRetry(op.id, executor, options);
    result.processed++;
    switch (execResult.status) {
      case 'completed':
        result.completed++;
        break;
      case 'pending':
        result.pending++;
        break;
      case 'failed':
        result.failed++;
        break;
      case 'aborted':
        result.aborted++;
        break;
    }
  }

  return result;
}

export async function executeNext(
  executor: OperationExecutor,
  options: ExecuteOptions = {}
): Promise<ExecuteResult | null> {
  const ready = await queue.listReadyForExecution();
  if (ready.length === 0) return null;
  const op = ready[0];
  return executeWithRetry(op.id, executor, options);
}
