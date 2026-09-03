import { describe, it, expect, beforeEach, vi } from 'vitest';

let postMessageMock: ReturnType<typeof vi.fn>;
let addEventListenerMock: ReturnType<typeof vi.fn>;
let terminateMock: ReturnType<typeof vi.fn>;
let messageHandler: ((e: MessageEvent) => void) | null = null;
let errorHandler: ((e: Event) => void) | null = null;

beforeEach(() => {
  postMessageMock = vi.fn();
  terminateMock = vi.fn();
  messageHandler = null;
  errorHandler = null;
  addEventListenerMock = vi.fn().mockImplementation((type: string, l: EventListener) => {
    if (type === 'message') messageHandler = l as (e: MessageEvent) => void;
    if (type === 'error') errorHandler = l as (e: Event) => void;
  });
  class MockWorker {
    postMessage = postMessageMock;
    addEventListener = addEventListenerMock;
    removeEventListener = vi.fn();
    terminate = terminateMock;
  }
  vi.stubGlobal('Worker', MockWorker);
  vi.resetModules();
});

describe('hashInWorker', () => {
  it('creates a worker, posts a message, and resolves with hash', async () => {
    const { hashInWorker } = await import('../services/hashWorkerClient');
    const data = new Uint8Array([1, 2, 3]);
    const promise = hashInWorker(data);
    expect(postMessageMock).toHaveBeenCalled();
    expect(messageHandler).not.toBeNull();
    const call = postMessageMock.mock.calls[0][0];
    const id = call.id;
    messageHandler!({ data: { id, ok: true, hash: 'abc123' } } as unknown as MessageEvent);
    await expect(promise).resolves.toBe('abc123');
  });

  it('rejects on error response', async () => {
    const { hashInWorker } = await import('../services/hashWorkerClient');
    const promise = hashInWorker(new Uint8Array([0]));
    const id = postMessageMock.mock.calls[0][0].id;
    messageHandler!({ data: { id, ok: false, error: 'bad' } } as unknown as MessageEvent);
    await expect(promise).rejects.toThrow('bad');
  });

  it('rejects all pending tasks when worker errors', async () => {
    const { hashInWorker, getHashWorker } = await import('../services/hashWorkerClient');
    const p1 = hashInWorker(new Uint8Array([1]));
    errorHandler!(new Event('error'));
    await expect(p1).rejects.toThrow('worker crashed');
    const client = getHashWorker();
    expect(() => client.destroy()).not.toThrow();
  });

  it('ignores unknown message ids', async () => {
    const { hashInWorker } = await import('../services/hashWorkerClient');
    const promise = hashInWorker(new Uint8Array([1]));
    messageHandler!({ data: { id: 'unknown', ok: true, hash: 'x' } } as unknown as MessageEvent);
    const id = postMessageMock.mock.calls[0][0].id;
    messageHandler!({ data: { id, ok: true, hash: 'real' } } as unknown as MessageEvent);
    await expect(promise).resolves.toBe('real');
  });
});
