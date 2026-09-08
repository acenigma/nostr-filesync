import './BottomTabBar.css';

export interface BottomTab {
  id: string;
  label: string;
  icon: string;
  active?: boolean;
  badge?: number;
  onClick: () => void;
}

interface BottomTabBarProps {
  tabs: BottomTab[];
  onFab?: () => void;
}

export function BottomTabBar({ tabs, onFab }: BottomTabBarProps) {
  const mid = Math.floor(tabs.length / 2);

  return (
    <nav className="bottom-tabbar" role="navigation" aria-label="Navegação inferior">
      <ul className="bottom-tabbar-list">
        {tabs.slice(0, mid).map((tab) => (
          <li key={tab.id}>
            <button
              className={`bottom-tab ${tab.active ? 'active' : ''}`}
              onClick={tab.onClick}
              aria-current={tab.active ? 'page' : undefined}
            >
              <span className="bottom-tab-icon" aria-hidden="true">{tab.icon}</span>
              <span className="bottom-tab-label">{tab.label}</span>
              {tab.badge != null && tab.badge > 0 && (
                <span className="bottom-tab-badge">{tab.badge > 99 ? '99+' : tab.badge}</span>
              )}
            </button>
          </li>
        ))}
        <li className="bottom-tab-fab-item">
          <button
            className="bottom-tab-fab"
            onClick={onFab}
            aria-label="Upload"
          >
            <span aria-hidden="true">⬆</span>
          </button>
        </li>
        {tabs.slice(mid).map((tab) => (
          <li key={tab.id}>
            <button
              className={`bottom-tab ${tab.active ? 'active' : ''}`}
              onClick={tab.onClick}
              aria-current={tab.active ? 'page' : undefined}
            >
              <span className="bottom-tab-icon" aria-hidden="true">{tab.icon}</span>
              <span className="bottom-tab-label">{tab.label}</span>
              {tab.badge != null && tab.badge > 0 && (
                <span className="bottom-tab-badge">{tab.badge > 99 ? '99+' : tab.badge}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default BottomTabBar;