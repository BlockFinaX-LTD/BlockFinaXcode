/**
 * App Header - Top navigation bar shown on all app pages
 *
 * Displays the BlockFinaX logo, current page title, wallet connection status,
 * and quick-access navigation links. Hidden on the public landing pages.
 * Exports: AppHeader
 */
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
  Menu,
  User,
  Bell,
  Settings,
  Lock,
  HelpCircle,
  RefreshCw,
} from 'lucide-react';
import logoPath from "@/assets/logo.png";

interface AppHeaderProps {
  title?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  rightContent?: React.ReactNode;
}

export function AppHeader({ title, onRefresh, refreshing, rightContent }: AppHeaderProps) {
  const [, setLocation] = useLocation();
  const { wallet, lockWallet } = useWallet();

  const handleLockWallet = () => {
    lockWallet();
    setLocation('/unlock-wallet');
  };

  return (
    <>
      <header className="bg-card/80 backdrop-blur-sm border-b border-border/50 sticky top-0 z-50">
        <div className="max-w-2xl mx-auto px-4">
          <div className="flex justify-between items-center h-14">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <img src={logoPath} alt="BlockFinaX Logo" className="w-7 h-7 object-contain shrink-0" />
              <span className="text-base font-semibold tracking-tight">{title || 'BlockFinaX'}</span>
              <Badge variant="outline" className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 hidden xs:inline-flex sm:inline-flex shrink-0">
                MAINNET
              </Badge>
            </div>

            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
              {rightContent}

              {onRefresh && (
                <Button variant="ghost" size="icon" onClick={onRefresh} className="h-9 w-9" disabled={refreshing}>
                  <RefreshCw className={`h-4 w-4 text-muted-foreground ${refreshing ? 'animate-spin' : ''}`} />
                </Button>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-9 w-9">
                    <Menu className="h-5 w-5 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-medium leading-none">My Account</p>
                      <p className="text-xs leading-none text-muted-foreground truncate">
                        {wallet?.address ? `${wallet.address.slice(0, 8)}...${wallet.address.slice(-6)}` : 'Not connected'}
                      </p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />

                  <DropdownMenuItem onClick={() => setLocation('/profile')}>
                    <User className="h-4 w-4 mr-2" />
                    Profile
                  </DropdownMenuItem>

                  <DropdownMenuItem onClick={() => setLocation('/notifications')} disabled>
                    <Bell className="h-4 w-4 mr-2" />
                    Notifications
                    <Badge variant="secondary" className="ml-auto text-[10px] px-1.5">Soon</Badge>
                  </DropdownMenuItem>

                  <DropdownMenuSeparator />

                  <DropdownMenuItem onClick={() => setLocation('/settings')}>
                    <Settings className="h-4 w-4 mr-2" />
                    Settings
                  </DropdownMenuItem>

                  <DropdownMenuItem onClick={() => window.open('https://blockfinax.com/help', '_blank')} disabled>
                    <HelpCircle className="h-4 w-4 mr-2" />
                    Help & Support
                  </DropdownMenuItem>

                  <DropdownMenuSeparator />

                  <DropdownMenuItem onClick={handleLockWallet} className="text-destructive">
                    <Lock className="h-4 w-4 mr-2" />
                    Lock Wallet
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </header>

    </>
  );
}
