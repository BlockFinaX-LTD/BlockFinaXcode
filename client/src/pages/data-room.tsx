import { useState, useEffect, useCallback, createContext, useContext, useRef } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { DEFAULT_ANNUALS, fmtUSD } from "@/lib/financial-model-data";
import { TAM, SAM } from "@/lib/market-figures";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Lock, LogOut, ExternalLink, FileText, BarChart2, Globe,
  PlayCircle, Beaker, ShieldCheck, BookOpen, ChevronRight,
  Eye, Clock, Building2, ArrowLeft, Pencil, Check, X, Video, Edit3, Calendar,
  Users, PieChart, TrendingUp, Activity, RefreshCw, Paperclip, Trash2, Plus
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ethers } from "ethers";

/* ─── EDIT AUTH CONTEXT ─── */
type EditAuthCtx = {
  editUnlocked: boolean;
  requestEdit: (callback: () => void) => void;
};
const EditAuthContext = createContext<EditAuthCtx>({ editUnlocked: false, requestEdit: () => {} });
const useEditAuth = () => useContext(EditAuthContext);

/* ─── SHARED EDITABLE DOC HOOK & TOOLBAR ─── */
const EI: React.CSSProperties = { width: "100%", fontSize: "12px", padding: "5px 8px", border: "1px solid #cbd5e1", borderRadius: "5px", background: "white", boxSizing: "border-box" as const };

function useEditableDoc<T extends object>(docId: string, token: string, defaults: T) {
  const { editUnlocked, requestEdit } = useEditAuth();
  const [data, setData] = useState<T>(defaults);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<T>(defaults);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  useEffect(() => {
    fetch(`/api/investor/content/${docId}`, { headers: { "x-investor-token": token } })
      .then(r => r.json()).then(d => { if (d.content) setData({ ...defaults, ...d.content } as T); }).catch(() => {});
  }, [docId, token]);
  const startEdit = () => { setDraft(JSON.parse(JSON.stringify(data))); setEditing(true); };
  const cancelEdit = () => setEditing(false);
  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/investor/content/${docId}`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-investor-token": token },
        body: JSON.stringify({ content: draft }),
      });
      if (!res.ok) throw new Error();
      setData(draft); setEditing(false); toast({ title: "Saved" });
    } catch { toast({ title: "Save failed", variant: "destructive" }); }
    finally { setSaving(false); }
  };
  const setField = (key: keyof T, val: unknown) => setDraft(d => ({ ...d, [key]: val }));
  return { data, draft, editing, saving, editUnlocked, startEdit, cancelEdit, save, setField, requestEdit };
}

function DocEditBar({ editUnlocked, editing, saving, onEdit, onSave, onCancel }: {
  editUnlocked: boolean; editing: boolean; saving: boolean; onEdit: () => void; onSave: () => void; onCancel: () => void;
}) {
  const b: React.CSSProperties = { fontSize: "12px", padding: "5px 14px", borderRadius: "6px", cursor: "pointer" };
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "12px", gap: "8px" }}>
      {editing ? (
        <>
          <button onClick={onCancel} style={{ ...b, border: "1px solid #e2e8f0", background: "white" }}>Cancel</button>
          <button onClick={onSave} disabled={saving} style={{ ...b, border: "none", background: "#2563eb", color: "white", fontWeight: 600 }}>{saving ? "Saving…" : "Save"}</button>
        </>
      ) : (
        <button onClick={onEdit} style={{ ...b, display: "flex", alignItems: "center", gap: "5px", border: "1px solid #e2e8f0", background: "white", color: editUnlocked ? "#0f172a" : "#64748b" }}>
          <Edit3 style={{ width: "12px", height: "12px" }} />
          Edit
          {!editUnlocked && <span style={{ fontSize: "10px", color: "#94a3b8" }}>🔒</span>}
        </button>
      )}
    </div>
  );
}

function TxtF({ label, value, onChange, rows = 3 }: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <div style={{ marginBottom: "8px" }}>
      <label style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", display: "block", marginBottom: "3px", textTransform: "capitalize" as const }}>{label.replace(/_/g, " ")}</label>
      <textarea value={value} onChange={e => onChange(e.target.value)} rows={rows} style={{ ...EI, resize: "vertical" as const }} />
    </div>
  );
}

function EditPasswordModal({ onSuccess, onClose, token }: { onSuccess: () => void; onClose: () => void; token: string }) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [shaking, setShaking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pw.trim()) return;
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/investor/unlock-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-investor-token": token },
        body: JSON.stringify({ password: pw }),
      });
      const data = await res.json();
      if (res.ok && data.success) { onSuccess(); }
      else {
        setError(data.message || "Incorrect edit password");
        setPw("");
        setShaking(true);
        setTimeout(() => setShaking(false), 500);
      }
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 12 }}
        animate={shaking ? { x: [0, -10, 10, -8, 8, -4, 4, 0] } : { opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: shaking ? 0.4 : 0.2 }}
        style={{ background: "white", borderRadius: "16px", padding: "32px", width: "100%", maxWidth: "380px", boxShadow: "0 24px 64px rgba(0,0,0,0.25)" }}>
        <div style={{ textAlign: "center", marginBottom: "24px" }}>
          <div style={{ width: "48px", height: "48px", borderRadius: "12px", background: "#eff6ff", border: "1px solid #bfdbfe", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
            <Edit3 style={{ width: "20px", height: "20px", color: "#2563eb" }} />
          </div>
          <h2 style={{ fontSize: "17px", fontWeight: 700, color: "#0f172a", marginBottom: "6px" }}>Edit Access Required</h2>
          <p style={{ fontSize: "13px", color: "#64748b", lineHeight: 1.5 }}>Enter the edit password to unlock content editing for this session.</p>
        </div>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <input ref={inputRef} type="password" placeholder="Edit password" value={pw}
            onChange={e => { setPw(e.target.value); setError(""); }}
            style={{ width: "100%", padding: "11px 14px", fontSize: "14px", border: `1px solid ${error ? "#fca5a5" : "#e2e8f0"}`, borderRadius: "8px", outline: "none", fontFamily: "inherit", background: error ? "#fff5f5" : "white", textAlign: "center", letterSpacing: "0.1em", boxSizing: "border-box" }} />
          {error && <p style={{ color: "#dc2626", fontSize: "13px", textAlign: "center", margin: 0 }}>{error}</p>}
          <Button type="submit" disabled={loading || !pw.trim()} style={{ background: "#2563eb", color: "white", height: "42px", fontWeight: 600 }}>{loading ? "Verifying…" : "Unlock Editing"}</Button>
          <Button type="button" variant="outline" onClick={onClose} style={{ height: "38px" }}>Cancel</Button>
        </form>
      </motion.div>
    </div>
  );
}

const SESSION_KEY = "bfx_investor_token";

/* ─── shared doc-content styles ─── */
const S = {
  h1: { fontSize: "22px", fontWeight: 700, color: "#0f172a", marginBottom: "6px" } as React.CSSProperties,
  h2: { fontSize: "16px", fontWeight: 700, color: "#1e293b", marginTop: "28px", marginBottom: "10px", paddingBottom: "6px", borderBottom: "1px solid #e2e8f0" } as React.CSSProperties,
  h3: { fontSize: "14px", fontWeight: 600, color: "#334155", marginTop: "16px", marginBottom: "6px" } as React.CSSProperties,
  p: { fontSize: "14px", color: "#475569", lineHeight: 1.7, marginBottom: "10px" } as React.CSSProperties,
  tag: (color: string): React.CSSProperties => ({ display: "inline-block", fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "999px", background: color === "blue" ? "#dbeafe" : color === "green" ? "#dcfce7" : color === "amber" ? "#fef3c7" : color === "red" ? "#fee2e2" : "#f1f5f9", color: color === "blue" ? "#1d4ed8" : color === "green" ? "#16a34a" : color === "amber" ? "#d97706" : color === "red" ? "#dc2626" : "#475569" }),
  stat: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "14px 18px" } as React.CSSProperties,
  statVal: { fontSize: "22px", fontWeight: 800, color: "#0f172a" } as React.CSSProperties,
  statLbl: { fontSize: "12px", color: "#64748b", marginTop: "2px" } as React.CSSProperties,
  table: { width: "100%", borderCollapse: "collapse" as const, fontSize: "13px" },
  th: { textAlign: "left" as const, padding: "8px 12px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0", fontWeight: 600, color: "#334155", fontSize: "12px" },
  td: { padding: "10px 12px", borderBottom: "1px solid #f1f5f9", color: "#475569", verticalAlign: "top" as const },
  check: "✅", cross: "❌", partial: "⚡",
  divider: { border: "none", borderTop: "1px solid #f1f5f9", margin: "20px 0" } as React.CSSProperties,
};

/* ─── DOCUMENT DEFINITIONS ─── */
const CATEGORIES = [
  {
    id: "overview", label: "Overview", icon: Building2,
    color: "border-blue-200 bg-blue-50", iconColor: "text-blue-600",
    documents: [
      { id: "pitch-deck", title: "Pitch Deck", description: "10-slide interactive investor presentation with animated slides", href: "/pitch", type: "navigate" as const, badge: "Interactive", badgeColor: "bg-blue-100 text-blue-700", icon: FileText },
      { id: "exec-summary", title: "Executive Summary", description: "Company overview, problem, solution, traction and the ask in one page", href: null, type: "modal" as const, badge: "Document", badgeColor: "bg-slate-100 text-slate-600", icon: BookOpen },
    ],
  },
  {
    id: "traction", label: "Traction", icon: TrendingUp,
    color: "border-emerald-200 bg-emerald-50", iconColor: "text-emerald-600",
    documents: [
      { id: "live-traction", title: "Live Protocol Monitor", description: "Real-time revenue, notional, liquidity, pools and transactions read straight from the Diamond on Base and BSC", href: null, type: "modal" as const, badge: "Live", badgeColor: "bg-emerald-100 text-emerald-700", icon: Activity },
      { id: "letters-of-intent", title: "Letters of Intent", description: "Signed and in-progress LOIs from counterparties — stated monthly FX exposure, status, and attached documents", href: null, type: "modal" as const, badge: "Confidential", badgeColor: "bg-indigo-100 text-indigo-700", icon: FileText },
    ],
  },
  {
    id: "financials", label: "Financials", icon: BarChart2,
    color: "border-emerald-200 bg-emerald-50", iconColor: "text-emerald-600",
    documents: [
      { id: "financial-model", title: "Financial Model", description: "54-month bottom-up P&L (Jul 2026–Dec 2030), editable inputs, scenario analysis", href: "/financial-model", type: "navigate" as const, badge: "Interactive", badgeColor: "bg-blue-100 text-blue-700", icon: BarChart2 },
      { id: "revenue-breakdown", title: "Revenue Breakdown", description: "Full fee structure, blended take rate, unit economics, and per-product revenue analysis", href: null, type: "modal" as const, badge: "Document", badgeColor: "bg-slate-100 text-slate-600", icon: FileText },
      { id: "cost-breakdown", title: "Cost Breakdown", description: "Annual COGS and OpEx by category — personnel, marketing, gas, oracle, legal, KYC and efficiency metrics", href: null, type: "modal" as const, badge: "Document", badgeColor: "bg-slate-100 text-slate-600", icon: BarChart2 },
    ],
  },
  {
    id: "technology", label: "Technology", icon: ShieldCheck,
    color: "border-purple-200 bg-purple-50", iconColor: "text-purple-600",
    documents: [
      { id: "whitepaper", title: "Whitepaper", description: "Technical deep-dive: Diamond Standard, HedgeFacet, USDC flows, settlement logic", href: "/data-room/whitepaper", type: "navigate" as const, badge: "Technical", badgeColor: "bg-purple-100 text-purple-700", icon: BookOpen },
      { id: "oracle-strategy", title: "Oracle Strategy", description: "Current oracle architecture, known limitations, and 4-phase decentralization roadmap", href: null, type: "modal" as const, badge: "Document", badgeColor: "bg-slate-100 text-slate-600", icon: Globe },
      { id: "security-audit", title: "Security Audit", description: "Historical April 2026 review and its stated scope; it does not verify current deployments", href: null, type: "modal" as const, badge: "Document", badgeColor: "bg-slate-100 text-slate-600", icon: ShieldCheck },
    ],
  },
  {
    id: "demo", label: "Demo & Product", icon: PlayCircle,
    color: "border-amber-200 bg-amber-50", iconColor: "text-amber-600",
    documents: [
      { id: "demo-video", title: "Product Demo Video", description: "A demo can be added after the recording and demonstrated flows are verified", href: null, type: "modal" as const, badge: "Video", badgeColor: "bg-slate-100 text-slate-600", icon: Video },
      { id: "live-app", title: "BlockFinaX App", description: "Open the application. Availability and supported actions depend on the selected network and current deployment state", href: "/home", type: "navigate" as const, badge: "App", badgeColor: "bg-slate-100 text-slate-600", icon: Beaker },
    ],
  },
  {
    id: "market", label: "Market Research", icon: Globe,
    color: "border-rose-200 bg-rose-50", iconColor: "text-rose-600",
    documents: [
      { id: "market-opportunity", title: "Market Opportunity", description: "Published context and illustrative scenarios; not validated company market sizing", href: null, type: "modal" as const, badge: "Document", badgeColor: "bg-slate-100 text-slate-600", icon: Globe },
      { id: "competitive-landscape", title: "Competitive Landscape", description: "Market research status and diligence gaps; no unsupported competitor ratings", href: null, type: "modal" as const, badge: "Document", badgeColor: "bg-slate-100 text-slate-600", icon: BarChart2 },
      { id: "gtm-strategy", title: "Go-to-Market Strategy", description: "4-phase GTM: community beta → SME direct → channel partners → flywheel growth", href: null, type: "modal" as const, badge: "Document", badgeColor: "bg-slate-100 text-slate-600", icon: ChevronRight },
    ],
  },
  {
    id: "legal", label: "Legal & Compliance", icon: FileText,
    color: "border-slate-200 bg-slate-50", iconColor: "text-slate-600",
    documents: [
      { id: "compliance-proposals", title: "Compliance Proposals", description: "Proposals and recommendations from legal and compliance consultants — admin editable", href: null, type: "modal" as const, badge: "Internal", badgeColor: "bg-purple-100 text-purple-700", icon: BookOpen },
      { id: "bog-sandbox", title: "Bank of Ghana Sandbox", description: "Management-reported application history and evidence gaps; no current regulatory status is asserted", href: null, type: "modal" as const, badge: "Unverified", badgeColor: "bg-slate-100 text-slate-600", icon: ShieldCheck },
      { id: "nda-request", title: "Request NDA / Term Sheet", description: "Contact us to request a non-disclosure agreement or investment term sheet", href: "mailto:anthonykumako8@gmail.com?subject=BlockFinaX%20NDA%20Request", type: "external" as const, badge: "Email", badgeColor: "bg-slate-100 text-slate-600", icon: ExternalLink },
    ],
  },
  {
    id: "company", label: "Company", icon: Users,
    color: "border-indigo-200 bg-indigo-50", iconColor: "text-indigo-600",
    documents: [
      { id: "governance", title: "Governance & Protocol Control", description: "Who can change the protocol today, read from the chain rather than from a deployment record, and what changes before third-party capital", href: null, type: "modal" as const, badge: "Document", badgeColor: "bg-slate-100 text-slate-600", icon: ShieldCheck },
      { id: "cap-table", title: "Cap Table", description: "Founder equity, option pool, investor allocations, and post-money ownership structure", href: null, type: "modal" as const, badge: "Confidential", badgeColor: "bg-indigo-100 text-indigo-700", icon: PieChart },
      { id: "team-info", title: "Team", description: "Founding team, advisors, and key hires — backgrounds, roles, and LinkedIn profiles", href: null, type: "modal" as const, badge: "Document", badgeColor: "bg-slate-100 text-slate-600", icon: Users },
      { id: "incorporation", title: "Incorporation & Ownership", description: "Company-structure information requiring current registry documents", href: null, type: "modal" as const, badge: "Evidence needed", badgeColor: "bg-slate-100 text-slate-600", icon: Building2 },
      { id: "agreements", title: "IP & Agreements", description: "NDA templates, IP assignment agreements, service contracts, consulting agreements, and investor term sheet status", href: null, type: "modal" as const, badge: "Document", badgeColor: "bg-slate-100 text-slate-600", icon: FileText },
    ],
  },
];

/* ─── CONTENT COMPONENTS ─── */

const EXEC_D = {
  intro: "BlockFinaX is developing blockchain-based tools for foreign-exchange risk management and cross-border payments. The protocol uses an EIP-2535 Diamond architecture on Base and BNB Smart Chain. Available pairs, features, collateral requirements and settlement behavior depend on the active network configuration; verify them in the application and on-chain before relying on them.",
  problem: "Businesses with cross-border exposure can be affected by exchange-rate movements. The size of the affected market and the alternatives available vary by corridor, business and provider; this document does not assert a universal minimum or claim that competitors do not serve a segment.",
  solution_hedge: "The protocol includes on-chain hedge and oracle-settlement functions. A position's eligibility, collateral reservation, settlement inputs, timing and payout depend on the active contract implementation and configuration. A transaction or oracle update may be required; do not assume settlement is automatic or guaranteed.",
  solution_wallet: "The application includes wallet and payment integrations. Custody model, signing method, fees, supported assets and transaction availability depend on the selected provider and network; review the current transaction details before use.",
  traction: "Company-reported product and deployment information is not a live chain verification. See Live Protocol Monitor for indexed on-chain activity, and Governance & Protocol Control for owner, Safe, settlement authority and oracle settings read from Base and BNB Smart Chain when the page loads. Historical audit scope and finding status are described separately and do not establish that current deployments match audited bytecode.",
  technology: "The protocol uses an EIP-2535 Diamond architecture. Supported settlement assets and live contract settings vary by chain and deployment; verify current values in the app and on the relevant block explorer before relying on them.",
  mainnet: "Deployment and contract addresses are listed as references. Current owner, Safe relationship, settlement authority, oracle configuration and active diamondCut selector implementation are queried from Base and BNB Smart Chain in Governance & Protocol Control. Explorer verification and an active facet address do not, by themselves, prove an audit match or an enforced timelock.",
  ask: [
    { round: "Pre-Seed", amount: "$500K", timing: "Proposed", use: "Proposed use: engineering, independent security review and regulatory work", color: "blue" },
    { round: "Seed",     amount: "$1.5M", timing: "Jan 2027",       use: "6 months live traction, bridge to Series A, early market validation", color: "blue" },
    { round: "Series A", amount: "$8M",   timing: "Jan 2028",       use: "Multi-country expansion, BD, institutional LP onboarding, near break-even", color: "green" },
    { round: "Series B", amount: "$20M",  timing: "Jul 2029",       use: "Deep market scale, Kenya/Nigeria enterprise integrations, liquidity depth", color: "amber" },
  ],
};

function ExecSummary({ token: _token }: { token: string }) {
  const data = EXEC_D;
  return (
    <div>
      <p style={{ ...S.p, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: 12 }}>Planning material only. Market estimates are source-attributed; financial results are model scenarios, not actual results or an offer. Product statements are subject to live deployment and network configuration.</p>
      <p style={S.p}>{data.intro}</p>
      <h2 style={S.h2}>The Problem</h2><p style={S.p}>{data.problem}</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "12px", margin: "16px 0" }}>
        <div style={S.stat}><div style={S.statVal}>{TAM.display}</div><div style={S.statLbl}>TAM — African merchandise trade ({TAM.year})</div></div>
        <div style={S.stat}><div style={S.statVal}>{SAM.display}</div><div style={S.statLbl}>Unmet trade finance estimate ({SAM.year})</div></div>
        <div style={{ ...S.stat, borderColor: "#86efac" }}><div style={{ ...S.statVal, color: "#16a34a" }}>{fmtUSD(DEFAULT_ANNUALS[1].notionalHedged)}</div><div style={S.statLbl}>Modelled notional scenario for 2027 — not actual volume</div></div>
        <div style={S.stat}><div style={S.statVal}>Network-specific</div><div style={S.statLbl}>Available assets and markets; verify live</div></div>
      </div>
      <p style={{ ...S.p, fontSize: 12 }}>Market estimates: {TAM.source} ({TAM.year}); {SAM.source} ({SAM.year}). These figures measure different things and are not BlockFinaX revenue or a validated serviceable market.</p>
      <h2 style={S.h2}>The Solution</h2><p style={S.p}>{data.solution_hedge}</p><p style={S.p}>{data.solution_wallet}</p>
      <h2 style={S.h2}>Traction and verification</h2><p style={S.p}>{data.traction}</p>
      <h2 style={S.h2}>Technology</h2><p style={S.p}>{data.technology}</p>
      <p style={{ fontSize: "13px", color: "#64748b", fontFamily: "monospace", background: "#f8fafc", padding: "8px 12px", borderRadius: "6px" }}>Diamond (Base): 0xbCC51E62C4948FD35ab505bd71804C849601e4Ef · Diamond (BSC): 0xaC939C0897981Abc0711ec4e37527F13106180fc</p>
      <h2 style={S.h2}>Indicative fundraising plan</h2><p style={S.p}>Discussion material only. Amounts, timing and use of proceeds are not a current public offer or committed schedule.</p>
      <table style={S.table}><thead><tr><th style={S.th}>Round</th><th style={S.th}>Amount</th><th style={S.th}>Timing</th><th style={S.th}>Use of Funds</th></tr></thead><tbody>{data.ask.map(r => (
        <tr key={r.round}><td style={S.td}><span style={S.tag(r.color)}>{r.round}</span></td><td style={S.td}>{r.amount}</td><td style={S.td}>{r.timing}</td><td style={S.td}>{r.use}</td></tr>
      ))}</tbody></table>
      <div style={{ margin: "16px 0", padding: "16px", background: "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)", borderRadius: "10px", border: "1px solid #bfdbfe", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", flexWrap: "wrap" as const }}>
        <div><div style={{ fontWeight: 700, fontSize: "15px", color: "#1e3a8a", marginBottom: "4px" }}>Discuss the opportunity</div><div style={{ fontSize: "13px", color: "#3b82f6" }}>Contact the founder to request current materials.</div></div>
        <a href="mailto:anthonykumako8@gmail.com?subject=BlockFinaX%20Investor%20Enquiry" style={{ display: "inline-flex", alignItems: "center", gap: "8px", background: "#2563eb", color: "#fff", fontWeight: 600, fontSize: "14px", padding: "10px 20px", borderRadius: "8px", textDecoration: "none", whiteSpace: "nowrap" as const, flexShrink: 0 }}>Contact BlockFinaX</a>
      </div>
      <h2 style={S.h2}>Deployment status</h2><p style={S.p}>{data.mainnet}</p>
    </div>
  );
}

function RevenueBreakdown() {
  const a = DEFAULT_ANNUALS; // [0]=2026H2 [1]=2027 [2]=2028 [3]=2029 [4]=2030

  const revRows = [
    { label: "2026 (H2 — launch)", notional: a[0].notionalHedged, hedgeRev: a[0].hedgeFees + a[0].eventCreationFees, walletRev: a[0].walletFees, total: a[0].totalRevenue },
    { label: "2027 (Year 1)",      notional: a[1].notionalHedged, hedgeRev: a[1].hedgeFees + a[1].eventCreationFees, walletRev: a[1].walletFees, total: a[1].totalRevenue },
    { label: "2028 (Year 2)",      notional: a[2].notionalHedged, hedgeRev: a[2].hedgeFees + a[2].eventCreationFees, walletRev: a[2].walletFees, total: a[2].totalRevenue },
    { label: "2029 (Year 3)",      notional: a[3].notionalHedged, hedgeRev: a[3].hedgeFees + a[3].eventCreationFees, walletRev: a[3].walletFees, total: a[3].totalRevenue },
    { label: "2030 (Year 4)",      notional: a[4].notionalHedged, hedgeRev: a[4].hedgeFees + a[4].eventCreationFees, walletRev: a[4].walletFees, total: a[4].totalRevenue },
  ];

  const y27 = a[1];
  const hedgePct27 = y27.totalRevenue > 0 ? Math.round(((y27.hedgeFees + y27.eventCreationFees) / y27.totalRevenue) * 100) : 0;
  const walletPct27 = 100 - hedgePct27;

  const avgNotional27 = y27.totalEvents > 0 ? Math.round(y27.notionalHedged / y27.totalEvents) : 0;
  const avgRevPerEvent27 = y27.totalEvents > 0 ? Math.round(y27.totalRevenue / y27.totalEvents) : 0;
  const blendedTakeRate27 = y27.notionalHedged > 0 ? ((y27.totalRevenue / y27.notionalHedged) * 100).toFixed(2) : "0";

  const y30 = a[4];
  const grossMargin30 = y30.totalRevenue > 0 ? Math.round((y30.grossProfit / y30.totalRevenue) * 100) : 0;

  return (
    <div>
      <p style={S.p}>The following rates are historical planning assumptions in the financial model. They are not verified live contract settings, customer terms, or evidence of collected revenue. Confirm the active network, contract code, and terms before relying on them.</p>

      <h2 style={S.h2}>Illustrative Model Fee Assumptions</h2>
      <table style={S.table}>
        <thead><tr><th style={S.th}>Fee Type</th><th style={S.th}>Rate</th><th style={S.th}>Paid By</th><th style={S.th}>Trigger</th></tr></thead>
        <tbody>
          <tr><td style={S.td}>Hedger premium fee</td><td style={S.td}><strong>5% (model input)</strong></td><td style={S.td}>Unverified</td><td style={S.td}>Confirm from active contract and terms</td></tr>
          <tr><td style={S.td}>Payout / LP fee</td><td style={S.td}><strong>1.0% (model input)</strong></td><td style={S.td}>Unverified</td><td style={S.td}>Confirm from active contract and terms</td></tr>
          <tr><td style={S.td}>Creator loyalty fee</td><td style={S.td}><strong>5% (model input)</strong></td><td style={S.td}>Unverified</td><td style={S.td}>Confirm from active contract and terms</td></tr>
          <tr><td style={S.td}>Wallet transfer fee</td><td style={S.td}><strong>0.3% (model input)</strong></td><td style={S.td}>Unverified</td><td style={S.td}>Confirm current wallet implementation and terms</td></tr>
        </tbody>
      </table>

      <h2 style={S.h2}>Revenue Projections</h2>
      <div style={{ overflowX: "auto" }}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Year</th>
              <th style={S.th}>Notional Hedged</th>
              <th style={S.th}>Hedge Revenue</th>
              <th style={S.th}>Wallet Revenue</th>
              <th style={S.th}>Total Revenue</th>
            </tr>
          </thead>
          <tbody>
            {revRows.map(r => (
              <tr key={r.label}>
                <td style={S.td}><strong>{r.label}</strong></td>
                <td style={S.td}>{fmtUSD(r.notional)}</td>
                <td style={S.td}>{fmtUSD(r.hedgeRev)}</td>
                <td style={S.td}>{fmtUSD(r.walletRev)}</td>
                <td style={{ ...S.td, fontWeight: 700, color: "#1d4ed8" }}>{fmtUSD(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 style={S.h2}>Unit Economics (2027 baseline)</h2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "10px", margin: "12px 0" }}>
        <div style={S.stat}><div style={S.statVal}>~{blendedTakeRate27}%</div><div style={S.statLbl}>Blended take rate on notional</div></div>
        <div style={S.stat}><div style={S.statVal}>{fmtUSD(avgNotional27)}</div><div style={S.statLbl}>Avg event notional</div></div>
        <div style={S.stat}><div style={S.statVal}>{fmtUSD(avgRevPerEvent27)}</div><div style={S.statLbl}>Avg revenue per event</div></div>
        <div style={S.stat}><div style={S.statVal}>14–30d</div><div style={S.statLbl}>Avg hedge duration</div></div>
      </div>

      <h2 style={S.h2}>Revenue Mix (2027)</h2>
      <p style={S.p}>In 2027, hedge fees (including event creation) account for approximately <strong>{hedgePct27}%</strong> of total revenue, with wallet transfers contributing <strong>{walletPct27}%</strong>. By 2030, the wallet share grows as cross-border payment volume scales independently of hedge activity.</p>

      <h2 style={S.h2}>Margin Profile</h2>
      <p style={S.p}>This is a forward-looking model, not operating results or a guarantee. It assumes the listed transaction volumes, fees, costs and product availability. Smart-contract collateral controls and the actual ability to pay depend on deployed code, token behavior and on-chain liquidity; review those independently before relying on the projection. Gross margin by 2030 in this scenario is <strong>{grossMargin30}%</strong>.</p>
    </div>
  );
}

function OracleStrategyDoc({ token: _token }: { token: string }) {
  return (
    <div>
      <p style={S.p}>This section describes the contract mechanism. It does not claim that a particular oracle service is running, that a feed is fresh, or that an off-chain poller completed a settlement.</p>
      <h2 style={S.h2}>On-chain settlement mechanism</h2>
      <p style={S.p}>The contracts include an oracle consensus route. Its live activation state, single-key settler, registered signers, quorum and tolerance are queried in Governance & Protocol Control. If the getter cannot be read, the state is shown as unverified.</p>
      <h2 style={S.h2}>Operational dependencies</h2>
      <p style={S.p}>Price source selection, data freshness, polling schedule, relay availability and settlement transaction completion are off-chain operational facts. This page does not infer them from contract source or deployment records. Verify service health and transaction receipts separately before relying on a market rate or settlement.</p>
      <h2 style={S.h2}>Limitations</h2>
      <ul style={{ fontSize: "13px", color: "#475569", paddingLeft: "18px", lineHeight: 1.8 }}>
        <li>An oracle consensus rule does not prove that input rates are accurate or independent.</li>
        <li>Registered signer count alone does not prove the multi-signer mode is active.</li>
        <li>RPC, data-provider or signer outages can delay settlement.</li>
        <li>Current provider identities and service status require separate operational evidence.</li>
      </ul>
    </div>
  );
}

const AUDIT_D = {
  intro:
    "Historical security review summary, dated April 2026. The report covered a Lisk deployment (0x3eDfA00a1E3C158A591097de2FA1756aCD66860D), not the current Base or BNB Smart Chain deployments. Its reported findings were 2 critical, 3 high, 5 medium, 5 low and 4 informational; the fixed/accepted/open labels below reflect the report summary and have not been independently revalidated against current deployed bytecode in this page. The report is not evidence that current Base/BSC bytecode matches the reviewed source. Obtain the original report and a separate deployment-equivalence review before representing the current deployments as audited.",
  findings: [
    { sev: "Critical", sevColor: "red",   issue: "C-01 · DiamondCutFacet is never replaced by TimelockCutFacet — both expose diamondCut, so routing is undefined if the original is not removed atomically",  status: "Open",         statusColor: "red"   },
    { sev: "Critical", sevColor: "red",   issue: "C-02 · facetAddress() may return a corrupted address if LibDiamond stores a struct rather than an address",                                                   status: "Open",         statusColor: "red"   },
    { sev: "High",     sevColor: "red",   issue: "H-01 · withdrawCapital does not block a subsequent claimPremiums",                                                                                            status: "Fixed",        statusColor: "green" },
    { sev: "High",     sevColor: "red",   issue: "H-02 · recoverExpiredPayouts uses a stale totalLiquidity",                                                                                                    status: "Fixed",        statusColor: "green" },
    { sev: "High",     sevColor: "red",   issue: "H-03 · Oracle RESUBMIT_COOLDOWN does not reset after consensus is cleared",                                                                                   status: "Fixed",        statusColor: "green" },
    { sev: "Medium",   sevColor: "amber", issue: "M-01 · Misleading comment on the owner's ability to settle after activateOracleV2()",                                                                         status: "Fixed",        statusColor: "green" },
    { sev: "Medium",   sevColor: "amber", issue: "M-02 · buyProtection accepted a user-supplied initialRate, which could inflate payouts",                                                                      status: "Fixed",        statusColor: "green" },
    { sev: "Medium",   sevColor: "amber", issue: "M-03 · deposit() share calculation truncates to zero for small deposits",                                                                                     status: "Fixed",        statusColor: "green" },
    { sev: "Medium",   sevColor: "amber", issue: "M-04 · Timelock proposal IDs can collide within the same block",                                                                                              status: "Fixed",        statusColor: "green" },
    { sev: "Medium",   sevColor: "amber", issue: "M-05 · LP withdrawal fairness asymmetry between early and late withdrawers",                                                                                  status: "Accepted",     statusColor: "amber" },
    { sev: "Low",      sevColor: "blue",  issue: "L-01 · getPendingCutIds() array grows unboundedly",                                                                                                           status: "Open",         statusColor: "amber" },
    { sev: "Low",      sevColor: "blue",  issue: "L-02 · facets() has O(n·m) read complexity",                                                                                                                  status: "Accepted",     statusColor: "amber" },
    { sev: "Low",      sevColor: "blue",  issue: "L-03 · rescueETH does not cap forwarded gas",                                                                                                                 status: "Fixed",        statusColor: "green" },
    { sev: "Low",      sevColor: "blue",  issue: "L-04 · PayoutClaimed does not index eventId",                                                                                                                 status: "Open",         statusColor: "amber" },
    { sev: "Low",      sevColor: "blue",  issue: "L-05 · setPoolSettings lacks nonReentrant",                                                                                                                   status: "Fixed",        statusColor: "green" },
    { sev: "Info",     sevColor: "blue",  issue: "I-01 · Unused totalHedgeEvents storage slot",                                                                                                                 status: "Accepted",     statusColor: "blue"  },
    { sev: "Info",     sevColor: "blue",  issue: "I-02 · Duplicated deposit logic in _createInitialDeposit",                                                                                                    status: "Open",         statusColor: "blue"  },
    { sev: "Info",     sevColor: "blue",  issue: "I-03 · recoverExpiredPayouts may consume significant gas over many positions",                                                                                status: "Accepted",     statusColor: "blue"  },
    { sev: "Info",     sevColor: "blue",  issue: "I-04 · _checkConsensus makes two passes over submitters",                                                                                                     status: "Open",         statusColor: "blue"  },
  ],
};

function SecurityAuditDoc({ token: _token }: { token: string }) {
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "10px", marginBottom: "20px" }}>
        <div style={S.stat}><div style={S.statVal}>19</div><div style={S.statLbl}>Findings reported, April 2026</div></div>
        <div style={{ ...S.stat, borderColor: "#fecaca" }}><div style={{ ...S.statVal, color: "#dc2626" }}>2</div><div style={S.statLbl}>Critical in historical report</div></div>
        <div style={{ ...S.stat, borderColor: "#86efac" }}><div style={{ ...S.statVal, color: "#16a34a" }}>9</div><div style={S.statLbl}>Reported fixed at that time</div></div>
        <div style={S.stat}><div style={{ ...S.statVal, color: "#d97706" }}>4</div><div style={S.statLbl}>Reported accepted at that time</div></div>
      </div>
      <p style={S.p}>{AUDIT_D.intro}</p>
      <h2 style={S.h2}>Findings as listed in the historical report</h2>
      <table style={S.table}>
        <thead><tr><th style={S.th}>Severity</th><th style={S.th}>Issue as described in report</th><th style={S.th}>Status in report</th></tr></thead>
        <tbody>{AUDIT_D.findings.map((r, i) => (
          <tr key={i}><td style={S.td}><span style={S.tag(r.sevColor)}>{r.sev}</span></td><td style={S.td}>{r.issue}</td><td style={S.td}><span style={S.tag(r.statusColor)}>{r.status}</span></td></tr>
        ))}</tbody>
      </table>
      <h2 style={S.h2}>Current deployed facet registry</h2>
      <p style={S.p}>The list below is queried from each Diamond at page load and includes only addresses returned by its live EIP-2535 loupe. It does not assert that the current bytecode matches the historical audit.</p>
      <LiveFacetRegistry />
    </div>
  );
}

function DemoVideoDoc({ token }: { token: string }) {
  const { requestEdit } = useEditAuth();
  const [data, setData] = useState<{ videoUrl?: string; description?: string }>({});
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ videoUrl: "", description: "" });
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetch("/api/investor/content/demo-video", { headers: { "x-investor-token": token } })
      .then(r => r.json())
      .then(d => { setData(d); setForm({ videoUrl: d.videoUrl || "", description: d.description || "" }); })
      .catch(() => {});
  }, [token]);

  const getEmbedUrl = (url: string) => {
    const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
    if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}`;
    const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
    if (vimeoMatch) return `https://player.vimeo.com/video/${vimeoMatch[1]}`;
    return url;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch("/api/investor/content/demo-video", {
        method: "POST", headers: { "Content-Type": "application/json", "x-investor-token": token },
        body: JSON.stringify({ videoUrl: form.videoUrl, description: form.description }),
      });
      setData({ videoUrl: form.videoUrl, description: form.description });
      setEditing(false);
      toast({ title: "Saved", description: "Video content updated." });
    } catch {
      toast({ title: "Error", description: "Failed to save.", variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <div>
      {!editing && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "16px" }}>
          <Button variant="outline" size="sm" onClick={() => requestEdit(() => setEditing(true))} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Pencil style={{ width: "13px", height: "13px" }} /> Edit video
          </Button>
        </div>
      )}

      {editing ? (
        <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
          <h3 style={S.h3}>Edit Demo Video</h3>
          <div>
            <label style={{ fontSize: "13px", fontWeight: 600, color: "#334155", display: "block", marginBottom: "6px" }}>Video URL (YouTube or Vimeo)</label>
            <Input value={form.videoUrl} onChange={e => setForm(f => ({ ...f, videoUrl: e.target.value }))} placeholder="https://www.youtube.com/watch?v=..." />
          </div>
          <div>
            <label style={{ fontSize: "13px", fontWeight: 600, color: "#334155", display: "block", marginBottom: "6px" }}>Description</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Describe what the demo shows — key features, flows, and what to look out for..."
              rows={5} style={{ width: "100%", padding: "8px 12px", fontSize: "13px", border: "1px solid #e2e8f0", borderRadius: "6px", resize: "vertical", outline: "none", fontFamily: "inherit", color: "#334155" }} />
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <Button onClick={handleSave} disabled={saving} style={{ background: "#2563eb", color: "white" }}>
              <Check style={{ width: "13px", height: "13px", marginRight: "5px" }} />{saving ? "Saving…" : "Save"}
            </Button>
            <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      ) : data.videoUrl ? (
        <div>
          <div style={{ borderRadius: "10px", overflow: "hidden", border: "1px solid #e2e8f0", marginBottom: "16px", aspectRatio: "16/9" }}>
            <iframe src={getEmbedUrl(data.videoUrl)} style={{ width: "100%", height: "100%", border: "none" }} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen title="BlockFinaX Demo" />
          </div>
          {data.description && <p style={S.p}>{data.description}</p>}
        </div>
      ) : (
        <div style={{ textAlign: "center", padding: "60px 20px", background: "#f8fafc", borderRadius: "10px", border: "1px dashed #cbd5e1" }}>
          <Video style={{ width: "40px", height: "40px", color: "#94a3b8", margin: "0 auto 12px" }} />
          <p style={{ fontSize: "15px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>No demo video yet</p>
          <p style={{ fontSize: "13px", color: "#64748b", marginBottom: "16px" }}>Click "Edit video" above to add a YouTube or Vimeo link and description.</p>
        </div>
      )}

      <h2 style={S.h2}>Demo status</h2>
      <p style={S.p}>No verified demo recording is attached here. Product flows, custody and settlement claims should be added only after they are demonstrated against the current deployment.</p>
    </div>
  );
}

const MARKET_D = {
  tam_text: "Afreximbank's 2025 report is cited for African merchandise trade estimates. This is a measure of trade value, not the value of FX hedging demand, BlockFinaX revenue, or customers the product can serve. Its methodology and corridor-specific relevance should be reviewed before use in an investment case.",
  sam_text: "The African Development Bank's 2025 report is cited for an estimate of unmet trade-finance demand. Trade-finance demand is not the same as demand for FX protection and is not a validated serviceable market for BlockFinaX.",
  sam_text2: "A BlockFinaX serviceable market has not been established in this document. It requires customer research by corridor, product eligibility, regulatory permissions, competitor analysis and willingness-to-pay evidence.",
  regional: "This is a planning hypothesis only. Do not infer product availability, a regulatory application or approval, or a launch commitment from this roadmap. Verify current status with supporting documents.",
  drivers: [
    { text: "Validate corridor-level customer demand and willingness to pay", label: "Research needed" },
    { text: "Verify current network costs and minimum viable transaction size", label: "Research needed" },
    { text: "Confirm supported assets and settlement path per deployment", label: "Product verification" },
    { text: "Map existing bank, broker and fintech alternatives by corridor", label: "Research needed" },
    { text: "Validate trade and FX exposure assumptions against source data", label: "Research needed" },
    { text: "Confirm regulatory correspondence and permissions", label: "Evidence needed" },
  ],
};

function MarketOpportunityDoc({ token }: { token: string }) {
  const { data, draft, editing, saving, editUnlocked, startEdit, cancelEdit, save, setField, requestEdit } = useEditableDoc("market-opportunity-evidence-v2", token, MARKET_D);
  const setDriver = (i: number, k: string, v: string) => setField("drivers", draft.drivers.map((r, j) => j === i ? { ...r, [k]: v } : r));
  const samValue = SAM.value;
  const som27 = DEFAULT_ANNUALS[1].notionalHedged;
  const som28 = DEFAULT_ANNUALS[2].notionalHedged;
  const som29 = DEFAULT_ANNUALS[3].notionalHedged;

  if (editing) return (
    <div>
      <DocEditBar editUnlocked saving={saving} editing onEdit={() => {}} onSave={save} onCancel={cancelEdit} />
      {(["tam_text","sam_text","sam_text2","regional"] as const).map(k => (
        <TxtF key={k} label={k} value={draft[k]} onChange={v => setField(k, v)} />
      ))}
      <h2 style={S.h2}>Growth Drivers</h2>
      {draft.drivers.map((r, i) => (
        <div key={i} style={{ display: "flex", gap: "6px", marginBottom: "6px" }}>
          <input value={r.text} onChange={e => setDriver(i, "text", e.target.value)} style={{ ...EI, flex: 1 }} />
          <input value={r.label} onChange={e => setDriver(i, "label", e.target.value)} style={{ ...EI, width: "120px" }} />
        </div>
      ))}
    </div>
  );

  return (
    <div>
      <DocEditBar editUnlocked={editUnlocked} editing={false} saving={false} onEdit={() => requestEdit(startEdit)} onSave={save} onCancel={cancelEdit} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "20px" }}>
        <div style={S.stat}><div style={S.statVal}>{TAM.display}</div><div style={S.statLbl}>TAM — African merchandise trade (2024)</div></div>
        <div style={S.stat}><div style={S.statVal}>{SAM.display}</div><div style={S.statLbl}>SAM — Unmet trade finance demand (2024)</div></div>
        <div style={{ ...S.stat, borderColor: "#86efac" }}><div style={{ ...S.statVal, color: "#16a34a" }}>{fmtUSD(som27)}</div><div style={S.statLbl}>Illustrative model output for 2027, not a market share</div></div>
      </div>
      <p style={S.p}>The trade and trade-finance figures below are context from cited reports. They are different measures and neither has been validated as BlockFinaX&apos;s serviceable market. The operating figures are editable model scenarios, not observed traction.</p>
      <h2 style={S.h2}>Total Addressable Market (TAM)</h2>
      <p style={S.p}>{data.tam_text}</p>
      <h2 style={S.h2}>Serviceable Available Market (SAM)</h2>
      <p style={S.p}>{data.sam_text}</p>
      <p style={S.p}>{data.sam_text2}</p>
      <h2 style={S.h2}>Illustrative operating scenarios — not a validated SOM</h2>
      <table style={S.table}>
        <thead><tr><th style={S.th}>Scenario year</th><th style={S.th}>Modelled notional</th><th style={S.th}>Share of cited trade-finance figure</th><th style={S.th}>Modelled new wallets</th><th style={S.th}>Modelled revenue</th></tr></thead>
        <tbody>
          <tr><td style={S.td}><strong>2027</strong></td><td style={S.td}>{fmtUSD(som27)}</td><td style={S.td}>Not a comparable measure</td><td style={S.td}>{DEFAULT_ANNUALS[1].totalNewWallets.toLocaleString()}</td><td style={S.td}><strong>{fmtUSD(DEFAULT_ANNUALS[1].totalRevenue)}</strong></td></tr>
          <tr><td style={S.td}><strong>2028</strong></td><td style={S.td}>{fmtUSD(som28)}</td><td style={S.td}>Not a comparable measure</td><td style={S.td}>{DEFAULT_ANNUALS[2].totalNewWallets.toLocaleString()}</td><td style={S.td}><strong>{fmtUSD(DEFAULT_ANNUALS[2].totalRevenue)}</strong></td></tr>
          <tr><td style={S.td}><strong>2029</strong></td><td style={S.td}>{fmtUSD(som29)}</td><td style={S.td}>Not a comparable measure</td><td style={S.td}>{DEFAULT_ANNUALS[3].totalNewWallets.toLocaleString()}</td><td style={S.td}><strong>{fmtUSD(DEFAULT_ANNUALS[3].totalRevenue)}</strong></td></tr>
        </tbody>
      </table>
      <h2 style={S.h2}>Key Growth Drivers</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: "10px", margin: "12px 0" }}>
        {data.drivers.map(r => (
          <div key={r.text} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px", background: "#f8fafc", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
            <span style={{ fontSize: "13px", color: "#334155", flex: 1 }}>{r.text}</span>
            <span style={S.tag("blue")}>{r.label}</span>
          </div>
        ))}
      </div>
      <h2 style={S.h2}>Regional Focus</h2>
      <p style={S.p}>{data.regional}</p>
    </div>
  );
}

const COMP_D = {
  intro: "This comparison has not been independently researched or validated and is not a complete assessment of providers. Availability, minimum size, pricing and product terms vary by institution and corridor; compare current provider documentation before using this table for a decision.",
  rows: [
    { feature: "Minimum trade size", bfx: "Check the selected market", banks: "Not assessed", otc: "Not assessed", defi: "Not assessed", pred: "Not assessed" },
    { feature: "Supported corridors", bfx: "Check the selected network and market", banks: "Not assessed", otc: "Not assessed", defi: "Not assessed", pred: "Not assessed" },
    { feature: "Settlement terms", bfx: "Check contract and oracle state", banks: "Not assessed", otc: "Not assessed", defi: "Not assessed", pred: "Not assessed" },
    { feature: "Pricing and eligibility", bfx: "Check current terms before transacting", banks: "Not assessed", otc: "Not assessed", defi: "Not assessed", pred: "Not assessed" },
  ],
};

function CompetitiveLandscapeDoc({ token: _token }: { token: string }) {
  return (
    <div>
      <p style={S.p}>{COMP_D.intro}</p>
      <div style={{ overflowX: "auto", margin: "20px 0" }}>
        <table style={{ ...S.table, minWidth: "680px" }}>
          <thead>
            <tr>
              <th style={S.th}> </th>
              <th style={{ ...S.th, background: "#eff6ff", color: "#1d4ed8" }}>BlockFinaX</th>
              <th style={S.th}>Banks</th><th style={S.th}>OTC Brokers</th><th style={S.th}>DeFi</th><th style={S.th}>Prediction Markets</th>
            </tr>
          </thead>
          <tbody>{COMP_D.rows.map(r => (
            <tr key={r.feature}>
              <td style={{ ...S.td, fontWeight: 500, color: "#334155" }}>{r.feature}</td>
              <td style={{ ...S.td, background: "#f0f9ff", fontWeight: 600, color: "#1e40af" }}>{r.bfx}</td>
              <td style={S.td}>{r.banks}</td><td style={S.td}>{r.otc}</td><td style={S.td}>{r.defi}</td><td style={S.td}>{r.pred}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

const GTM_DEFAULTS = {
  intro: "BlockFinaX's go-to-market strategy follows a deliberate 4-phase progression: build community trust and product-market fit, then expand to SME direct sales, then leverage channel partners for institutional liquidity, then activate the LP network flywheel for exponential growth.",
  phases: [
    { num: "1", title: "Community Beta",   period: "H1 2026",           color: "#dbeafe", target: "Crypto-native users, DeFi traders, Web3 community members",                              channels: "Discord, Twitter/X, Web3 communities, testnet campaigns, hackathons",       goal: "1,000 wallets, 500 active hedge positions, $500K TVL",                     metrics: "Cost of acquisition: <$10/user · Avg position size: $500" },
    { num: "2", title: "SME Direct",       period: "H2 2026 – H1 2027", color: "#dcfce7", target: "African SMEs with structured FX exposure: importers, exporters, diaspora businesses",   channels: "Direct sales, fintech conferences (AfricaFinTech, Money2020 Africa), referral programme", goal: "10,000 wallets, $50M monthly notional, Bank of Ghana approval", metrics: "Cost of acquisition: <$50/user · Avg position size: $5,000" },
    { num: "3", title: "Channel Partners", period: "H2 2027 – H1 2028", color: "#fef3c7", target: "Banks, fintechs, treasury desks, payment platforms",                                    channels: "API integration, white-label product, revenue-share partnerships",         goal: "3 institutional LP partners, $200M monthly notional",                     metrics: "Revenue share: 15% of platform fees to channel partners" },
    { num: "4", title: "Flywheel",         period: "H2 2028+",          color: "#f3e8ff", target: "Full regional expansion: East Africa, Francophone, Southern Africa",                    channels: "Network effects, LP depth driving better pricing, new pair additions",    goal: "$1B+ monthly notional, 50,000+ active users, multi-regulator approvals",  metrics: "LTV:CAC >10x · Net revenue retention >120%" },
  ],
  partnerships: [
    { type: "Mobile money",        examples: "M-Pesa, MTN MoMo",          value: "On/off ramp + distribution",              phase: "2" },
    { type: "Pan-African fintechs", examples: "Chipper Cash, Flutterwave", value: "User distribution, FX corridors",         phase: "2" },
    { type: "Trade finance banks", examples: "Ecobank, Access Bank",       value: "LP liquidity + institutional credibility", phase: "3" },
    { type: "Base ecosystem",      examples: "Base Foundation",            value: "Grant funding + co-marketing",            phase: "1" },
  ],
};

type GTMData = typeof GTM_DEFAULTS;

function GTMStrategyDoc({ token }: { token: string }) {
  const { editUnlocked, requestEdit } = useEditAuth();
  const [data, setData] = useState<GTMData>(GTM_DEFAULTS);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<GTMData>(GTM_DEFAULTS);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetch(`/api/investor/content/gtm-strategy`, { headers: { "x-investor-token": token } })
      .then(r => r.json())
      .then(d => { if (d.gtm) setData(d.gtm); })
      .catch(() => {});
  }, [token]);

  const startEdit = () => { setDraft(JSON.parse(JSON.stringify(data))); setEditing(true); };
  const cancelEdit = () => setEditing(false);

  const save = async () => {
    setSaving(true);
    try {
      await fetch("/api/investor/content/gtm-strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-investor-token": token },
        body: JSON.stringify({ gtm: draft }),
      });
      setData(draft);
      setEditing(false);
      toast({ title: "GTM strategy saved" });
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    } finally { setSaving(false); }
  };

  const setPhaseField = (idx: number, field: string, val: string) =>
    setDraft(d => ({ ...d, phases: d.phases.map((p, i) => i === idx ? { ...p, [field]: val } : p) }));

  const setPartnerField = (idx: number, field: string, val: string) =>
    setDraft(d => ({ ...d, partnerships: d.partnerships.map((p, i) => i === idx ? { ...p, [field]: val } : p) }));

  const addPartner = () => setDraft(d => ({ ...d, partnerships: [...d.partnerships, { type: "", examples: "", value: "", phase: "1" }] }));
  const removePartner = (idx: number) => setDraft(d => ({ ...d, partnerships: d.partnerships.filter((_, i) => i !== idx) }));

  const inp: React.CSSProperties = { width: "100%", fontSize: "12px", padding: "4px 7px", border: "1px solid #cbd5e1", borderRadius: "5px", background: "white", boxSizing: "border-box" };
  const phaseColors = ["#dbeafe", "#dcfce7", "#fef3c7", "#f3e8ff"];
  const phaseTagColors: Array<"blue"|"green"|"amber"|"violet"> = ["blue", "green", "amber", "violet"];

  if (editing) {
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
          <span style={{ fontSize: "13px", fontWeight: 600, color: "#64748b" }}>Editing GTM Strategy</span>
          <div style={{ display: "flex", gap: "8px" }}>
            <button onClick={cancelEdit} style={{ fontSize: "12px", padding: "6px 14px", border: "1px solid #e2e8f0", borderRadius: "6px", background: "white", cursor: "pointer" }}>Cancel</button>
            <button onClick={save} disabled={saving} style={{ fontSize: "12px", padding: "6px 14px", border: "none", borderRadius: "6px", background: "#2563eb", color: "white", cursor: "pointer", fontWeight: 600 }}>{saving ? "Saving…" : "Save"}</button>
          </div>
        </div>

        <div style={{ marginBottom: "8px" }}>
          <label style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", display: "block", marginBottom: "3px" }}>Intro paragraph</label>
          <textarea value={draft.intro} onChange={e => setDraft(d => ({ ...d, intro: e.target.value }))} rows={3} style={{ ...inp, resize: "vertical" }} />
        </div>

        {draft.phases.map((ph, i) => (
          <div key={ph.num} style={{ background: phaseColors[i] || "#f8fafc", border: "1px solid rgba(0,0,0,0.06)", borderRadius: "10px", padding: "14px 16px", marginBottom: "10px" }}>
            <div style={{ fontSize: "13px", fontWeight: 700, color: "#0f172a", marginBottom: "10px" }}>Phase {ph.num}: {ph.title}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              {(["title","period","target","channels","goal","metrics"] as const).map(f => (
                <div key={f}>
                  <label style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", display: "block", marginBottom: "2px", textTransform: "capitalize" }}>{f}</label>
                  <input value={(ph as Record<string,string>)[f]} onChange={e => setPhaseField(i, f, e.target.value)} style={inp} />
                </div>
              ))}
            </div>
          </div>
        ))}

        <h2 style={S.h2}>Partnership Pipeline</h2>
        <table style={{ ...S.table, width: "100%" }}>
          <thead><tr><th style={S.th}>Partner Type</th><th style={S.th}>Examples</th><th style={S.th}>Value</th><th style={S.th}>Phase</th><th style={S.th}></th></tr></thead>
          <tbody>
            {draft.partnerships.map((p, i) => (
              <tr key={i}>
                {(["type","examples","value","phase"] as const).map(f => (
                  <td key={f} style={S.td}><input value={p[f]} onChange={e => setPartnerField(i, f, e.target.value)} style={inp} /></td>
                ))}
                <td style={S.td}><button onClick={() => removePartner(i)} style={{ fontSize: "11px", color: "#ef4444", background: "none", border: "none", cursor: "pointer" }}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={addPartner} style={{ marginTop: "8px", fontSize: "12px", color: "#2563eb", background: "none", border: "1px dashed #93c5fd", borderRadius: "6px", padding: "5px 14px", cursor: "pointer" }}>+ Add partner</button>
      </div>
    );
  }

  return (
    <div>
      {editUnlocked && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "12px" }}>
          <button onClick={() => requestEdit(startEdit)} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", padding: "6px 14px", border: "1px solid #e2e8f0", borderRadius: "6px", background: "white", cursor: "pointer", fontWeight: 500 }}>
            <Edit3 style={{ width: "13px", height: "13px" }} /> Edit Strategy
          </button>
        </div>
      )}

      <p style={S.p}>{data.intro}</p>

      {data.phases.map((ph, i) => (
        <div key={ph.num} style={{ background: phaseColors[i] || "#f8fafc", border: "1px solid rgba(0,0,0,0.06)", borderRadius: "12px", padding: "18px 20px", marginBottom: "14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
            <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: "#0f172a", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", fontWeight: 700, flexShrink: 0 }}>{ph.num}</div>
            <div><div style={{ fontSize: "15px", fontWeight: 700, color: "#0f172a" }}>Phase {ph.num}: {ph.title}</div><div style={{ fontSize: "12px", color: "#64748b" }}>{ph.period}</div></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "13px" }}>
            <div><span style={{ fontWeight: 600, color: "#334155" }}>Target: </span><span style={{ color: "#475569" }}>{ph.target}</span></div>
            <div><span style={{ fontWeight: 600, color: "#334155" }}>Goal: </span><span style={{ color: "#475569" }}>{ph.goal}</span></div>
            <div><span style={{ fontWeight: 600, color: "#334155" }}>Channels: </span><span style={{ color: "#475569" }}>{ph.channels}</span></div>
            <div><span style={{ fontWeight: 600, color: "#334155" }}>Unit metrics: </span><span style={{ color: "#475569" }}>{ph.metrics}</span></div>
          </div>
        </div>
      ))}

      <h2 style={S.h2}>Partnership Pipeline</h2>
      <table style={S.table}>
        <thead><tr><th style={S.th}>Partner Type</th><th style={S.th}>Examples</th><th style={S.th}>Value</th><th style={S.th}>Phase</th></tr></thead>
        <tbody>
          {data.partnerships.map((p, i) => (
            <tr key={i}>
              <td style={S.td}>{p.type}</td>
              <td style={S.td}>{p.examples}</td>
              <td style={S.td}>{p.value}</td>
              <td style={S.td}><span style={S.tag(phaseTagColors[Number(p.phase) - 1] || "blue")}>Phase {p.phase}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const BOG_D = {
  status_label: "Current status not verified",
  status_date: "Check the latest written Bank of Ghana correspondence",
  intro: "Company records have described a Bank of Ghana Regulatory Sandbox application. This page does not include an application receipt or a current decision letter, so the filing status, admission, permissions and any regulatory protection are unverified. A sandbox application is not a licence or approval.",
  applied_for: [
    "A sandbox licence to offer parametric FX protection contracts to Ghanaian SMEs",
    "Permission to settle contracts in USDC on a public blockchain (Base Mainnet)",
    "Regulatory safe harbour during the sandbox period for on-chain settlement mechanisms",
    "Access to the Bank of Ghana's FinTech and Innovation Office for dialogue on licensing frameworks",
  ],
  compliance: [
    { title: "Supported settlement assets", desc: "Verify against live network configuration and current terms.", status: "pending" },
    { title: "Collateral and payout controls", desc: "Require independent source-to-deployment review and financial testing.", status: "pending" },
    { title: "Transaction audit trail", desc: "Document event coverage, indexing, retention and reconciliation evidence.", status: "pending" },
    { title: "Customer loss limits", desc: "Verify contract behavior, disclosures and edge cases before making a claim.", status: "pending" },
    { title: "KYC and transaction limits", desc: "Provide current policy, enforcement evidence and exception handling.", status: "pending" },
    { title: "Sanctions screening", desc: "Provide vendor, screening scope, refresh cadence and case records.", status: "pending" },
    { title: "Transaction monitoring", desc: "Provide documented rules, alert handling and reporting procedures.", status: "pending" },
    { title: "AML/CFT policy", desc: "Provide the approved policy and evidence of implementation.", status: "pending" },
    { title: "Identity verification", desc: "Provide vendor or manual review process and evidence of coverage.", status: "pending" },
    { title: "Compliance officer", desc: "Provide appointment and documented responsibilities.", status: "pending" },
  ],
  timeline: [
    { milestone: "Application receipt",            date: "Evidence required", status: "Unverified", color: "amber" },
    { milestone: "Bank of Ghana decision",         date: "Evidence required", status: "Unverified", color: "amber" },
    { milestone: "Sandbox period, if admitted",    date: "Not scheduled here", status: "Unverified", color: "amber" },
    { milestone: "Commercial launch in Ghana",     date: "Not scheduled here", status: "Unverified", color: "amber" },
  ],
  markets: [
    { market: "Kenya",                 regulator: "Capital Markets Authority",  target: "Sandbox application 2027" },
    { market: "Nigeria",               regulator: "SEC Nigeria Fintech Sandbox", target: "2028"                    },
    { market: "Francophone W. Africa", regulator: "BCEAO",                      target: "Dialogue 2028"           },
  ],
};

function BoGSandboxDoc({ token }: { token: string }) {
  const { data, draft, editing, saving, editUnlocked, startEdit, cancelEdit, save, setField, requestEdit } = useEditableDoc("bog-sandbox-evidence-v2", token, BOG_D);
  const setComp = (i: number, k: string, v: string) => setField("compliance", draft.compliance.map((r, j) => j === i ? { ...r, [k]: v } : r));
  const setTime = (i: number, k: string, v: string) => setField("timeline", draft.timeline.map((r, j) => j === i ? { ...r, [k]: v } : r));
  const setMkt  = (i: number, k: string, v: string) => setField("markets", draft.markets.map((r, j) => j === i ? { ...r, [k]: v } : r));
  const setApp  = (i: number, v: string) => setField("applied_for", draft.applied_for.map((s, j) => j === i ? v : s));

  if (editing) return (
    <div>
      <DocEditBar editUnlocked saving={saving} editing onEdit={() => {}} onSave={save} onCancel={cancelEdit} />
      <TxtF label="status_label" value={draft.status_label} onChange={v => setField("status_label", v)} rows={1} />
      <TxtF label="status_date"  value={draft.status_date}  onChange={v => setField("status_date", v)}  rows={1} />
      <TxtF label="intro"        value={draft.intro}        onChange={v => setField("intro", v)} />
      <h2 style={S.h2}>What We Applied For</h2>
      {draft.applied_for.map((s, i) => <input key={i} value={s} onChange={e => setApp(i, e.target.value)} style={{ ...EI, marginBottom: "6px", display: "block" }} />)}
      <h2 style={S.h2}>Compliance Framework</h2>
      {draft.compliance.map((r, i) => (
        <div key={i} style={{ display: "flex", gap: "6px", marginBottom: "6px", alignItems: "center" }}>
          <input value={r.title} onChange={e => setComp(i, "title", e.target.value)} style={{ ...EI, width: "35%" }} />
          <input value={r.desc}  onChange={e => setComp(i, "desc",  e.target.value)} style={{ ...EI, flex: 1 }} />
          <select value={r.status} onChange={e => setComp(i, "status", e.target.value)} style={{ ...EI, width: "90px" }}>
            <option value="done">done</option><option value="pending">pending</option>
          </select>
        </div>
      ))}
      <h2 style={S.h2}>Timeline</h2>
      {draft.timeline.map((r, i) => (
        <div key={i} style={{ display: "flex", gap: "6px", marginBottom: "6px" }}>
          <input value={r.milestone} onChange={e => setTime(i, "milestone", e.target.value)} style={{ ...EI, flex: 1 }} />
          <input value={r.date}      onChange={e => setTime(i, "date",      e.target.value)} style={{ ...EI, width: "130px" }} />
          <input value={r.status}    onChange={e => setTime(i, "status",    e.target.value)} style={{ ...EI, width: "90px" }} />
        </div>
      ))}
      <h2 style={S.h2}>Other Markets</h2>
      {draft.markets.map((r, i) => (
        <div key={i} style={{ display: "flex", gap: "6px", marginBottom: "6px" }}>
          <input value={r.market}    onChange={e => setMkt(i, "market",    e.target.value)} style={{ ...EI, width: "25%" }} />
          <input value={r.regulator} onChange={e => setMkt(i, "regulator", e.target.value)} style={{ ...EI, flex: 1 }} />
          <input value={r.target}    onChange={e => setMkt(i, "target",    e.target.value)} style={{ ...EI, width: "160px" }} />
        </div>
      ))}
    </div>
  );

  return (
    <div>
      <DocEditBar editUnlocked={editUnlocked} editing={false} saving={false} onEdit={() => requestEdit(startEdit)} onSave={save} onCancel={cancelEdit} />
      <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "14px 18px", background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: "10px", marginBottom: "20px" }}>
        <span style={{ fontSize: "22px" }}>⏳</span>
        <div>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "#92400e" }}>{data.status_label}</div>
          <div style={{ fontSize: "13px", color: "#b45309" }}>{data.status_date}</div>
        </div>
      </div>
      <p style={S.p}>{data.intro}</p>
      <h2 style={S.h2}>What We Applied For</h2>
      <ul style={{ fontSize: "14px", color: "#475569", paddingLeft: "18px", lineHeight: 2 }}>
        {data.applied_for.map((s, i) => <li key={i}>{s}</li>)}
      </ul>
      <h2 style={S.h2}>Compliance Framework</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", margin: "12px 0" }}>
        {data.compliance.map(r => (
          <div key={r.title} style={{ display: "flex", gap: "10px", padding: "10px 14px", background: r.status === "done" ? "#f0fdf4" : "#f8fafc", borderRadius: "6px", border: `1px solid ${r.status === "done" ? "#bbf7d0" : "#e2e8f0"}` }}>
            <span style={{ fontSize: "16px", flexShrink: 0 }}>{r.status === "done" ? "✅" : "⬜"}</span>
            <div><div style={{ fontSize: "13px", fontWeight: 600, color: "#1e293b" }}>{r.title}</div><div style={{ fontSize: "12px", color: "#64748b" }}>{r.desc}</div></div>
          </div>
        ))}
      </div>
      <h2 style={S.h2}>Timeline</h2>
      <table style={S.table}>
        <thead><tr><th style={S.th}>Milestone</th><th style={S.th}>Date</th><th style={S.th}>Status</th></tr></thead>
        <tbody>{data.timeline.map(r => (
          <tr key={r.milestone}><td style={S.td}>{r.milestone}</td><td style={S.td}>{r.date}</td><td style={S.td}><span style={S.tag(r.color)}>{r.status}</span></td></tr>
        ))}</tbody>
      </table>
      <h2 style={S.h2}>Other Markets Roadmap</h2>
      <table style={S.table}>
        <thead><tr><th style={S.th}>Market</th><th style={S.th}>Regulator</th><th style={S.th}>Target</th></tr></thead>
        <tbody>{data.markets.map(r => (
          <tr key={r.market}><td style={S.td}>{r.market}</td><td style={S.td}>{r.regulator}</td><td style={S.td}>{r.target}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function CostBreakdownDoc() {
  const a = DEFAULT_ANNUALS; // [0]=2026H2 [1]=2027 [2]=2028 [3]=2029 [4]=2030

  function pct(costs: number, rev: number): string {
    if (rev <= 0) return "n/a";
    return `${Math.round((costs / rev) * 100)}%`;
  }

  const years = [
    {
      period: "2026 (H2 only)",
      revenue: fmtUSD(a[0].totalRevenue),
      personnel: fmtUSD(a[0].personnel), marketing: fmtUSD(a[0].marketing), legal: fmtUSD(a[0].legal), infra: fmtUSD(a[0].infraCloud), ga: fmtUSD(a[0].ga), totalOpEx: fmtUSD(a[0].totalOpEx),
      gas: fmtUSD(a[0].gasCost), oracle: fmtUSD(a[0].oracleCost), loyalty: fmtUSD(a[0].creatorLoyalty), kyc: fmtUSD(a[0].kycCost), totalCOGS: fmtUSD(a[0].totalCOGS),
      totalCosts: fmtUSD(a[0].totalCosts), costPct: "n/a",
      stage: "Invest", stageColor: "#d97706", stageBg: "#fef3c7",
      note: "Pre-revenue burn phase. Legal & pre-seed setup dominate.",
    },
    {
      period: "2027 (Full Year)",
      revenue: fmtUSD(a[1].totalRevenue),
      personnel: fmtUSD(a[1].personnel), marketing: fmtUSD(a[1].marketing), legal: fmtUSD(a[1].legal), infra: fmtUSD(a[1].infraCloud), ga: fmtUSD(a[1].ga), totalOpEx: fmtUSD(a[1].totalOpEx),
      gas: fmtUSD(a[1].gasCost), oracle: fmtUSD(a[1].oracleCost), loyalty: fmtUSD(a[1].creatorLoyalty), kyc: fmtUSD(a[1].kycCost), totalCOGS: fmtUSD(a[1].totalCOGS),
      totalCosts: fmtUSD(a[1].totalCosts), costPct: pct(a[1].totalCosts, a[1].totalRevenue),
      stage: "Scale", stageColor: "#1d4ed8", stageBg: "#dbeafe",
      note: "Series A year. Marketing spend drives wallet growth. Gas & creator loyalty grow with volume.",
    },
    {
      period: "2028 (Full Year)",
      revenue: fmtUSD(a[2].totalRevenue),
      personnel: fmtUSD(a[2].personnel), marketing: fmtUSD(a[2].marketing), legal: fmtUSD(a[2].legal), infra: fmtUSD(a[2].infraCloud), ga: fmtUSD(a[2].ga), totalOpEx: fmtUSD(a[2].totalOpEx),
      gas: fmtUSD(a[2].gasCost), oracle: fmtUSD(a[2].oracleCost), loyalty: fmtUSD(a[2].creatorLoyalty), kyc: fmtUSD(a[2].kycCost), totalCOGS: fmtUSD(a[2].totalCOGS),
      totalCosts: fmtUSD(a[2].totalCosts), costPct: pct(a[2].totalCosts, a[2].totalRevenue),
      stage: "Profitable", stageColor: "#16a34a", stageBg: "#dcfce7",
      note: "Break-even achieved. Revenue scales faster than costs. COGS grows with user volume.",
    },
    {
      period: "2029 (Full Year)",
      revenue: fmtUSD(a[3].totalRevenue),
      personnel: fmtUSD(a[3].personnel), marketing: fmtUSD(a[3].marketing), legal: fmtUSD(a[3].legal), infra: fmtUSD(a[3].infraCloud), ga: fmtUSD(a[3].ga), totalOpEx: fmtUSD(a[3].totalOpEx),
      gas: fmtUSD(a[3].gasCost), oracle: fmtUSD(a[3].oracleCost), loyalty: fmtUSD(a[3].creatorLoyalty), kyc: fmtUSD(a[3].kycCost), totalCOGS: fmtUSD(a[3].totalCOGS),
      totalCosts: fmtUSD(a[3].totalCosts), costPct: pct(a[3].totalCosts, a[3].totalRevenue),
      stage: "High Growth", stageColor: "#7c3aed", stageBg: "#ede9fe",
      note: "Creator loyalty and gas sponsorship dominate COGS — both tied directly to revenue volume.",
    },
    {
      period: "2030 (Full Year)",
      revenue: fmtUSD(a[4].totalRevenue),
      personnel: fmtUSD(a[4].personnel), marketing: fmtUSD(a[4].marketing), legal: fmtUSD(a[4].legal), infra: fmtUSD(a[4].infraCloud), ga: fmtUSD(a[4].ga), totalOpEx: fmtUSD(a[4].totalOpEx),
      gas: fmtUSD(a[4].gasCost), oracle: fmtUSD(a[4].oracleCost), loyalty: fmtUSD(a[4].creatorLoyalty), kyc: fmtUSD(a[4].kycCost), totalCOGS: fmtUSD(a[4].totalCOGS),
      totalCosts: fmtUSD(a[4].totalCosts), costPct: pct(a[4].totalCosts, a[4].totalRevenue),
      stage: "Mature", stageColor: "#0f766e", stageBg: "#ccfbf1",
      note: "Strong EBITDA margin at scale. Infrastructure costs sub-linear vs revenue growth.",
    },
  ];

  function Bar({ pct, color }: { pct: number; color: string }) {
    return (
      <div style={{ background: "#f1f5f9", borderRadius: "4px", height: "8px", width: "100%", overflow: "hidden" }}>
        <div style={{ width: `${Math.min(pct, 100)}%`, height: "100%", background: color, borderRadius: "4px", transition: "width 0.3s" }} />
      </div>
    );
  }

  return (
    <div>
      <p style={S.p}>BlockFinaX operates a lean cost structure split into two buckets: <strong>Cost of Goods Sold (COGS)</strong> — direct costs tied to revenue delivery (gas sponsorship, oracle infrastructure, creator loyalty, and KYC compliance) — and <strong>Operating Expenses (OpEx)</strong> — team, marketing, legal, infra, and G&A. Total costs fall sharply as a percentage of revenue as the platform scales, from ~44% in 2027 to ~12% by 2030.</p>

      {/* Annual overview table */}
      <h2 style={S.h2}>Annual Cost Overview</h2>
      <div style={{ overflowX: "auto" }}>
        <table style={S.table}>
          <thead>
            <tr>
              {["Period", "Revenue", "Total COGS", "Total OpEx", "Total Costs", "Costs / Rev", "Stage"].map(h => (
                <th key={h} style={S.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {years.map(r => (
              <tr key={r.period}>
                <td style={S.td}><strong>{r.period}</strong></td>
                <td style={{ ...S.td, color: "#1d4ed8", fontWeight: 600 }}>{r.revenue}</td>
                <td style={{ ...S.td, color: "#c2410c" }}>{r.totalCOGS}</td>
                <td style={{ ...S.td, color: "#7c3aed" }}>{r.totalOpEx}</td>
                <td style={{ ...S.td, fontWeight: 700 }}>{r.totalCosts}</td>
                <td style={{ ...S.td, fontWeight: 600, color: r.costPct === "n/a" ? "#94a3b8" : parseFloat(r.costPct) > 50 ? "#dc2626" : parseFloat(r.costPct) > 25 ? "#d97706" : "#16a34a" }}>{r.costPct}</td>
                <td style={S.td}><span style={{ ...S.tag(""), background: r.stageBg, color: r.stageColor }}>{r.stage}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* COGS breakdown */}
      <h2 style={S.h2}>COGS Breakdown — Direct Delivery Costs</h2>
      <p style={S.p}>All COGS items scale with volume, not headcount. They represent the real cost of delivering each hedge event and wallet onboarding.</p>
      <div style={{ overflowX: "auto" }}>
        <table style={S.table}>
          <thead>
            <tr>
              {["Cost Item", "2027", "2028", "2029", "2030", "Driver"].map(h => (
                <th key={h} style={S.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              { label: "Gas Costs",             vals: [fmtUSD(a[1].gasCost),      fmtUSD(a[2].gasCost),      fmtUSD(a[3].gasCost),      fmtUSD(a[4].gasCost)],      driver: "Wallet onboarding gas + hedge execution gas (~6 on-chain txns per event on Base L2)" },
              { label: "Oracle / RPC",          vals: [fmtUSD(a[1].oracleCost),   fmtUSD(a[2].oracleCost),   fmtUSD(a[3].oracleCost),   fmtUSD(a[4].oracleCost)],   driver: "On-chain settlement infrastructure, scales with pairs" },
              { label: "Creator Loyalty (5%)",  vals: [fmtUSD(a[1].creatorLoyalty),fmtUSD(a[2].creatorLoyalty),fmtUSD(a[3].creatorLoyalty),fmtUSD(a[4].creatorLoyalty)], driver: "5% of hedge fees paid to event creators" },
              { label: "KYC / AML",             vals: [fmtUSD(a[1].kycCost),      fmtUSD(a[2].kycCost),      fmtUSD(a[3].kycCost),      fmtUSD(a[4].kycCost)],      driver: "AML identity verification at $1.50/wallet" },
              { label: "Total COGS",            vals: [fmtUSD(a[1].totalCOGS),    fmtUSD(a[2].totalCOGS),    fmtUSD(a[3].totalCOGS),    fmtUSD(a[4].totalCOGS)],    driver: "", bold: true },
            ].map(row => (
              <tr key={row.label} style={{ background: row.bold ? "#fff7ed" : undefined }}>
                <td style={{ ...S.td, fontWeight: row.bold ? 700 : 400, color: row.bold ? "#c2410c" : undefined }}>{row.label}</td>
                {row.vals.map((v, i) => <td key={i} style={{ ...S.td, fontWeight: row.bold ? 700 : 400, color: row.bold ? "#c2410c" : "#475569" }}>{v}</td>)}
                <td style={{ ...S.td, fontSize: "12px", color: "#94a3b8" }}>{row.driver}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* OpEx breakdown */}
      <h2 style={S.h2}>OpEx Breakdown — Operating Expenses</h2>
      <div style={{ overflowX: "auto" }}>
        <table style={S.table}>
          <thead>
            <tr>
              {["Cost Item", "2027", "2028", "2029", "2030", "Driver"].map(h => (
                <th key={h} style={S.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              { label: "Personnel",     vals: [fmtUSD(a[1].personnel),  fmtUSD(a[2].personnel),  fmtUSD(a[3].personnel),  fmtUSD(a[4].personnel)],  driver: "Headcount × salary/FTE — lean Africa-based team" },
              { label: "Marketing/CAC", vals: [fmtUSD(a[1].marketing),  fmtUSD(a[2].marketing),  fmtUSD(a[3].marketing),  fmtUSD(a[4].marketing)],  driver: "New wallets × CAC — paid acquisition & partnerships" },
              { label: "Legal",         vals: [fmtUSD(a[1].legal),      fmtUSD(a[2].legal),      fmtUSD(a[3].legal),      fmtUSD(a[4].legal)],      driver: "Regulatory counsel, sandbox fees, IP, compliance" },
              { label: "Infra / Cloud", vals: [fmtUSD(a[1].infraCloud), fmtUSD(a[2].infraCloud), fmtUSD(a[3].infraCloud), fmtUSD(a[4].infraCloud)], driver: "Hosting, RPC nodes, CDN, monitoring, CI/CD" },
              { label: "G&A",           vals: [fmtUSD(a[1].ga),         fmtUSD(a[2].ga),         fmtUSD(a[3].ga),         fmtUSD(a[4].ga)],         driver: "Office, finance ops, tooling, HR, insurance" },
              { label: "Total OpEx",    vals: [fmtUSD(a[1].totalOpEx),  fmtUSD(a[2].totalOpEx),  fmtUSD(a[3].totalOpEx),  fmtUSD(a[4].totalOpEx)],  driver: "", bold: true },
            ].map(row => (
              <tr key={row.label} style={{ background: row.bold ? "#f5f3ff" : undefined }}>
                <td style={{ ...S.td, fontWeight: row.bold ? 700 : 400, color: row.bold ? "#7c3aed" : undefined }}>{row.label}</td>
                {row.vals.map((v, i) => <td key={i} style={{ ...S.td, fontWeight: row.bold ? 700 : 400, color: row.bold ? "#7c3aed" : "#475569" }}>{v}</td>)}
                <td style={{ ...S.td, fontSize: "12px", color: "#94a3b8" }}>{row.driver}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Cost composition bars */}
      <h2 style={S.h2}>Cost Composition — 2027 vs 2030</h2>
      {(() => {
        const revenueGrowth = a[0].totalRevenue > 0 ? Math.round(a[4].totalRevenue / a[1].totalRevenue) : 0;
        return <p style={S.p}>As revenue grows {revenueGrowth}× from 2027 to 2030, the cost mix shifts: personnel dominates early, while creator loyalty and gas (both volume-linked) grow to represent the majority of COGS at scale.</p>;
      })()}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", margin: "12px 0" }}>
        {[
          {
            year: "2027", total27: a[1].totalCosts,
            items: [
              { label: "Marketing/CAC",   raw: a[1].marketing,      color: "#a855f7" },
              { label: "Gas Costs",       raw: a[1].gasCost,        color: "#f97316" },
              { label: "Personnel",       raw: a[1].personnel,      color: "#3b82f6" },
              { label: "Legal",           raw: a[1].legal,          color: "#f59e0b" },
              { label: "Creator Loyalty", raw: a[1].creatorLoyalty, color: "#ec4899" },
              { label: "Other",           raw: a[1].oracleCost + a[1].kycCost + a[1].infraCloud + a[1].ga, color: "#94a3b8" },
            ].map(i => ({ ...i, pct: a[1].totalCosts > 0 ? Math.round((i.raw / a[1].totalCosts) * 100) : 0 })),
          },
          {
            year: "2030", total27: a[4].totalCosts,
            items: [
              { label: "Creator Loyalty", raw: a[4].creatorLoyalty, color: "#ec4899" },
              { label: "Marketing/CAC",   raw: a[4].marketing,      color: "#a855f7" },
              { label: "Gas Costs",       raw: a[4].gasCost,        color: "#f97316" },
              { label: "Personnel",       raw: a[4].personnel,      color: "#3b82f6" },
              { label: "Other",           raw: a[4].oracleCost + a[4].kycCost + a[4].infraCloud + a[4].ga + a[4].legal, color: "#94a3b8" },
            ].map(i => ({ ...i, pct: a[4].totalCosts > 0 ? Math.round((i.raw / a[4].totalCosts) * 100) : 0 })),
          },
        ].map(({ year, items }) => (
          <div key={year} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "16px" }}>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "#0f172a", marginBottom: "12px" }}>{year} Cost Mix</div>
            {items.map(item => (
              <div key={item.label} style={{ marginBottom: "8px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#475569", marginBottom: "3px" }}>
                  <span>{item.label}</span><span style={{ fontWeight: 600 }}>{item.pct}%</span>
                </div>
                <Bar pct={item.pct} color={item.color} />
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Key efficiency metrics */}
      <h2 style={S.h2}>Cost Efficiency Metrics</h2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "10px", margin: "12px 0" }}>
        <div style={S.stat}><div style={S.statVal}>{fmtUSD(a[1].totalCosts)}</div><div style={S.statLbl}>Total costs 2027 (Year 1)</div></div>
        <div style={S.stat}><div style={S.statVal}>{a[4].totalRevenue > 0 ? Math.round((a[4].totalCosts / a[4].totalRevenue) * 100) : 0}%</div><div style={S.statLbl}>Cost/Revenue ratio by 2030</div></div>
        <div style={S.stat}><div style={S.statVal}>{a[1].totalEvents > 0 ? `$${Math.round(a[1].totalCosts / a[1].totalEvents)}` : "—"}</div><div style={S.statLbl}>Cost per hedge event (2027)</div></div>
        <div style={S.stat}><div style={S.statVal}>{a[4].totalEvents > 0 ? `$${Math.round(a[4].totalCosts / a[4].totalEvents)}` : "—"}</div><div style={S.statLbl}>Cost per hedge event (2030)</div></div>
      </div>
      <table style={S.table}>
        <thead><tr><th style={S.th}>Metric</th><th style={S.th}>2027</th><th style={S.th}>2028</th><th style={S.th}>2029</th><th style={S.th}>2030</th></tr></thead>
        <tbody>
          {[
            { label: "Total Costs",            vals: [fmtUSD(a[1].totalCosts), fmtUSD(a[2].totalCosts), fmtUSD(a[3].totalCosts), fmtUSD(a[4].totalCosts)] },
            { label: "Cost per Hedge Event",   vals: [a[1],a[2],a[3],a[4]].map(y => y.totalEvents > 0 ? `$${Math.round(y.totalCosts / y.totalEvents)}` : "—") },
            { label: "Cost per New Wallet",    vals: [a[1],a[2],a[3],a[4]].map(y => y.totalNewWallets > 0 ? `$${Math.round(y.totalCosts / y.totalNewWallets)}` : "—") },
            { label: "Personnel % Total Cost", vals: [a[1],a[2],a[3],a[4]].map(y => y.totalCosts > 0 ? `${Math.round((y.personnel / y.totalCosts) * 100)}%` : "—") },
            { label: "Gross Margin",           vals: [a[1],a[2],a[3],a[4]].map(y => y.totalRevenue > 0 ? `${Math.round((y.grossProfit / y.totalRevenue) * 100)}%` : "—") },
            { label: "EBITDA Margin",          vals: [a[1],a[2],a[3],a[4]].map(y => y.totalRevenue > 0 ? `${Math.round((y.ebitda / y.totalRevenue) * 100)}%` : "—") },
          ].map(row => (
            <tr key={row.label}>
              <td style={{ ...S.td, fontWeight: 600 }}>{row.label}</td>
              {row.vals.map((v, i) => <td key={i} style={S.td}>{v}</td>)}
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: "8px", padding: "14px 18px", marginTop: "20px" }}>
        <div style={{ fontSize: "13px", fontWeight: 600, color: "#0369a1" }}>📊 Full Interactive Model</div>
        <div style={{ fontSize: "13px", color: "#0284c7", marginTop: "4px" }}>The Financial Model tab contains the full 54-month bottom-up model with editable inputs, adjustable headcount, CAC, legal, and infrastructure assumptions — all cost lines update in real time.</div>
      </div>
    </div>
  );
}

const INCORP_D = {
  intro: "Entity names, registration, ownership links, operating status, and customer contracting entity have not been independently verified for this data room. Treat all status as unverified until current registry extracts and signed corporate records are attached.",
  investor_note: "No investment entity, parent-subsidiary relationship, or financing structure is asserted here. Confirm these from current corporate records and counsel before relying on them.",
  ghana_rows: [
    { k: "Entity name",      v: "Not verified — provide current registry extract" },
    { k: "Entity type",      v: "Not verified — provide current registry extract" },
    { k: "Registration",     v: "Not verified — provide current registry extract" },
    { k: "Ownership",        v: "Not verified — provide signed corporate records" },
    { k: "Operating status", v: "Not verified — provide current official record" },
  ],
  delaware_rows: [
    { k: "Entity name",    v: "Not verified — provide current registry extract" },
    { k: "Entity type",    v: "Not verified — provide current registry extract" },
    { k: "Registration",   v: "Not verified — provide current registry extract" },
    { k: "Ownership link", v: "Not verified — provide signed corporate records" },
    { k: "Legal counsel",  v: "Not verified — provide current engagement evidence" },
  ],
  timeline_rows: [
    { milestone: "Ghana entity registration and status", jur: "Ghana", target: "Current registry extract required", status: "Unverified", color: "amber" },
    { milestone: "Operating bank account", jur: "Ghana", target: "Current bank evidence required", status: "Unverified", color: "amber" },
    { milestone: "Regulatory application status", jur: "Ghana", target: "Official correspondence required", status: "Unverified", color: "amber" },
    { milestone: "US entity formation, if any", jur: "United States", target: "Current registry extract required", status: "Unverified", color: "amber" },
    { milestone: "Intercompany ownership and IP assignment", jur: "As applicable", target: "Signed records required", status: "Unverified", color: "amber" },
  ],
};

function IncorporationDoc({ token }: { token: string }) {
  const { data, draft, editing, saving, editUnlocked, startEdit, cancelEdit, save, setField, requestEdit } = useEditableDoc("incorporation-evidence-v2", token, INCORP_D);
  const setGhana  = (i: number, k: string, v: string) => setField("ghana_rows",    draft.ghana_rows.map((r, j)    => j === i ? { ...r, [k]: v } : r));
  const setDel    = (i: number, k: string, v: string) => setField("delaware_rows", draft.delaware_rows.map((r, j) => j === i ? { ...r, [k]: v } : r));
  const setTl     = (i: number, k: string, v: string) => setField("timeline_rows", draft.timeline_rows.map((r, j) => j === i ? { ...r, [k]: v } : r));

  const KVTable = ({ rows, setter }: { rows: {k:string;v:string}[]; setter: (i:number, k:string, v:string)=>void }) => (
    <table style={S.table}>
      <tbody>{rows.map((r, i) => (
        <tr key={i}>
          <td style={{ ...S.td, width: "40%" }}><input value={r.k} onChange={e => setter(i, "k", e.target.value)} style={EI} /></td>
          <td style={S.td}><input value={r.v} onChange={e => setter(i, "v", e.target.value)} style={EI} /></td>
        </tr>
      ))}</tbody>
    </table>
  );

  if (editing) return (
    <div>
      <DocEditBar editUnlocked saving={saving} editing onEdit={() => {}} onSave={save} onCancel={cancelEdit} />
      <TxtF label="intro"         value={draft.intro}         onChange={v => setField("intro", v)} />
      <TxtF label="investor_note" value={draft.investor_note} onChange={v => setField("investor_note", v)} />
      <h2 style={S.h2}>Ghana Entity</h2>
      <KVTable rows={draft.ghana_rows} setter={setGhana} />
      <h2 style={S.h2}>Delaware Entity</h2>
      <KVTable rows={draft.delaware_rows} setter={setDel} />
      <h2 style={S.h2}>Formation Timeline</h2>
      {draft.timeline_rows.map((r, i) => (
        <div key={i} style={{ display: "flex", gap: "6px", marginBottom: "6px" }}>
          <input value={r.milestone} onChange={e => setTl(i, "milestone", e.target.value)} style={{ ...EI, flex: 1 }} />
          <input value={r.jur}       onChange={e => setTl(i, "jur",       e.target.value)} style={{ ...EI, width: "110px" }} />
          <input value={r.target}    onChange={e => setTl(i, "target",    e.target.value)} style={{ ...EI, width: "90px" }} />
          <input value={r.status}    onChange={e => setTl(i, "status",    e.target.value)} style={{ ...EI, width: "90px" }} />
        </div>
      ))}
    </div>
  );

  return (
    <div>
      <DocEditBar editUnlocked={editUnlocked} editing={false} saving={false} onEdit={() => requestEdit(startEdit)} onSave={save} onCancel={cancelEdit} />
      <p style={S.p}>{data.intro}</p>
      <h2 style={S.h2}>Ghana — Operating Subsidiary</h2>
      <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "10px", padding: "18px", margin: "12px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
          <span style={{ fontSize: "22px" }}>🇬🇭</span>
          <div><div style={{ fontSize: "15px", fontWeight: 700, color: "#0f172a" }}>Registry evidence required</div><div style={{ fontSize: "13px", color: "#92400e" }}>Entity name and status unverified</div></div>
          <span style={{ marginLeft: "auto", ...S.tag("amber") }}>Unverified</span>
        </div>
        <table style={S.table}><tbody>{data.ghana_rows.map(r => (
          <tr key={r.k}><td style={{ ...S.td, fontWeight: 600, color: "#334155", width: "40%", whiteSpace: "nowrap" as const }}>{r.k}</td><td style={S.td}>{r.v}</td></tr>
        ))}</tbody></table>
      </div>
      <h2 style={S.h2}>Delaware — Parent / Holding Company</h2>
      <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "18px", margin: "12px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
          <span style={{ fontSize: "22px" }}>🇺🇸</span>
          <div><div style={{ fontSize: "15px", fontWeight: 700, color: "#0f172a" }}>Registry evidence required</div><div style={{ fontSize: "13px", color: "#92400e" }}>Entity name and status unverified</div></div>
          <span style={{ marginLeft: "auto", ...S.tag("amber") }}>Unverified</span>
        </div>
        <table style={S.table}><tbody>{data.delaware_rows.map(r => (
          <tr key={r.k}><td style={{ ...S.td, fontWeight: 600, color: "#334155", width: "40%", whiteSpace: "nowrap" as const }}>{r.k}</td><td style={S.td}>{r.v}</td></tr>
        ))}</tbody></table>
      </div>
      <h2 style={S.h2}>Entity Formation Timeline</h2>
      <table style={S.table}>
        <thead><tr><th style={S.th}>Milestone</th><th style={S.th}>Jurisdiction</th><th style={S.th}>Target</th><th style={S.th}>Status</th></tr></thead>
        <tbody>{data.timeline_rows.map(r => (
          <tr key={r.milestone}><td style={S.td}>{r.milestone}</td><td style={S.td}>{r.jur}</td><td style={S.td}>{r.target}</td><td style={S.td}><span style={S.tag(r.color)}>{r.status}</span></td></tr>
        ))}</tbody>
      </table>
      <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "8px", padding: "14px 18px", marginTop: "20px" }}>
        <div style={{ fontSize: "13px", fontWeight: 600, color: "#1d4ed8" }}>ℹ Investor Note</div>
        <div style={{ fontSize: "13px", color: "#1e40af", marginTop: "4px" }}>{data.investor_note}</div>
      </div>
    </div>
  );
}

type GovernanceSnapshot = {
  chain: string;
  chainId: number;
  blockNumber: number;
  diamond: string;
  safe: string;
  owner: string;
  pendingOwner: string;
  ownerKind: "contract" | "externally owned account";
  safeControlsDiamond: boolean;
  oracleV2Active: boolean | null;
  singleKeySettler: string | null;
  oracleSigners: string[];
  requiredSigners: string | null;
  toleranceBps: string | null;
  maxOracles: string | null;
  safeThreshold: string | null;
  safeOwners: string[];
  safeStatus: string;
  activeCutFacet: string;
};

const GOVERNANCE_CHAINS = [
  { name: "Base", chainId: 8453, rpc: "https://mainnet.base.org", diamond: "0xbCC51E62C4948FD35ab505bd71804C849601e4Ef", safe: "0x7909a2f1fAd63678eEDcC5A75462B66D062189Bb", explorer: "https://basescan.org" },
  { name: "BNB Smart Chain", chainId: 56, rpc: "https://bsc-dataseed.binance.org", diamond: "0xaC939C0897981Abc0711ec4e37527F13106180fc", safe: "0x2a0ab363E01b518B189218e39f79Bfc3AE310807", explorer: "https://bscscan.com" },
] as const;

const DIAMOND_GOVERNANCE_ABI = [
  "function owner() view returns (address)",
  "function pendingOwnerAddress() view returns (address)",
  "function facetAddress(bytes4) view returns (address)",
  "function getOracles() view returns (address[])",
  "function getOracleConfig() view returns (uint256,uint256,uint256,uint256)",
  "function getSettlementAuthority() view returns (bool,address,address[],uint256,uint256)",
];
const SAFE_GOVERNANCE_ABI = [
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
];
const DIAMOND_CUT_SELECTOR = "0x1f931c1c";

async function readGovernanceSnapshot(chain: typeof GOVERNANCE_CHAINS[number]): Promise<GovernanceSnapshot> {
  const provider = new ethers.JsonRpcProvider(chain.rpc, chain.chainId, { staticNetwork: true });
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== chain.chainId) {
    throw new Error("RPC returned chain " + network.chainId + ", expected " + chain.chainId);
  }
  const diamond = new ethers.Contract(chain.diamond, DIAMOND_GOVERNANCE_ABI, provider);
  const safe = new ethers.Contract(chain.safe, SAFE_GOVERNANCE_ABI, provider);
  const [blockNumber, ownerWord, pendingOwnerWord, safeResult, activeCutFacet, safeCode, oracleReadResults] = await Promise.all([
    provider.getBlockNumber(),
    provider.getStorage(chain.diamond, ethers.toBeHex(BigInt(ethers.id("diamond.standard.diamond.storage")) + 4n, 32)),
    provider.getStorage(chain.diamond, ethers.toBeHex(BigInt(ethers.id("diamond.standard.diamond.storage")) + 5n, 32)),
    Promise.allSettled([safe.getOwners(), safe.getThreshold()]),
    diamond.facetAddress(DIAMOND_CUT_SELECTOR),
    provider.getCode(chain.safe),
    Promise.allSettled([diamond.getOracles(), diamond.getOracleConfig()]),
  ]);
  const owner = ethers.getAddress("0x" + ownerWord.slice(-40));
  const pendingOwner = ethers.getAddress("0x" + pendingOwnerWord.slice(-40));
  const [ownerFunction, pendingOwnerFunction, settlementAuthority] = await Promise.allSettled([
    diamond.owner(),
    diamond.pendingOwnerAddress(),
    diamond.getSettlementAuthority(),
  ]);
  if (ownerFunction.status === "fulfilled" && ethers.getAddress(ownerFunction.value) !== owner) {
    throw new Error("owner() result does not match the documented Diamond storage layout");
  }
  if (pendingOwnerFunction.status === "fulfilled" && ethers.getAddress(pendingOwnerFunction.value) !== pendingOwner) {
    throw new Error("pendingOwnerAddress() result does not match the documented Diamond storage layout");
  }
  const authority = settlementAuthority.status === "fulfilled" ? settlementAuthority.value : null;
  const ownerCode = await provider.getCode(owner);
  const safeOwnersResult = safeResult[0];
  const safeThresholdResult = safeResult[1];
  const oracleSignersCall = oracleReadResults[0];
  const oracleConfigCall = oracleReadResults[1];
  const safeOk = safeCode !== "0x" && safeOwnersResult.status === "fulfilled" && safeThresholdResult.status === "fulfilled";
  const liveSafeOwners = safeOwnersResult.status === "fulfilled" ? safeOwnersResult.value as string[] : [];
  const liveSafeThreshold = safeThresholdResult.status === "fulfilled" ? (safeThresholdResult.value as bigint).toString() : null;
  const liveOracleSigners = oracleSignersCall.status === "fulfilled" ? oracleSignersCall.value as string[] : [];
  const liveOracleConfig = oracleConfigCall.status === "fulfilled" ? oracleConfigCall.value as readonly [bigint, bigint, bigint, bigint] : null;
  return {
    chain: chain.name,
    chainId: chain.chainId,
    blockNumber,
    diamond: chain.diamond,
    safe: chain.safe,
    owner: ethers.getAddress(owner),
    pendingOwner: ethers.getAddress(pendingOwner),
    ownerKind: ownerCode === "0x" ? "externally owned account" : "contract",
    safeControlsDiamond: owner.toLowerCase() === chain.safe.toLowerCase(),
    oracleV2Active: authority ? authority[0] : null,
    singleKeySettler: authority ? ethers.getAddress(authority[1]) : null,
    oracleSigners: liveOracleSigners.map((address: string) => ethers.getAddress(address)),
    requiredSigners: liveOracleConfig ? liveOracleConfig[0].toString() : null,
    toleranceBps: liveOracleConfig ? liveOracleConfig[1].toString() : null,
    maxOracles: liveOracleConfig ? liveOracleConfig[3].toString() : null,
    safeThreshold: liveSafeThreshold,
    safeOwners: liveSafeOwners.map((address: string) => ethers.getAddress(address)),
    safeStatus: safeOk ? "Safe owners and threshold read successfully" : safeCode === "0x" ? "Configured Safe address has no contract code on this network" : "Safe owner/threshold reads unavailable",
    activeCutFacet: ethers.getAddress(activeCutFacet),
  };
}

type FacetRegistrySnapshot = {
  chainId: number;
  chain: string;
  blockNumber: number;
  diamond: string;
  facets: { address: string; selectorCount: number }[];
};

const DIAMOND_LOUPE_ABI = [
  "function facets() view returns ((address facetAddress, bytes4[] functionSelectors)[])",
];

async function readFacetRegistry(chain: typeof GOVERNANCE_CHAINS[number]): Promise<FacetRegistrySnapshot> {
  const provider = new ethers.JsonRpcProvider(chain.rpc, chain.chainId, { staticNetwork: true });
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== chain.chainId) throw new Error("RPC chain ID mismatch");
  const diamond = new ethers.Contract(chain.diamond, DIAMOND_LOUPE_ABI, provider);
  const [blockNumber, facets] = await Promise.all([provider.getBlockNumber(), diamond.facets()]);
  return {
    chainId: chain.chainId,
    chain: chain.name,
    blockNumber,
    diamond: chain.diamond,
    facets: facets
      .map((facet: any) => ({ address: ethers.getAddress(facet.facetAddress), selectorCount: facet.functionSelectors.length }))
      .filter((facet: { selectorCount: number }) => facet.selectorCount > 0)
      .sort((a: { address: string }, b: { address: string }) => a.address.localeCompare(b.address)),
  };
}

function LiveFacetRegistry() {
  const [snapshots, setSnapshots] = useState<FacetRegistrySnapshot[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.all(GOVERNANCE_CHAINS.map(async chain => {
      try { return { snapshot: await readFacetRegistry(chain) }; }
      catch (error) { return { error: chain.name + ": " + (error instanceof Error ? error.message : "loupe read failed") }; }
    })).then(results => {
      if (!active) return;
      setSnapshots(results.flatMap(result => "snapshot" in result && result.snapshot ? [result.snapshot] : []));
      setErrors(results.flatMap(result => "error" in result && result.error ? [result.error] : []));
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  return <div>
    {loading && <p style={S.p}>Reading live facet registries…</p>}
    {errors.map(error => <p key={error} style={{ ...S.p, color: "#b91c1c" }}>Live registry unavailable: {error}</p>)}
    {snapshots.map(snapshot => {
      const chain = GOVERNANCE_CHAINS.find(item => item.chainId === snapshot.chainId)!;
      return <section key={snapshot.chainId} style={{ marginBottom: 20 }}>
        <h3 style={S.h3}>{snapshot.chain} — block {snapshot.blockNumber}</h3>
        <p style={S.p}><a href={chain.explorer + "/address/" + snapshot.diamond} target="_blank" rel="noreferrer">Diamond {snapshot.diamond}</a></p>
        <table style={S.table}><thead><tr><th style={S.th}>Live facet address</th><th style={S.th}>Active selectors</th></tr></thead>
          <tbody>{snapshot.facets.map(facet => <tr key={facet.address}>
            <td style={S.td}><a href={chain.explorer + "/address/" + facet.address} target="_blank" rel="noreferrer">{facet.address}</a></td>
            <td style={S.td}>{facet.selectorCount}</td>
          </tr>)}</tbody>
        </table>
      </section>;
    })}
  </div>;
}

function GovernanceDoc({ token: _token }: { token: string }) {
  const [snapshots, setSnapshots] = useState<GovernanceSnapshot[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.all(GOVERNANCE_CHAINS.map(async chain => {
      try { return { snapshot: await readGovernanceSnapshot(chain) }; }
      catch (error) {
        return { error: chain.name + ": " + (error instanceof Error ? error.message : "live read failed") };
      }
    })).then(results => {
      if (!active) return;
      setSnapshots(results.flatMap(result => "snapshot" in result && result.snapshot ? [result.snapshot] : []));
      setErrors(results.flatMap(result => "error" in result && result.error ? [result.error] : []));
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  return (
    <div>
      <p style={S.p}>Governance is read from each chain when this page loads. If a chain read fails, its state is shown as unverified; this page does not substitute a saved or dated ownership claim.</p>
      {loading && <p style={S.p}>Reading Base and BNB Smart Chain…</p>}
      {errors.map(error => <p key={error} style={{ ...S.p, color: "#b91c1c" }}>Live verification unavailable: {error}</p>)}
      {snapshots.map(snapshot => {
        const chain = GOVERNANCE_CHAINS.find(item => item.chainId === snapshot.chainId)!;
        return (
          <section key={snapshot.chainId} style={{ marginBottom: 24 }}>
            <h2 style={S.h2}>{snapshot.chain} governance — live block {snapshot.blockNumber}</h2>
            <table style={S.table}><tbody>
              <tr><td style={{ ...S.td, width: "34%", fontWeight: 600 }}>Diamond</td><td style={S.td}><a href={chain.explorer + "/address/" + snapshot.diamond} target="_blank" rel="noreferrer">{snapshot.diamond}</a></td></tr>
              <tr><td style={{ ...S.td, fontWeight: 600 }}>Current owner</td><td style={S.td}><a href={chain.explorer + "/address/" + snapshot.owner} target="_blank" rel="noreferrer">{snapshot.owner}</a> ({snapshot.ownerKind})</td></tr>
              <tr><td style={{ ...S.td, fontWeight: 600 }}>Configured Safe controls Diamond</td><td style={S.td}>{snapshot.safeControlsDiamond ? "Yes — live owner address matches this Safe" : "No — live owner address does not match this Safe"}</td></tr>
              <tr><td style={{ ...S.td, fontWeight: 600 }}>Pending owner</td><td style={S.td}>{snapshot.pendingOwner}</td></tr>
              <tr><td style={{ ...S.td, fontWeight: 600 }}>Configured Safe owners and threshold</td><td style={S.td}>{snapshot.safeStatus}{snapshot.safeThreshold !== null ? ` — ${snapshot.safeThreshold} of ${snapshot.safeOwners.length}; ${snapshot.safeOwners.join(", ")}` : ""}</td></tr>
              <tr><td style={{ ...S.td, fontWeight: 600 }}>Settlement authorization</td><td style={S.td}>{snapshot.oracleV2Active === null ? "Unverified — current implementation does not expose this getter" : snapshot.oracleV2Active ? "Multi-signer consensus required" : "Single-key settlement path active"}{snapshot.singleKeySettler ? "; single-key address: " + snapshot.singleKeySettler : ""}</td></tr>
              <tr><td style={{ ...S.td, fontWeight: 600 }}>Oracle consensus configuration</td><td style={S.td}>{snapshot.requiredSigners === null ? "Unverified — current implementation does not expose this getter" : `${snapshot.requiredSigners} of ${snapshot.oracleSigners.length} registered signers; tolerance ${snapshot.toleranceBps} bps; maximum ${snapshot.maxOracles}; signers: ${snapshot.oracleSigners.join(", ") || "none registered"}`}</td></tr>
              <tr><td style={{ ...S.td, fontWeight: 600 }}>Active diamondCut selector implementation</td><td style={S.td}><a href={chain.explorer + "/address/" + snapshot.activeCutFacet} target="_blank" rel="noreferrer">{snapshot.activeCutFacet}</a>. This address alone does not establish whether an upgrade delay is enforced.</td></tr>
            </tbody></table>
          </section>
        );
      })}
      <p style={{ ...S.p, color: "#64748b" }}>The Safe address is a configured reference. The page reads its live owners and threshold and separately checks whether it currently owns the Diamond. It does not infer timelock behavior from a facet name or deployment file.</p>
    </div>
  );
}

const AGREE_D = {
  intro: "Management-provided agreement and ownership checklist. Entries are not independently verified and supporting records are not attached here. Confirm signed documents, active counterparties and current legal entities before relying on any status.",
  request_note: "Contact BlockFinaX to request the current supporting documents. Availability and execution status should be confirmed in writing.",
  investor_rows: [
    { doc: "Non-Disclosure Agreement (NDA)", party: "Not verified", status: "Evidence needed", color: "amber", note: "Attach current template or confirm availability" },
    { doc: "Investment agreement", party: "Not verified", status: "Evidence needed", color: "amber", note: "Attach current draft or confirm none exists" },
    { doc: "Investor term sheet", party: "Not verified", status: "Evidence needed", color: "amber", note: "Attach current draft or confirm none exists" },
  ],
  service_rows: [
    { doc: "Smart Contract Audit Agreement", party: "Not verified", status: "Evidence needed", color: "amber", note: "Attach signed agreement or confirm no engagement" },
    { doc: "Legal Advisory Retainer",        party: "Not verified",               status: "Evidence needed",            color: "amber", note: "Provide signed agreement or confirm no engagement" },
    { doc: "Compliance Consulting",          party: "Not verified",               status: "Evidence needed",            color: "amber", note: "Provide signed agreement or confirm no engagement" },
    { doc: "Cloud Services Agreement",       party: "Not verified",               status: "Evidence needed",            color: "amber", note: "Provide current vendor and terms" },
    { doc: "Delaware Formation Counsel",     party: "Not verified",               status: "Evidence needed",            color: "amber", note: "Provide current formation status and counsel details" },
  ],
  ip_items: [
    { title: "Source-code ownership", desc: "Assignment and entity records required; deployment ownership is not IP ownership.", status: "pending" },
    { title: "Deployment authority", desc: "See live on-chain owner; this does not establish corporate ownership.", status: "pending" },
    { title: "Open-source licence review", desc: "Provide a current dependency inventory and licence review.", status: "pending" },
    { title: "IP assignment and ownership records", desc: "Provide executed assignment records and identify the relevant entity.", status: "pending" },
    { title: "Trademark registration", desc: "Provide current registry evidence or confirm no registration.", status: "pending" },
  ],
};

function AgreementsDoc({ token }: { token: string }) {
  const { data, draft, editing, saving, editUnlocked, startEdit, cancelEdit, save, setField, requestEdit } = useEditableDoc("agreements-evidence-v2", token, AGREE_D);
  const setInv  = (i: number, k: string, v: string) => setField("investor_rows", draft.investor_rows.map((r, j) => j === i ? { ...r, [k]: v } : r));
  const setSvc  = (i: number, k: string, v: string) => setField("service_rows",  draft.service_rows.map((r, j)  => j === i ? { ...r, [k]: v } : r));
  const setIP   = (i: number, k: string, v: string) => setField("ip_items",      draft.ip_items.map((r, j)      => j === i ? { ...r, [k]: v } : r));

  const AgreTable = ({ rows, setter }: { rows: {doc:string;party:string;status:string;color:string;note:string}[]; setter:(i:number,k:string,v:string)=>void }) => (
    <table style={S.table}>
      <thead><tr><th style={S.th}>Document</th><th style={S.th}>Party</th><th style={S.th}>Status</th><th style={S.th}>Notes</th></tr></thead>
      <tbody>{rows.map((r, i) => (
        <tr key={i}>
          <td style={S.td}><input value={r.doc}    onChange={e => setter(i, "doc",    e.target.value)} style={EI} /></td>
          <td style={S.td}><input value={r.party}  onChange={e => setter(i, "party",  e.target.value)} style={EI} /></td>
          <td style={S.td}><input value={r.status} onChange={e => setter(i, "status", e.target.value)} style={EI} /></td>
          <td style={S.td}><input value={r.note}   onChange={e => setter(i, "note",   e.target.value)} style={EI} /></td>
        </tr>
      ))}</tbody>
    </table>
  );

  if (editing) return (
    <div>
      <DocEditBar editUnlocked saving={saving} editing onEdit={() => {}} onSave={save} onCancel={cancelEdit} />
      <TxtF label="intro"        value={draft.intro}        onChange={v => setField("intro", v)} />
      <TxtF label="request_note" value={draft.request_note} onChange={v => setField("request_note", v)} rows={2} />
      <h2 style={S.h2}>Investor Agreements</h2>
      <AgreTable rows={draft.investor_rows} setter={setInv} />
      <h2 style={S.h2}>Service & Consulting Agreements</h2>
      <AgreTable rows={draft.service_rows} setter={setSvc} />
      <h2 style={S.h2}>IP & Ownership</h2>
      {draft.ip_items.map((r, i) => (
        <div key={i} style={{ display: "flex", gap: "6px", marginBottom: "6px", alignItems: "center" }}>
          <input value={r.title} onChange={e => setIP(i, "title", e.target.value)} style={{ ...EI, flex: 1 }} />
          <input value={r.desc}  onChange={e => setIP(i, "desc",  e.target.value)} style={{ ...EI, flex: 1 }} />
          <select value={r.status} onChange={e => setIP(i, "status", e.target.value)} style={{ ...EI, width: "90px" }}>
            <option value="done">done</option><option value="pending">pending</option>
          </select>
        </div>
      ))}
    </div>
  );

  return (
    <div>
      <DocEditBar editUnlocked={editUnlocked} editing={false} saving={false} onEdit={() => requestEdit(startEdit)} onSave={save} onCancel={cancelEdit} />
      <p style={S.p}>{data.intro}</p>
      <h2 style={S.h2}>Investor Agreements</h2>
      <table style={S.table}>
        <thead><tr><th style={S.th}>Document</th><th style={S.th}>Counterparty</th><th style={S.th}>Status</th><th style={S.th}>Notes</th></tr></thead>
        <tbody>{data.investor_rows.map(r => (
          <tr key={r.doc}><td style={{ ...S.td, fontWeight: 600 }}>{r.doc}</td><td style={S.td}>{r.party}</td><td style={S.td}><span style={S.tag(r.color)}>{r.status}</span></td><td style={{ ...S.td, fontSize: "12px", color: "#64748b" }}>{r.note}</td></tr>
        ))}</tbody>
      </table>
      <h2 style={S.h2}>Service & Consulting Agreements</h2>
      <table style={S.table}>
        <thead><tr><th style={S.th}>Agreement Type</th><th style={S.th}>Party</th><th style={S.th}>Status</th><th style={S.th}>Notes</th></tr></thead>
        <tbody>{data.service_rows.map(r => (
          <tr key={r.doc}><td style={{ ...S.td, fontWeight: 600 }}>{r.doc}</td><td style={S.td}>{r.party}</td><td style={S.td}><span style={S.tag(r.color)}>{r.status}</span></td><td style={{ ...S.td, fontSize: "12px", color: "#64748b" }}>{r.note}</td></tr>
        ))}</tbody>
      </table>
      <h2 style={S.h2}>IP & Ownership</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", margin: "12px 0" }}>
        {data.ip_items.map(r => (
          <div key={r.title} style={{ display: "flex", gap: "10px", padding: "10px 14px", background: r.status === "done" ? "#f0fdf4" : "#f8fafc", borderRadius: "6px", border: `1px solid ${r.status === "done" ? "#bbf7d0" : "#e2e8f0"}` }}>
            <span style={{ fontSize: "16px", flexShrink: 0 }}>{r.status === "done" ? "✅" : "⬜"}</span>
            <div><div style={{ fontSize: "13px", fontWeight: 600, color: "#1e293b" }}>{r.title}</div><div style={{ fontSize: "12px", color: "#64748b" }}>{r.desc}</div></div>
          </div>
        ))}
      </div>
      <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "14px 18px", marginTop: "20px" }}>
        <div style={{ fontSize: "13px", fontWeight: 600, color: "#334155" }}>📩 Request Documents</div>
        <div style={{ fontSize: "13px", color: "#475569", marginTop: "4px" }}>{data.request_note}</div>
      </div>
    </div>
  );
}

type ProposalFile = { filename: string; originalName: string; size: number; mimeType: string };
type Proposal = { id: string; name: string; consultant: string; date: string; status: string; notes: string; files?: ProposalFile[] };

function fileIcon(mime: string) {
  if (mime === "application/pdf") return "📄";
  if (mime.includes("word")) return "📝";
  if (mime.includes("excel") || mime.includes("spreadsheet")) return "📊";
  if (mime.includes("powerpoint") || mime.includes("presentation")) return "📋";
  return "📎";
}
function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ComplianceProposalsDoc({ token }: { token: string }) {
  const { editUnlocked, requestEdit } = useEditAuth();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<ProposalFile[]>([]);
  const [form, setForm] = useState<Omit<Proposal, "id" | "files">>({ name: "", consultant: "", date: "", status: "Draft", notes: "" });
  const { toast } = useToast();

  useEffect(() => {
    fetch("/api/investor/content/compliance-proposals", { headers: { "x-investor-token": token } })
      .then(r => r.json())
      .then(d => setProposals(d.proposals || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  const saveToDb = async (updated: Proposal[]) => {
    await fetch("/api/investor/content/compliance-proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-investor-token": token },
      body: JSON.stringify({ proposals: updated }),
    });
  };

  const resetForm = () => {
    setForm({ name: "", consultant: "", date: "", status: "Draft", notes: "" });
    setPendingFiles([]);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true);
    try {
      const uploaded: ProposalFile[] = [];
      for (const file of files) {
        const fd = new FormData();
        fd.append("file", file);
        const r = await fetch("/api/investor/upload", { method: "POST", headers: { "x-investor-token": token }, body: fd });
        if (!r.ok) { const err = await r.json(); throw new Error(err.error || "Upload failed"); }
        uploaded.push(await r.json());
      }
      setPendingFiles(prev => [...prev, ...uploaded]);
      toast({ title: `${uploaded.length} file${uploaded.length > 1 ? "s" : ""} uploaded` });
    } catch (err: unknown) {
      toast({ title: "Upload failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const removePendingFile = async (filename: string) => {
    await fetch(`/api/investor/files/${encodeURIComponent(filename)}`, { method: "DELETE", headers: { "x-investor-token": token } }).catch(() => {});
    setPendingFiles(prev => prev.filter(f => f.filename !== filename));
  };

  const removeFileFromProposal = async (proposalId: string, filename: string) => {
    await fetch(`/api/investor/files/${encodeURIComponent(filename)}`, { method: "DELETE", headers: { "x-investor-token": token } }).catch(() => {});
    const updated = proposals.map(p => p.id === proposalId ? { ...p, files: (p.files || []).filter(f => f.filename !== filename) } : p);
    await saveToDb(updated);
    setProposals(updated);
  };

  const handleAdd = async () => {
    if (!form.name.trim()) { toast({ title: "Name required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const entry: Proposal = { ...form, id: Date.now().toString(), files: pendingFiles };
      const updated = [...proposals, entry];
      await saveToDb(updated);
      setProposals(updated);
      resetForm();
      setShowForm(false);
      toast({ title: "Proposal added" });
    } catch { toast({ title: "Save failed", variant: "destructive" }); }
    finally { setSaving(false); }
  };

  const handleUpdate = async () => {
    if (!form.name.trim() || !editingId) return;
    setSaving(true);
    try {
      const existing = proposals.find(p => p.id === editingId);
      const mergedFiles = [...(existing?.files || []), ...pendingFiles];
      const updated = proposals.map(p => p.id === editingId ? { ...form, id: p.id, files: mergedFiles } : p);
      await saveToDb(updated);
      setProposals(updated);
      setEditingId(null);
      resetForm();
      toast({ title: "Proposal updated" });
    } catch { toast({ title: "Save failed", variant: "destructive" }); }
    finally { setSaving(false); }
  };

  const handleDelete = async (p: Proposal) => {
    for (const f of p.files || []) {
      await fetch(`/api/investor/files/${encodeURIComponent(f.filename)}`, { method: "DELETE", headers: { "x-investor-token": token } }).catch(() => {});
    }
    const updated = proposals.filter(pr => pr.id !== p.id);
    await saveToDb(updated);
    setProposals(updated);
    toast({ title: "Proposal removed" });
  };

  const startEdit = (p: Proposal) => {
    setEditingId(p.id);
    setForm({ name: p.name, consultant: p.consultant, date: p.date, status: p.status, notes: p.notes });
    setPendingFiles([]);
    setShowForm(false);
  };

  const statusColor: Record<string, string> = {
    "Draft": "slate", "Under Review": "blue", "Approved": "green", "Rejected": "red", "Implemented": "amber",
  };
  const fieldStyle: React.CSSProperties = { width: "100%", padding: "7px 10px", fontSize: "13px", border: "1px solid #e2e8f0", borderRadius: "6px", outline: "none", fontFamily: "inherit", color: "#334155", background: "white" };

  const FileUploadArea = () => (
    <div>
      <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569", display: "block", marginBottom: "6px" }}>
        Attach Files <span style={{ fontWeight: 400, color: "#94a3b8" }}>(PDF, Word, Excel, PowerPoint — max 20 MB each)</span>
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 16px", background: "#f8fafc", border: "2px dashed #cbd5e1", borderRadius: "8px", cursor: "pointer", transition: "border-color 0.2s" }}
        onMouseEnter={e => (e.currentTarget.style.borderColor = "#3b82f6")}
        onMouseLeave={e => (e.currentTarget.style.borderColor = "#cbd5e1")}>
        <input type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt" onChange={handleFileSelect} style={{ display: "none" }} />
        <span style={{ fontSize: "20px" }}>📁</span>
        <span style={{ fontSize: "13px", color: "#475569" }}>
          {uploading ? "Uploading…" : "Click to browse or drag files here"}
        </span>
      </label>
      {pendingFiles.length > 0 && (
        <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "4px" }}>
          {pendingFiles.map(f => (
            <div key={f.filename} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 10px", background: "#eff6ff", borderRadius: "6px", fontSize: "12px" }}>
              <span>{fileIcon(f.mimeType)}</span>
              <span style={{ flex: 1, color: "#1e40af", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.originalName}</span>
              <span style={{ color: "#64748b", flexShrink: 0 }}>{fmtSize(f.size)}</span>
              <button onClick={() => removePendingFile(f.filename)} style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", fontSize: "14px", padding: "0 2px", lineHeight: 1 }}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const ProposalForm = ({ onSave, onCancel, saveLabel }: { onSave: () => void; onCancel: () => void; saveLabel: string }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
        <div>
          <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569", display: "block", marginBottom: "4px" }}>Proposal Name *</label>
          <input style={fieldStyle} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. AML/KYC Framework Proposal" />
        </div>
        <div>
          <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569", display: "block", marginBottom: "4px" }}>Consultant / Firm</label>
          <input style={fieldStyle} value={form.consultant} onChange={e => setForm(f => ({ ...f, consultant: e.target.value }))} placeholder="e.g. LexCorps Advisory" />
        </div>
        <div>
          <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569", display: "block", marginBottom: "4px" }}>Date Received</label>
          <input type="date" style={fieldStyle} value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
        </div>
        <div>
          <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569", display: "block", marginBottom: "4px" }}>Status</label>
          <select style={fieldStyle} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
            {["Draft", "Under Review", "Approved", "Rejected", "Implemented"].map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569", display: "block", marginBottom: "4px" }}>Notes / Summary</label>
        <textarea style={{ ...fieldStyle, resize: "vertical" as const }} rows={3} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Key points, recommendations, estimated cost, next steps…" />
      </div>
      <FileUploadArea />
      <div style={{ display: "flex", gap: "8px" }}>
        <Button onClick={onSave} disabled={saving || uploading} style={{ background: "#2563eb", color: "white" }}>
          <Check style={{ width: "13px", height: "13px", marginRight: "5px" }} />{saving ? "Saving…" : saveLabel}
        </Button>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );

  return (
    <div>
      <p style={S.p}>Track all compliance and legal proposals from external consultants. Attach the original PDF, Word document, or spreadsheet directly — files are stored securely and only accessible to authenticated users.</p>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <h2 style={{ ...S.h2, marginTop: 0, marginBottom: 0, border: "none", paddingBottom: 0 }}>Proposals ({proposals.length})</h2>
        {editUnlocked && !showForm && !editingId && (
          <Button size="sm" onClick={() => setShowForm(true)} style={{ background: "#2563eb", color: "white" }}>+ Add Proposal</Button>
        )}
      </div>

      {showForm && (
        <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "18px", marginBottom: "16px" }}>
          <h3 style={{ ...S.h3, marginTop: 0, marginBottom: "12px" }}>New Compliance Proposal</h3>
          <ProposalForm onSave={handleAdd} onCancel={() => { setShowForm(false); resetForm(); }} saveLabel="Add Proposal" />
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: "40px", color: "#94a3b8" }}>Loading…</div>
      ) : proposals.length === 0 ? (
        <div style={{ textAlign: "center", padding: "50px 20px", background: "#f8fafc", borderRadius: "10px", border: "1px dashed #cbd5e1" }}>
          <BookOpen style={{ width: "36px", height: "36px", color: "#94a3b8", margin: "0 auto 10px" }} />
          <p style={{ fontSize: "14px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>No proposals yet</p>
          <p style={{ fontSize: "13px", color: "#64748b" }}>Click "Add Proposal" to log your first compliance proposal and attach the document.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {proposals.map(p => editingId === p.id ? (
            <div key={p.id} style={{ background: "#f8fafc", border: "1px solid #bfdbfe", borderRadius: "10px", padding: "16px" }}>
              <h3 style={{ ...S.h3, marginTop: 0, marginBottom: "12px" }}>Edit Proposal</h3>
              {/* Existing files in edit mode */}
              {(p.files || []).length > 0 && (
                <div style={{ marginBottom: "10px" }}>
                  <div style={{ fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "6px" }}>Existing attachments</div>
                  {(p.files || []).map(f => (
                    <div key={f.filename} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 10px", background: "#f0fdf4", borderRadius: "6px", fontSize: "12px", marginBottom: "4px" }}>
                      <span>{fileIcon(f.mimeType)}</span>
                      <a href={`/api/investor/files/${encodeURIComponent(f.filename)}`}
                        onClick={e => { e.preventDefault(); fetch(`/api/investor/files/${encodeURIComponent(f.filename)}`, { headers: { "x-investor-token": token } }).then(r => r.blob()).then(blob => { const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = f.originalName; a.click(); URL.revokeObjectURL(url); }); }}
                        style={{ flex: 1, color: "#16a34a", fontWeight: 500, cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.originalName}</a>
                      <span style={{ color: "#64748b", flexShrink: 0 }}>{fmtSize(f.size)}</span>
                      <button onClick={() => removeFileFromProposal(p.id, f.filename)} style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", fontSize: "14px", padding: "0 2px", lineHeight: 1 }}>✕</button>
                    </div>
                  ))}
                </div>
              )}
              <ProposalForm onSave={handleUpdate} onCancel={() => { setEditingId(null); resetForm(); }} saveLabel="Save Changes" />
            </div>
          ) : (
            <div key={p.id} style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "16px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", marginBottom: "8px" }}>
                <div>
                  <div style={{ fontSize: "14px", fontWeight: 700, color: "#0f172a" }}>{p.name}</div>
                  <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                    {p.consultant && <span>{p.consultant}</span>}
                    {p.consultant && p.date && <span> · </span>}
                    {p.date && <span>Received {new Date(p.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                  <span style={S.tag(statusColor[p.status] || "slate")}>{p.status}</span>
                  {editUnlocked && <>
                    <button onClick={() => startEdit(p)} style={{ background: "none", border: "1px solid #e2e8f0", borderRadius: "5px", padding: "3px 8px", cursor: "pointer", fontSize: "12px", color: "#475569" }}>Edit</button>
                    <button onClick={() => handleDelete(p)} style={{ background: "none", border: "1px solid #fee2e2", borderRadius: "5px", padding: "3px 8px", cursor: "pointer", fontSize: "12px", color: "#dc2626" }}>Remove</button>
                  </>}
                </div>
              </div>
              {p.notes && <p style={{ ...S.p, marginBottom: (p.files || []).length > 0 ? "10px" : 0, fontSize: "13px", background: "#f8fafc", padding: "8px 12px", borderRadius: "6px" }}>{p.notes}</p>}
              {(p.files || []).length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  {(p.files || []).map(f => (
                    <div key={f.filename} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 10px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", fontSize: "12px" }}>
                      <span>{fileIcon(f.mimeType)}</span>
                      <a href="#"
                        onClick={e => { e.preventDefault(); fetch(`/api/investor/files/${encodeURIComponent(f.filename)}`, { headers: { "x-investor-token": token } }).then(r => r.blob()).then(blob => { const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = f.originalName; a.click(); URL.revokeObjectURL(url); }); }}
                        style={{ flex: 1, color: "#2563eb", fontWeight: 500, cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.originalName}</a>
                      <span style={{ color: "#94a3b8", flexShrink: 0 }}>{fmtSize(f.size)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── CAP TABLE ─── */
const TOTAL_AUTHORIZED = 1_000_000;
const parseNum = (s: string | undefined) => { const n = parseFloat(String(s ?? "").replace(/[^0-9.]/g, "")); return isNaN(n) ? 0 : n; };
const fmtN     = (n: number) => Math.round(n).toLocaleString();
const fmtMoney = (n: number) => n >= 1e9 ? `$${(n/1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n/1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n/1e3).toFixed(1)}K` : `$${fmtN(n)}`;

const CAP_TABLE_D = {
  notes: "All shares subject to vesting as noted. Total authorized: 1,000,000. Investor round allocations are indicative until term sheets are signed.",
  founders: [
    { name: "Anthony Kumako",  role: "CEO & Co-Founder",  type: "founder",  pct: "31.5", vesting: "4-year, 1-year cliff" },
    { name: "[Co-Founder 2]",  role: "[Role]",             type: "founder",  pct: "7.5",  vesting: "4-year, 1-year cliff" },
    { name: "Option Pool",     role: "Employee Equity",    type: "pool",     pct: "5.5",  vesting: "4-year, 1-year cliff per grant" },
    { name: "AYAHQ",           role: "Incubation",         type: "service",  pct: "1.0",  vesting: "2-year, 6-month cliff" },
  ],
  rounds: [
    { name: "Pre-Seed Round",  investment: "500000",   preMoney: "4500000",  status: "planned" },
    { name: "Seed Round",      investment: "1500000",  preMoney: "",         status: "planned" },
    { name: "Series A",        investment: "8000000",  preMoney: "",         status: "planned" },
    { name: "Series B",        investment: "20000000", preMoney: "",         status: "planned" },
  ],
};
type CapTableData = typeof CAP_TABLE_D;

function CapTableDoc({ token }: { token: string }) {
  const { data, draft, editing, saving, editUnlocked, startEdit, cancelEdit, save, setField, requestEdit } =
    useEditableDoc<CapTableData>("cap-table", token, CAP_TABLE_D);

  /* ── shared cell styles ── */
  const row: React.CSSProperties = { padding: "8px 10px", borderBottom: "1px solid #f1f5f9", fontSize: "13px" };
  const th: React.CSSProperties  = { ...row, background: "#f8fafc", fontWeight: 600, fontSize: "11px", color: "#64748b", textTransform: "uppercase" as const, letterSpacing: "0.04em" };
  const typeColor: Record<string,string> = { founder:"#2563eb", pool:"#7c3aed", service:"#0891b2", investor:"#059669" };
  const typeLabel: Record<string,string> = { founder:"Founder", pool:"Option Pool", service:"Service Grant", investor:"Investor" };

  /* ── round % calculator ── */
  const roundPct = (r: { investment: string; preMoney: string }) => {
    const inv = parseNum(r.investment); const pre = parseNum(r.preMoney);
    return (inv > 0 && pre > 0) ? (inv / (inv + pre)) * 100 : null;
  };

  /* ─────────────── EDIT MODE ─────────────── */
  if (editing) {
    const setFounder = (i: number, k: string, v: string) => {
      const arr = [...draft.founders]; arr[i] = { ...arr[i], [k]: v }; setField("founders", arr);
    };
    const setRound = (i: number, k: string, v: string) => {
      const arr = [...draft.rounds]; arr[i] = { ...arr[i], [k]: v }; setField("rounds", arr);
    };
    const founderTotal = draft.founders.reduce((s, f) => s + parseNum(f.pct), 0);
    const roundTotal   = draft.rounds.reduce((s, r) => { const p = roundPct(r); return p ? s + p : s; }, 0);
    const grandTotal   = founderTotal + roundTotal;
    const totalOk      = Math.abs(grandTotal - 100) < 0.1;

    return (
      <div>
        <DocEditBar editUnlocked saving={saving} editing onEdit={() => {}} onSave={save} onCancel={cancelEdit} />

        {/* Total indicator */}
        <div style={{ display: "flex", gap: "10px", marginBottom: "18px", flexWrap: "wrap" as const }}>
          <div style={{ flex: 1, background: "#f8fafc", borderRadius: "6px", padding: "8px 14px", minWidth: "110px" }}>
            <p style={{ fontSize: "11px", color: "#64748b", margin: 0 }}>Founding Team</p>
            <p style={{ fontSize: "15px", fontWeight: 700, margin: "2px 0 0", color: "#2563eb" }}>{founderTotal.toFixed(2)}%</p>
          </div>
          <div style={{ flex: 1, background: "#f8fafc", borderRadius: "6px", padding: "8px 14px", minWidth: "110px" }}>
            <p style={{ fontSize: "11px", color: "#64748b", margin: 0 }}>Investor Rounds</p>
            <p style={{ fontSize: "15px", fontWeight: 700, margin: "2px 0 0", color: "#059669" }}>{roundTotal.toFixed(2)}%</p>
          </div>
          <div style={{ flex: 1, background: totalOk ? "#f0fdf4" : "#fef2f2", borderRadius: "6px", padding: "8px 14px", minWidth: "110px", border: `1px solid ${totalOk ? "#bbf7d0" : "#fecaca"}` }}>
            <p style={{ fontSize: "11px", color: "#64748b", margin: 0 }}>Grand Total</p>
            <p style={{ fontSize: "15px", fontWeight: 700, margin: "2px 0 0", color: totalOk ? "#059669" : "#ef4444" }}>{grandTotal.toFixed(2)}% {totalOk ? "✓" : "≠ 100%"}</p>
          </div>
        </div>

        {/* ── Founding Team Editor ── */}
        <h3 style={{ ...S.h3, marginBottom: "10px" }}>Founding Team</h3>
        {draft.founders.map((f, i) => (
          <div key={i} style={{ border: "1px solid #e2e8f0", borderRadius: "6px", padding: "10px", marginBottom: "8px", display: "flex", gap: "8px", flexWrap: "wrap" as const, alignItems: "flex-end" }}>
            <div style={{ flex: "2 1 130px" }}><TxtF label="Name"    value={f.name}    onChange={v => setFounder(i,"name",v)}    rows={1} /></div>
            <div style={{ flex: "2 1 120px" }}><TxtF label="Role"    value={f.role}    onChange={v => setFounder(i,"role",v)}    rows={1} /></div>
            <div style={{ flex: "1 1 90px" }}>
              <label style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", display: "block", marginBottom: "3px" }}>Type</label>
              <select value={f.type} onChange={e => setFounder(i,"type",e.target.value)} style={{ ...EI, padding: "5px 8px" }}>
                <option value="founder">Founder</option>
                <option value="pool">Option Pool</option>
                <option value="service">Service Grant</option>
              </select>
            </div>
            <div style={{ flex: "1 1 80px" }}>
              <label style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", display: "block", marginBottom: "3px" }}>Ownership %</label>
              <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                <input type="number" step="0.01" value={f.pct} onChange={e => setFounder(i,"pct",e.target.value)} style={{ ...EI, fontFamily: "monospace", width: "64px" }} />
                <span style={{ fontSize: "12px" }}>%</span>
              </div>
            </div>
            <div style={{ flex: "0 0 76px", paddingBottom: "2px" }}>
              <p style={{ fontSize: "11px", color: "#64748b", margin: "0 0 2px" }}>Shares</p>
              <p style={{ fontSize: "13px", fontWeight: 700, color: typeColor[f.type] || "#2563eb", margin: 0 }}>{fmtN(Math.round(parseNum(f.pct)/100*TOTAL_AUTHORIZED))}</p>
            </div>
            <div style={{ flex: "2 1 160px" }}><TxtF label="Vesting" value={f.vesting} onChange={v => setFounder(i,"vesting",v)} rows={1} /></div>
            <button onClick={() => setField("founders", draft.founders.filter((_,j) => j!==i))} style={{ fontSize:"11px", color:"#ef4444", background:"none", border:"none", cursor:"pointer", alignSelf:"flex-end" as const, paddingBottom:"4px" }}>✕</button>
          </div>
        ))}
        <button onClick={() => setField("founders", [...draft.founders, { name:"", role:"", type:"founder", pct:"0", vesting:"4-year, 1-year cliff" }])}
          style={{ fontSize:"12px", color:"#2563eb", background:"none", border:"1px dashed #bfdbfe", borderRadius:"5px", padding:"5px 12px", cursor:"pointer", marginBottom:"24px" }}>
          + Add team member
        </button>

        {/* ── Investor Rounds Editor ── */}
        <h3 style={{ ...S.h3, marginBottom: "10px" }}>Investor Rounds</h3>
        <p style={{ fontSize: "12px", color: "#64748b", margin: "0 0 12px" }}>Enter the investment amount and pre-money valuation — ownership % is calculated automatically.</p>
        {draft.rounds.map((r, i) => {
          const pct = roundPct(r);
          const postMoney = parseNum(r.investment) + parseNum(r.preMoney);
          return (
            <div key={i} style={{ border: "1px solid #d1fae5", borderRadius: "6px", padding: "10px", marginBottom: "8px", background: "#f0fdf4", display: "flex", gap: "8px", flexWrap: "wrap" as const, alignItems: "flex-end" }}>
              <div style={{ flex: "2 1 130px" }}><TxtF label="Round name" value={r.name} onChange={v => setRound(i,"name",v)} rows={1} /></div>
              <div style={{ flex: "1 1 120px" }}>
                <label style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", display: "block", marginBottom: "3px" }}>Investment ($)</label>
                <input type="number" value={r.investment} onChange={e => setRound(i,"investment",e.target.value)} style={{ ...EI, fontFamily: "monospace" }} placeholder="e.g. 500000" />
              </div>
              <div style={{ flex: "1 1 130px" }}>
                <label style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", display: "block", marginBottom: "3px" }}>Pre-Money Valuation ($)</label>
                <input type="number" value={r.preMoney} onChange={e => setRound(i,"preMoney",e.target.value)} style={{ ...EI, fontFamily: "monospace" }} placeholder="e.g. 4500000" />
              </div>
              <div style={{ flex: "0 0 auto", paddingBottom: "2px" }}>
                <p style={{ fontSize: "11px", color: "#64748b", margin: "0 0 2px" }}>Post-Money</p>
                <p style={{ fontSize: "13px", fontWeight: 700, color: "#059669", margin: 0 }}>{postMoney > 0 ? fmtMoney(postMoney) : "—"}</p>
              </div>
              <div style={{ flex: "0 0 auto", paddingBottom: "2px" }}>
                <p style={{ fontSize: "11px", color: "#64748b", margin: "0 0 2px" }}>Ownership %</p>
                <p style={{ fontSize: "13px", fontWeight: 700, color: "#059669", margin: 0 }}>{pct !== null ? `${pct.toFixed(2)}%` : "—"}</p>
              </div>
              <div style={{ flex: "1 1 90px" }}>
                <label style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", display: "block", marginBottom: "3px" }}>Status</label>
                <select value={r.status} onChange={e => setRound(i,"status",e.target.value)} style={{ ...EI, padding: "5px 8px" }}>
                  <option value="planned">Planned</option>
                  <option value="open">Open</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
              <button onClick={() => setField("rounds", draft.rounds.filter((_,j) => j!==i))} style={{ fontSize:"11px", color:"#ef4444", background:"none", border:"none", cursor:"pointer", alignSelf:"flex-end" as const, paddingBottom:"4px" }}>✕</button>
            </div>
          );
        })}
        <button onClick={() => setField("rounds", [...draft.rounds, { name:"", investment:"", preMoney:"", status:"planned" }])}
          style={{ fontSize:"12px", color:"#059669", background:"none", border:"1px dashed #6ee7b7", borderRadius:"5px", padding:"5px 12px", cursor:"pointer", marginBottom:"24px" }}>
          + Add investor round
        </button>

        <h3 style={S.h3}>Notes</h3>
        <TxtF label="notes" value={draft.notes} onChange={v => setField("notes", v)} rows={3} />
      </div>
    );
  }

  /* ─────────────── VIEW MODE ─────────────── */
  const founderTotal = data.founders.reduce((s, f) => s + parseNum(f.pct), 0);
  const roundTotal   = data.rounds.reduce((s, r) => { const p = roundPct(r); return p ? s + p : s; }, 0);
  const grandTotal   = founderTotal + roundTotal;

  /* implied valuation = post-money of the last round with both values set */
  const lastRoundWithVal = [...data.rounds].reverse().find(r => parseNum(r.preMoney) > 0 && parseNum(r.investment) > 0);
  const impliedVal = lastRoundWithVal ? parseNum(lastRoundWithVal.preMoney) + parseNum(lastRoundWithVal.investment) : 0;

  return (
    <div>
      <DocEditBar editUnlocked={editUnlocked} editing={false} saving={false} onEdit={() => requestEdit(startEdit)} onSave={save} onCancel={cancelEdit} />

      {/* ── Summary stats ── */}
      <div style={{ display: "flex", gap: "14px", marginBottom: "20px", flexWrap: "wrap" as const }}>
        <div style={{ flex: 1, background: "#eff6ff", borderRadius: "8px", padding: "12px 16px", minWidth: "120px", border: "1px solid #bfdbfe" }}>
          <p style={{ fontSize: "11px", color: "#2563eb", margin: 0, fontWeight: 600 }}>Founding Team</p>
          <p style={{ fontSize: "17px", fontWeight: 700, margin: "4px 0 0", color: "#1d4ed8" }}>{founderTotal.toFixed(2)}%</p>
          <p style={{ fontSize: "11px", color: "#64748b", margin: "2px 0 0" }}>{fmtN(Math.round(founderTotal/100*TOTAL_AUTHORIZED))} shares</p>
        </div>
        <div style={{ flex: 1, background: "#f0fdf4", borderRadius: "8px", padding: "12px 16px", minWidth: "120px", border: "1px solid #bbf7d0" }}>
          <p style={{ fontSize: "11px", color: "#059669", margin: 0, fontWeight: 600 }}>Investor Rounds</p>
          <p style={{ fontSize: "17px", fontWeight: 700, margin: "4px 0 0", color: "#047857" }}>{roundTotal.toFixed(2)}%</p>
          <p style={{ fontSize: "11px", color: "#64748b", margin: "2px 0 0" }}>{fmtN(Math.round(roundTotal/100*TOTAL_AUTHORIZED))} shares</p>
        </div>
        <div style={{ flex: 1, background: "#f8fafc", borderRadius: "8px", padding: "12px 16px", minWidth: "120px" }}>
          <p style={{ fontSize: "11px", color: "#64748b", margin: 0 }}>Total Authorized</p>
          <p style={{ fontSize: "17px", fontWeight: 700, margin: "4px 0 0" }}>{fmtN(TOTAL_AUTHORIZED)}</p>
          <p style={{ fontSize: "11px", color: Math.abs(grandTotal-100)<0.1?"#059669":"#ef4444", margin: "2px 0 0", fontWeight: 600 }}>{grandTotal.toFixed(2)}% allocated</p>
        </div>
        {impliedVal > 0 && (
          <div style={{ flex: 1, background: "linear-gradient(135deg,#eff6ff,#dbeafe)", borderRadius: "8px", padding: "12px 16px", minWidth: "120px", border: "1px solid #bfdbfe" }}>
            <p style={{ fontSize: "11px", color: "#2563eb", margin: 0, fontWeight: 600 }}>Implied Valuation</p>
            <p style={{ fontSize: "17px", fontWeight: 700, margin: "4px 0 0", color: "#1d4ed8" }}>{fmtMoney(impliedVal)}</p>
            <p style={{ fontSize: "11px", color: "#64748b", margin: "2px 0 0" }}>post-money ({lastRoundWithVal!.name})</p>
          </div>
        )}
      </div>

      {/* ── Founding Team Table ── */}
      <h3 style={{ ...S.h3, marginBottom: "10px" }}>Founding Team</h3>
      <table style={{ ...S.table, marginBottom: "28px" }}>
        <thead><tr>
          <th style={th}>Name</th>
          <th style={th}>Role</th>
          <th style={th}>Type</th>
          <th style={th}>Ownership %</th>
          <th style={th}>Shares</th>
          {impliedVal > 0 && <th style={th}>Stake Value</th>}
          <th style={th}>Vesting</th>
        </tr></thead>
        <tbody>
          {data.founders.map((f, i) => {
            const pct = parseNum(f.pct);
            return (
              <tr key={i}>
                <td style={{ ...row, fontWeight: 600 }}>{f.name}</td>
                <td style={row}>{f.role}</td>
                <td style={{ ...row, fontSize: "12px", color: typeColor[f.type] || "#64748b" }}>{typeLabel[f.type] || f.type}</td>
                <td style={{ ...row, fontWeight: 700, color: typeColor[f.type] || "#2563eb" }}>{pct.toFixed(2)}%</td>
                <td style={{ ...row, fontFamily: "monospace" }}>{fmtN(Math.round(pct/100*TOTAL_AUTHORIZED))}</td>
                {impliedVal > 0 && <td style={{ ...row, fontFamily: "monospace", color: "#1d4ed8", fontWeight: 600 }}>{fmtMoney(pct/100*impliedVal)}</td>}
                <td style={{ ...row, fontSize: "12px", color: "#7c3aed" }}>{f.vesting}</td>
              </tr>
            );
          })}
          <tr style={{ background: "#f8fafc" }}>
            <td style={{ ...row, fontWeight: 700 }}>Total</td>
            <td colSpan={2} style={row}></td>
            <td style={{ ...row, fontWeight: 700, color: "#2563eb" }}>{founderTotal.toFixed(2)}%</td>
            <td style={{ ...row, fontFamily: "monospace", fontWeight: 700 }}>{fmtN(Math.round(founderTotal/100*TOTAL_AUTHORIZED))}</td>
            {impliedVal > 0 && <td style={{ ...row, fontFamily: "monospace", fontWeight: 700, color: "#1d4ed8" }}>{fmtMoney(founderTotal/100*impliedVal)}</td>}
            <td style={row}></td>
          </tr>
        </tbody>
      </table>

      {/* ── Investor Rounds Table ── */}
      <h3 style={{ ...S.h3, marginBottom: "10px" }}>Investor Rounds</h3>
      <table style={S.table}>
        <thead><tr>
          <th style={th}>Round</th>
          <th style={th}>Investment</th>
          <th style={th}>Pre-Money Val.</th>
          <th style={th}>Post-Money Val.</th>
          <th style={th}>Ownership %</th>
          <th style={th}>Shares</th>
          {impliedVal > 0 && <th style={th}>Stake Value</th>}
          <th style={th}>Status</th>
        </tr></thead>
        <tbody>
          {data.rounds.map((r, i) => {
            const pct  = roundPct(r);
            const inv  = parseNum(r.investment);
            const pre  = parseNum(r.preMoney);
            const post = inv + pre;
            const statusColor: Record<string,string> = { planned: "#d97706", open: "#2563eb", closed: "#059669" };
            return (
              <tr key={i} style={{ background: r.status === "closed" ? "#f0fdf4" : r.status === "open" ? "#eff6ff" : "white" }}>
                <td style={{ ...row, fontWeight: 600 }}>{r.name || "—"}</td>
                <td style={{ ...row, fontFamily: "monospace" }}>{inv > 0 ? fmtMoney(inv) : "—"}</td>
                <td style={{ ...row, fontFamily: "monospace" }}>{pre > 0 ? fmtMoney(pre) : <span style={{ color: "#94a3b8", fontStyle: "italic" }}>not set</span>}</td>
                <td style={{ ...row, fontFamily: "monospace", fontWeight: 600 }}>{post > 0 ? fmtMoney(post) : "—"}</td>
                <td style={{ ...row, fontWeight: 700, color: "#059669" }}>{pct !== null ? `${pct.toFixed(2)}%` : <span style={{ color: "#94a3b8" }}>—</span>}</td>
                <td style={{ ...row, fontFamily: "monospace" }}>{pct !== null ? fmtN(Math.round(pct/100*TOTAL_AUTHORIZED)) : "—"}</td>
                {impliedVal > 0 && <td style={{ ...row, fontFamily: "monospace", color: "#059669", fontWeight: 600 }}>{pct !== null ? fmtMoney(pct/100*impliedVal) : "—"}</td>}
                <td style={{ ...row, fontSize: "12px", fontWeight: 600, color: statusColor[r.status] || "#64748b", textTransform: "capitalize" as const }}>{r.status}</td>
              </tr>
            );
          })}
          <tr style={{ background: "#f0fdf4" }}>
            <td style={{ ...row, fontWeight: 700 }}>Total</td>
            <td colSpan={3} style={row}></td>
            <td style={{ ...row, fontWeight: 700, color: "#047857" }}>{roundTotal.toFixed(2)}%</td>
            <td style={{ ...row, fontFamily: "monospace", fontWeight: 700 }}>{fmtN(Math.round(roundTotal/100*TOTAL_AUTHORIZED))}</td>
            {impliedVal > 0 && <td style={{ ...row, fontFamily: "monospace", fontWeight: 700, color: "#047857" }}>{fmtMoney(roundTotal/100*impliedVal)}</td>}
            <td style={row}></td>
          </tr>
        </tbody>
      </table>

      <p style={{ ...S.p, fontStyle: "italic", color: "#94a3b8", marginTop: "16px", fontSize: "12px" }}>{data.notes}</p>
    </div>
  );
}

/* ─── TEAM INFO ─── */
const TEAM_D = {
  intro: "BlockFinaX is built by a lean, execution-focused founding team with backgrounds in software engineering, financial markets, and African fintech.",
  members: [
    { name: "Anthony Kumako", role: "CEO & Co-Founder", bio: "Founder and lead engineer. Background in blockchain development, DeFi protocol design, and African cross-border payments. Responsible for product strategy, smart contract architecture, and investor relations.", linkedin: "https://linkedin.com/in/" },
    { name: "[Co-Founder 2]", role: "[Role & Co-Founder]", bio: "Add background here.", linkedin: "" },
  ],
  advisors: [
    { name: "[Advisor Name]", role: "[Domain] Advisor", bio: "Add advisor background and relevance here.", linkedin: "" },
  ],
  hiring: "Actively hiring: Senior Solidity Engineer, Business Development Lead (Ghana/Nigeria), and Compliance Officer. Reach out at anthonykumako8@gmail.com.",
};
type TeamData = typeof TEAM_D;

function TeamInfoDoc({ token }: { token: string }) {
  const { data, draft, editing, saving, editUnlocked, startEdit, cancelEdit, save, setField, requestEdit } =
    useEditableDoc<TeamData>("team-info", token, TEAM_D);

  const setMember = (key: "members" | "advisors", i: number, k: string, v: string) => {
    const arr = [...(draft[key] as any[])];
    arr[i] = { ...arr[i], [k]: v };
    setField(key, arr);
  };
  const addMember = (key: "members" | "advisors") =>
    setField(key, [...(draft[key] as any[]), { name: "", role: "", bio: "", linkedin: "" }]);
  const removeMember = (key: "members" | "advisors", i: number) =>
    setField(key, (draft[key] as any[]).filter((_: any, j: number) => j !== i));

  const cardStyle: React.CSSProperties = { border: "1px solid #e2e8f0", borderRadius: "8px", padding: "16px", marginBottom: "12px" };

  if (editing) return (
    <div>
      <DocEditBar editUnlocked saving={saving} editing onEdit={() => {}} onSave={save} onCancel={cancelEdit} />
      <TxtF label="intro" value={draft.intro} onChange={v => setField("intro", v)} rows={2} />
      <h3 style={S.h3}>Team Members</h3>
      {draft.members.map((r, i) => (
        <div key={i} style={{ ...cardStyle, background: "#fafafa" }}>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" as const }}>
            {(["name","role","bio","linkedin"] as const).map(f => (
              <div key={f} style={{ flex: f === "bio" ? "1 1 100%" : "1 1 200px" }}>
                <TxtF label={f} value={r[f]} onChange={v => setMember("members", i, f, v)} rows={f === "bio" ? 3 : 1} />
              </div>
            ))}
          </div>
          <button onClick={() => removeMember("members", i)} style={{ fontSize: "11px", color: "#ef4444", background: "none", border: "none", cursor: "pointer" }}>Remove</button>
        </div>
      ))}
      <button onClick={() => addMember("members")} style={{ fontSize: "12px", color: "#2563eb", background: "none", border: "1px solid #bfdbfe", borderRadius: "5px", padding: "4px 10px", cursor: "pointer", marginBottom: "12px" }}>+ Add Team Member</button>
      <h3 style={S.h3}>Advisors</h3>
      {draft.advisors.map((r, i) => (
        <div key={i} style={{ ...cardStyle, background: "#fafafa" }}>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" as const }}>
            {(["name","role","bio","linkedin"] as const).map(f => (
              <div key={f} style={{ flex: f === "bio" ? "1 1 100%" : "1 1 200px" }}>
                <TxtF label={f} value={r[f]} onChange={v => setMember("advisors", i, f, v)} rows={f === "bio" ? 3 : 1} />
              </div>
            ))}
          </div>
          <button onClick={() => removeMember("advisors", i)} style={{ fontSize: "11px", color: "#ef4444", background: "none", border: "none", cursor: "pointer" }}>Remove</button>
        </div>
      ))}
      <button onClick={() => addMember("advisors")} style={{ fontSize: "12px", color: "#2563eb", background: "none", border: "1px solid #bfdbfe", borderRadius: "5px", padding: "4px 10px", cursor: "pointer", marginBottom: "12px" }}>+ Add Advisor</button>
      <h3 style={S.h3}>Open Roles</h3>
      <TxtF label="hiring" value={draft.hiring} onChange={v => setField("hiring", v)} rows={2} />
    </div>
  );

  return (
    <div>
      <DocEditBar editUnlocked={editUnlocked} editing={false} saving={false} onEdit={() => requestEdit(startEdit)} onSave={save} onCancel={cancelEdit} />
      <p style={S.p}>{data.intro}</p>
      <h3 style={S.h3}>Founding Team</h3>
      {data.members.map((m, i) => (
        <div key={i} style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap" as const, gap: "4px" }}>
            <div>
              <p style={{ margin: 0, fontWeight: 700, fontSize: "15px", color: "#0f172a" }}>{m.name}</p>
              <p style={{ margin: "2px 0 8px", fontSize: "12px", color: "#2563eb", fontWeight: 600 }}>{m.role}</p>
            </div>
            {m.linkedin && (
              <a href={m.linkedin} target="_blank" rel="noopener noreferrer" style={{ fontSize: "12px", color: "#2563eb", textDecoration: "none", display: "flex", alignItems: "center", gap: "4px" }}>
                LinkedIn →
              </a>
            )}
          </div>
          <p style={{ ...S.p, margin: 0 }}>{m.bio}</p>
        </div>
      ))}
      {data.advisors.length > 0 && (
        <>
          <h3 style={S.h3}>Advisors</h3>
          {data.advisors.map((m, i) => (
            <div key={i} style={{ ...cardStyle, background: "#fafafe" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap" as const, gap: "4px" }}>
                <div>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: "14px", color: "#0f172a" }}>{m.name}</p>
                  <p style={{ margin: "2px 0 8px", fontSize: "12px", color: "#7c3aed", fontWeight: 600 }}>{m.role}</p>
                </div>
                {m.linkedin && (
                  <a href={m.linkedin} target="_blank" rel="noopener noreferrer" style={{ fontSize: "12px", color: "#2563eb", textDecoration: "none" }}>
                    LinkedIn →
                  </a>
                )}
              </div>
              <p style={{ ...S.p, margin: 0 }}>{m.bio}</p>
            </div>
          ))}
        </>
      )}
      <h3 style={S.h3}>Open Roles</h3>
      <p style={S.p}>{data.hiring}</p>
    </div>
  );
}

/* ─── ADMIN NOTES SECTION ─── */
function AdminNotesSection({ docId, token }: { docId: string; token: string }) {
  const { editUnlocked } = useEditAuth();
  const { toast } = useToast();
  const [notes, setNotes] = useState("");
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const notesKey = `${docId}-admin-notes`;

  useEffect(() => {
    fetch(`/api/investor/content/${notesKey}`, { headers: { "x-investor-token": token } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.notes) { setNotes(d.notes); setDraft(d.notes); } })
      .catch(() => {});
  }, [notesKey, token]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch(`/api/investor/content/${notesKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-investor-token": token },
        body: JSON.stringify({ notes: draft }),
      });
      setNotes(draft);
      setEditing(false);
      toast({ title: "Notes saved" });
    } catch { toast({ title: "Save failed", variant: "destructive" }); }
    finally { setSaving(false); }
  };

  if (!editUnlocked && !notes) return null;

  return (
    <div style={{ marginTop: "28px", borderTop: "1px solid #e2e8f0", paddingTop: "20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
          <Pencil style={{ width: "13px", height: "13px", color: "#92400e" }} />
          <span style={{ fontSize: "12px", fontWeight: 700, color: "#92400e", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {editUnlocked ? "Admin Notes (editable)" : "Admin Notes"}
          </span>
        </div>
        {editUnlocked && !editing && (
          <button onClick={() => { setDraft(notes); setEditing(true); }}
            style={{ fontSize: "12px", color: "#2563eb", background: "none", border: "1px solid #bfdbfe", borderRadius: "5px", padding: "3px 10px", cursor: "pointer", fontWeight: 500 }}>
            {notes ? "Edit" : "Add Notes"}
          </button>
        )}
      </div>

      {editing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={5}
            placeholder="Add internal notes, status updates, or content overrides for this document…"
            style={{ width: "100%", padding: "10px 12px", fontSize: "13px", border: "1px solid #bfdbfe", borderRadius: "8px", outline: "none", fontFamily: "inherit", resize: "vertical", background: "#fffbeb", boxSizing: "border-box" as const }}
          />
          <div style={{ display: "flex", gap: "8px" }}>
            <Button size="sm" onClick={handleSave} disabled={saving} style={{ background: "#2563eb", color: "white" }}>
              <Check style={{ width: "12px", height: "12px", marginRight: "4px" }} />{saving ? "Saving…" : "Save"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      ) : notes ? (
        <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "8px", padding: "12px 14px", fontSize: "13px", color: "#78350f", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
          {notes}
        </div>
      ) : null}
    </div>
  );
}

/* ─── TRACTION ─── */

interface TractionData {
  generatedAt: string;
  chains: Array<{ chainId: number; chainName: string; live: boolean }>;
  pools: { total: number; open: number; settled: number; expired: number };
  participants: { hedgerPositions: number; lpPositions: number; uniqueHedgers: number; uniqueLps: number };
  detailCoverage: { poolsRead: number; positionsResolved: number; depositsResolved: number };
  volume: {
    totalNotional: string; totalLiquidityDeposited: string; totalPremiumsCollected: string;
    totalPayouts: string; totalLpPremiumsEarned: string; totalTransferVolume: string;
  };
  revenue: {
    creationFees: string; poolsCreated: number; hedgerProtocolFees: string;
    creationFeeBreakdown: Array<{ chainName: string; pools: number; feePerPool: number; known: boolean }>;
    hedgePlatformFees: string; transactionFees: string; netPlatformRevenue: string;
    transactionFeeCount: number; onChainTreasury: string;
    chainFeeDetails: Record<string, { fees: number; source: string }>;
  };
  byPair: Array<{ pair: string; pools: number; liquidity: number; notional: number; premiums: number; hedgers: number }>;
  agreements: {
    signedCount: number;
    outstandingCount: number;
    byRelationship: Record<string, number>;
    byCountry: Record<string, number>;
    latestSignedAt: string | null;
    /** Only counterparties who agreed to be named. */
    named: Array<{ company: string; country: string | null; relationshipType: string; docType: string; signedAt: string | null }>;
  };
  activityBackfill: { running: boolean; rows: number };
  recentActivity: Array<{
    txHash: string; chainId: number; chainName: string; actionType: string;
    amount: string | null; token: string | null; walletAddress: string;
    onChainEventId: number | null; positionId: number | null; depositId: number | null;
    metadata: string | null; blockNumber: number | null;
    status: string; createdAt: string | null; explorerUrl: string | null;
  }>;
}

const usd = (n: string | number) =>
  "$" + Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });

const shortAddr = (a: string) => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

/** Mirrors RELATIONSHIP_LABELS server-side; kept local so the data room
 *  bundle doesn't pull in the whole agreements schema. */
const RELATIONSHIP_LABEL: Record<string, string> = {
  institutional_underwriter: "Institutional underwriter", liquidity_provider: "Liquidity provider",
  sme: "SME", fintech_partner: "Fintech partner", strategic_partner: "Strategic partner",
  investor: "Investor", broker: "Broker", other: "Other",
};

const ACTION_LABEL: Record<string, string> = {
  create_event: "Pool created", deposit: "LP deposit", withdraw: "LP withdrawal",
  buy_protection: "Protection bought", claim: "Payout claimed",
  claim_premiums: "Premiums claimed", settle: "Settled",
};

/**
 * Live protocol monitor. Every figure is read from the Diamond on Base + BSC
 * at request time, not from our database — that's the point of showing it to
 * an investor. Polls every 30s while the modal is open.
 */
export function LiveTractionDoc({ token, shareKey }: { token: string; shareKey?: string }) {
  const [d, setD] = useState<TractionData | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      // Two ways in. A data-room session sends its token as a header; a share
      // link has no session at all and puts its key in the query string,
      // because a pasted URL cannot carry a header.
      const url = shareKey
        ? `/api/investor/traction?k=${encodeURIComponent(shareKey)}`
        : "/api/investor/traction";
      const r = await fetch(url, { headers: shareKey ? {} : { "x-investor-token": token } });
      if (!r.ok) throw new Error((await r.json()).error || "Failed to load");
      setD(await r.json());
      setErr("");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [token, shareKey]);

  useEffect(() => {
    load();
    // Thirty seconds is right for someone watching the protocol live inside
    // the data room. On a shared link it is wrong: the reader is doing
    // diligence, not trading, and the figures move a few times a week. Every
    // poll re-reads two chains and aggregates the database, so a tab left
    // open all day would cost thousands of those for no new information.
    const t = setInterval(load, shareKey ? 300_000 : 30_000);
    return () => clearInterval(t);
  }, [load]);

  if (loading && !d) return <p style={S.p}>Reading the chain…</p>;
  if (err && !d) return <p style={{ ...S.p, color: "#dc2626" }}>{err}</p>;
  if (!d) return null;

  // Payout / LP-earning figures depend on the per-position getters, which
  // revert on older Base pools. Show them only when we actually resolved some,
  // rather than presenting a zero that reads as "nothing ever paid out".
  const detailed = d.detailCoverage.positionsResolved > 0;

  const stats: Array<[string, string, string]> = [
    ["Protocol revenue", usd(d.revenue.netPlatformRevenue), "Platform fees + transaction fees"],
    ["Notional protected", usd(d.volume.totalNotional), "Total exposure covered across pools"],
    ["Liquidity underwritten", usd(d.volume.totalLiquidityDeposited), "Capital committed by LPs"],
    ["Premiums collected", usd(d.volume.totalPremiumsCollected), "Paid by hedgers into pools"],
    ["Hedger positions", String(d.participants.hedgerPositions), "Cover contracts bought"],
    ["LP positions", String(d.participants.lpPositions), "Underwriting deposits made"],
    ...(detailed
      ? ([
          ["Payouts settled", usd(d.volume.totalPayouts), "Returned to hedgers on trigger"],
          ["LP earnings", usd(d.volume.totalLpPremiumsEarned), "Premium income accrued to LPs"],
        ] as Array<[string, string, string]>)
      : []),
  ];

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px", flexWrap: "wrap" }}>
        <span style={{ ...S.tag("green"), display: "inline-flex", alignItems: "center", gap: "5px" }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: "#16a34a", display: "inline-block" }} />
          Live from chain
        </span>
        {d.chains.map(c => (
          <span key={c.chainId} style={S.tag(c.live ? "blue" : "amber")}>
            {c.chainName}{c.live ? "" : " (estimated fees)"}
          </span>
        ))}
        <span style={{ fontSize: "11px", color: "#94a3b8", marginLeft: "auto", display: "flex", alignItems: "center", gap: "5px" }}>
          <RefreshCw style={{ width: 11, height: 11 }} />
          {new Date(d.generatedAt).toLocaleTimeString()} · refreshes every 30s
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "10px" }}>
        {stats.map(([label, val, hint]) => (
          <div key={label} style={S.stat}>
            <div style={S.statVal}>{val}</div>
            <div style={S.statLbl}>{label}</div>
            <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "4px" }}>{hint}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "10px", marginTop: "10px" }}>
        {([
          ["Pools", d.pools.total], ["Open", d.pools.open], ["Settled", d.pools.settled],
          ...(detailed
            ? ([["Unique hedgers", d.participants.uniqueHedgers], ["Unique LPs", d.participants.uniqueLps]] as Array<[string, number]>)
            : []),
        ] as Array<[string, number]>).map(([l, v]) => (
          <div key={l} style={S.stat}>
            <div style={{ ...S.statVal, fontSize: "18px" }}>{v}</div>
            <div style={S.statLbl}>{l}</div>
          </div>
        ))}
      </div>

      <h2 style={S.h2}>Revenue, itemised from chain</h2>
      <table style={S.table}>
        <thead><tr><th style={S.th}>Source</th><th style={S.th}>Amount</th><th style={S.th}>Basis</th></tr></thead>
        <tbody>
          <tr>
            <td style={S.td}>Pool creation fees</td>
            <td style={S.td}>{usd(d.revenue.creationFees)}</td>
            <td style={S.td}>
              {d.revenue.creationFeeBreakdown?.length
                ? d.revenue.creationFeeBreakdown.map(c => c.known
                    ? `${c.chainName}: ${c.pools} × ${usd(c.feePerPool)}`
                    : `${c.chainName}: ${c.pools} pools · fee unreadable on chain`).join(" · ")
                : `${d.revenue.poolsCreated} pools`}
            </td>
          </tr>
          <tr>
            <td style={S.td}>Hedger protocol fees</td>
            <td style={S.td}>{usd(d.revenue.hedgerProtocolFees)}</td>
            <td style={S.td}>Taken at purchase, summed from {d.recentActivity.filter(a => a.actionType === "buy_protection").length} purchase logs</td>
          </tr>
          <tr>
            <td style={S.td}>Transaction fees</td>
            <td style={S.td}>{usd(d.revenue.transactionFees)}</td>
            <td style={S.td}>{d.revenue.transactionFeeCount} transfers · {usd(d.volume.totalTransferVolume)} volume</td>
          </tr>
          <tr>
            <td style={{ ...S.td, fontWeight: 700, color: "#0f172a" }}>Net platform revenue</td>
            <td style={{ ...S.td, fontWeight: 700, color: "#0f172a" }}>{usd(d.revenue.netPlatformRevenue)}</td>
            <td style={S.td} />
          </tr>
          <tr>
            <td style={{ ...S.td, color: "#94a3b8" }}>Undrawn treasury balance</td>
            <td style={{ ...S.td, color: "#94a3b8" }}>{usd(d.revenue.onChainTreasury)}</td>
            <td style={{ ...S.td, color: "#94a3b8" }}>
              Cross-check — reads lower than lifetime revenue once fees are withdrawn
              {Object.entries(d.revenue.chainFeeDetails).map(([c, v]) => ` · ${c}: ${v.source}`).join("")}
            </td>
          </tr>
        </tbody>
      </table>

      {(d.agreements?.signedCount > 0 || d.agreements?.outstandingCount > 0) && (
        <>
          <h2 style={S.h2}>
            Signed agreements
            <span style={{ fontSize: "12px", fontWeight: 500, color: "#64748b", marginLeft: "8px" }}>
              Executed letters of intent, counted from the signing platform
            </span>
          </h2>
          <p style={S.p}>
            {d.agreements.signedCount} counterpart{d.agreements.signedCount === 1 ? "y has" : "ies have"} electronically
            signed a letter of intent with BlockFinaX
            {d.agreements.latestSignedAt
              ? `, most recently on ${new Date(d.agreements.latestSignedAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}`
              : ""}
            . {d.agreements.outstandingCount > 0
              ? `A further ${d.agreements.outstandingCount} ${d.agreements.outstandingCount === 1 ? "is" : "are"} out for signature and not counted above.`
              : ""}
          </p>
          {Object.keys(d.agreements.byRelationship).length > 0 && (
            <table style={S.table}>
              <thead><tr><th style={S.th}>Counterparty type</th><th style={S.th}>Signed</th></tr></thead>
              <tbody>
                {Object.entries(d.agreements.byRelationship)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, n]) => (
                    <tr key={k}>
                      <td style={{ ...S.td, fontWeight: 600, color: "#0f172a" }}>{RELATIONSHIP_LABEL[k] ?? k}</td>
                      <td style={S.td}>{n}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
          {d.agreements.named.length > 0 && (
            <>
              <h3 style={{ ...S.h2, fontSize: "15px", marginTop: "18px" }}>Named counterparties</h3>
              <table style={S.table}>
                <thead><tr><th style={S.th}>Counterparty</th><th style={S.th}>Type</th><th style={S.th}>Country</th><th style={S.th}>Signed</th></tr></thead>
                <tbody>
                  {d.agreements.named.map((a, i) => (
                    <tr key={i}>
                      <td style={{ ...S.td, fontWeight: 600, color: "#0f172a" }}>{a.company}</td>
                      <td style={S.td}>{RELATIONSHIP_LABEL[a.relationshipType] ?? a.relationshipType}</td>
                      <td style={S.td}>{a.country || "—"}</td>
                      <td style={S.td}>{a.signedAt ? new Date(a.signedAt).toLocaleDateString() : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <p style={{ ...S.p, color: "#94a3b8", fontSize: "12px" }}>
            Counterparties are named only where they have agreed to be identified; the remainder are counted
            anonymously because each letter of intent binds both parties to confidentiality.
          </p>
        </>
      )}

      {d.byPair.length > 0 && (
        <>
          <h2 style={S.h2}>By currency pair</h2>
          <table style={S.table}>
            <thead><tr><th style={S.th}>Pair</th><th style={S.th}>Pools</th><th style={S.th}>Liquidity</th><th style={S.th}>Notional</th><th style={S.th}>Premiums</th><th style={S.th}>Hedgers</th></tr></thead>
            <tbody>
              {d.byPair.map(p => (
                <tr key={p.pair}>
                  <td style={{ ...S.td, fontWeight: 600, color: "#0f172a" }}>{p.pair}</td>
                  <td style={S.td}>{p.pools}</td>
                  <td style={S.td}>{usd(p.liquidity)}</td>
                  <td style={S.td}>{usd(p.notional)}</td>
                  <td style={S.td}>{usd(p.premiums)}</td>
                  <td style={S.td}>{p.hedgers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h2 style={S.h2}>
        Transaction history
        <span style={{ fontSize: "12px", fontWeight: 500, color: "#64748b", marginLeft: "8px" }}>
          {d.recentActivity.length} on-chain transaction{d.recentActivity.length === 1 ? "" : "s"}
        </span>
      </h2>

      {d.activityBackfill.running && (
        <p style={{ ...S.p, color: "#d97706" }}>
          Still reading historical logs from the chain — this list is incomplete
          and will fill in over the next few minutes. It only happens once.
        </p>
      )}

      {d.recentActivity.length === 0 ? (
        <p style={S.p}>
          {d.activityBackfill.running
            ? "Scanning the chain now…"
            : "No transactions indexed yet. The historical backfill runs shortly after the server starts."}
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={S.table}>
            <thead><tr>
              <th style={S.th}>When</th><th style={S.th}>Action</th><th style={S.th}>Pool</th>
              <th style={S.th}>Amount</th><th style={S.th}>Wallet</th><th style={S.th}>Block</th>
              <th style={S.th}>Chain</th><th style={S.th}>Proof</th>
            </tr></thead>
            <tbody>
              {d.recentActivity.map(a => {
                let extra = "";
                try {
                  const m = a.metadata ? JSON.parse(a.metadata) : null;
                  if (m?.premium) extra = `premium ${usd(m.premium)}`;
                } catch { /* metadata is best-effort decoration */ }
                return (
                  <tr key={`${a.chainId}-${a.txHash}-${a.actionType}`}>
                    <td style={S.td}>{a.createdAt ? new Date(a.createdAt).toLocaleDateString() : "—"}</td>
                    <td style={S.td}>
                      {ACTION_LABEL[a.actionType] || a.actionType}
                      {extra && <div style={{ fontSize: "11px", color: "#94a3b8" }}>{extra}</div>}
                    </td>
                    <td style={S.td}>{a.onChainEventId != null ? `#${a.onChainEventId}` : "—"}</td>
                    <td style={S.td}>{a.amount ? `${usd(a.amount)} ${a.token || ""}` : "—"}</td>
                    <td style={{ ...S.td, fontFamily: "monospace", fontSize: "12px" }}>{shortAddr(a.walletAddress)}</td>
                    <td style={{ ...S.td, fontFamily: "monospace", fontSize: "12px" }}>{a.blockNumber ?? "—"}</td>
                    <td style={S.td}>{a.chainName}</td>
                    <td style={S.td}>
                      {a.explorerUrl ? (
                        <a href={a.explorerUrl} target="_blank" rel="noopener noreferrer"
                           style={{ color: "#2563eb", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                          View <ExternalLink style={{ width: 11, height: 11 }} />
                        </a>
                      ) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ fontSize: "11px", color: "#94a3b8", marginTop: "14px", lineHeight: 1.6 }}>
        Pool, position and fee figures are read directly from the BlockFinaX Diamond
        on Base and BSC each time this page loads. Every transaction above links to
        its block-explorer record, so nothing here has to be taken on trust.
        {!detailed && (
          <> Payout and per-wallet breakdowns are unavailable for the currently
          deployed pools — the position getters are not exposed by the facet
          version on those events, so only pool-level aggregates are shown.</>
        )}
      </p>
    </div>
  );
}

/* ─── LETTERS OF INTENT ─── */

interface LoiFile { filename: string; originalName: string; url: string }
interface Loi {
  id: string; counterparty: string; country: string; sector: string;
  pair: string; monthlyVolume: string; status: string; date: string;
  notes: string; files?: LoiFile[];
}

const LOI_D: { intro: string; items: Loi[] } = {
  intro:
    "Signed and in-progress letters of intent from businesses that have committed to hedging volume through BlockFinaX. Figures are counterparty-stated monthly FX exposure, not realised volume.",
  items: [],
};

const LOI_STATUS = ["Signed", "Verbal", "In discussion", "Lapsed"];

function LettersOfIntentDoc({ token }: { token: string }) {
  const { data, draft, editing, saving, editUnlocked, startEdit, cancelEdit, save, setField, requestEdit } =
    useEditableDoc("letters-of-intent", token, LOI_D);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  const items = (editing ? draft.items : data.items) || [];
  const setItems = (next: Loi[]) => setField("items", next);
  const patch = (id: string, k: keyof Loi, v: unknown) =>
    setItems(items.map(i => (i.id === id ? { ...i, [k]: v } : i)));

  const addRow = () =>
    setItems([...items, {
      id: `loi_${Date.now()}`, counterparty: "", country: "", sector: "",
      pair: "", monthlyVolume: "", status: "In discussion", date: "", notes: "", files: [],
    }]);

  const upload = async (id: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true);
    try {
      const done: LoiFile[] = [];
      for (const file of files) {
        const fd = new FormData();
        fd.append("file", file);
        const r = await fetch("/api/investor/upload", { method: "POST", headers: { "x-investor-token": token }, body: fd });
        if (!r.ok) throw new Error((await r.json()).error || "Upload failed");
        done.push(await r.json());
      }
      patch(id, "files", [...(items.find(i => i.id === id)?.files || []), ...done]);
      toast({ title: `${done.length} file${done.length > 1 ? "s" : ""} attached` });
    } catch (e2: unknown) {
      toast({ title: "Upload failed", description: e2 instanceof Error ? e2.message : "", variant: "destructive" });
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const signed = data.items?.filter(i => i.status === "Signed").length || 0;
  const stated = (data.items || []).reduce((s, i) => s + (parseFloat(String(i.monthlyVolume).replace(/[^0-9.]/g, "")) || 0), 0);

  return (
    <div>
      <DocEditBar editUnlocked={editUnlocked} editing={editing} saving={saving}
        onEdit={() => (editUnlocked ? startEdit() : requestEdit(startEdit))}
        onSave={save} onCancel={cancelEdit} />

      {editing
        ? <TxtF label="intro" value={draft.intro} onChange={v => setField("intro", v)} rows={3} />
        : <p style={S.p}>{data.intro}</p>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "10px", marginBottom: "8px" }}>
        <div style={S.stat}><div style={S.statVal}>{data.items?.length || 0}</div><div style={S.statLbl}>Letters of intent</div></div>
        <div style={S.stat}><div style={S.statVal}>{signed}</div><div style={S.statLbl}>Signed</div></div>
        <div style={S.stat}><div style={S.statVal}>{usd(stated)}</div><div style={S.statLbl}>Stated monthly exposure</div></div>
      </div>

      {items.length === 0 && !editing && (
        <p style={{ ...S.p, color: "#94a3b8" }}>No letters of intent recorded yet. Unlock editing to add the first one.</p>
      )}

      {items.map(i => (
        <div key={i.id} style={{ border: "1px solid #e2e8f0", borderRadius: "10px", padding: "14px", marginBottom: "10px", background: "white" }}>
          {editing ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "8px", marginBottom: "8px" }}>
                {(["counterparty", "country", "sector", "pair", "monthlyVolume", "date"] as Array<keyof Loi>).map(k => (
                  <div key={String(k)}>
                    <label style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", display: "block", marginBottom: "3px", textTransform: "capitalize" as const }}>
                      {String(k).replace(/([A-Z])/g, " $1")}
                    </label>
                    <input value={String(i[k] ?? "")} onChange={e => patch(i.id, k, e.target.value)} style={EI} />
                  </div>
                ))}
                <div>
                  <label style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", display: "block", marginBottom: "3px" }}>Status</label>
                  <select value={i.status} onChange={e => patch(i.id, "status", e.target.value)} style={EI}>
                    {LOI_STATUS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <TxtF label="notes" value={i.notes} onChange={v => patch(i.id, "notes", v)} rows={2} />
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <label style={{ fontSize: "12px", color: "#2563eb", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "5px" }}>
                  <Paperclip style={{ width: 12, height: 12 }} />
                  {uploading ? "Uploading…" : "Attach signed PDF"}
                  <input type="file" multiple onChange={e => upload(i.id, e)} style={{ display: "none" }} />
                </label>
                <button onClick={() => setItems(items.filter(x => x.id !== i.id))}
                  style={{ fontSize: "12px", color: "#dc2626", background: "none", border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                  <Trash2 style={{ width: 12, height: 12 }} /> Remove
                </button>
              </div>
            </>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "6px" }}>
                <strong style={{ fontSize: "14px", color: "#0f172a" }}>{i.counterparty || "Unnamed counterparty"}</strong>
                <span style={S.tag(i.status === "Signed" ? "green" : i.status === "Lapsed" ? "red" : "amber")}>{i.status}</span>
                {i.date && <span style={{ fontSize: "11px", color: "#94a3b8" }}>{i.date}</span>}
              </div>
              <div style={{ fontSize: "12px", color: "#64748b", marginBottom: i.notes ? "6px" : 0 }}>
                {[i.country, i.sector, i.pair, i.monthlyVolume && `${i.monthlyVolume}/mo`].filter(Boolean).join(" · ")}
              </div>
              {i.notes && <p style={{ ...S.p, marginBottom: 0 }}>{i.notes}</p>}
            </>
          )}

          {(i.files || []).length > 0 && (
            <div style={{ marginTop: "8px", display: "flex", flexWrap: "wrap", gap: "8px" }}>
              {(i.files || []).map(f => (
                <a key={f.filename} href={f.url} target="_blank" rel="noopener noreferrer"
                   style={{ fontSize: "12px", color: "#2563eb", display: "inline-flex", alignItems: "center", gap: "4px", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "3px 8px" }}>
                  <Paperclip style={{ width: 11, height: 11 }} /> {f.originalName}
                </a>
              ))}
            </div>
          )}
        </div>
      ))}

      {editing && (
        <button onClick={addRow}
          style={{ fontSize: "12px", padding: "6px 14px", borderRadius: "6px", border: "1px dashed #cbd5e1", background: "white", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "5px" }}>
          <Plus style={{ width: 12, height: 12 }} /> Add letter of intent
        </button>
      )}
    </div>
  );
}

/* ─── MODAL CONTENT ROUTER ─── */
function DocContent({ docId, token }: { docId: string; token: string }) {
  const meta: Record<string, { title: string; subtitle: string }> = {
    "exec-summary": { title: "Executive Summary", subtitle: "Company overview, problem, solution, and the ask" },
    "live-traction": { title: "Live Protocol Monitor", subtitle: "Revenue, volume and transactions read from Base and BSC in real time" },
    "letters-of-intent": { title: "Letters of Intent", subtitle: "Counterparty commitments, stated exposure, and signed documents" },
    "revenue-breakdown": { title: "Revenue Breakdown", subtitle: "Fee structure, projections, and unit economics" },
    "cost-breakdown":    { title: "Cost Breakdown",    subtitle: "Annual COGS & OpEx by category with efficiency metrics" },
    "oracle-strategy": { title: "Oracle Strategy", subtitle: "Architecture, limitations, and decentralisation roadmap" },
    "security-audit": { title: "Security Audit", subtitle: "April 2026 Diamond audit — findings, status and remediation" },
    "demo-video": { title: "Product Demo Video", subtitle: "Video walkthrough of the Wallet and Hedge products" },
    "market-opportunity": { title: "Market Opportunity", subtitle: "Published context and illustrative scenarios; not validated company market sizing" },
    "competitive-landscape": { title: "Competitive Landscape", subtitle: "Side-by-side comparison across key dimensions" },
    "gtm-strategy": { title: "Go-to-Market Strategy", subtitle: "4-phase GTM, partnerships, and flywheel" },
    "governance":            { title: "Governance & Protocol Control", subtitle: "Upgrade authority, operational controls, and what changes before third-party capital" },
    "incorporation":         { title: "Incorporation",         subtitle: "Entity records and ownership require current evidence" },
    "agreements":            { title: "Agreements",            subtitle: "NDAs, service contracts, IP ownership, and investor docs" },
    "compliance-proposals":  { title: "Compliance Proposals",  subtitle: "Consultant proposals — admin editable" },
    "bog-sandbox": { title: "Bank of Ghana Sandbox", subtitle: "Application status, compliance framework, and timeline" },
    "cap-table":  { title: "Cap Table",  subtitle: "Founder equity, option pool, and investor allocations" },
    "team-info":  { title: "Team",       subtitle: "Founding team, advisors, and open roles" },
  };

  const m = meta[docId];
  if (!m) return null;

  return (
    <div>
      <div style={{ marginBottom: "20px" }}>
        <h1 style={S.h1}>{m.title}</h1>
        <p style={{ fontSize: "13px", color: "#64748b" }}>{m.subtitle}</p>
      </div>
      {docId === "exec-summary"           && <ExecSummary token={token} />}
      {docId === "live-traction"          && <LiveTractionDoc token={token} />}
      {docId === "letters-of-intent"      && <LettersOfIntentDoc token={token} />}
      {docId === "revenue-breakdown" && <RevenueBreakdown />}
      {docId === "cost-breakdown"    && <CostBreakdownDoc />}
      {docId === "oracle-strategy"        && <OracleStrategyDoc token={token} />}
      {docId === "security-audit"         && <SecurityAuditDoc token={token} />}
      {docId === "demo-video"             && <DemoVideoDoc token={token} />}
      {docId === "market-opportunity"     && <MarketOpportunityDoc token={token} />}
      {docId === "competitive-landscape"  && <CompetitiveLandscapeDoc token={token} />}
      {docId === "gtm-strategy"           && <GTMStrategyDoc token={token} />}
      {docId === "governance"             && <GovernanceDoc token={token} />}
      {docId === "incorporation"          && <IncorporationDoc token={token} />}
      {docId === "agreements"             && <AgreementsDoc token={token} />}
      {docId === "compliance-proposals"   && <ComplianceProposalsDoc token={token} />}
      {docId === "bog-sandbox"            && <BoGSandboxDoc token={token} />}
      {docId === "cap-table"              && <CapTableDoc token={token} />}
      {docId === "team-info"              && <TeamInfoDoc token={token} />}
      {docId !== "revenue-breakdown" && docId !== "cost-breakdown" && (
        <AdminNotesSection docId={docId} token={token} />
      )}
    </div>
  );
}

/* ─── PASSWORD GATE ─── */
function PasswordGate({ onSuccess }: { onSuccess: (token: string, editEnabled: boolean) => void }) {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/investor/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const data = await res.json();
      if (!res.ok) { setError(data.message || "Invalid access code"); return; }
      localStorage.setItem(SESSION_KEY, data.token);
      onSuccess(data.token, !!data.editEnabled);
      toast({ title: "Access granted", description: "Welcome to the BlockFinaX Investor Data Room." });
    } catch { setError("Connection error. Please try again."); }
    finally { setLoading(false); }
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
            <p style={{ fontSize: "14px", color: "#94a3b8", lineHeight: 1.6 }}>Confidential — restricted to authorised investors and advisors. Enter your access code to continue.</p>
          </div>
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <Input type="password" placeholder="Enter access code" value={password} onChange={e => { setPassword(e.target.value); setError(""); }}
              className="bg-white/[0.06] border-white/10 text-white placeholder:text-slate-500 h-12 text-center tracking-widest" autoFocus />
            {error && <p style={{ color: "#f87171", fontSize: "14px", textAlign: "center" }}>{error}</p>}
            <Button type="submit" disabled={loading || !password.trim()} style={{ height: "48px", background: "#2563eb", color: "white", fontWeight: 600, border: "none", borderRadius: "8px", cursor: "pointer" }}>
              {loading ? "Verifying…" : "Access Data Room"}
            </Button>
          </form>
          <p style={{ textAlign: "center", color: "#475569", fontSize: "13px", marginTop: "24px" }}>
            No access code? <a href="mailto:anthonykumako8@gmail.com?subject=BlockFinaX%20Data%20Room%20Access" style={{ color: "#3d8ef5" }}>Request access</a>
          </p>
        </div>
        <p style={{ textAlign: "center", color: "#334155", fontSize: "12px", marginTop: "16px" }}>BlockFinaX · Confidential · Not for public distribution</p>
      </motion.div>
    </div>
  );
}

/* ─── MAIN DATA ROOM CONTENT ─── */
function DataRoomContent({ token, onLogout, initialEditEnabled = false }: { token: string; onLogout: () => void; initialEditEnabled?: boolean }) {
  const [, navigate] = useLocation();
  const [activeCategory, setActiveCategory] = useState("overview");
  const [openDoc, setOpenDoc] = useState<string | null>(null);
  const { toast } = useToast();
  const isMobile = useIsMobile();

  /* edit-auth state */
  const [editUnlocked, setEditUnlocked] = useState(initialEditEnabled);
  const [showEditModal, setShowEditModal] = useState(false);
  const pendingEditCb = useRef<(() => void) | null>(null);

  const requestEdit = useCallback((cb: () => void) => {
    if (editUnlocked) { cb(); return; }
    pendingEditCb.current = cb;
    setShowEditModal(true);
  }, [editUnlocked]);

  const handleEditSuccess = () => {
    setEditUnlocked(true);
    setShowEditModal(false);
    pendingEditCb.current?.();
    pendingEditCb.current = null;
    toast({ title: "Edit mode unlocked", description: "You can now edit content for this session." });
  };

  const handleLogout = useCallback(async () => {
    await fetch("/api/investor/logout", { method: "POST", headers: { "x-investor-token": token } });
    localStorage.removeItem(SESSION_KEY);
    onLogout();
  }, [token, onLogout]);

  const handleOpen = (doc: typeof CATEGORIES[0]["documents"][0]) => {
    if (doc.type === "external" || (doc.href && doc.href.startsWith("mailto:"))) { window.open(doc.href!, "_blank"); return; }
    if (doc.type === "navigate" && doc.href) { navigate(doc.href); return; }
    if (doc.type === "modal") { setOpenDoc(doc.id); }
  };

  const active = CATEGORIES.find(c => c.id === activeCategory)!;

  return (
    <EditAuthContext.Provider value={{ editUnlocked, requestEdit }}>
    <div style={{ minHeight: "100vh", background: "#f8fafc" }}>
      {showEditModal && <EditPasswordModal token={token} onSuccess={handleEditSuccess} onClose={() => { setShowEditModal(false); pendingEditCb.current = null; }} />}

      {/* Header */}
      <div style={{ background: "white", borderBottom: "1px solid #e2e8f0", position: "sticky", top: 0, zIndex: 40 }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: isMobile ? "12px 16px" : "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: isMobile ? "14px" : "16px", fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>BlockFinaX · Investor Data Room</h1>
            {!isMobile && <p style={{ fontSize: "12px", color: "#94a3b8" }}>Confidential — authorised access only</p>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
            {!isMobile && (
              <span style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "12px", color: "#16a34a", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "999px", padding: "4px 10px" }}>
                <ShieldCheck style={{ width: "12px", height: "12px" }} /> Secure session
              </span>
            )}
            {!isMobile && (
              <span style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "12px", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "999px", padding: "4px 10px" }}>
                <Clock style={{ width: "12px", height: "12px" }} /> 24h session
              </span>
            )}
            <AnimatePresence>
              {editUnlocked && (
                <motion.span initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }}
                  style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "12px", color: "#92400e", background: "#fef3c7", border: "1px solid #fde68a", borderRadius: "999px", padding: "4px 10px", fontWeight: 600 }}>
                  <Edit3 style={{ width: "11px", height: "11px" }} /> Edit
                </motion.span>
              )}
            </AnimatePresence>
            {token && <Button variant="outline" size="sm" onClick={handleLogout} style={{ color: "#64748b", fontSize: "13px" }}>
              <LogOut style={{ width: "13px", height: "13px", marginRight: isMobile ? "0" : "5px" }} />
              {!isMobile && "Sign out"}
            </Button>}
          </div>
        </div>
      </div>

      {/* Mobile category tabs */}
      {isMobile && (
        <div style={{ background: "white", borderBottom: "1px solid #e2e8f0", overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <div style={{ display: "flex", gap: "4px", padding: "10px 16px", minWidth: "max-content" }}>
            {CATEGORIES.map(cat => (
              <button key={cat.id} onClick={() => { setActiveCategory(cat.id); setOpenDoc(null); }}
                style={{ display: "flex", alignItems: "center", gap: "6px", padding: "7px 12px", borderRadius: "8px", fontSize: "12px", fontWeight: 500, border: "none", cursor: "pointer", whiteSpace: "nowrap", background: activeCategory === cat.id && !openDoc ? "#eff6ff" : "#f8fafc", color: activeCategory === cat.id && !openDoc ? "#1d4ed8" : "#475569", outline: activeCategory === cat.id && !openDoc ? "1px solid #bfdbfe" : "1px solid #e2e8f0" }}>
                <cat.icon style={{ width: "13px", height: "13px", flexShrink: 0 }} />
                {cat.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: isMobile ? "16px" : "32px 24px", display: "flex", gap: "28px" }}>
        {/* Sidebar — desktop only */}
        {!isMobile && (
        <aside style={{ width: "210px", flexShrink: 0 }}>
          <p style={{ fontSize: "11px", fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px", paddingLeft: "8px" }}>Categories</p>
          <nav style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
            {CATEGORIES.map(cat => (
              <button key={cat.id} onClick={() => { setActiveCategory(cat.id); setOpenDoc(null); }}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: "9px", padding: "9px 10px", borderRadius: "8px", fontSize: "13px", fontWeight: 500, border: "none", cursor: "pointer", textAlign: "left", background: activeCategory === cat.id && !openDoc ? "#eff6ff" : "transparent", color: activeCategory === cat.id && !openDoc ? "#1d4ed8" : "#475569", outline: activeCategory === cat.id && !openDoc ? "1px solid #bfdbfe" : "none" }}>
                <cat.icon style={{ width: "15px", height: "15px", flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{cat.label}</span>
                <span style={{ fontSize: "10px", borderRadius: "999px", padding: "1px 5px", fontWeight: 600, background: "#f1f5f9", color: "#94a3b8" }}>{cat.documents.length}</span>
              </button>
            ))}
          </nav>
          <div style={{ marginTop: "28px", padding: "14px", background: "#f1f5f9", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
            <p style={{ fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "3px" }}>Need something else?</p>
            <p style={{ fontSize: "12px", color: "#64748b", marginBottom: "10px" }}>Request documents or schedule a call.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
              <a href="mailto:anthonykumako8@gmail.com?subject=BlockFinaX%20Investor%20Request" style={{ fontSize: "12px", color: "#2563eb", fontWeight: 600, display: "flex", alignItems: "center", gap: "5px", textDecoration: "none", padding: "7px 10px", background: "white", border: "1px solid #dbeafe", borderRadius: "7px" }}>
                <ExternalLink style={{ width: "11px", height: "11px", flexShrink: 0 }} /> Send an email
              </a>
              <a href="https://calendly.com/anthonykumako8/30min" target="_blank" rel="noopener noreferrer" style={{ fontSize: "12px", color: "#fff", fontWeight: 600, display: "flex", alignItems: "center", gap: "5px", textDecoration: "none", padding: "7px 10px", background: "#2563eb", border: "1px solid #2563eb", borderRadius: "7px" }}>
                <Calendar style={{ width: "11px", height: "11px", flexShrink: 0 }} /> Book a call
              </a>
            </div>
          </div>
        </aside>
        )}

        {/* Main */}
        <main style={{ flex: 1, minWidth: 0 }}>
          {openDoc ? (
            <div>
              {/* Back button */}
              <button onClick={() => setOpenDoc(null)}
                style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "#2563eb", background: "none", border: "none", cursor: "pointer", padding: "6px 0", marginBottom: "20px", fontWeight: 500 }}>
                <ArrowLeft style={{ width: "15px", height: "15px" }} /> Back to {active.label}
              </button>
              <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: "14px", padding: "28px 32px" }}>
                <DocContent docId={openDoc} token={token} />
              </div>
            </div>
          ) : (
            <div>
              {/* Category header */}
              <div style={{ borderRadius: "10px", border: "1px solid", padding: "16px 20px", marginBottom: "20px" }} className={active.color}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <active.icon style={{ width: "20px", height: "20px" }} className={active.iconColor} />
                  <div>
                    <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>{active.label}</h2>
                    <p style={{ fontSize: "12px", color: "#64748b" }}>{active.documents.length} document{active.documents.length !== 1 ? "s" : ""}</p>
                  </div>
                </div>
              </div>

              {/* Document cards */}
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {active.documents.map((doc, idx) => (
                  <motion.div key={doc.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.04 }}
                    onClick={() => handleOpen(doc)}
                    style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: "12px", padding: "18px", display: "flex", alignItems: "flex-start", gap: "14px", cursor: "pointer", transition: "box-shadow 0.15s" }}
                    whileHover={{ scale: 1.003, boxShadow: "0 4px 14px rgba(0,0,0,0.06)" }}>
                    <div style={{ width: "38px", height: "38px", borderRadius: "8px", background: "#f8fafc", border: "1px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <doc.icon style={{ width: "17px", height: "17px", color: "#64748b" }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "3px" }}>
                        <h3 style={{ fontSize: "14px", fontWeight: 600, color: "#0f172a" }}>{doc.title}</h3>
                        <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 7px", borderRadius: "999px" }} className={doc.badgeColor}>{doc.badge}</span>
                      </div>
                      <p style={{ fontSize: "13px", color: "#64748b", lineHeight: 1.5 }}>{doc.description}</p>
                    </div>
                    <div style={{ flexShrink: 0, marginTop: "2px" }}>
                      {doc.type === "external" || doc.type === "navigate" ? <ExternalLink style={{ width: "15px", height: "15px", color: "#cbd5e1" }} />
                        : <Eye style={{ width: "15px", height: "15px", color: "#cbd5e1" }} />}
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>

      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "20px 24px", borderTop: "1px solid #f1f5f9", textAlign: "center" }}>
        <p style={{ fontSize: "12px", color: "#94a3b8" }}>
          BlockFinaX Investor Data Room · Confidential · Not for public distribution ·{" "}
          <a href="mailto:anthonykumako8@gmail.com" style={{ color: "#3b82f6" }}>anthonykumako8@gmail.com</a>
        </p>
      </div>
    </div>
    </EditAuthContext.Provider>
  );
}

/* ─── ROOT EXPORT ─── */
export default function DataRoom() {
  const [token, setToken] = useState("");
  const [initialEditEnabled, setInitialEditEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const stored = localStorage.getItem(SESSION_KEY);
    if (!stored) return;
    fetch("/api/investor/verify", { headers: { "x-investor-token": stored } })
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        if (d.valid) { setToken(stored); setInitialEditEnabled(!!d.editEnabled); }
        else localStorage.removeItem(SESSION_KEY);
      })
      .catch(() => {}) ;
    return () => { cancelled = true; };
  }, []);
  return <DataRoomContent token={token} initialEditEnabled={initialEditEnabled}
    onLogout={() => { setToken(""); setInitialEditEnabled(false); }} />;
}
