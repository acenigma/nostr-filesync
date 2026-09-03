import { useOnlineStatus } from '../hooks/useOnlineStatus';
import './OnlineIndicator.css';

export default function OnlineIndicator() {
  const { online, justCameOnline } = useOnlineStatus();

  if (online && !justCameOnline) return null;

  return (
    <div className={`online-indicator ${online ? 'reconnected' : 'offline'}`} role="status">
      {online ? '✅ Voltou online — sincronizando...' : '⚠ Offline — alterações serão sincronizadas depois'}
    </div>
  );
}
