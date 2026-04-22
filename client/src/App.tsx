/**
 * Main Application Component
 * 
 * React application root with routing, state management, and wallet integration.
 * Handles wallet authentication flow, referral processing, and global providers.
 */

import { Switch, Route, useLocation } from "wouter";
import { useEffect } from "react";
import { queryClient } from "./lib/api-client";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isLoggedIn } from "@/lib/rift-client";
import { TxAuthDialog } from "@/components/wallet/tx-auth-dialog";

// Public pages
import Website from "@/pages/website";
import PitchDeck from "@/pages/pitch-deck";
import Whitepaper from "@/pages/whitepaper";
import DataRoom from "@/pages/data-room";
import TermsPage from "@/pages/terms";
import PrivacyPage from "@/pages/privacy";
import NotFound from "@/pages/not-found";

// Wallet & auth
import Wallet from "@/pages/wallet";
import Auth from "@/pages/auth";

// Core features
import HomePage from "@/pages/home";
import Hedge from "@/pages/hedge";
import TasksPage from "@/pages/tasks";
import ProfilePage from "@/pages/profile";
import SettingsPage from "@/pages/settings";

// Admin
import AdminDashboard from "@/pages/admin-dashboard";
import VideoPage from "@/pages/video";
import FinancialModel from "@/pages/financial-model";
import AcceptOwnership from "@/pages/accept-ownership";
import OracleSetup from "@/pages/oracle-setup";
import InstallTimelock from "@/pages/install-timelock";
import SafeTransfer from "@/pages/safe-transfer";
import ProposeOwnershipFacet from "@/pages/propose-ownership-facet";
import SafeAddOwner from "@/pages/safe-add-owner";
import ProposeV2Upgrades from "@/pages/propose-v2-upgrades";

// Routes that require Rift login. Unauthenticated visits redirect to /auth.
const PROTECTED_ROUTES = ['/home', '/hedge', '/tasks', '/profile', '/settings', '/wallet', '/rewards'];

function AuthGuard() {
  const [location, setLocation] = useLocation();
  useEffect(() => {
    const requiresAuth = PROTECTED_ROUTES.some(p => location === p || location.startsWith(p + '/'));
    if (requiresAuth && !isLoggedIn()) {
      setLocation('/auth');
    }
  }, [location, setLocation]);
  return null;
}

function Router() {
  return (
    <Switch>
      {/* Public */}
      <Route path="/" component={Website} />
      <Route path="/pitch" component={PitchDeck} />
      <Route path="/whitepaper" component={Whitepaper} />
      <Route path="/data-room" component={DataRoom} />
      <Route path="/terms" component={TermsPage} />
      <Route path="/privacy" component={PrivacyPage} />
      {/* Auth */}
      <Route path="/auth" component={Auth} />

      {/* Protected — AuthGuard above redirects unauthenticated users to /auth */}
      <Route path="/wallet" component={Wallet} />

      {/* Core features */}
      <Route path="/home" component={HomePage} />
      <Route path="/hedge" component={Hedge} />
      <Route path="/tasks" component={TasksPage} />
      <Route path="/profile" component={ProfilePage} />
      <Route path="/settings" component={SettingsPage} />

      {/* Rewards & admin */}
      <Route path="/rewards" component={TasksPage} />
      <Route path="/admin" component={AdminDashboard} />
      <Route path="/accept-ownership" component={AcceptOwnership} />
      <Route path="/oracle-setup" component={OracleSetup} />
      <Route path="/install-timelock" component={InstallTimelock} />
      <Route path="/safe-transfer" component={SafeTransfer} />
      <Route path="/propose-ownership-facet" component={ProposeOwnershipFacet} />
      <Route path="/safe-add-owner" component={SafeAddOwner} />
      <Route path="/propose-v2-upgrades" component={ProposeV2Upgrades} />
      <Route path="/video" component={VideoPage} />
      <Route path="/financial-model" component={FinancialModel} />

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <AuthGuard />
        <TxAuthDialog />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
