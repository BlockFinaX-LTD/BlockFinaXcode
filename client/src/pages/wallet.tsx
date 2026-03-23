import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { BottomNav } from '@/components/bottom-nav';
import { AppHeader } from '@/components/app-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EnhancedWalletOverview } from '@/components/wallet/wallet-dashboard';
import { TransactionHistory } from '@/components/wallet/transaction-history';
import { NetworkSelector } from '@/components/wallet/network-selector';
import { TransactionChecker } from '@/components/wallet/transaction-checker';
import ProfileSettings from '@/components/profile/profile-settings';
import { useWallet } from '@/hooks/use-wallet';
import logoPath from "@/assets/logo.png";

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
    if (!isLoading) {
      if (!walletExists()) {
        setLocation('/create-wallet');
      } else if (!isUnlocked) {
        setLocation('/unlock-wallet');
      }
    }
  }, [isUnlocked, walletExists, isLoading, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <img 
            src={logoPath} 
            alt="BlockFinaX Logo" 
            className="w-24 h-16 object-contain mx-auto mb-4"
          />
          <div className="text-lg font-semibold mb-2">Loading BlockFinaX...</div>
        </div>
      </div>
    );
  }

  if (!walletExists() || !isUnlocked) {
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
