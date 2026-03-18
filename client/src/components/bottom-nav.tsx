/**
 * Bottom Navigation Bar - Mobile navigation shown at the bottom of app pages
 *
 * Fixed bottom bar with icon links to Home, Wallet, Hedge, and Tasks.
 * Only visible on mobile screens. Highlights the currently active page.
 * Exports: BottomNav
 */
import { useLocation } from 'wouter';
import { Home as HomeIcon, Wallet as WalletIcon, Shield, ListChecks } from 'lucide-react';

export function BottomNav() {
  const [location, setLocation] = useLocation();

  const tabs = [
    { path: '/home', label: 'Home', icon: HomeIcon },
    { path: '/wallet', label: 'Wallet', icon: WalletIcon },
    { path: '/hedge', label: 'Hedge', icon: Shield },
    { path: '/tasks', label: 'Rewards', icon: ListChecks },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-card border-t border-border/50 z-50 safe-area-bottom">
      <div className="max-w-2xl mx-auto">
        <div className="grid grid-cols-4 h-16">
          {tabs.map((tab) => {
            const isActive = location === tab.path || (tab.path === '/tasks' && location === '/rewards');
            return (
              <button
                key={tab.path}
                onClick={() => !isActive && setLocation(tab.path)}
                className={`flex flex-col items-center justify-center gap-1 transition-colors ${
                  isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <tab.icon className="h-5 w-5" />
                <span className="text-[10px] font-medium">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
