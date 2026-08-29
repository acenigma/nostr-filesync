import { useState, useEffect, useCallback, useRef } from 'react';
import * as nostr from '../services/nostr';
import type { NostrEvent } from 'nostr-tools';
import type { TodoRecord } from '../services/nostr';
import { useAbort } from './useAbort';
import { useT } from './useT';

export interface UseTodoSyncResult {
  todos: TodoRecord[];
  newTodo: string;
  setNewTodo: (s: string) => void;
  loading: boolean;
  error: string | null;
  pubkey: string | null;
  connected: boolean;
  connectedRelays: string[];
  syncing: boolean;
  addTodo: (e: React.FormEvent) => Promise<void>;
  toggleTodo: (todo: TodoRecord) => Promise<void>;
  deleteTodo: (todo: TodoRecord) => Promise<void>;
  retry: () => void;
}

export function useTodoSync(): UseTodoSyncResult {
  const [todos, setTodos] = useState<TodoRecord[]>([]);
  const [newTodo, setNewTodo] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pubkey, setPubkey] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [connectedRelays, setConnectedRelays] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);
  const mountedRef = useRef(true);
  const operationAbort = useAbort();
  const { t } = useT();
  const tRef = useRef(t);
  tRef.current = t;

  const applyTodoEvent = useCallback((event: NostrEvent) => {
    if (event.kind === 30000) {
      const dTag = event.tags.find((t) => t[0] === 'd')?.[1];
      if (!dTag) return;
      const payload = nostr.parseTodoPayload(event.content);
      if (!payload) return;
      setTodos((prev) => {
        const exists = prev.find((t) => t.id === dTag);
        if (exists) {
          if ((event.created_at ?? 0) < exists.createdAt) return prev;
          return prev.map((t) =>
            t.id === dTag
              ? {
                  ...t,
                  text: payload.text,
                  done: payload.done,
                  eventId: event.id || '',
                  createdAt: event.created_at ?? 0,
                }
              : t
          );
        }
        return [
          {
            id: dTag,
            text: payload.text,
            done: payload.done,
            eventId: event.id || '',
            createdAt: event.created_at ?? 0,
          },
          ...prev,
        ];
      });
    } else if (event.kind === 5) {
      const eTag = event.tags.find((t) => t[0] === 'e')?.[1];
      if (eTag) {
        setTodos((prev) => prev.filter((t) => t.eventId !== eTag));
      }
    }
  }, []);

  const loadTodos = useCallback(async () => {
    const keys = nostr.getKeys();
    if (!keys.publicKey) return;
    setSyncing(true);
    try {
      const fetched = await nostr.fetchTodos(keys.publicKey);
      if (mountedRef.current) setTodos(fetched);
    } catch (err) {
      console.warn('Falha ao carregar tarefas', err);
    } finally {
      if (mountedRef.current) setSyncing(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const unsubscribe = nostr.onConnectionChange((info) => {
      setConnected(info.connected);
      setConnectedRelays(info.relays);
    });

    const closeSubRef = { current: null as (() => void) | null };

    async function initialize(): Promise<(() => void) | null> {
      try {
        const keys = nostr.getKeys();
        if (!keys.publicKey) {
          await nostr.initNostr();
        }
        const finalKeys = nostr.getKeys();
        if (!finalKeys.publicKey) return null;
        if (!mountedRef.current) return null;
        setPubkey(nostr.getNpub());
        await loadTodos();
        return nostr.subscribeToTodos(finalKeys.publicKey, applyTodoEvent);
      } catch (err) {
        console.error(err);
        if (mountedRef.current) setError('Falha ao inicializar conexão Nostr');
        return null;
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    }

    initialize().then((fn) => {
      if (mountedRef.current) {
        closeSubRef.current = fn;
      } else {
        fn?.();
      }
    });

    return () => {
      mountedRef.current = false;
      unsubscribe();
      closeSubRef.current?.();
    };
  }, [loadTodos, applyTodoEvent]);

  const addTodo = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const text = newTodo.trim();
      if (!text) return;
      try {
        const { event, todoId } = nostr.createTodoEvent(text);
        const optimistic: TodoRecord = {
          id: todoId,
          text,
          done: false,
          eventId: event.id || '',
          createdAt: event.created_at || 0,
        };
        setTodos((prev) => [optimistic, ...prev]);
        setNewTodo('');
        await nostr.publishEvent(event);
      } catch (err) {
        console.error('Falha ao criar tarefa', err);
        setError(tRef.current('todo_error_prefix'));
      }
    },
    [newTodo]
  );

  const toggleTodo = useCallback(async (todo: TodoRecord) => {
    const done = !todo.done;
    try {
      const event = nostr.createUpdateEvent(todo.id, todo.text, done);
      setTodos((prev) =>
        prev.map((t) => (t.id === todo.id ? { ...t, done, eventId: event.id || '' } : t))
      );
      await nostr.publishEvent(event);
    } catch (err) {
      console.error('Falha ao atualizar tarefa', err);
      setError(tRef.current('todo_error_update'));
    }
  }, []);

  const deleteTodo = useCallback(async (todo: TodoRecord) => {
    try {
      const event = nostr.createDeleteEvent(todo.id, todo.eventId);
      setTodos((prev) => prev.filter((t) => t.id !== todo.id));
      await nostr.publishEvent(event);
    } catch (err) {
      console.error('Falha ao deletar tarefa', err);
      setError(tRef.current('todo_error_delete'));
    }
  }, []);

  const retry = useCallback(() => window.location.reload(), []);

  void operationAbort;

  return {
    todos,
    newTodo,
    setNewTodo,
    loading,
    error,
    pubkey,
    connected,
    connectedRelays,
    syncing,
    addTodo,
    toggleTodo,
    deleteTodo,
    retry,
  };
}