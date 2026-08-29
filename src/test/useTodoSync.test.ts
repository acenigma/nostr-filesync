import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import * as nostr from '../services/nostr';
import type { NostrEvent } from 'nostr-tools';
import { useTodoSync } from '../hooks/useTodoSync';

vi.mock('../services/nostr', async () => {
  const actual = await vi.importActual<typeof nostr>('../services/nostr');
  return {
    ...actual,
    onAuthChange: vi.fn(() => () => {}),
    checkStoredCredential: vi.fn(),
    getKeys: vi.fn(() => ({ privateKey: null, publicKey: 'pk-test' })),
    initNostr: vi.fn().mockResolvedValue(undefined),
    getNpub: vi.fn(() => 'npub-test'),
    subscribeToTodos: vi.fn(() => () => {}),
    fetchTodos: vi.fn().mockResolvedValue([]),
    onConnectionChange: vi.fn(() => () => {}),
    publishEvent: vi.fn().mockResolvedValue(1),
    createTodoEvent: vi.fn((text: string) => ({
      event: {
        id: 'evt-1',
        pubkey: 'pk',
        kind: 30000,
        content: JSON.stringify({ text, done: false }),
        tags: [['d', 't-1']],
        created_at: 100,
        sig: 'sig',
      },
      todoId: 't-1',
    })),
    createUpdateEvent: vi.fn((id: string, text: string, done: boolean) => ({
      id: 'evt-2',
      pubkey: 'pk',
      kind: 30000,
      content: JSON.stringify({ text, done }),
      tags: [['d', id]],
      created_at: 101,
      sig: 'sig',
    })),
    createDeleteEvent: vi.fn((id: string) => ({
      id: 'evt-d',
      pubkey: 'pk',
      kind: 5,
      content: '',
      tags: [['e', id]],
      created_at: 102,
      sig: 'sig',
    })),
    parseTodoPayload: actual.parseTodoPayload,
  };
});

const todoEvent = (id: string, text: string, done: boolean, createdAt: number): NostrEvent => ({
  id: 'evt-' + id,
  pubkey: 'pk-test',
  created_at: createdAt,
  kind: 30000,
  tags: [['d', id]],
  content: JSON.stringify({ text, done }),
  sig: 'sig',
});

describe('useTodoSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetch inicial carrega todos', async () => {
    vi.mocked(nostr.fetchTodos).mockResolvedValue([
      { id: 't-1', text: 'hello', done: false, eventId: 'e1', createdAt: 1 },
    ]);

    const { result } = renderHook(() => useTodoSync());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(result.current.todos).toHaveLength(1);
    expect(result.current.todos[0].text).toBe('hello');
    expect(result.current.loading).toBe(false);
  });

  it('addTodo adiciona otimisticamente', async () => {
    const { result } = renderHook(() => useTodoSync());

    await act(async () => {
      await result.current.addTodo({ preventDefault: () => {} } as React.FormEvent);
    });

    expect(result.current.todos.length).toBeGreaterThanOrEqual(1);
    expect(result.current.newTodo).toBe('');
  });

  it('toggleTodo atualiza done e publica evento', async () => {
    vi.mocked(nostr.fetchTodos).mockResolvedValue([
      { id: 't-1', text: 'a', done: false, eventId: 'e1', createdAt: 1 },
    ]);

    const { result } = renderHook(() => useTodoSync());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    await act(async () => {
      await result.current.toggleTodo(result.current.todos[0]);
    });

    expect(result.current.todos[0].done).toBe(true);
    expect(nostr.publishEvent).toHaveBeenCalled();
  });

  it('deleteTodo remove e publica kind 5', async () => {
    vi.mocked(nostr.fetchTodos).mockResolvedValue([
      { id: 't-1', text: 'a', done: false, eventId: 'e1', createdAt: 1 },
    ]);

    const { result } = renderHook(() => useTodoSync());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    await act(async () => {
      await result.current.deleteTodo(result.current.todos[0]);
    });

    expect(result.current.todos).toHaveLength(0);
    expect(nostr.publishEvent).toHaveBeenCalled();
  });

  it('aplica evento kind 5 via subscribe e remove todo', async () => {
    let capturedCb: ((e: NostrEvent) => void) | null = null;
    vi.mocked(nostr.subscribeToTodos).mockImplementation((_pk, cb) => {
      capturedCb = cb as (e: NostrEvent) => void;
      return () => {};
    });
    vi.mocked(nostr.fetchTodos).mockResolvedValue([
      { id: 't-1', text: 'a', done: false, eventId: 'e1', createdAt: 1 },
    ]);

    const { result } = renderHook(() => useTodoSync());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    await act(async () => {
      capturedCb?.({
        id: 'del-evt',
        pubkey: 'pk-test',
        created_at: 999,
        kind: 5,
        tags: [['e', 'e1']],
        content: '',
        sig: 'sig',
      });
    });

    expect(result.current.todos.find((t) => t.id === 't-1')).toBeUndefined();
  });

  it('aplica evento kind 30000 e atualiza todo existente', async () => {
    let capturedCb: ((e: NostrEvent) => void) | null = null;
    vi.mocked(nostr.subscribeToTodos).mockImplementation((_pk, cb) => {
      capturedCb = cb as (e: NostrEvent) => void;
      return () => {};
    });
    vi.mocked(nostr.fetchTodos).mockResolvedValue([
      { id: 't-1', text: 'old', done: false, eventId: 'e1', createdAt: 1 },
    ]);

    const { result } = renderHook(() => useTodoSync());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    await act(async () => {
      capturedCb?.(todoEvent('t-1', 'new', true, 100));
    });

    const updated = result.current.todos.find((t) => t.id === 't-1');
    expect(updated?.text).toBe('new');
    expect(updated?.done).toBe(true);
  });

  it('descarta eventos com payload inválido (kind 30000)', async () => {
    let capturedCb: ((e: NostrEvent) => void) | null = null;
    vi.mocked(nostr.subscribeToTodos).mockImplementation((_pk, cb) => {
      capturedCb = cb as (e: NostrEvent) => void;
      return () => {};
    });
    vi.mocked(nostr.fetchTodos).mockResolvedValue([
      { id: 't-existing', text: 'x', done: false, eventId: 'e0', createdAt: 1 },
    ]);

    const { result } = renderHook(() => useTodoSync());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    await act(async () => {
      capturedCb?.({
        id: 'evt-bad',
        pubkey: 'pk-test',
        created_at: 200,
        kind: 30000,
        tags: [['d', 't-bad']],
        content: '{"text":42,"done":"yes"}',
        sig: 'sig',
      });
    });

    expect(result.current.todos.find((t) => t.id === 't-bad')).toBeUndefined();
  });
});