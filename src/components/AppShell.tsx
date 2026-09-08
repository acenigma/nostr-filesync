import { ReactNode } from 'react';
import { useTheme } from '../hooks/useTheme';
import { useIsDesktop, useIsMobile } from '../hooks/useBreakpoint';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { BottomTabBar } from './BottomTabBar';
import './AppShell.css';

export interface NavItem {
  id: string;
  label: string;
  icon: string;
  badge?: number;
  active?: boolean;
  onClick: () => void;
}

export interface BottomTab {
  id: string;
  label: string;
  icon: string;
  active?: boolean;
  badge?: number;
  onClick: () => void;
}

interface AppShellProps {
  navItems: NavItem[];
  bottomTabs: BottomTab[];
  userNpub?: string;
  unreadCount: number;
  searchValue?: string;
  onSearch: (q: string) => void;
  onUpload: () => void;
  onNotifications: () => void;
  onSettings: () => void;
  onThemeToggle: () => void;
  onMenu: () => void;
  onFab: () => void;
  children: ReactNode;
  toasts?: ReactNode;
  commandPalette?: ReactNode;
}

export function AppShell({
  navItems,
  bottomTabs,
  userNpub,
  unreadCount,
  searchValue,
  onSearch,
  onUpload,
  onNotifications,
  onSettings,
  onThemeToggle,
  onMenu,
  onFab,
  children,
  toasts,
  commandPalette,
}: AppShellProps) {
  const { theme } = useTheme();
  const isDesktop = useIsDesktop();
  const isMobile = useIsMobile();

  return (
    <div className="app-shell" data-breakpoint={isDesktop ? 'desktop' : isMobile ? 'mobile' : 'tablet'}>
      {isDesktop && (
        <Sidebar
          items={navItems}
          userNpub={userNpub}
          onUpload={onUpload}
          onSettings={onSettings}
          onThemeToggle={onThemeToggle}
          theme={theme}
        />
      )}

      <div className="app-shell-main">
        {!isDesktop && (
          <TopBar
            onMenu={onMenu}
            onSearch={onSearch}
            onNotifications={onNotifications}
            onUpload={onUpload}
            onSettings={onSettings}
            onThemeToggle={onThemeToggle}
            theme={theme}
            unreadCount={unreadCount}
            userNpub={userNpub}
            searchValue={searchValue}
          />
        )}

        <main className="app-shell-content" role="main">
          {children}
        </main>

        {isMobile && (
          <BottomTabBar tabs={bottomTabs} onFab={onFab} />
        )}
      </div>

      {toasts}
      {commandPalette && commandPalette}
    </div>
  );
}

export default AppShell;
