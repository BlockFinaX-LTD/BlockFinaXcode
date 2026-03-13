import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Lock, LogOut, ExternalLink, FileText, BarChart2, Globe,
  PlayCircle, FlaskConical, ShieldCheck, BookOpen, ChevronRight,
  Eye, Download, Clock, Building2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

const SESSION_KEY = "bfx_investor_token";

type Document = {
  title: string;
  description: string;
  type: "internal" | "external" | "download";
  href: string;
  badge?: string;
  icon: React.ElementType;
  status: "live" | "coming-soon";
};

type Category = {
  id: string;
  label: string;
  icon: React.ElementType;
  color: string;
  documents: Document[];
};

const CATEGORIES: Category[] = [
  {
    id: "overview",
    label: "Overview",
    icon: Building2,
    color: "from-blue-500/20 to-blue-500/5 border-blue-500/30",
    documents: [
      {
        title: "Pitch Deck",
        description: "10-slide interactive investor presentation with animated slides and PDF export",
        type: "internal",
        href: "/pitch",
        badge: "Interactive",
        icon: FileText,
        status: "live",
      },
      {
        title: "Executive Summary",
        description: "One-page summary of BlockFinaX — problem, solution, market, ask",
        type: "internal",
        href: "/pitch",
        badge: "Slide 1–3",
        icon: BookOpen,
        status: "live",
      },
    ],
  },
  {
    id: "financials",
    label: "Financials",
    icon: BarChart2,
    color: "from-emerald-500/20 to-emerald-500/5 border-emerald-500/30",
    documents: [
      {
        title: "Financial Model",
        description: "54-month bottom-up P&L model (Jul 2026–Dec 2030), editable inputs, Excel export",
        type: "internal",
        href: "/financial-model",
        badge: "Interactive",
        icon: BarChart2,
        status: "live",
      },
      {
        title: "Revenue Model",
        description: "Fee structure, blended take rate analysis, and per-product revenue breakdown",
        type: "internal",
        href: "/pitch",
        badge: "Slide 5",
        icon: FileText,
        status: "live",
      },
    ],
  },
  {
    id: "technology",
    label: "Technology",
    icon: ShieldCheck,
    color: "from-purple-500/20 to-purple-500/5 border-purple-500/30",
    documents: [
      {
        title: "Whitepaper",
        description: "Technical deep-dive: Diamond Standard, HedgeFacet, USDC flows, and settlement logic",
        type: "internal",
        href: "/whitepaper",
        badge: "Technical",
        icon: BookOpen,
        status: "live",
      },
      {
        title: "Oracle Strategy",
        description: "Current oracle architecture, known challenges, and phased decentralization roadmap",
        type: "internal",
        href: "/pitch",
        badge: "Slide 9",
        icon: Globe,
        status: "live",
      },
      {
        title: "Smart Contract Audit",
        description: "Security scan results (70.94/100), reentrancy patches, and verified contract addresses",
        type: "internal",
        href: "/pitch",
        badge: "Slide 8",
        icon: ShieldCheck,
        status: "live",
      },
    ],
  },
  {
    id: "demo",
    label: "Demo & Product",
    icon: PlayCircle,
    color: "from-amber-500/20 to-amber-500/5 border-amber-500/30",
    documents: [
      {
        title: "Product Demo Video",
        description: "Walkthrough of the Wallet and Hedge products on testnet",
        type: "internal",
        href: "/video",
        badge: "Video",
        icon: PlayCircle,
        status: "live",
      },
      {
        title: "Live Testnet App",
        description: "Fully functional testnet deployment — create a wallet and explore hedge markets live",
        type: "internal",
        href: "/home",
        badge: "Live",
        icon: FlaskConical,
        status: "live",
      },
    ],
  },
  {
    id: "market",
    label: "Market Research",
    icon: Globe,
    color: "from-rose-500/20 to-rose-500/5 border-rose-500/30",
    documents: [
      {
        title: "Market Opportunity",
        description: "TAM/SAM/SOM analysis — $210B African cross-border trade, $35B annual FX losses",
        type: "internal",
        href: "/pitch",
        badge: "Slide 4",
        icon: Globe,
        status: "live",
      },
      {
        title: "Competitive Landscape",
        description: "Comparison vs banks, OTC brokers, DeFi protocols, and prediction markets",
        type: "internal",
        href: "/pitch",
        badge: "Slide 6",
        icon: BarChart2,
        status: "live",
      },
      {
        title: "Go-to-Market Strategy",
        description: "4-phase GTM: community → SME direct → channel partners → flywheel",
        type: "internal",
        href: "/pitch",
        badge: "Slide 7",
        icon: ChevronRight,
        status: "live",
      },
    ],
  },
  {
    id: "legal",
    label: "Legal & Compliance",
    icon: FileText,
    color: "from-slate-500/20 to-slate-500/5 border-slate-500/30",
    documents: [
      {
        title: "Bank of Ghana Sandbox",
        description: "Regulatory sandbox application status and compliance roadmap",
        type: "internal",
        href: "/pitch",
        badge: "Slide 10",
        icon: ShieldCheck,
        status: "live",
      },
      {
        title: "Token Legal Opinion",
        description: "USDC-only model — no native token, no securities classification risk",
        type: "internal",
        href: "/whitepaper",
        badge: "Coming Soon",
        icon: FileText,
        status: "coming-soon",
      },
      {
        title: "NDA / Term Sheet",
        description: "Request a non-disclosure agreement or investment term sheet",
        type: "external",
        href: "mailto:anthonykumako8@gmail.com?subject=BlockFinaX%20NDA%20Request",
        badge: "Request",
        icon: FileText,
        status: "live",
      },
    ],
  },
];

function PasswordGate({ onSuccess }: { onSuccess: (token: string) => void }) {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/investor/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Invalid access code");
        return;
      }
      sessionStorage.setItem(SESSION_KEY, data.token);
      onSuccess(data.token);
      toast({ title: "Access granted", description: "Welcome to the BlockFinaX Investor Data Room." });
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "linear-gradient(135deg, #0a1628 0%, #0f2044 50%, #0a1628 100%)" }}>
      <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="w-full max-w-md px-6">
        <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-8 backdrop-blur-sm">
          <div className="text-center mb-8">
            <div className="w-14 h-14 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mx-auto mb-4">
              <Lock className="w-6 h-6 text-blue-400" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">Investor Data Room</h1>
            <p className="text-slate-400 text-sm leading-relaxed">
              This area is confidential and restricted to authorised investors and advisors.
              Enter your access code to continue.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              type="password"
              placeholder="Enter access code"
              value={password}
              onChange={e => { setPassword(e.target.value); setError(""); }}
              className="bg-white/[0.06] border-white/10 text-white placeholder:text-slate-500 h-12 text-center tracking-widest"
              autoFocus
            />
            {error && (
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-red-400 text-sm text-center">
                {error}
              </motion.p>
            )}
            <Button type="submit" disabled={loading || !password.trim()} className="w-full h-12 bg-blue-600 hover:bg-blue-500 text-white font-semibold">
              {loading ? "Verifying..." : "Access Data Room"}
            </Button>
          </form>

          <p className="text-center text-slate-600 text-xs mt-6">
            Don't have an access code?{" "}
            <a href="mailto:anthonykumako8@gmail.com?subject=BlockFinaX%20Data%20Room%20Access" className="text-blue-400 hover:underline">
              Request access
            </a>
          </p>
        </div>

        <p className="text-center text-slate-700 text-xs mt-4">
          BlockFinaX · Confidential · Not for public distribution
        </p>
      </motion.div>
    </div>
  );
}

function DataRoomContent({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [, navigate] = useLocation();
  const [activeCategory, setActiveCategory] = useState("overview");

  const handleLogout = async () => {
    await fetch("/api/investor/logout", {
      method: "POST",
      headers: { "x-investor-token": token },
    });
    sessionStorage.removeItem(SESSION_KEY);
    onLogout();
  };

  const handleOpen = (doc: Document) => {
    if (doc.status === "coming-soon") return;
    if (doc.type === "external") {
      window.open(doc.href, "_blank");
    } else {
      navigate(doc.href);
    }
  };

  const active = CATEGORIES.find(c => c.id === activeCategory)!;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-slate-900">BlockFinaX · Investor Data Room</h1>
            <p className="text-xs text-slate-400">Confidential — authorised access only</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1">
              <ShieldCheck className="w-3 h-3" />
              Secure session
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-full px-3 py-1">
              <Clock className="w-3 h-3" />
              Expires in 24h
            </div>
            <Button variant="outline" size="sm" onClick={handleLogout} className="text-slate-600 hover:text-red-600 hover:border-red-200">
              <LogOut className="w-4 h-4 mr-1.5" />
              Sign out
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 flex gap-8">
        {/* Sidebar */}
        <aside className="w-56 flex-shrink-0">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 px-2">Categories</p>
          <nav className="space-y-1">
            {CATEGORIES.map(cat => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  activeCategory === cat.id
                    ? "bg-blue-50 text-blue-700 border border-blue-100"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <cat.icon className="w-4 h-4 flex-shrink-0" />
                {cat.label}
                <span className={`ml-auto text-xs rounded-full px-1.5 py-0.5 font-medium ${
                  activeCategory === cat.id ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-400"
                }`}>
                  {cat.documents.length}
                </span>
              </button>
            ))}
          </nav>

          <div className="mt-8 p-4 bg-slate-100 rounded-xl border border-slate-200">
            <p className="text-xs font-semibold text-slate-700 mb-1">Need something else?</p>
            <p className="text-xs text-slate-500 mb-3">Request specific documents or schedule a call.</p>
            <a
              href="mailto:anthonykumako8@gmail.com?subject=BlockFinaX%20Investor%20Request"
              className="text-xs text-blue-600 font-semibold hover:underline flex items-center gap-1"
            >
              Contact us <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeCategory}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.2 }}
            >
              <div className={`rounded-2xl bg-gradient-to-br ${active.color} border p-6 mb-6`}>
                <div className="flex items-center gap-3">
                  <active.icon className="w-6 h-6 text-slate-700" />
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">{active.label}</h2>
                    <p className="text-sm text-slate-500">{active.documents.length} document{active.documents.length !== 1 ? "s" : ""} available</p>
                  </div>
                </div>
              </div>

              <div className="grid gap-4">
                {active.documents.map((doc, idx) => (
                  <motion.div
                    key={doc.title}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    onClick={() => handleOpen(doc)}
                    className={`group bg-white border border-slate-200 rounded-xl p-5 flex items-start gap-4 transition-all ${
                      doc.status === "coming-soon"
                        ? "opacity-50 cursor-not-allowed"
                        : "hover:border-blue-300 hover:shadow-md cursor-pointer"
                    }`}
                  >
                    <div className="w-10 h-10 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center flex-shrink-0 group-hover:bg-blue-50 group-hover:border-blue-200 transition-colors">
                      <doc.icon className="w-5 h-5 text-slate-500 group-hover:text-blue-600 transition-colors" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-slate-900 text-sm">{doc.title}</h3>
                        {doc.badge && (
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                            doc.status === "coming-soon"
                              ? "bg-slate-100 text-slate-400"
                              : doc.badge === "Live"
                              ? "bg-emerald-100 text-emerald-700"
                              : doc.badge === "Interactive"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-slate-100 text-slate-600"
                          }`}>
                            {doc.badge}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed">{doc.description}</p>
                    </div>
                    <div className="flex-shrink-0 ml-2">
                      {doc.status === "coming-soon" ? (
                        <span className="text-xs text-slate-400">Soon</span>
                      ) : doc.type === "external" ? (
                        <ExternalLink className="w-4 h-4 text-slate-300 group-hover:text-blue-500 transition-colors" />
                      ) : doc.type === "download" ? (
                        <Download className="w-4 h-4 text-slate-300 group-hover:text-blue-500 transition-colors" />
                      ) : (
                        <Eye className="w-4 h-4 text-slate-300 group-hover:text-blue-500 transition-colors" />
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <footer className="max-w-7xl mx-auto px-6 py-6 border-t border-slate-100 mt-8">
        <p className="text-xs text-slate-400 text-center">
          BlockFinaX Investor Data Room · Confidential · Not for public distribution ·{" "}
          <a href="mailto:anthonykumako8@gmail.com" className="hover:text-blue-500">anthonykumako8@gmail.com</a>
        </p>
      </footer>
    </div>
  );
}

export default function DataRoom() {
  const [token, setToken] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (!stored) { setChecking(false); return; }

    fetch("/api/investor/verify", { headers: { "x-investor-token": stored } })
      .then(r => r.json())
      .then(data => {
        if (data.valid) setToken(stored);
        else sessionStorage.removeItem(SESSION_KEY);
      })
      .catch(() => sessionStorage.removeItem(SESSION_KEY))
      .finally(() => setChecking(false));
  }, []);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a1628]">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <AnimatePresence mode="wait">
      {token ? (
        <DataRoomContent key="content" token={token} onLogout={() => setToken(null)} />
      ) : (
        <PasswordGate key="gate" onSuccess={setToken} />
      )}
    </AnimatePresence>
  );
}
