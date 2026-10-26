/**
 * Main Application Component
 *
 * React application root with routing, state management, and wallet integration.
 * Sign-in is the BlockFinaX passkey wallet (lib/identity.tsx): email or Google,
 * then a passkey that creates the user's Stellar account.
 */

import { Switch, Route, Redirect, useLocation } from "wouter";
import { isWalletSandbox } from "@/lib/wallet-environment";
import { useEffect, useState } from "react";
import { queryClient } from "./lib/api-client";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { IdentityProvider, rememberReturnPath, useIdentity } from "@/lib/identity";
import { storedSessionToken } from "@/lib/wallets/passkey-wallet";

// Public pages
import Website, { AboutPage, HedgersPage, UnderwritersPage } from "@/pages/website";
import PitchDeck from "@/pages/pitch-deck";
import Whitepaper from "@/pages/whitepaper";
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
import Hedge from "@/pages/hedge";

// Admin
import AdminDashboard from "@/pages/admin-dashboard";
import VideoPage from "@/pages/video";
import FinancialModel from "@/pages/financial-model";

// Private beta gating
import ApplyPage from "@/pages/apply";
import ContactPage from "@/pages/contact";
import TechnicalDocs from "@/pages/docs-technical";
import DocsIndex from "@/pages/docs-index";
import AcademyRoute from "@/pages/academy";

// Counterparty signing portal. Public by design — authenticated by the
// bearer token in the emailed link, not by a BlockFinaX account.
import LoiSignPage from "@/pages/loi-sign";

// Finax — the chat assistant. Public scope on the marketing site, customer
// scope inside the app where it can see the signed-in user's own account.
import { FinaxChat } from "@/components/finax-chat";

// AML/CFT verification — customers raise their own transacting limits here.

// Signed-in app routes. Unauthenticated visits redirect to /auth.
const PROTECTED_ROUTES = ['/hedge'];

// True on first paint if a session token is stored. Used to suppress the /auth
// redirect while the session is being checked, so signed-in users are not
// bounced to /auth on every reload.
function hasStoredSession(): boolean {
  if (typeof window === 'undefined') return false;
  return !!storedSessionToken();
}

function AuthGuard() {
  const { isAuthenticated } = useIdentity();
  const [location, setLocation] = useLocation();
  // Snapshot once at mount — flips false only after the user explicitly signs out.
  const [pendingHydration, setPendingHydration] = useState<boolean>(() => hasStoredSession());
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
      rememberReturnPath(location);
      setLocation('/auth');
    }
  }, [location, isAuthenticated, pendingHydration, setLocation]);
  return null;
}

// App routes are open — anyone who signs in can use them. The
// allowlist gate (AccessGate) is intentionally not applied here so new
// users can discover and use the product directly. Auth is still required
// (AuthGuard redirects unauthenticated visitors to /auth) but the post
// sign-in approval wall is gone.

// Document routes are public; no sign-in or access approval is required.

function Router() {
  return (
    <Switch>
      {/* Public */}
      <Route path="/">{isWalletSandbox ? <Redirect to="/home" /> : <Website />}</Route>
      <Route path="/terms" component={TermsPage} />
      <Route path="/faq" component={FaqPage} />
      <Route path="/privacy" component={PrivacyPage} />
      <Route path="/blog" component={BlogPage} />
      <Route path="/blog/:slug" component={BlogPage} />
      <Route path="/predict" component={PredictPage} />
      <Route path="/apply" component={ApplyPage} />
      <Route path="/contact" component={ContactPage} />
      <Route path="/about" component={AboutPage} />
      <Route path="/docs/request"><Redirect to="/docs" /></Route>
      <Route path="/liquidity-provider" component={UnderwritersPage} />
      <Route path="/hedger" component={HedgersPage} />

      {/* Agreement signing. Deliberately outside PROTECTED_ROUTES: the
          counterparty has no BlockFinaX account and must never be asked for
          one. The link's token is the credential. */}
      <Route path="/sign/:publicId" component={LoiSignPage} />

      {/* Academy — public course pages under /learn. One dispatcher handles
          the root (Start here) and every /learn/:slug lesson from the catalog. */}
      <Route path="/learn" component={AcademyRoute} />
      <Route path="/learn/:slug" component={AcademyRoute} />

      {/* Auth — open to anyone, so new users can sign up without an invitation. */}
      <Route path="/auth" component={Auth} />
      <Route path="/auth/google/done" component={Auth} />

      {/* Docs — gated by per-request magic-link token */}
      <Route path="/docs/technical" component={TechnicalDocs} />
      <Route path="/docs" component={DocsIndex} />
      <Route path="/pitch" component={PitchDeck} />
      <Route path="/traction/:key" component={TractionShare} />
      <Route path="/data-room" component={DataRoom} />
      <Route path="/data-room/whitepaper" component={Whitepaper} />
      {/* Old public path. Kept as a redirect so shared links and bookmarks
          land in the data room rather than on a 404. */}
      <Route path="/whitepaper"><Redirect to="/data-room/whitepaper" /></Route>

      {/* The app is the workspace at /hedge. Pages from the earlier wallet app
          redirect there, so old links and bookmarks still land somewhere useful. */}
      {['/home', '/wallet', '/tasks', '/rewards', '/profile', '/settings', '/verify', '/signing', '/notifications'].map((p) => (
        <Route key={p} path={p}><Redirect to="/hedge" /></Route>
      ))}
      <Route path="/hedge" component={Hedge} />

      {/* Admin */}
      <Route path="/admin" component={AdminDashboard} />
      <Route path="/video" component={VideoPage} />
      <Route path="/financial-model" component={FinancialModel} />

      <Route component={NotFound} />
    </Switch>
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
  const { isAuthenticated } = useIdentity();
  const [location] = useLocation();

  const hidden = ["/admin", "/auth", "/sign/"].some((p) => location.startsWith(p));
  if (hidden || isWalletSandbox) return null;

  const inApp = PROTECTED_ROUTES.some((p) => location === p || location.startsWith(p + "/"));
  return <FinaxChat scope={inApp && isAuthenticated ? "customer" : "public"} />;
}

function App() {
  return (
    <IdentityProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <AuthGuard />
          <Router />
          <FinaxMount />
        </TooltipProvider>
      </QueryClientProvider>
    </IdentityProvider>
  );
}

export default App;
