/**
 * App Header - Top navigation bar shown on all app pages
 *
 * Displays the BlockFinaX logo, current page title, wallet connection status,
 * and quick-access navigation links. Hidden on the public landing pages.
 * Exports: AppHeader
 */
import { useState } from 'react';
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
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useWallet } from '@/hooks/use-wallet';
import { useToast } from '@/hooks/use-toast';
import {
  Menu,
  Shield,
  User,
  Bell,
  Settings,
  Lock,
  Download,
  Upload,
  HelpCircle,
  Copy,
  Eye,
  EyeOff,
  DollarSign,
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
  const { wallet, lockWallet, exportPrivateKey, exportMnemonic } = useWallet();
  const { toast } = useToast();
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportType, setExportType] = useState<'privateKey' | 'mnemonic'>('privateKey');
  const [exportedData, setExportedData] = useState('');
  const [showExportData, setShowExportData] = useState(false);

  const handleExportPrivateKey = () => {
    try {
      const privateKey = exportPrivateKey();
      setExportedData(privateKey);
      setExportType('privateKey');
      setExportModalOpen(true);
      setShowExportData(false);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Export Failed",
        description: "Could not export private key. Make sure your wallet is unlocked.",
      });
    }
  };

  const handleExportMnemonic = () => {
    try {
      const mnemonic = exportMnemonic();
      if (mnemonic) {
        setExportedData(mnemonic);
        setExportType('mnemonic');
        setExportModalOpen(true);
        setShowExportData(false);
      } else {
        toast({
          variant: "destructive",
          title: "No Seed Phrase",
          description: "This wallet was imported using a private key and doesn't have a seed phrase.",
        });
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Export Failed",
        description: "Could not export seed phrase. Make sure your wallet is unlocked.",
      });
    }
  };

  const handleCopyToClipboard = () => {
    navigator.clipboard.writeText(exportedData);
    toast({
      title: "Copied!",
      description: `${exportType === 'privateKey' ? 'Private key' : 'Seed phrase'} copied to clipboard.`,
    });
  };

  const handleLockWallet = () => {
    lockWallet();
    setLocation('/unlock-wallet');
  };

  return (
    <>
      <header className="bg-card/80 backdrop-blur-sm border-b border-border/50 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-14">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <img src={logoPath} alt="BlockFinaX Logo" className="w-7 h-7 object-contain shrink-0" />
              <span className="text-base font-semibold tracking-tight">{title || 'BlockFinaX'}</span>
              <Badge variant="outline" className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800 hidden xs:inline-flex sm:inline-flex shrink-0">
                TESTNET
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

                  <DropdownMenuItem onClick={() => setLocation('/faucet')}>
                    <DollarSign className="h-4 w-4 mr-2" />
                    Test USDC Faucet
                  </DropdownMenuItem>

                  <DropdownMenuItem onClick={() => setLocation('/notifications')} disabled>
                    <Bell className="h-4 w-4 mr-2" />
                    Notifications
                    <Badge variant="secondary" className="ml-auto text-[10px] px-1.5">Soon</Badge>
                  </DropdownMenuItem>

                  <DropdownMenuSeparator />

                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Shield className="h-4 w-4 mr-2" />
                      Security
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem onClick={handleExportMnemonic}>
                        <Download className="h-4 w-4 mr-2" />
                        Export Seed Phrase
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={handleExportPrivateKey}>
                        <Upload className="h-4 w-4 mr-2" />
                        Export Private Key
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>

                  <DropdownMenuItem disabled>
                    <Settings className="h-4 w-4 mr-2" />
                    Settings
                    <Badge variant="secondary" className="ml-auto text-[10px] px-1.5">Soon</Badge>
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

      <Dialog open={exportModalOpen} onOpenChange={setExportModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <Download className="h-5 w-5" />
              <span>Export {exportType === 'privateKey' ? 'Private Key' : 'Seed Phrase'}</span>
            </DialogTitle>
            <DialogDescription>
              {exportType === 'privateKey'
                ? 'Your private key gives full access to your wallet. Keep it secure and never share it.'
                : 'Your seed phrase can restore your entire wallet. Store it safely and never share it.'
              }
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="p-4 bg-destructive/5 border border-destructive/20 rounded-lg">
              <div className="flex items-start space-x-3">
                <Shield className="h-5 w-5 text-destructive mt-0.5" />
                <div className="text-sm">
                  <p className="font-semibold text-destructive mb-1">Security Warning</p>
                  <p className="text-muted-foreground">
                    Anyone with access to this {exportType === 'privateKey' ? 'private key' : 'seed phrase'} can steal your funds.
                    Only copy it to a secure location.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">
                {exportType === 'privateKey' ? 'Private Key' : 'Seed Phrase'}
              </div>
              <div className="relative">
                <textarea
                  id="export-data"
                  className="w-full p-3 bg-muted rounded-lg font-mono text-sm min-h-[100px] resize-none"
                  value={showExportData ? exportedData : '•'.repeat(exportedData.length)}
                  readOnly
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute top-2 right-2"
                  onClick={() => setShowExportData(!showExportData)}
                >
                  {showExportData ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter className="flex flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setExportModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCopyToClipboard} className="flex items-center space-x-2">
              <Copy className="h-4 w-4" />
              <span>Copy to Clipboard</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
