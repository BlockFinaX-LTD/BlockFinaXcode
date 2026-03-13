import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import {
  Lock, LogOut, ExternalLink, FileText, BarChart2, Globe,
  PlayCircle, Beaker, ShieldCheck, BookOpen, ChevronRight,
  Eye, Download, Clock, Building2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

const SESSION_KEY = "bfx_investor_token";

const CATEGORIES = [
  {
    id: "overview",
    label: "Overview",
    icon: Building2,
    color: "border-blue-200 bg-blue-50",
    iconColor: "text-blue-600",
    documents: [
      { title: "Pitch Deck", description: "10-slide interactive investor presentation with animated slides and PDF export", href: "/pitch", badge: "Interactive", badgeColor: "bg-blue-100 text-blue-700", icon: FileText, status: "live" },
      { title: "Executive Summary", description: "Cover, problem, and solution overview in 3 slides", href: "/pitch", badge: "Slides 1–3", badgeColor: "bg-slate-100 text-slate-600", icon: BookOpen, status: "live" },
    ],
  },
  {
    id: "financials",
    label: "Financials",
    icon: BarChart2,
    color: "border-emerald-200 bg-emerald-50",
    iconColor: "text-emerald-600",
    documents: [
      { title: "Financial Model", description: "54-month bottom-up P&L (Jul 2026–Dec 2030), editable inputs, Excel export", href: "/financial-model", badge: "Interactive", badgeColor: "bg-blue-100 text-blue-700", icon: BarChart2, status: "live" },
      { title: "Revenue Breakdown", description: "Fee structure, blended take rate, and per-product revenue analysis", href: "/pitch", badge: "Slide 5", badgeColor: "bg-slate-100 text-slate-600", icon: FileText, status: "live" },
    ],
  },
  {
    id: "technology",
    label: "Technology",
    icon: ShieldCheck,
    color: "border-purple-200 bg-purple-50",
    iconColor: "text-purple-600",
    documents: [
      { title: "Whitepaper", description: "Technical deep-dive: Diamond Standard, HedgeFacet, USDC flows, settlement logic", href: "/whitepaper", badge: "Technical", badgeColor: "bg-purple-100 text-purple-700", icon: BookOpen, status: "live" },
      { title: "Oracle Strategy", description: "Current oracle architecture, known challenges, and decentralization roadmap", href: "/pitch", badge: "Slide 9", badgeColor: "bg-slate-100 text-slate-600", icon: Globe, status: "live" },
      { title: "Security Audit", description: "Scan results (70.94/100), reentrancy patches, verified contract addresses on Blockscout", href: "/pitch", badge: "Slide 8", badgeColor: "bg-slate-100 text-slate-600", icon: ShieldCheck, status: "live" },
    ],
  },
  {
    id: "demo",
    label: "Demo & Product",
    icon: PlayCircle,
    color: "border-amber-200 bg-amber-50",
    iconColor: "text-amber-600",
    documents: [
      { title: "Product Demo Video", description: "Walkthrough of the Wallet and Hedge products on testnet", href: "/video", badge: "Video", badgeColor: "bg-amber-100 text-amber-700", icon: PlayCircle, status: "live" },
      { title: "Live Testnet App", description: "Fully functional deployment — create a wallet and explore hedge markets live", href: "/home", badge: "Live", badgeColor: "bg-emerald-100 text-emerald-700", icon: Beaker, status: "live" },
    ],
  },
  {
    id: "market",
    label: "Market Research",
    icon: Globe,
    color: "border-rose-200 bg-rose-50",
    iconColor: "text-rose-600",
    documents: [
      { title: "Market Opportunity", description: "TAM/SAM/SOM: $210B African cross-border trade, $35B annual FX losses", href: "/pitch", badge: "Slide 4", badgeColor: "bg-slate-100 text-slate-600", icon: Globe, status: "live" },
      { title: "Competitive Landscape", description: "Comparison vs banks, OTC brokers, DeFi protocols, and prediction markets", href: "/pitch", badge: "Slide 6", badgeColor: "bg-slate-100 text-slate-600", icon: BarChart2, status: "live" },
      { title: "Go-to-Market Strategy", description: "4-phase GTM: community → SME direct → channel partners → flywheel effects", href: "/pitch", badge: "Slide 7", badgeColor: "bg-slate-100 text-slate-600", icon: ChevronRight, status: "live" },
    ],
  },
  {
    id: "legal",
    label: "Legal & Compliance",
    icon: FileText,
    color: "border-slate-200 bg-slate-50",
    iconColor: "text-slate-600",
    documents: [
      { title: "Bank of Ghana Sandbox", description: "Regulatory sandbox application status and compliance roadmap", href: "/pitch", badge: "In Progress", badgeColor: "bg-orange-100 text-orange-700", icon: ShieldCheck, status: "live" },
      { title: "Token Legal Opinion", description: "USDC-only model — no native token, no securities classification risk", href: "/whitepaper", badge: "Coming Soon", badgeColor: "bg-slate-100 text-slate-400", icon: FileText, status: "coming-soon" },
      { title: "Request NDA / Term Sheet", description: "Contact us to request a non-disclosure agreement or investment term sheet", href: "mailto:anthonykumako8@gmail.com?subject=BlockFinaX%20NDA%20Request", badge: "Email", badgeColor: "bg-slate-100 text-slate-600", icon: ExternalLink, status: "external" },
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
      if (!res.ok) { setError(data.message || "Invalid access code"); return; }
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
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0a1628 0%, #0f2044 50%, #0a1628 100%)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
      <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} style={{ width: "100%", maxWidth: "420px" }}>
        <div style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "16px", padding: "40px", backdropFilter: "blur(12px)" }}>
          <div style={{ textAlign: "center", marginBottom: "32px" }}>
            <div style={{ width: "56px", height: "56px", borderRadius: "12px", background: "rgba(61,142,245,0.1)", border: "1px solid rgba(61,142,245,0.2)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
              <Lock style={{ width: "24px", height: "24px", color: "#3d8ef5" }} />
            </div>
            <h1 style={{ fontSize: "22px", fontWeight: 700, color: "white", marginBottom: "8px" }}>Investor Data Room</h1>
            <p style={{ fontSize: "14px", color: "#94a3b8", lineHeight: 1.6 }}>
              This area is confidential and restricted to authorised investors and advisors. Enter your access code to continue.
            </p>
          </div>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <Input
              type="password"
              placeholder="Enter access code"
              value={password}
              onChange={e => { setPassword(e.target.value); setError(""); }}
              className="bg-white/[0.06] border-white/10 text-white placeholder:text-slate-500 h-12 text-center tracking-widest"
              autoFocus
            />
            {error && <p style={{ color: "#f87171", fontSize: "14px", textAlign: "center" }}>{error}</p>}
            <Button type="submit" disabled={loading || !password.trim()} style={{ height: "48px", background: "#2563eb", color: "white", fontWeight: 600, border: "none", borderRadius: "8px", cursor: "pointer" }}>
              {loading ? "Verifying..." : "Access Data Room"}
            </Button>
          </form>

          <p style={{ textAlign: "center", color: "#475569", fontSize: "13px", marginTop: "24px" }}>
            No access code?{" "}
            <a href="mailto:anthonykumako8@gmail.com?subject=BlockFinaX%20Data%20Room%20Access" style={{ color: "#3d8ef5" }}>Request access</a>
          </p>
        </div>
        <p style={{ textAlign: "center", color: "#334155", fontSize: "12px", marginTop: "16px" }}>BlockFinaX · Confidential · Not for public distribution</p>
      </motion.div>
    </div>
  );
}

function DataRoomContent({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [, navigate] = useLocation();
  const [activeCategory, setActiveCategory] = useState("overview");
  const { toast } = useToast();

  const handleLogout = async () => {
    await fetch("/api/investor/logout", { method: "POST", headers: { "x-investor-token": token } });
    sessionStorage.removeItem(SESSION_KEY);
    onLogout();
  };

  const handleOpen = (doc: typeof CATEGORIES[0]["documents"][0]) => {
    if (doc.status === "coming-soon") {
      toast({ title: "Coming soon", description: "This document will be available shortly." });
      return;
    }
    if (doc.status === "external" || doc.href.startsWith("mailto:")) {
      window.open(doc.href, "_blank");
    } else {
      navigate(doc.href);
    }
  };

  const active = CATEGORIES.find(c => c.id === activeCategory)!;

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc" }}>
      {/* Header */}
      <div style={{ background: "white", borderBottom: "1px solid #e2e8f0", position: "sticky", top: 0, zIndex: 40 }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h1 style={{ fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>BlockFinaX · Investor Data Room</h1>
            <p style={{ fontSize: "12px", color: "#94a3b8" }}>Confidential — authorised access only</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#16a34a", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "999px", padding: "4px 12px" }}>
              <ShieldCheck style={{ width: "12px", height: "12px" }} /> Secure session
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "999px", padding: "4px 12px" }}>
              <Clock style={{ width: "12px", height: "12px" }} /> Expires 24h
            </span>
            <Button variant="outline" size="sm" onClick={handleLogout} style={{ color: "#64748b", fontSize: "13px" }}>
              <LogOut style={{ width: "14px", height: "14px", marginRight: "6px" }} /> Sign out
            </Button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "32px 24px", display: "flex", gap: "32px" }}>
        {/* Sidebar */}
        <aside style={{ width: "220px", flexShrink: 0 }}>
          <p style={{ fontSize: "11px", fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "12px", paddingLeft: "8px" }}>Categories</p>
          <nav style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {CATEGORIES.map(cat => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px",
                  borderRadius: "8px", fontSize: "14px", fontWeight: 500, border: "none", cursor: "pointer", textAlign: "left",
                  background: activeCategory === cat.id ? "#eff6ff" : "transparent",
                  color: activeCategory === cat.id ? "#1d4ed8" : "#475569",
                  outline: activeCategory === cat.id ? "1px solid #bfdbfe" : "none",
                }}
              >
                <cat.icon style={{ width: "16px", height: "16px", flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{cat.label}</span>
                <span style={{ fontSize: "11px", borderRadius: "999px", padding: "1px 6px", fontWeight: 600,
                  background: activeCategory === cat.id ? "#dbeafe" : "#f1f5f9",
                  color: activeCategory === cat.id ? "#1d4ed8" : "#94a3b8" }}>
                  {cat.documents.length}
                </span>
              </button>
            ))}
          </nav>

          <div style={{ marginTop: "32px", padding: "16px", background: "#f1f5f9", borderRadius: "12px", border: "1px solid #e2e8f0" }}>
            <p style={{ fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>Need something else?</p>
            <p style={{ fontSize: "12px", color: "#64748b", marginBottom: "12px" }}>Request specific documents or schedule a call.</p>
            <a href="mailto:anthonykumako8@gmail.com?subject=BlockFinaX%20Investor%20Request"
              style={{ fontSize: "13px", color: "#2563eb", fontWeight: 600, display: "flex", alignItems: "center", gap: "4px", textDecoration: "none" }}>
              Contact us <ExternalLink style={{ width: "12px", height: "12px" }} />
            </a>
          </div>
        </aside>

        {/* Main */}
        <main style={{ flex: 1, minWidth: 0 }}>
          <div style={{ borderRadius: "12px", border: "1px solid", padding: "20px 24px", marginBottom: "24px" }}
            className={active.color}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <active.icon style={{ width: "22px", height: "22px" }} className={active.iconColor} />
              <div>
                <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#0f172a" }}>{active.label}</h2>
                <p style={{ fontSize: "13px", color: "#64748b" }}>{active.documents.length} document{active.documents.length !== 1 ? "s" : ""} available</p>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {active.documents.map((doc, idx) => (
              <motion.div
                key={doc.title}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.04 }}
                onClick={() => handleOpen(doc)}
                style={{
                  background: "white", border: "1px solid #e2e8f0", borderRadius: "12px", padding: "20px",
                  display: "flex", alignItems: "flex-start", gap: "16px",
                  cursor: doc.status === "coming-soon" ? "not-allowed" : "pointer",
                  opacity: doc.status === "coming-soon" ? 0.5 : 1,
                  transition: "border-color 0.15s, box-shadow 0.15s",
                }}
                whileHover={doc.status !== "coming-soon" ? { scale: 1.005, boxShadow: "0 4px 16px rgba(0,0,0,0.06)" } : {}}
              >
                <div style={{ width: "40px", height: "40px", borderRadius: "8px", background: "#f8fafc", border: "1px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <doc.icon style={{ width: "18px", height: "18px", color: "#64748b" }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                    <h3 style={{ fontSize: "14px", fontWeight: 600, color: "#0f172a" }}>{doc.title}</h3>
                    <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "999px" }} className={doc.badgeColor}>
                      {doc.badge}
                    </span>
                  </div>
                  <p style={{ fontSize: "13px", color: "#64748b", lineHeight: 1.5 }}>{doc.description}</p>
                </div>
                <div style={{ flexShrink: 0 }}>
                  {doc.status === "external" ? (
                    <ExternalLink style={{ width: "16px", height: "16px", color: "#cbd5e1" }} />
                  ) : doc.status === "coming-soon" ? (
                    <span style={{ fontSize: "12px", color: "#94a3b8" }}>Soon</span>
                  ) : (
                    <Eye style={{ width: "16px", height: "16px", color: "#cbd5e1" }} />
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </main>
      </div>

      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "24px", borderTop: "1px solid #f1f5f9", textAlign: "center" }}>
        <p style={{ fontSize: "12px", color: "#94a3b8" }}>
          BlockFinaX Investor Data Room · Confidential · Not for public distribution ·{" "}
          <a href="mailto:anthonykumako8@gmail.com" style={{ color: "#3b82f6" }}>anthonykumako8@gmail.com</a>
        </p>
      </div>
    </div>
  );
}

export default function DataRoom() {
  const [token, setToken] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (!stored) {
      setChecking(false);
      return;
    }
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
      <div style={{ minHeight: "100vh", background: "#0a1628", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: "32px", height: "32px", border: "2px solid #3d8ef5", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      </div>
    );
  }

  if (token) {
    return <DataRoomContent token={token} onLogout={() => setToken(null)} />;
  }

  return <PasswordGate onSuccess={setToken} />;
}
