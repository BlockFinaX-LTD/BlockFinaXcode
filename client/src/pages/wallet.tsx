import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { BottomNav } from '@/components/bottom-nav';
import { AppHeader } from '@/components/app-header';
import { BackupWarningBanner } from '@/components/wallet/backup-warning-banner';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { EnhancedWalletOverview } from '@/components/wallet/wallet-dashboard';
import { TransactionHistory } from '@/components/wallet/transaction-history';
import { NetworkSelector } from '@/components/wallet/network-selector';
import ProfileSettings from '@/components/profile/profile-settings';
import { useWallet } from '@/hooks/use-wallet';
import logoPath from "@/assets/logo-transparent.png";

function WalletLanding() {
  const [, setLocation] = useLocation();
  return (
    <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden" style={{ backgroundColor: '#ffffff' }}>
      {/* Subtle blue glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-72 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(26,68,128,0.08) 0%, transparent 70%)' }} />

      <div className="flex flex-col items-center px-6 w-full max-w-sm relative z-10">
        {/* Logo */}
        <img
          src={logoPath}
          alt="BlockFinaX"
          className="w-28 h-28 object-contain mb-6"
        />
        <h1 className="text-4xl font-extrabold tracking-tight text-center leading-tight" style={{ color: '#1a4480' }}>
          BlockFinaX
        </h1>
        <p className="mt-3 text-sm text-center" style={{ color: '#6b7280' }}>
          P2P hedging against price volatility
        </p>

        {/* Buttons */}
        <div className="mt-10 w-full space-y-3">
          <button
            onClick={() => setLocation('/create-wallet')}
            className="w-full py-4 rounded-2xl text-base font-semibold transition-all active:scale-[0.98]"
            style={{ backgroundColor: '#1a4480', color: '#ffffff' }}
          >
            Create a new wallet
          </button>
          <button
            onClick={() => setLocation('/import-wallet')}
            className="w-full py-4 rounded-2xl text-base font-semibold transition-all active:scale-[0.98]"
            style={{ backgroundColor: '#ffffff', color: '#1a4480', border: '1.5px solid #1a4480' }}
          >
            I have an existing wallet
          </button>
        </div>
      </div>

      {/* Brand bottom strip */}
      <div className="fixed bottom-0 left-0 right-0 h-1.5" style={{ backgroundColor: '#1a4480' }} />
    </div>
  );
}

export default function Wallet() {
  const [, setLocation] = useLocation();
  const { isUnlocked, settings, walletExists, isLoading } = useWallet();
  const [selectedNetworkId, setSelectedNetworkId] = useState(settings.selectedNetworkId);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (tab) setActiveTab(tab);
  }, []);

  useEffect(() => {
    if (!isLoading && walletExists() && !isUnlocked) {
      setLocation('/unlock-wallet');
    }
  }, [isUnlocked, walletExists, isLoading, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F5EFE6' }}>
        <div className="text-center">
          <img src={logoPath} alt="BlockFinaX Logo" className="w-20 h-20 object-contain mx-auto mb-4" />
          <div className="text-base font-semibold text-gray-600">Loading…</div>
        </div>
      </div>
    );
  }

  if (!walletExists()) {
    return <WalletLanding />;
  }

  if (!isUnlocked) {
    return null;
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader
        rightContent={
          <NetworkSelector
            selectedNetworkId={selectedNetworkId}
            onNetworkChange={setSelectedNetworkId}
            className="h-8 text-xs px-2"
          />
        }
      />

      {/* Persistent backup warning for users who skipped saving their secret phrase */}
      <BackupWarningBanner />

      {/* Main Content */}
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6 pb-24">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">

          <TabsContent value="overview" className="space-y-4">
            <EnhancedWalletOverview 
              selectedNetworkId={selectedNetworkId}
              onTabChange={setActiveTab}
            />
            <TransactionHistory networkId={selectedNetworkId} />
          </TabsContent>


          <TabsContent value="profile" className="">
            <ProfileSettings />
          </TabsContent>
        </Tabs>
      </main>

      {/* Bottom Navigation */}
      <BottomNav />
    </div>
  );
}
