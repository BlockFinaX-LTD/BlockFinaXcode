/**
 * App Header — BlockFinaX 2026 redesign
 *
 * Translucent top bar with brand mark, account context, refresh + menu.
 * Sits sticky at the top under the safe area inset.
 */
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { useWallet } from '@/hooks/use-wallet';
import {
  Bell,
  Settings,
  User,
  LogOut,
  HelpCircle,
  RefreshCw,
  ChevronDown,
} from 'lucide-react';
import { shortAddr } from '@/components/ui/bfx';
import logoPath from '@/assets/logo.png';

interface AppHeaderProps {
  title?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  rightContent?: React.ReactNode;
}

export function AppHeader({ title, onRefresh, refreshing, rightContent }: AppHeaderProps) {
  const [, setLocation] = useLocation();
  const { wallet, lockWallet } = useWallet();

  const handleLockWallet = async () => {
    await lockWallet();
    setLocation('/auth');
  };

  return (
    <header className="sticky top-0 z-40 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/70 border-b border-border/60">
      <div className="mx-auto max-w-2xl px-4 h-14 flex items-center justify-between gap-3">
        {/* Left: brand */}
        <div className="flex items-center gap-2 min-w-0">
          <img src={logoPath} alt="BlockFinaX" className="h-7 w-7 object-contain shrink-0" />
          {title ? (
            <span className="bfx-display text-[15px] font-semibold tracking-tight leading-none">
              {title}
            </span>
          ) : (
            <span className="bfx-display text-[15px] font-semibold tracking-tight leading-none">
              BlockFinaX
            </span>
          )}
        </div>

        {/* Right: refresh + bell + menu */}
        <div className="flex items-center gap-1 shrink-0">
          {rightContent}

          {onRefresh && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onRefresh}
              disabled={refreshing}
              className="h-9 w-9 rounded-full"
            >
              <RefreshCw className={`h-4 w-4 text-muted-foreground ${refreshing ? 'animate-spin' : ''}`} />
            </Button>
          )}

          <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full" aria-label="Notifications">
            <Bell className="h-[18px] w-[18px] text-muted-foreground" strokeWidth={1.7} />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full">
                <User className="h-[18px] w-[18px] text-muted-foreground" strokeWidth={1.7} />
                <ChevronDown className="h-3 w-3 text-muted-foreground -ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col gap-0.5">
                  <p className="text-sm font-medium leading-none">My account</p>
                  <p className="text-xs leading-none text-muted-foreground font-mono-data">
                    {shortAddr(wallet?.address)}
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setLocation('/profile')}>
                <User className="h-4 w-4 mr-2" /> Profile
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setLocation('/settings')}>
                <Settings className="h-4 w-4 mr-2" /> Settings
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => window.open('https://blockfinax.com/help', '_blank')}
              >
                <HelpCircle className="h-4 w-4 mr-2" /> Help & support
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLockWallet} className="text-destructive">
                <LogOut className="h-4 w-4 mr-2" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
