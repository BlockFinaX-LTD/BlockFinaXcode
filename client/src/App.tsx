/**
 * Main Application Component
 *
 * React application root with routing, state management, and wallet integration.
 * Auth + wallet provisioning is handled by the @rift-finance/react widget
 * (RiftProvider + RiftAuth). RiftTokenBridge keeps the JWT in sync with the
 * legacy wallet SDK so non-React modules can keep calling typed methods.
 */

import { Switch, Route, Redirect, useLocation } from "wouter";
import { useEffect, useState } from "react";
import { queryClient } from "./lib/api-client";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RiftProvider, RiftAuth, useRift } from "@rift-finance/react";
import { RiftTokenBridge } from "@/lib/rift-token-bridge";
import { getMe, setCachedUserSummary, clearLocalRiftState } from "@/lib/rift-client";
import { TxAuthDialog } from "@/components/wallet/tx-auth-dialog";
import { V3SignDialog } from "@/components/wallet/v3-sign-dialog";
import { MethodChooser } from "@/components/wallet/method-chooser";
import { useToast } from "@/hooks/use-toast";

// Public pages
import Website, { AboutPage, ConnectorsPage, HedgersPage, UnderwritersPage } from "@/pages/website";
import PitchDeck from "@/pages/pitch-deck";
import Whitepaper from "@/pages/whitepaper";
import { InvestorGate } from "@/components/investor-gate";
import DataRoom from "@/pages/data-room";
import TractionShare from "@/pages/traction-share";
import TermsPage from "@/pages/terms";
import FaqPage from "@/pages/faq";
import PrivacyPage from "@/pages/privacy";
import BlogPage from "@/pages/blog";
import PredictPage from "@/pages/predict";
import NotFound from "@/pages/not-found";

// Auth
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
import ContactPage from "@/pages/contact";
import TechnicalDocs from "@/pages/docs-technical";
import DocsRequestPage from "@/pages/docs-request";
import DocsIndex from "@/pages/docs-index";
import AcademyRoute from "@/pages/academy";
import { DocsSessionRecovery } from "@/components/docs-session-recovery";
import { DocsGate } from "@/components/docs-gate";

// Counterparty signing portal. Public by design — authenticated by the
// bearer token in the emailed link, not by a BlockFinaX account.
import LoiSignPage from "@/pages/loi-sign";

// Finax — the chat assistant. Public scope on the marketing site, customer
// scope inside the app where it can see the signed-in user's own account.
import { FinaxChat } from "@/components/finax-chat";

// AML/CFT verification — customers raise their own transacting limits here.
import VerifyPage from "@/pages/verify";
import SigningPage from "@/pages/signing";
import NotificationsPage from "@/pages/notifications";

/**
 * The browser must use a PUBLISHABLE key (pk_), never a secret one (sk_).
 *
 * Anything Vite sees prefixed VITE_ is inlined into the bundle it ships to
 * every visitor, so a key placed here is public by construction. That is fine
 * for a widget key — Rift's docs are explicit that the project key is meant to
 * be public and the safety property is the origin allowlist — and it is not
 * fine for a server key, which can enumerate and suspend users.
 *
 * Prefers VITE_RIFT_PUBLIC_KEY. The fallback keeps the app running until Rift
 * issues a pk_; the moment they do, this becomes a config change and nothing
 * else needs touching.
 */
const RIFT_API_KEY = (import.meta.env.VITE_RIFT_PUBLIC_KEY || import.meta.env.VITE_RIFT_API_KEY || '').trim();

// White-label sign-in: the widget is served from our own subdomain so the
// Google sign-in screen reads "Sign in to BlockFinaX" instead of the partner
// host. Same project, same API key, same behaviour — only the embed URL
// changes. Override via VITE_RIFT_WIDGET_URL if we ever need to point back
// at the partner-hosted widget for debugging.
const RIFT_WIDGET_URL =
  (import.meta.env.VITE_RIFT_WIDGET_URL || 'https://widget.blockfinax.com').trim();

// Routes that require Rift login. Unauthenticated visits redirect to /auth.
const PROTECTED_ROUTES = ['/home', '/hedge', '/tasks', '/profile', '/settings', '/wallet', '/rewards', '/verify'];

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
        // Carry the referral code captured at /auth?ref=CODE (if any). The
        // server only attributes it for a genuinely new wallet, then clears it.
        let referralCode: string | null = null;
        try { referralCode = localStorage.getItem('bfx_ref'); } catch { /* ignore */ }
        fetch('/api/rift/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accessToken: user.accessToken, ...(referralCode ? { referralCode } : {}) }),
        })
          .then(() => { try { localStorage.removeItem('bfx_ref'); } catch { /* ignore */ } })
          .catch(() => {});
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

// Docs gate: the whitepaper, docs index, and pitch deck only render once the
// visitor has a valid magic-link token. The gate intercepts and shows a
// "request access" form otherwise. Docs stay gated.
const TechnicalDocsGated = () => <DocsGate><TechnicalDocs /></DocsGate>;
const DocsIndexGated  = () => <DocsGate><DocsIndex /></DocsGate>;
const PitchGated      = () => <DocsGate><PitchDeck /></DocsGate>;
// The whitepaper is an investor document, not a marketing page. It sits under
// /data-room and admits only a live data-room session — no magic link, no
// admin bypass, and no entry from the public navigation.
const WhitepaperGated = () => <DocsSessionRecovery><InvestorGate><Whitepaper /></InvestorGate></DocsSessionRecovery>;

// Recover approved docs sessions before entering the data room. Visitors
// without a docs credential can still use its existing password screen.
const DataRoomGated   = () => <DocsSessionRecovery><DataRoom /></DocsSessionRecovery>;

function Router() {
  return (
    <Switch>
      {/* Public */}
      <Route path="/" component={Website} />
      <Route path="/terms" component={TermsPage} />
      <Route path="/faq" component={FaqPage} />
      <Route path="/privacy" component={PrivacyPage} />
      <Route path="/blog" component={BlogPage} />
      <Route path="/blog/:slug" component={BlogPage} />
      <Route path="/predict" component={PredictPage} />
      <Route path="/apply" component={ApplyPage} />
      <Route path="/contact" component={ContactPage} />
      <Route path="/about" component={AboutPage} />
      <Route path="/docs/request" component={DocsRequestPage} />
      <Route path="/liquidity-provider" component={UnderwritersPage} />
      <Route path="/hedger" component={HedgersPage} />
      <Route path="/connectors" component={ConnectorsPage} />

      {/* Agreement signing. Deliberately outside PROTECTED_ROUTES: the
          counterparty has no BlockFinaX account and must never be asked for
          one. The link's token is the credential. */}
      <Route path="/sign/:publicId" component={LoiSignPage} />

      {/* Academy — public course pages under /learn. One dispatcher handles
          the root (Start here) and every /learn/:slug lesson from the catalog. */}
      <Route path="/learn" component={AcademyRoute} />
      <Route path="/learn/:slug" component={AcademyRoute} />

      {/* Auth — open to anyone. Rift widget renders unconditionally so new
          users can sign up without an invitation. */}
      <Route path="/auth" component={Auth} />

      {/* Docs — gated by per-request magic-link token */}
      <Route path="/docs/technical" component={TechnicalDocsGated} />
      <Route path="/docs" component={DocsIndexGated} />
      <Route path="/pitch" component={PitchGated} />
      <Route path="/traction/:key" component={TractionShare} />
      <Route path="/data-room" component={DataRoomGated} />
      <Route path="/data-room/whitepaper" component={WhitepaperGated} />
      {/* Old public path. Kept as a redirect so shared links and bookmarks
          land in the data room rather than on a 404. */}
      <Route path="/whitepaper"><Redirect to="/data-room/whitepaper" /></Route>

      {/* App routes — AuthGuard redirects unauthenticated visitors to /auth.
          No allowlist check after sign-in: anyone with a Rift session can
          use the app. */}
      {/* Wallet page retired — its functions live on Home now. Old links/bookmarks redirect. */}
      <Route path="/wallet"><Redirect to="/home" /></Route>
      <Route path="/home" component={HomePage} />
      <Route path="/hedge" component={Hedge} />
      <Route path="/tasks" component={TasksPage} />
      <Route path="/profile" component={ProfilePage} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/verify" component={VerifyPage} />
      <Route path="/signing" component={SigningPage} />
      <Route path="/notifications" component={NotificationsPage} />

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

/**
 * Picks which Finax to show, and where to hide it.
 *
 * Signed-in app routes get the customer agent, which can read the caller's own
 * cover and deposits. Everything else gets the public one. It stays out of the
 * way on surfaces where a floating button would be wrong: the admin console
 * has Finax as a full section already, the signing portal belongs to a
 * counterparty who has no account, and /auth is mid-sign-in.
 */
function FinaxMount() {
  const { isAuthenticated } = useRift();
  const [location] = useLocation();

  const hidden = ["/admin", "/auth", "/sign/"].some((p) => location.startsWith(p));
  if (hidden) return null;

  const inApp = PROTECTED_ROUTES.some((p) => location === p || location.startsWith(p + "/"));
  return <FinaxChat scope={inApp && isAuthenticated ? "customer" : "public"} />;
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
          <V3SignDialog />
          <MethodChooser />
          <Router />
          <FinaxMount />
        </TooltipProvider>
      </QueryClientProvider>
    </RiftProvider>
  );
}

export default App;
