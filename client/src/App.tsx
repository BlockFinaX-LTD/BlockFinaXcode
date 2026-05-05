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
// NOTE: 7 single-purpose governance pages were removed in cleanup — they targeted
// the legacy Lisk Diamond (0x885E…) and a Safe-ownership-transfer + timelock-install
// migration path that was never executed on the current production Diamonds. Active
// admin operations now go through scripts in contracts/scripts/ (set-pricing-signer,
// upgrade-cut-facet, upgrade-hedge-v8, etc.) signed by the deployer or Safe keys.
// Removed pages: accept-ownership, oracle-setup, install-timelock, safe-transfer,
// propose-ownership-facet, safe-add-owner, propose-v2-upgrades.

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
