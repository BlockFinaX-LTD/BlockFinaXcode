/**
 * Main Application Component
 * 
 * React application root with routing, state management, and wallet integration.
 * Handles wallet authentication flow, referral processing, and global providers.
 */

import { Switch, Route } from "wouter";
import { queryClient } from "./lib/api-client";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

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
import CreateWallet from "@/pages/create-wallet";
import ImportWallet from "@/pages/import-wallet";
import UnlockWallet from "@/pages/unlock-wallet";
import Auth from "@/pages/auth";
import AuthEmailSent from "@/pages/auth-email-sent";
import AuthVerify from "@/pages/auth-verify";
import AuthGoogleDone from "@/pages/auth-google-done";
import SetPin from "@/pages/set-pin";

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
      {/* Wallet & auth */}
      <Route path="/wallet" component={Wallet} />
      <Route path="/create-wallet" component={CreateWallet} />
      <Route path="/import-wallet" component={ImportWallet} />
      <Route path="/unlock-wallet" component={UnlockWallet} />
      <Route path="/auth" component={Auth} />
      <Route path="/auth/email-sent" component={AuthEmailSent} />
      <Route path="/auth/verify" component={AuthVerify} />
      <Route path="/auth/google/done" component={AuthGoogleDone} />
      <Route path="/set-pin" component={SetPin} />

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
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
