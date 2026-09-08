export interface Toast {
  id: string;
  type?: 'info' | 'success' | 'warning' | 'error';
  message: string;
  duration?: number;
  action?: { label: string; onClick: () => void };
}

interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  return (
    <div className="toast-container" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type || 'info'}`} role="alert">
          <span className="toast-message">{t.message}</span>
          {t.action && (
            <button className="toast-action" onClick={t.action.onClick}>
              {t.action.label}
            </button>
          )}
          <button
            className="toast-dismiss"
            onClick={() => onDismiss(t.id)}
            aria-label="Fechar notificação"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

export default ToastContainer;
