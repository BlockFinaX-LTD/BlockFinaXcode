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
import NotFound from "@/pages/not-found";

// Wallet & auth
import Wallet from "@/pages/wallet";
import CreateWallet from "@/pages/create-wallet";
import ImportWallet from "@/pages/import-wallet";
import UnlockWallet from "@/pages/unlock-wallet";

// Core features
import HomePage from "@/pages/home";
import Hedge from "@/pages/hedge";
import TasksPage from "@/pages/tasks";
import ProfilePage from "@/pages/profile";
import Faucet from "@/pages/faucet";


// Admin
import AdminDashboard from "@/pages/admin-dashboard";
import VideoPage from "@/pages/video";
import FinancialModel from "@/pages/financial-model";

function Router() {
  return (
    <Switch>
      {/* Public */}
      <Route path="/" component={Website} />
      <Route path="/pitch" component={PitchDeck} />
      <Route path="/whitepaper" component={Whitepaper} />
      {/* Wallet & auth */}
      <Route path="/wallet" component={Wallet} />
      <Route path="/create-wallet" component={CreateWallet} />
      <Route path="/import-wallet" component={ImportWallet} />
      <Route path="/unlock-wallet" component={UnlockWallet} />

      {/* Core features */}
      <Route path="/home" component={HomePage} />
      <Route path="/hedge" component={Hedge} />
      <Route path="/tasks" component={TasksPage} />
      <Route path="/profile" component={ProfilePage} />
      <Route path="/faucet" component={Faucet} />

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
