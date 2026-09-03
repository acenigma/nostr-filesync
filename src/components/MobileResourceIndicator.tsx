import { useMobileResourceState } from '../hooks/useMobileResourceState';
import './MobileResourceIndicator.css';

export default function MobileResourceIndicator() {
  const state = useMobileResourceState();

  if (!state.deferUploads) return null;

  const labels: Record<string, string> = {
    offline: '📴 Offline — uploads pausados',
    'save-data': '💾 Data saver ativo — uploads pausados',
    'low-battery': '🔋 Bateria baixa — uploads pausados',
    user: '⏸ Uploads pausados manualmente',
  };
  const label = state.reason ? labels[state.reason] || state.reason : '⏸ Uploads pausados';

  return <div className="mobile-resource-indicator">{label}</div>;
}
