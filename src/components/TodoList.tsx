import { useState, useEffect, useCallback, useRef } from 'react';
import * as nostr from '../services/nostr';
import type { NostrEvent } from 'nostr-tools';
import type { TodoRecord } from '../services/nostr';
import './TodoList.css';

export default function TodoList() {
  const [todos, setTodos] = useState<TodoRecord[]>([]);
  const [newTodo, setNewTodo] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pubkey, setPubkey] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [connectedRelays, setConnectedRelays] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);
  const mountedRef = useRef(true);

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

  const addTodo = async (e: React.FormEvent) => {
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
      setError('Falha ao criar tarefa: nenhum relay conectado');
    }
  };

  const toggleTodo = async (todo: TodoRecord) => {
    const done = !todo.done;
    try {
      const event = nostr.createUpdateEvent(todo.id, todo.text, done);
      setTodos((prev) =>
        prev.map((t) => (t.id === todo.id ? { ...t, done, eventId: event.id || '' } : t))
      );
      await nostr.publishEvent(event);
    } catch (err) {
      console.error('Falha ao atualizar tarefa', err);
      setError('Falha ao atualizar tarefa: nenhum relay conectado');
    }
  };

  const deleteTodo = async (todo: TodoRecord) => {
    try {
      const event = nostr.createDeleteEvent(todo.id, todo.eventId);
      setTodos((prev) => prev.filter((t) => t.id !== todo.id));
      await nostr.publishEvent(event);
    } catch (err) {
      console.error('Falha ao deletar tarefa', err);
      setError('Falha ao deletar tarefa: nenhum relay conectado');
    }
  };

  if (loading) {
    return <div className="todo-container loading">Conectando à rede Nostr...</div>;
  }

  if (error) {
    return (
      <div className="todo-container error">
        <div>
          {error}
          <button className="retry-btn" onClick={() => window.location.reload()}>
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  const pending = todos.filter((t) => !t.done).length;
  const done = todos.filter((t) => t.done).length;

  return (
    <div className="todo-container">
      <header className="todo-header">
        <div className="header-top">
          <h1>📝 Nostr Todo</h1>
          <div className="connection-status" title={connectedRelays.join('\n')}>
            <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`}></span>
            <span className="status-text">
              {connected ? `Conectado (${connectedRelays.length})` : 'Conectando...'}
            </span>
            {syncing && <span className="syncing">⟳</span>}
          </div>
        </div>
        <div className="pubkey-info">
          <span className="pubkey-label">Sua chave:</span>
          <code className="pubkey">{pubkey}</code>
          {pubkey && (
            <button className="copy-btn" onClick={() => navigator.clipboard.writeText(pubkey)}>
              Copiar
            </button>
          )}
        </div>
      </header>

      <form onSubmit={addTodo} className="todo-form">
        <input
          type="text"
          value={newTodo}
          onChange={(e) => setNewTodo(e.target.value)}
          placeholder="O que precisa ser feito?"
          className="todo-input"
        />
        <button type="submit" className="add-btn">
          Adicionar
        </button>
      </form>

      <ul className="todo-list">
        {todos.length === 0 ? (
          <li className="empty-state">Nenhuma tarefa ainda. Adicione uma acima!</li>
        ) : (
          todos.map((todo) => (
            <li key={todo.id} className={`todo-item ${todo.done ? 'done' : ''}`}>
              <label className="todo-checkbox-label">
                <input
                  type="checkbox"
                  checked={todo.done}
                  onChange={() => toggleTodo(todo)}
                  className="todo-checkbox"
                />
                <span className="todo-text">{todo.text}</span>
              </label>
              <button onClick={() => deleteTodo(todo)} className="delete-btn" aria-label="Deletar tarefa">
                🗑️
              </button>
            </li>
          ))
        )}
      </ul>

      <footer className="todo-footer">
        <p>
          {pending} pendente{pending !== 1 ? 's' : ''} · {done} concluída
          {done !== 1 ? 's' : ''} · {todos.length} no total
        </p>
        <p className="relay-info">Dados armazenados na rede Nostr via relays públicos</p>
      </footer>
    </div>
  );
}
