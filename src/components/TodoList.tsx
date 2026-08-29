import { useTodoSync } from '../hooks/useTodoSync';
import { useT } from '../hooks/useT';
import './TodoList.css';

export default function TodoList() {
  const {
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
  } = useTodoSync();
  const { t } = useT();

  if (loading) {
    return <div className="todo-container loading">{t('todo_loading')}</div>;
  }

  if (error) {
    return (
      <div className="todo-container error">
        <div>
          {error}
          <button className="retry-btn" onClick={retry}>
            {t('settings_retry')}
          </button>
        </div>
      </div>
    );
  }

  const pending = todos.filter((t) => !t.done).length;
  const done = todos.filter((t) => t.done).length;

  const statsKey =
    pending === 1 && done === 1
      ? 'todo_stats_singular_both'
      : pending === 1
        ? 'todo_stats_singular_pending'
        : done === 1
          ? 'todo_stats_singular_done'
          : 'todo_stats';

  return (
    <div className="todo-container">
      <header className="todo-header">
        <div className="header-top">
          <h1>📝 Nostr Todo</h1>
          <div className="connection-status" title={connectedRelays.join('\n')}>
            <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`}></span>
            <span className="status-text">
              {connected
                ? t('todo_connected', { n: connectedRelays.length })
                : t('todo_connecting')}
            </span>
            {syncing && <span className="syncing">⟳</span>}
          </div>
        </div>
        <div className="pubkey-info">
          <span className="pubkey-label">{t('todo_pubkey_label')}</span>
          <code className="pubkey">{pubkey}</code>
          {pubkey && (
            <button className="copy-btn" onClick={() => navigator.clipboard.writeText(pubkey)}>
              {t('todo_copy')}
            </button>
          )}
        </div>
      </header>

      <form onSubmit={addTodo} className="todo-form">
        <input
          type="text"
          value={newTodo}
          onChange={(e) => setNewTodo(e.target.value)}
          placeholder={t('todo_input_placeholder')}
          className="todo-input"
        />
        <button type="submit" className="add-btn">
          {t('todo_add')}
        </button>
      </form>

      <ul className="todo-list">
        {todos.length === 0 ? (
          <li className="empty-state">{t('todo_empty')}</li>
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
              <button
                onClick={() => deleteTodo(todo)}
                className="delete-btn"
                aria-label={t('todo_delete_label')}
              >
                🗑️
              </button>
            </li>
          ))
        )}
      </ul>

      <footer className="todo-footer">
        <p>{t(statsKey, { pending, done, total: todos.length })}</p>
        <p className="relay-info">{t('todo_relay_info')}</p>
      </footer>
    </div>
  );
}