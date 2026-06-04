/**
 * Main Application Component
 *
 * React application root with routing, state management, and wallet integration.
 * Auth + wallet provisioning is handled by the @rift-finance/react widget
 * (RiftProvider + RiftAuth). RiftTokenBridge keeps the JWT in sync with the
 * legacy wallet SDK so non-React modules can keep calling typed methods.
 */

import { Switch, Route, useLocation } from "wouter";
import { useEffect, useState } from "react";
import { queryClient } from "./lib/api-client";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RiftProvider, RiftAuth, useRift } from "@rift-finance/react";
import { RiftTokenBridge } from "@/lib/rift-token-bridge";
import { getMe, setCachedUserSummary, clearLocalRiftState } from "@/lib/rift-client";
import { TxAuthDialog } from "@/components/wallet/tx-auth-dialog";
import { useToast } from "@/hooks/use-toast";

// Public pages
import Website from "@/pages/website";
import PitchDeck from "@/pages/pitch-deck";
import Whitepaper from "@/pages/whitepaper";
import DataRoom from "@/pages/data-room";
import TermsPage from "@/pages/terms";
import PrivacyPage from "@/pages/privacy";
import BlogPage from "@/pages/blog";
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

// Private beta gating
import ApplyPage from "@/pages/apply";
import DocsRequestPage from "@/pages/docs-request";
import DocsIndex from "@/pages/docs-index";
import LiquidityProviderPage from "@/pages/liquidity-provider";
import HedgerPage from "@/pages/hedger";
import { DocsGate } from "@/components/docs-gate";

const RIFT_API_KEY = (import.meta.env.VITE_RIFT_API_KEY || '').trim();

// White-label sign-in: the widget is served from our own subdomain so the
// Google sign-in screen reads "Sign in to BlockFinaX" instead of the partner
// host. Same project, same API key, same behaviour — only the embed URL
// changes. Override via VITE_RIFT_WIDGET_URL if we ever need to point back
// at the partner-hosted widget for debugging.
const RIFT_WIDGET_URL =
  (import.meta.env.VITE_RIFT_WIDGET_URL || 'https://widget.blockfinax.com').trim();

// Routes that require Rift login. Unauthenticated visits redirect to /auth.
const PROTECTED_ROUTES = ['/home', '/hedge', '/tasks', '/profile', '/settings', '/wallet', '/rewards'];

// True on first paint if the Rift provider has a persisted session in storage.
// Used to suppress the /auth redirect during the brief window between mount
// and the provider rehydrating its JWT — without it, signed-in users bounce
// to /auth on every cold reload.
function hasStoredRiftSession(): boolean {
  if (typeof window === 'undefined') return false;
  try { return !!window.localStorage.getItem('rift:identity'); } catch { return false; }
}

function AuthGuard() {
  const { isAuthenticated } = useRift();
  const [location, setLocation] = useLocation();
  // Snapshot once at mount — flips false only after the user explicitly signs out.
  const [pendingHydration, setPendingHydration] = useState<boolean>(() => hasStoredRiftSession());
  useEffect(() => {
    // The moment the provider confirms auth, hydration is done.
    if (isAuthenticated) setPendingHydration(false);
  }, [isAuthenticated]);
  useEffect(() => {
    // Fallback: if the stored session is invalid (expired refresh, server
    // revoked, etc.) we still need to redirect eventually. 2s is enough
    // for the iframe-based silent refresh to complete in practice.
    if (!pendingHydration) return;
    const t = setTimeout(() => setPendingHydration(false), 2000);
    return () => clearTimeout(t);
  }, [pendingHydration]);
  useEffect(() => {
    if (pendingHydration) return;
    const requiresAuth = PROTECTED_ROUTES.some(p => location === p || location.startsWith(p + '/'));
    if (requiresAuth && !isAuthenticated) {
      setLocation('/auth');
    }
  }, [location, isAuthenticated, pendingHydration, setLocation]);
  return null;
}

/**
 * Reacts to widget sign-in by (a) caching the user summary so the wallet
 * page can render instantly on reload, and (b) fetching the full user
 * profile so OTP-gated tx prompts know which channel to use.
 */
function RiftPostSigninSync() {
  const { user, isAuthenticated } = useRift();
  useEffect(() => {
    if (isAuthenticated && user) {
      setCachedUserSummary({
        user: user.user,
        address: user.address,
        btcAddress: user.btcAddress,
      });
      // Fire-and-forget — pulls email/phone for the AuthMethod cache.
      getMe().catch(() => {});
      // Fire-and-forget — ensures the dashboard user count reflects this
      // Rift account. The server upserts by address so repeat sign-ins on
      // the same address are idempotent no-ops.
      if (user.accessToken) {
        fetch('/api/rift/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accessToken: user.accessToken }),
        }).catch(() => {});
      }
    } else if (!isAuthenticated) {
      clearLocalRiftState();
    }
  }, [isAuthenticated, user?.user, user?.accessToken]);
  return null;
}

// App routes are open — anyone who signs in via Rift can use them. The
// allowlist gate (AccessGate) is intentionally not applied here so new
// users can discover and use the product directly. Auth is still required
// (AuthGuard redirects unauthenticated visitors to /auth) but the post
// sign-in approval wall is gone.

// Docs gate: the whitepaper, data room, and pitch deck only render once the
// visitor has a valid magic-link token. The gate intercepts and shows a
// "request access" form otherwise. Docs stay gated.
const DocsIndexGated  = () => <DocsGate><DocsIndex /></DocsGate>;
const PitchGated      = () => <DocsGate><PitchDeck /></DocsGate>;
const WhitepaperGated = () => <DocsGate><Whitepaper /></DocsGate>;
const DataRoomGated   = () => <DocsGate><DataRoom /></DocsGate>;

function Router() {
  return (
    <Switch>
      {/* Public */}
      <Route path="/" component={Website} />
      <Route path="/terms" component={TermsPage} />
      <Route path="/privacy" component={PrivacyPage} />
      <Route path="/blog" component={BlogPage} />
      <Route path="/blog/:slug" component={BlogPage} />
      <Route path="/apply" component={ApplyPage} />
      <Route path="/docs/request" component={DocsRequestPage} />
      <Route path="/liquidity-provider" component={LiquidityProviderPage} />
      <Route path="/hedger" component={HedgerPage} />

      {/* Auth — open to anyone. Rift widget renders unconditionally so new
          users can sign up without an invitation. */}
      <Route path="/auth" component={Auth} />

      {/* Docs — gated by per-request magic-link token */}
      <Route path="/docs" component={DocsIndexGated} />
      <Route path="/pitch" component={PitchGated} />
      <Route path="/whitepaper" component={WhitepaperGated} />
      <Route path="/data-room" component={DataRoomGated} />

      {/* App routes — AuthGuard redirects unauthenticated visitors to /auth.
          No allowlist check after sign-in: anyone with a Rift session can
          use the app. */}
      <Route path="/wallet" component={Wallet} />
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

function RiftAuthMount() {
  const { toast } = useToast();
  return (
    <RiftAuth
      // Full-page modal — the widget owns the entire viewport instead of
      // floating as a centered card. Mobile users get the same experience.
      maxHeight="100dvh"
      maxWidth="100vw"
      radius={0}
      backdrop={{
        color: 'hsl(var(--background))',
        blur: 0,
      }}
      iframeStyle={{
        width: '100vw',
        height: '100dvh',
        border: 'none',
      }}
      onError={(msg) => toast({ title: 'Sign-in error', description: msg, variant: 'destructive' })}
    />
  );
}

function App() {
  return (
    // `persist` keeps the session in storage across reloads so signed-in users
    // don't get bounced back to /auth on refresh. Combined with the isReady
    // gate in AuthGuard, the redirect only fires after rehydration completes.
    <RiftProvider apiKey={RIFT_API_KEY} widgetUrl={RIFT_WIDGET_URL} persist>
      <RiftTokenBridge />
      <RiftPostSigninSync />
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <RiftAuthMount />
          <AuthGuard />
          <TxAuthDialog />
          <Router />
        </TooltipProvider>
      </QueryClientProvider>
    </RiftProvider>
  );
}

export default App;
