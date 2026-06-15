/**
 * Bottom Navigation Bar — BlockFinaX 2026 redesign
 *
 * Floating, frosted-glass pill anchored at the bottom of the viewport.
 * Four tabs: Home, Wallet, Cover (the rebranded Hedge), Earn.
 * Active state shows a small primary dot below the icon.
 */
import { useLocation } from 'wouter';
import { Home as HomeIcon, User as UserIcon, Shield, Star } from 'lucide-react';
import { cn } from '@/lib/utils';

const TABS = [
  { path: '/home', label: 'Home', icon: HomeIcon, matches: ['/home'] },
  { path: '/hedge', label: 'Cover', icon: Shield, matches: ['/hedge'] },
  { path: '/tasks', label: 'Earn', icon: Star, matches: ['/rewards', '/tasks'] },
  { path: '/profile', label: 'Profile', icon: UserIcon, matches: ['/profile'] },
];

export function BottomNav() {
  const [location, setLocation] = useLocation();

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 pointer-events-none pb-[max(env(safe-area-inset-bottom),12px)]">
      <nav className="pointer-events-auto bfx-nav-float mx-auto mb-3 max-w-md rounded-[22px] h-[64px] px-2">
        <div className="relative grid grid-cols-4 h-full">
          {TABS.map((tab) => {
            const isActive = tab.matches.some(
              (m) => location === m || location.startsWith(m + '/'),
            );
            const Icon = tab.icon;
            return (
              <button
                key={tab.path}
                type="button"
                onClick={() => !isActive && setLocation(tab.path)}
                className={cn(
                  'relative flex flex-col items-center justify-center gap-1 outline-none focus-visible:ring-2 focus-visible:ring-primary/30 rounded-xl transition-colors group',
                  isActive
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground active:scale-95',
                )}
                aria-current={isActive ? 'page' : undefined}
              >
                <span
                  className={cn(
                    'relative h-7 w-12 inline-flex items-center justify-center rounded-full transition-all duration-200',
                    isActive && 'bg-primary/12',
                  )}
                >
                  <Icon
                    className={cn('h-[18px] w-[18px] transition-transform', isActive && 'text-primary')}
                    strokeWidth={isActive ? 2 : 1.7}
                  />
                </span>
                <span
                  className={cn(
                    'text-[10px] tracking-tight leading-none transition-all',
                    isActive ? 'font-semibold text-primary' : 'font-medium',
                  )}
                >
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
