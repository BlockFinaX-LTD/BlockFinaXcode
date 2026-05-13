/**
 * Wallet — 2026 redesign
 *
 * Keeps the existing wallet machinery intact:
 *   - EnhancedWalletOverview: balance card with real token icons (EthIcon,
 *     UsdcIcon, UsdtIcon, BnbIcon), Send/Deposit modals wired to the
 *     correct chain, formatCrypto + formatCurrency helpers
 *   - TransactionHistory: chain-aware on-chain tx history
 *
 * The page wraps them in the new visual frame: clean header, Assets/Activity
 * tabs, NetworkSelector in the app header.
 */
import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { BottomNav } from '@/components/bottom-nav';
import { AppHeader } from '@/components/app-header';
import { BackupWarningBanner } from '@/components/wallet/backup-warning-banner';
import { EnhancedWalletOverview } from '@/components/wallet/wallet-dashboard';
import { RiftActivity } from '@/components/wallet/rift-activity';
import { NetworkSelector } from '@/components/wallet/network-selector';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useWallet } from '@/hooks/use-wallet';
import logoPath from '@/assets/logo-transparent.png';

function WalletLanding() {
  const [, setLocation] = useLocation();
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6">
      <div className="flex flex-col items-center max-w-sm w-full">
        <img src={logoPath} alt="BlockFinaX" className="w-20 h-20 object-contain mb-4" />
        <h1 className="bfx-display text-2xl font-semibold tracking-tight">BlockFinaX</h1>
        <p className="text-sm text-muted-foreground text-center mt-1">
          Cross-border payments &amp; cover
        </p>
        <Button onClick={() => setLocation('/auth')} className="mt-8 w-full h-12 rounded-2xl">
          Sign in or create account
        </Button>
      </div>
    </div>
  );
}

export default function Wallet() {
  const [, setLocation] = useLocation();
  const { isUnlocked, settings, walletExists, isLoading } = useWallet();
  const [selectedNetworkId, setSelectedNetworkId] = useState(settings.selectedNetworkId);
  const [activeTab, setActiveTab] = useState<'assets' | 'activity'>('assets');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (tab === 'history' || tab === 'activity') setActiveTab('activity');
    else if (tab === 'assets' || tab === 'overview') setActiveTab('assets');
  }, []);

  useEffect(() => {
    if (!isLoading && !isUnlocked) setLocation('/auth');
  }, [isUnlocked, isLoading, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <img src={logoPath} alt="BlockFinaX" className="w-16 h-16 object-contain mx-auto mb-3" />
          <div className="text-sm font-medium text-muted-foreground">Loading…</div>
        </div>
      </div>
    );
  }

  if (!walletExists()) return <WalletLanding />;
  if (!isUnlocked) return null;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader
        title="Wallet"
        rightContent={
          <NetworkSelector
            selectedNetworkId={selectedNetworkId}
            onNetworkChange={setSelectedNetworkId}
            className="h-8 text-xs px-2"
          />
        }
      />

      <BackupWarningBanner />

      <main className="flex-1 pb-28">
        <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
            <TabsList className="grid grid-cols-2 bg-muted/50 rounded-xl h-10 p-1 w-full">
              <TabsTrigger
                value="assets"
                className="rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm"
              >
                Assets
              </TabsTrigger>
              <TabsTrigger
                value="activity"
                className="rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm"
              >
                Activity
              </TabsTrigger>
            </TabsList>

            <TabsContent value="assets" className="mt-4">
              {/* Real balance card + asset rows with proper token icons + modals */}
              <EnhancedWalletOverview selectedNetworkId={selectedNetworkId} />
            </TabsContent>

            <TabsContent value="activity" className="mt-4">
              <RiftActivity />
            </TabsContent>
          </Tabs>
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
