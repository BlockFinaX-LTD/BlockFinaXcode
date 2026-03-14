import { useState, useEffect, useCallback, createContext, useContext, useRef } from "react";
import { DEFAULT_ANNUALS, fmtUSD } from "@/lib/financial-model-data";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Lock, LogOut, ExternalLink, FileText, BarChart2, Globe,
  PlayCircle, Beaker, ShieldCheck, BookOpen, ChevronRight,
  Eye, Clock, Building2, ArrowLeft, Pencil, Check, X, Video, Edit3, Calendar,
  Users, PieChart
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

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
  if (!editUnlocked) return null;
  const b: React.CSSProperties = { fontSize: "12px", padding: "5px 14px", borderRadius: "6px", cursor: "pointer" };
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "12px", gap: "8px" }}>
      {editing ? (
        <>
          <button onClick={onCancel} style={{ ...b, border: "1px solid #e2e8f0", background: "white" }}>Cancel</button>
          <button onClick={onSave} disabled={saving} style={{ ...b, border: "none", background: "#2563eb", color: "white", fontWeight: 600 }}>{saving ? "Saving…" : "Save"}</button>
        </>
      ) : (
        <button onClick={onEdit} style={{ ...b, display: "flex", alignItems: "center", gap: "5px", border: "1px solid #e2e8f0", background: "white" }}>
          <Edit3 style={{ width: "12px", height: "12px" }} /> Edit
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
      { id: "whitepaper", title: "Whitepaper", description: "Technical deep-dive: Diamond Standard, HedgeFacet, USDC flows, settlement logic", href: "/whitepaper", type: "navigate" as const, badge: "Technical", badgeColor: "bg-purple-100 text-purple-700", icon: BookOpen },
      { id: "oracle-strategy", title: "Oracle Strategy", description: "Current oracle architecture, known limitations, and 4-phase decentralization roadmap", href: null, type: "modal" as const, badge: "Document", badgeColor: "bg-slate-100 text-slate-600", icon: Globe },
      { id: "security-audit", title: "Security Audit", description: "Pre-audit scan results (70.94/100), findings, fixes applied, and pre-mainnet checklist", href: null, type: "modal" as const, badge: "Document", badgeColor: "bg-slate-100 text-slate-600", icon: ShieldCheck },
    ],
  },
  {
    id: "demo", label: "Demo & Product", icon: PlayCircle,
    color: "border-amber-200 bg-amber-50", iconColor: "text-amber-600",
    documents: [
      { id: "demo-video", title: "Product Demo Video", description: "Walkthrough of the Wallet and Hedge products on testnet — add your video link", href: null, type: "modal" as const, badge: "Video", badgeColor: "bg-amber-100 text-amber-700", icon: Video },
      { id: "live-app", title: "Live Testnet App", description: "Fully functional deployment on Lisk Sepolia — create a wallet and explore hedge markets live", href: "/home", type: "navigate" as const, badge: "Live", badgeColor: "bg-emerald-100 text-emerald-700", icon: Beaker },
    ],
  },
  {
    id: "market", label: "Market Research", icon: Globe,
    color: "border-rose-200 bg-rose-50", iconColor: "text-rose-600",
    documents: [
      { id: "market-opportunity", title: "Market Opportunity", description: "TAM/SAM/SOM: $210B African cross-border trade, $35B annual SME FX losses", href: null, type: "modal" as const, badge: "Document", badgeColor: "bg-slate-100 text-slate-600", icon: Globe },
      { id: "competitive-landscape", title: "Competitive Landscape", description: "Side-by-side comparison vs banks, OTC brokers, DeFi protocols, and prediction markets", href: null, type: "modal" as const, badge: "Document", badgeColor: "bg-slate-100 text-slate-600", icon: BarChart2 },
      { id: "gtm-strategy", title: "Go-to-Market Strategy", description: "4-phase GTM: community beta → SME direct → channel partners → flywheel growth", href: null, type: "modal" as const, badge: "Document", badgeColor: "bg-slate-100 text-slate-600", icon: ChevronRight },
    ],
  },
  {
    id: "legal", label: "Legal & Compliance", icon: FileText,
    color: "border-slate-200 bg-slate-50", iconColor: "text-slate-600",
    documents: [
      { id: "incorporation", title: "Incorporation", description: "Ghana incorporation (active) · Delaware C-Corp in progress — dual-entity structure for US investors", href: null, type: "modal" as const, badge: "Active", badgeColor: "bg-emerald-100 text-emerald-700", icon: Building2 },
      { id: "agreements", title: "Agreements", description: "NDA templates, service agreements, consulting contracts, and investor term sheet status", href: null, type: "modal" as const, badge: "Document", badgeColor: "bg-slate-100 text-slate-600", icon: FileText },
      { id: "compliance-proposals", title: "Compliance Proposals", description: "Proposals and recommendations from legal and compliance consultants — admin editable", href: null, type: "modal" as const, badge: "Internal", badgeColor: "bg-purple-100 text-purple-700", icon: BookOpen },
      { id: "bog-sandbox", title: "Bank of Ghana Sandbox", description: "Regulatory sandbox application status, compliance framework, and market entry roadmap", href: null, type: "modal" as const, badge: "In Progress", badgeColor: "bg-orange-100 text-orange-700", icon: ShieldCheck },
      { id: "token-legal", title: "Token Legal Opinion", description: "USDC-only model — no native token, no securities classification risk", href: null, type: "coming-soon" as const, badge: "Coming Soon", badgeColor: "bg-slate-100 text-slate-400", icon: FileText },
      { id: "book-call", title: "Book a Discovery Call", description: "Schedule a 30-minute call with the founder — ask anything, explore the opportunity", href: "https://calendly.com/anthonykumako8/30min", type: "external" as const, badge: "Calendly", badgeColor: "bg-blue-100 text-blue-700", icon: Calendar },
      { id: "nda-request", title: "Request NDA / Term Sheet", description: "Contact us to request a non-disclosure agreement or investment term sheet", href: "mailto:anthonykumako8@gmail.com?subject=BlockFinaX%20NDA%20Request", type: "external" as const, badge: "Email", badgeColor: "bg-slate-100 text-slate-600", icon: ExternalLink },
    ],
  },
  {
    id: "company", label: "Company", icon: Users,
    color: "border-indigo-200 bg-indigo-50", iconColor: "text-indigo-600",
    documents: [
      { id: "cap-table", title: "Cap Table", description: "Founder equity, option pool, investor allocations, and post-money ownership structure", href: null, type: "modal" as const, badge: "Confidential", badgeColor: "bg-indigo-100 text-indigo-700", icon: PieChart },
      { id: "team-info", title: "Team", description: "Founding team, advisors, and key hires — backgrounds, roles, and LinkedIn profiles", href: null, type: "modal" as const, badge: "Document", badgeColor: "bg-slate-100 text-slate-600", icon: Users },
    ],
  },
];

/* ─── CONTENT COMPONENTS ─── */

const EXEC_D = {
  intro: "BlockFinaX is a blockchain-native P2P parametric protection platform designed for African SMEs, traders, and cross-border businesses. Built on the EIP-2535 Diamond Standard on Lisk L2, it offers fully collateralised downside protection, stop-loss rebates, and volatility buffers across 63 asset pairs — covering 40+ African FX pairs, commodities, and major crypto assets.",
  problem: "African SMEs conducting cross-border trade are structurally exposed to FX volatility, with swings of 8–25% common on pairs like GHS/USD, NGN/USD, and KES/USD. No accessible, transparent hedging product exists for sub-$1M trade flows. Banks ignore them. OTC brokers are opaque and expensive. DeFi protocols don't cover African pairs.",
  solution_hedge: "BlockFinaX Hedge — P2P one-touch parametric contracts. Hedgers buy downside protection against a specific FX strike level. LPs provide liquidity and earn premiums. No counterparty risk: payouts are reserved on-chain the moment a hedge is purchased. Settlement is automatic — triggered when the price touches the strike, or at expiry.",
  solution_wallet: "BlockFinaX Wallet — Non-custodial USDC wallet with AES-256 encrypted key storage, gasless transactions, and real-time cross-border transfers at 0.3% (min $0.50).",
  traction: "Live on Lisk Sepolia testnet. Smart contracts verified on Blockscout. FX oracle running — polling ExchangeRate-API, Yahoo Finance, and CoinGecko every 5 minutes, automatically settling expired hedge events. Bank of Ghana regulatory sandbox application filed Q1 2026.",
  technology: "Diamond Standard (EIP-2535) for upgradeable contract architecture. HedgeFacet encapsulates all P2P hedge logic. USDC as the sole settlement token. Lisk L2 for near-zero gas fees, enabling micro-hedges starting from $10.",
  mainnet: "July 7, 2026 — Mainnet launch on Lisk L2, following third-party security audit and Bank of Ghana sandbox approval.",
  ask: [
    { round: "Pre-Seed", amount: "$500K", timing: "Now (H1 2026)", use: "Engineering, audit, regulatory sandbox", color: "blue" },
    { round: "Seed",     amount: "$1.5M", timing: "Jan 2027",       use: "6 months live traction, bridge to Series A, early market validation", color: "blue" },
    { round: "Series A", amount: "$8M",   timing: "Jan 2028",       use: "Multi-country expansion, BD, institutional LP onboarding, near break-even", color: "green" },
    { round: "Series B", amount: "$20M",  timing: "Jul 2029",       use: "Deep market scale, Kenya/Nigeria enterprise integrations, liquidity depth", color: "amber" },
  ],
};

function ExecSummary({ token }: { token: string }) {
  const { data, draft, editing, saving, editUnlocked, startEdit, cancelEdit, save, setField, requestEdit } = useEditableDoc("exec-summary", token, EXEC_D);
  const setAsk = (i: number, k: string, v: string) => setField("ask", draft.ask.map((r, j) => j === i ? { ...r, [k]: v } : r));

  if (editing) return (
    <div>
      <DocEditBar editUnlocked saving={saving} editing onEdit={() => {}} onSave={save} onCancel={cancelEdit} />
      {(["intro","problem","solution_hedge","solution_wallet","traction","technology","mainnet"] as const).map(k => (
        <TxtF key={k} label={k} value={draft[k]} onChange={v => setField(k, v)} />
      ))}
      <h2 style={S.h2}>The Ask</h2>
      <table style={S.table}>
        <thead><tr><th style={S.th}>Round</th><th style={S.th}>Amount</th><th style={S.th}>Timing</th><th style={S.th}>Use of Funds</th></tr></thead>
        <tbody>{draft.ask.map((r, i) => (
          <tr key={i}>{(["round","amount","timing","use"] as const).map(f => (
            <td key={f} style={S.td}><input value={r[f]} onChange={e => setAsk(i, f, e.target.value)} style={EI} /></td>
          ))}</tr>
        ))}</tbody>
      </table>
    </div>
  );

  return (
    <div>
      <DocEditBar editUnlocked={editUnlocked} editing={false} saving={false} onEdit={() => requestEdit(startEdit)} onSave={save} onCancel={cancelEdit} />
      <p style={S.p}>{data.intro}</p>
      <h2 style={S.h2}>The Problem</h2>
      <p style={S.p}>{data.problem}</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "12px", margin: "16px 0" }}>
        <div style={S.stat}><div style={S.statVal}>$210B</div><div style={S.statLbl}>TAM — African cross-border trade (2024)</div></div>
        <div style={S.stat}><div style={S.statVal}>$35B</div><div style={S.statLbl}>SAM — Annual FX losses for SMEs</div></div>
        <div style={{ ...S.stat, borderColor: "#86efac" }}><div style={{ ...S.statVal, color: "#16a34a" }}>{fmtUSD(DEFAULT_ANNUALS[1].notionalHedged)}</div><div style={S.statLbl}>SOM Year 1 — {((DEFAULT_ANNUALS[1].notionalHedged / 35_000_000_000) * 100).toFixed(1)}% of SAM (2027)</div></div>
        <div style={S.stat}><div style={S.statVal}>63</div><div style={S.statLbl}>Asset pairs at launch</div></div>
      </div>
      <h2 style={S.h2}>The Solution</h2>
      <p style={S.p}>{data.solution_hedge}</p>
      <p style={S.p}>{data.solution_wallet}</p>
      <h2 style={S.h2}>Traction</h2>
      <p style={S.p}>{data.traction}</p>
      <h2 style={S.h2}>Technology</h2>
      <p style={S.p}>{data.technology}</p>
      <p style={{ fontSize: "13px", color: "#64748b", fontFamily: "monospace", background: "#f8fafc", padding: "8px 12px", borderRadius: "6px" }}>Diamond: 0x3582D8f5f88ef557ce10Af26834FAC8B8e1445bf · HedgeFacet: 0x1B2aca3f871e9AF5D88C28862375601a2552bBb2</p>
      <h2 style={S.h2}>The Ask</h2>
      <table style={S.table}>
        <thead><tr><th style={S.th}>Round</th><th style={S.th}>Amount</th><th style={S.th}>Timing</th><th style={S.th}>Use of Funds</th></tr></thead>
        <tbody>{data.ask.map(r => (
          <tr key={r.round}>
            <td style={S.td}><span style={S.tag(r.color)}>{r.round}</span></td>
            <td style={S.td}>{r.amount}</td><td style={S.td}>{r.timing}</td><td style={S.td}>{r.use}</td>
          </tr>
        ))}</tbody>
      </table>
      <div style={{ margin: "16px 0", padding: "16px", background: "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)", borderRadius: "10px", border: "1px solid #bfdbfe", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", flexWrap: "wrap" as const }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: "15px", color: "#1e3a8a", marginBottom: "4px" }}>Ready to explore the opportunity?</div>
          <div style={{ fontSize: "13px", color: "#3b82f6" }}>Schedule a 30-minute discovery call with the founder — no commitment required.</div>
        </div>
        <a href="https://calendly.com/anthonykumako8/30min" target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: "8px", background: "#2563eb", color: "#fff", fontWeight: 600, fontSize: "14px", padding: "10px 20px", borderRadius: "8px", textDecoration: "none", whiteSpace: "nowrap" as const, flexShrink: 0 }}>
          <Calendar style={{ width: "16px", height: "16px" }} /> Book a Call
        </a>
      </div>
      <h2 style={S.h2}>Mainnet Timeline</h2>
      <p style={S.p}>{data.mainnet}</p>
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
      <p style={S.p}>BlockFinaX generates revenue from two products: <strong>Hedge</strong> (P2P parametric contracts) and <strong>Wallet</strong> (USDC cross-border transfers). Both use a low-friction fee model designed for high volume.</p>

      <h2 style={S.h2}>Fee Structure</h2>
      <table style={S.table}>
        <thead><tr><th style={S.th}>Fee Type</th><th style={S.th}>Rate</th><th style={S.th}>Paid By</th><th style={S.th}>Trigger</th></tr></thead>
        <tbody>
          <tr><td style={S.td}>Hedger premium fee</td><td style={S.td}><strong>0.5%</strong></td><td style={S.td}>Hedger</td><td style={S.td}>At purchase, on position notional</td></tr>
          <tr><td style={S.td}>Payout / LP fee</td><td style={S.td}><strong>1.0%</strong></td><td style={S.td}>Winning party</td><td style={S.td}>At claim, on payout amount</td></tr>
          <tr><td style={S.td}>Creator loyalty fee</td><td style={S.td}><strong>5%</strong></td><td style={S.td}>Platform fee pool</td><td style={S.td}>At settlement, to event creator</td></tr>
          <tr><td style={S.td}>Wallet transfer fee</td><td style={S.td}><strong>0.3%</strong> (min $0.50)</td><td style={S.td}>Sender</td><td style={S.td}>Per USDC transfer</td></tr>
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
      <p style={S.p}>The platform is asset-light — BlockFinaX does not take principal risk. Hedges are fully collateralised by LPs. Revenue is purely fee-based. Gross margins reach <strong>{grossMargin30}%</strong> by 2030, as infrastructure costs (Lisk L2 gas, oracle, hosting) scale sub-linearly with volume.</p>
    </div>
  );
}

const ORACLE_D = {
  intro: "BlockFinaX operates as a P2P parametric protection platform covering 63 asset pairs across African FX, commodities, and crypto. At the core of every hedge settlement is a price oracle — the mechanism that determines whether a strike price has been touched and triggers payouts.",
  current_impl: "BlockFinaX uses a custodial push oracle model. The platform backend fetches prices from multiple external APIs on a 5-minute polling cycle and submits settlement prices directly to the Diamond smart contract when a strike condition is met.",
  phase1: "Dual-source averaging for FX (two ExchangeRate-API endpoints). Anomaly detection planned — reject rates deviating more than 5% from the median of all sources before submission.",
  phase2: "Replace single admin key with a 3-of-5 multisig oracle relay. Multiple independent signers must agree on a price before any settlement is submitted. Gnosis Safe as the signing infrastructure.",
  phase3: "Integrate Chainlink Data Feeds for crypto prices (already available). Advocate for Chainlink or Pyth coverage of major African FX pairs (GHS/USD, KES/USD, NGN/USD). Hybrid model: on-chain oracle for available pairs; signed off-chain feed for African FX.",
  phase4: "Open oracle participation to permissioned third-party data providers. Stake-weighted median aggregation. Dispute window before settlement is final. Moves BlockFinaX from \"trusted operator\" to \"verifiable protocol\".",
  limitations: [
    { risk: "Centralisation",           desc: "Single private key controls all settlements",           status: "Pre-mainnet fix", color: "amber" },
    { risk: "Single point of failure",  desc: "Backend outage halts all settlements",                  status: "Phase 2",         color: "amber" },
    { risk: "No on-chain provenance",   desc: "Price source is not verifiable on-chain",               status: "Phase 3",         color: "amber" },
    { risk: "5-minute latency",         desc: "Fast-moving markets may miss intraday touches",         status: "Accepted for now",color: "blue"  },
    { risk: "No decentralised alt",     desc: "Chainlink/Pyth don't support 40+ African FX pairs",     status: "Phase 4",         color: "blue"  },
  ],
};

function OracleStrategyDoc({ token }: { token: string }) {
  const { data, draft, editing, saving, editUnlocked, startEdit, cancelEdit, save, setField, requestEdit } = useEditableDoc("oracle-strategy", token, ORACLE_D);
  const setLim = (i: number, k: string, v: string) => setField("limitations", draft.limitations.map((r, j) => j === i ? { ...r, [k]: v } : r));

  if (editing) return (
    <div>
      <DocEditBar editUnlocked saving={saving} editing onEdit={() => {}} onSave={save} onCancel={cancelEdit} />
      {(["intro","current_impl","phase1","phase2","phase3","phase4"] as const).map(k => (
        <TxtF key={k} label={k} value={draft[k]} onChange={v => setField(k, v)} />
      ))}
      <h2 style={S.h2}>Known Limitations</h2>
      <table style={S.table}>
        <thead><tr><th style={S.th}>Risk</th><th style={S.th}>Description</th><th style={S.th}>Status</th></tr></thead>
        <tbody>{draft.limitations.map((r, i) => (
          <tr key={i}>
            <td style={S.td}><input value={r.risk} onChange={e => setLim(i, "risk", e.target.value)} style={EI} /></td>
            <td style={S.td}><input value={r.desc} onChange={e => setLim(i, "desc", e.target.value)} style={EI} /></td>
            <td style={S.td}><input value={r.status} onChange={e => setLim(i, "status", e.target.value)} style={EI} /></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );

  return (
    <div>
      <DocEditBar editUnlocked={editUnlocked} editing={false} saving={false} onEdit={() => requestEdit(startEdit)} onSave={save} onCancel={cancelEdit} />
      <p style={S.p}>{data.intro}</p>
      <h2 style={S.h2}>Current Implementation</h2>
      <p style={S.p}>{data.current_impl}</p>
      <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "14px 18px", margin: "12px 0" }}>
        <p style={{ ...S.p, marginBottom: "6px" }}><strong>Data Sources:</strong></p>
        <ul style={{ fontSize: "13px", color: "#475569", paddingLeft: "18px", lineHeight: 1.8 }}>
          <li><strong>FX Rates:</strong> ExchangeRate-API (two endpoints, equal-weight averaged)</li>
          <li><strong>Commodities:</strong> Yahoo Finance (metals, energy, agriculture)</li>
          <li><strong>Crypto:</strong> CoinGecko (BTC, ETH, BNB, SOL, XRP, ADA)</li>
        </ul>
      </div>
      <p style={{ ...S.p, fontFamily: "monospace", fontSize: "12px", background: "#f8fafc", padding: "8px 12px", borderRadius: "6px" }}>Oracle admin: 0xef5Bed7c221c85A2c88e3c0223ee45482d6F037d</p>
      <h2 style={S.h2}>Known Limitations</h2>
      <table style={S.table}>
        <thead><tr><th style={S.th}>Risk</th><th style={S.th}>Description</th><th style={S.th}>Status</th></tr></thead>
        <tbody>{data.limitations.map(r => (
          <tr key={r.risk}><td style={S.td}>{r.risk}</td><td style={S.td}>{r.desc}</td><td style={S.td}><span style={S.tag(r.color)}>{r.status}</span></td></tr>
        ))}</tbody>
      </table>
      <h2 style={S.h2}>Decentralisation Roadmap</h2>
      <h3 style={S.h3}>Phase 1 — Multi-Source Aggregation (Live)</h3><p style={S.p}>{data.phase1}</p>
      <h3 style={S.h3}>Phase 2 — Multi-Signer Oracle Relay (Pre-Mainnet)</h3><p style={S.p}>{data.phase2}</p>
      <h3 style={S.h3}>Phase 3 — Chainlink / Pyth Integration (Series A, 2027)</h3><p style={S.p}>{data.phase3}</p>
      <h3 style={S.h3}>Phase 4 — On-Chain Oracle DAO (Series B, 2028)</h3><p style={S.p}>{data.phase4}</p>
    </div>
  );
}

const AUDIT_D = {
  intro: "Pre-audit scan conducted Q1 2026 using SmartLock automated analysis + manual review of all HedgeFacet functions. A formal third-party audit (Certik or Trail of Bits) is scheduled for Q2 2026 ahead of mainnet launch.",
  findings: [
    { sev: "High",   sevColor: "red",   issue: "Reentrancy vulnerability in claimPayout() — malicious LP could trigger recursive withdrawal",  status: "Fixed — ReentrancyGuard added",  statusColor: "green" },
    { sev: "Medium", sevColor: "amber", issue: "Access control: settleEvent() callable by any address on testnet",                               status: "Mitigated — admin-only modifier", statusColor: "amber" },
    { sev: "Medium", sevColor: "amber", issue: "Integer overflow risk in premium calculation for large notional values",                         status: "Fixed — SafeMath checks added",  statusColor: "green" },
    { sev: "Medium", sevColor: "amber", issue: "Event expiry boundary condition allows settlement 1 block after expiry",                         status: "Fixed — strict timestamp comparison", statusColor: "green" },
    { sev: "Low",    sevColor: "blue",  issue: "Gas optimisation: redundant SLOAD in getLpBalance()",                                           status: "Fixed",                          statusColor: "green" },
    { sev: "Low",    sevColor: "blue",  issue: "Missing event emission on LP withdrawal",                                                        status: "Fixed",                          statusColor: "green" },
    { sev: "Low",    sevColor: "blue",  issue: "ERC-20 return value not checked in USDC transfer",                                              status: "Fixed — SafeERC20 used",         statusColor: "green" },
    { sev: "Low",    sevColor: "blue",  issue: "Unchecked return value on internal fee transfer",                                               status: "Fixed",                          statusColor: "green" },
    { sev: "Low",    sevColor: "blue",  issue: "Hardcoded USDC address — not upgradeable without DiamondCut",                                   status: "Accepted risk",                  statusColor: "blue"  },
  ],
  checklist: [
    { item: "Formal third-party audit (Certik / Trail of Bits)", timing: "Q2 2026",    status: "pending" },
    { item: "Gnosis Safe multisig on oracle admin wallet",       timing: "Pre-launch",  status: "pending" },
    { item: "Timelock on Diamond upgrades (48h delay)",          timing: "Pre-launch",  status: "pending" },
    { item: "Emergency pause mechanism on HedgeFacet",          timing: "Pre-launch",  status: "pending" },
    { item: "Multi-signer oracle relay (3-of-5)",                timing: "Pre-launch",  status: "pending" },
    { item: "ReentrancyGuard on all state-changing functions",   timing: "Done",        status: "done"    },
    { item: "SafeERC20 for all USDC transfers",                  timing: "Done",        status: "done"    },
    { item: "Contract verification on Blockscout",               timing: "Done",        status: "done"    },
  ],
};

function SecurityAuditDoc({ token }: { token: string }) {
  const { data, draft, editing, saving, editUnlocked, startEdit, cancelEdit, save, setField, requestEdit } = useEditableDoc("security-audit", token, AUDIT_D);
  const setFinding = (i: number, k: string, v: string) => setField("findings", draft.findings.map((r, j) => j === i ? { ...r, [k]: v } : r));
  const setCheck  = (i: number, k: string, v: string) => setField("checklist", draft.checklist.map((r, j) => j === i ? { ...r, [k]: v } : r));

  if (editing) return (
    <div>
      <DocEditBar editUnlocked saving={saving} editing onEdit={() => {}} onSave={save} onCancel={cancelEdit} />
      <TxtF label="intro" value={draft.intro} onChange={v => setField("intro", v)} />
      <h2 style={S.h2}>Findings</h2>
      <table style={S.table}>
        <thead><tr><th style={S.th}>Severity</th><th style={S.th}>Issue</th><th style={S.th}>Status</th></tr></thead>
        <tbody>{draft.findings.map((r, i) => (
          <tr key={i}>
            <td style={S.td}><input value={r.sev} onChange={e => setFinding(i, "sev", e.target.value)} style={{ ...EI, width: "70px" }} /></td>
            <td style={S.td}><input value={r.issue} onChange={e => setFinding(i, "issue", e.target.value)} style={EI} /></td>
            <td style={S.td}><input value={r.status} onChange={e => setFinding(i, "status", e.target.value)} style={EI} /></td>
          </tr>
        ))}</tbody>
      </table>
      <h2 style={S.h2}>Checklist</h2>
      {draft.checklist.map((r, i) => (
        <div key={i} style={{ display: "flex", gap: "8px", marginBottom: "6px", alignItems: "center" }}>
          <input value={r.item} onChange={e => setCheck(i, "item", e.target.value)} style={{ ...EI, flex: 1 }} />
          <input value={r.timing} onChange={e => setCheck(i, "timing", e.target.value)} style={{ ...EI, width: "100px" }} />
          <select value={r.status} onChange={e => setCheck(i, "status", e.target.value)} style={{ ...EI, width: "90px" }}>
            <option value="done">done</option><option value="pending">pending</option>
          </select>
        </div>
      ))}
    </div>
  );

  return (
    <div>
      <DocEditBar editUnlocked={editUnlocked} editing={false} saving={false} onEdit={() => requestEdit(startEdit)} onSave={save} onCancel={cancelEdit} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "10px", marginBottom: "20px" }}>
        <div style={{ ...S.stat, borderColor: "#86efac" }}><div style={{ ...S.statVal, color: "#16a34a" }}>70.94</div><div style={S.statLbl}>Audit score (out of 100)</div></div>
        <div style={S.stat}><div style={{ ...S.statVal, color: "#dc2626" }}>0</div><div style={S.statLbl}>Critical findings</div></div>
        <div style={S.stat}><div style={{ ...S.statVal, color: "#d97706" }}>1</div><div style={S.statLbl}>High severity (fixed)</div></div>
        <div style={S.stat}><div style={S.statVal}>3</div><div style={S.statLbl}>Medium severity</div></div>
      </div>
      <p style={S.p}>{data.intro}</p>
      <h2 style={S.h2}>Findings Summary</h2>
      <table style={S.table}>
        <thead><tr><th style={S.th}>Severity</th><th style={S.th}>Issue</th><th style={S.th}>Status</th></tr></thead>
        <tbody>{data.findings.map((r, i) => (
          <tr key={i}><td style={S.td}><span style={S.tag(r.sevColor)}>{r.sev}</span></td><td style={S.td}>{r.issue}</td><td style={S.td}><span style={S.tag(r.statusColor)}>{r.status}</span></td></tr>
        ))}</tbody>
      </table>
      <h2 style={S.h2}>Pre-Mainnet Security Checklist</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", margin: "12px 0" }}>
        {data.checklist.map(r => (
          <div key={r.item} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px", background: r.status === "done" ? "#f0fdf4" : "#f8fafc", borderRadius: "6px", border: `1px solid ${r.status === "done" ? "#bbf7d0" : "#e2e8f0"}` }}>
            <span style={{ fontSize: "16px" }}>{r.status === "done" ? "✅" : "⬜"}</span>
            <span style={{ fontSize: "13px", color: "#334155", flex: 1 }}>{r.item}</span>
            <span style={{ fontSize: "11px", color: "#64748b" }}>{r.timing}</span>
          </div>
        ))}
      </div>
      <h2 style={S.h2}>Contract Addresses (Lisk Sepolia)</h2>
      <div style={{ fontFamily: "monospace", fontSize: "12px", color: "#475569", background: "#f8fafc", padding: "12px 16px", borderRadius: "8px", lineHeight: 2 }}>
        <div>Diamond: <strong>0x3582D8f5f88ef557ce10Af26834FAC8B8e1445bf</strong></div>
        <div>HedgeFacet: <strong>0x1B2aca3f871e9AF5D88C28862375601a2552bBb2</strong></div>
        <div>DiamondCutFacet: <strong>0x289eE379b00e3B20c4BaD64a525B0b0D123a7d0c</strong></div>
        <div>USDC: <strong>0xf52Ad63619Bf9cFeF510341ac6b4038554399562</strong></div>
      </div>
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

      <h2 style={S.h2}>What the Demo Covers</h2>
      <ul style={{ fontSize: "13px", color: "#475569", paddingLeft: "18px", lineHeight: 2 }}>
        <li>Creating a non-custodial USDC wallet on Lisk Sepolia</li>
        <li>Receiving Sepolia ETH via the gasless faucet mechanism</li>
        <li>Browsing open hedge events across FX, commodities, and crypto pairs</li>
        <li>Buying a downside hedge — setting strike, notional, and expiry</li>
        <li>Providing liquidity as an LP and earning premiums</li>
        <li>Automatic oracle settlement when the strike is touched</li>
        <li>Claiming payouts and viewing position history</li>
      </ul>
    </div>
  );
}

const MARKET_D = {
  tam_text: "African cross-border trade flows exceed $210B annually, growing at approximately 12% CAGR, driven by mobile money adoption, infrastructure improvements, and regional trade agreements (AfCFTA). The majority of this trade is conducted by SMEs — importers, exporters, manufacturers, and remittance-dependent businesses — that lack access to professional FX hedging tools.",
  sam_text: "An estimated $35B per year is lost by African SMEs to unhedged FX volatility. Key corridors include GHS/USD (Ghana), NGN/USD (Nigeria), KES/USD (Kenya), and ZAR/USD (South Africa). Volatility ranges from 8–25% annually on these pairs — unacceptable for businesses operating on thin margins.",
  sam_text2: "BlockFinaX's SAM is the subset of these losses that can be addressed by parametric hedging products: businesses with predictable, scheduled FX exposure (e.g., import payment in 30 days) who would pay a small premium to cap their downside.",
  regional: "Pilot: Ghana (GHS pairs, Bank of Ghana sandbox approval) → 2027: Nigeria, Kenya → 2028: South Africa, Francophone West Africa (CEMAC/BCEAO currencies)",
  drivers: [
    { text: "594M mobile money accounts in Sub-Saharan Africa",              label: "Infrastructure" },
    { text: "Lisk L2 near-zero gas fees enable micro-hedges from $10",       label: "Technology"     },
    { text: "USDC as settlement — no FX execution risk at point of hedge",   label: "Product"        },
    { text: "No incumbent serving sub-$1M cross-border trade hedging",       label: "Market gap"     },
    { text: "AfCFTA driving 60% more intra-African trade by 2030",           label: "Macro"          },
    { text: "Bank of Ghana regulatory sandbox — first-mover advantage",      label: "Regulatory"     },
  ],
};

function MarketOpportunityDoc({ token }: { token: string }) {
  const { data, draft, editing, saving, editUnlocked, startEdit, cancelEdit, save, setField, requestEdit } = useEditableDoc("market-opportunity", token, MARKET_D);
  const setDriver = (i: number, k: string, v: string) => setField("drivers", draft.drivers.map((r, j) => j === i ? { ...r, [k]: v } : r));
  const SAM = 35_000_000_000;
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
        <div style={S.stat}><div style={S.statVal}>$210B</div><div style={S.statLbl}>TAM — African cross-border trade (2024)</div></div>
        <div style={S.stat}><div style={S.statVal}>$35B</div><div style={S.statLbl}>SAM — Annual FX losses for SMEs</div></div>
        <div style={{ ...S.stat, borderColor: "#86efac" }}><div style={{ ...S.statVal, color: "#16a34a" }}>{fmtUSD(som27)}</div><div style={S.statLbl}>SOM Year 1 — {((som27 / SAM) * 100).toFixed(1)}% of SAM (2027)</div></div>
      </div>
      <h2 style={S.h2}>Total Addressable Market (TAM)</h2>
      <p style={S.p}>{data.tam_text}</p>
      <h2 style={S.h2}>Serviceable Available Market (SAM)</h2>
      <p style={S.p}>{data.sam_text}</p>
      <p style={S.p}>{data.sam_text2}</p>
      <h2 style={S.h2}>Serviceable Obtainable Market (SOM) — Projections</h2>
      <table style={S.table}>
        <thead><tr><th style={S.th}>Year</th><th style={S.th}>Notional Hedged</th><th style={S.th}>SAM Share</th><th style={S.th}>Active Wallets</th><th style={S.th}>Revenue</th></tr></thead>
        <tbody>
          <tr><td style={S.td}><strong>2027</strong></td><td style={S.td}>{fmtUSD(som27)}</td><td style={S.td}>{((som27/SAM)*100).toFixed(1)}%</td><td style={S.td}>~{(DEFAULT_ANNUALS[1].totalNewWallets/1000).toFixed(0)}K</td><td style={S.td}><strong>{fmtUSD(DEFAULT_ANNUALS[1].totalRevenue)}</strong></td></tr>
          <tr><td style={S.td}><strong>2028</strong></td><td style={S.td}>{fmtUSD(som28)}</td><td style={S.td}>{((som28/SAM)*100).toFixed(1)}%</td><td style={S.td}>~{(DEFAULT_ANNUALS[2].totalNewWallets/1000).toFixed(0)}K</td><td style={S.td}><strong>{fmtUSD(DEFAULT_ANNUALS[2].totalRevenue)}</strong></td></tr>
          <tr><td style={S.td}><strong>2029</strong></td><td style={S.td}>{fmtUSD(som29)}</td><td style={S.td}>{((som29/SAM)*100).toFixed(1)}%</td><td style={S.td}>~{(DEFAULT_ANNUALS[3].totalNewWallets/1000).toFixed(0)}K</td><td style={S.td}><strong>{fmtUSD(DEFAULT_ANNUALS[3].totalRevenue)}</strong></td></tr>
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
  intro: "Banks ignore sub-$1M trade flows. OTC brokers are opaque and expensive. DeFi protocols don't cover African pairs. Prediction markets are booming — but built for speculation, not real-world business hedging. BlockFinaX is the only accessible, transparent protection product built for African SMEs.",
  rows: [
    { feature: "Min trade size",        bfx: "$10 USDC",    banks: "~$250K+",    otc: "~$100K+",   defi: "❌ None",      pred: "~$1+"          },
    { feature: "African pair coverage", bfx: "40+ pairs",   banks: "❌ None",    otc: "❌ None",   defi: "❌ None",      pred: "❌ None"        },
    { feature: "Real-world hedging",    bfx: "✅ Yes",       banks: "✅ Yes",     otc: "✅ Yes",    defi: "⚡ Limited",   pred: "❌ Speculative" },
    { feature: "Transparent pricing",   bfx: "✅ On-chain",  banks: "❌ Opaque",  otc: "❌ Opaque", defi: "⚡ Varies",    pred: "✅ On-chain"    },
    { feature: "Instant settlement",    bfx: "✅ Auto",      banks: "3–5 days",   otc: "1–3 days",  defi: "✅ On-chain",  pred: "✅ On-chain"    },
    { feature: "SME accessible",        bfx: "✅",           banks: "❌ Ignored", otc: "❌ Opaque", defi: "❌ Complex",   pred: "⚡ Partial"     },
  ],
};

function CompetitiveLandscapeDoc({ token }: { token: string }) {
  const { data, draft, editing, saving, editUnlocked, startEdit, cancelEdit, save, setField, requestEdit } = useEditableDoc("competitive-landscape", token, COMP_D);
  const setRow = (i: number, k: string, v: string) => setField("rows", draft.rows.map((r, j) => j === i ? { ...r, [k]: v } : r));

  if (editing) return (
    <div>
      <DocEditBar editUnlocked saving={saving} editing onEdit={() => {}} onSave={save} onCancel={cancelEdit} />
      <TxtF label="intro" value={draft.intro} onChange={v => setField("intro", v)} />
      <h2 style={S.h2}>Comparison Table</h2>
      <table style={S.table}>
        <thead><tr><th style={S.th}>Feature</th><th style={S.th}>BlockFinaX</th><th style={S.th}>Banks</th><th style={S.th}>OTC</th><th style={S.th}>DeFi</th><th style={S.th}>Prediction</th></tr></thead>
        <tbody>{draft.rows.map((r, i) => (
          <tr key={i}>{(["feature","bfx","banks","otc","defi","pred"] as const).map(f => (
            <td key={f} style={S.td}><input value={r[f]} onChange={e => setRow(i, f, e.target.value)} style={EI} /></td>
          ))}</tr>
        ))}</tbody>
      </table>
    </div>
  );

  return (
    <div>
      <DocEditBar editUnlocked={editUnlocked} editing={false} saving={false} onEdit={() => requestEdit(startEdit)} onSave={save} onCancel={cancelEdit} />
      <p style={S.p}>{data.intro}</p>
      <div style={{ overflowX: "auto", margin: "20px 0" }}>
        <table style={{ ...S.table, minWidth: "680px" }}>
          <thead>
            <tr>
              <th style={S.th}> </th>
              <th style={{ ...S.th, background: "#eff6ff", color: "#1d4ed8" }}>BlockFinaX</th>
              <th style={S.th}>Banks</th><th style={S.th}>OTC Brokers</th><th style={S.th}>DeFi</th><th style={S.th}>Prediction Markets</th>
            </tr>
          </thead>
          <tbody>{data.rows.map(r => (
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
    { type: "Lisk ecosystem",      examples: "Lisk Foundation",            value: "Grant funding + co-marketing",            phase: "1" },
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
  status_label: "Application In Progress",
  status_date: "Filed Q1 2026 · Decision expected Q3 2026",
  intro: "BlockFinaX has applied for admission to the Bank of Ghana's Regulatory Sandbox — a controlled environment for testing innovative fintech products under regulatory supervision. Admission would grant a time-limited licence to operate in Ghana while formal regulation is developed around on-chain parametric protection products.",
  applied_for: [
    "A sandbox licence to offer parametric FX protection contracts to Ghanaian SMEs",
    "Permission to settle contracts in USDC on a public blockchain (Lisk Sepolia / Lisk Mainnet)",
    "Regulatory safe harbour during the sandbox period for on-chain settlement mechanisms",
    "Access to the Bank of Ghana's FinTech and Innovation Office for dialogue on licensing frameworks",
  ],
  compliance: [
    { title: "USDC-only settlement",          desc: "No native token — no securities classification risk",                                  status: "done"    },
    { title: "Fully pre-funded pools",         desc: "Hedger payouts reserved on-chain before purchase — no undercollateralisation",         status: "done"    },
    { title: "Immutable on-chain audit trail", desc: "Every settlement recorded permanently on Lisk L2",                                      status: "done"    },
    { title: "No leverage",                    desc: "Hedgers can only lose their premium — no amplified loss risk",                          status: "done"    },
    { title: "No algorithmic trading",         desc: "All contracts are user-initiated — no automated position-taking",                      status: "done"    },
    { title: "KYC/AML roadmap",               desc: "Wallet-based identity linkage to mobile number (planned for commercial launch)",        status: "pending" },
    { title: "Designated compliance officer",  desc: "To be appointed ahead of commercial launch",                                           status: "pending" },
  ],
  timeline: [
    { milestone: "Application filed",            date: "Q1 2026",            status: "Complete", color: "green" },
    { milestone: "Bank of Ghana decision",        date: "Q3 2026",            status: "Pending",  color: "amber" },
    { milestone: "Sandbox period (if approved)",  date: "Q4 2026 – Q2 2027", status: "Planned",  color: "blue"  },
    { milestone: "Commercial launch in Ghana",    date: "Q1 2027",            status: "Planned",  color: "blue"  },
  ],
  markets: [
    { market: "Kenya",                 regulator: "Capital Markets Authority",  target: "Sandbox application 2027" },
    { market: "Nigeria",               regulator: "SEC Nigeria Fintech Sandbox", target: "2028"                    },
    { market: "Francophone W. Africa", regulator: "BCEAO",                      target: "Dialogue 2028"           },
  ],
};

function BoGSandboxDoc({ token }: { token: string }) {
  const { data, draft, editing, saving, editUnlocked, startEdit, cancelEdit, save, setField, requestEdit } = useEditableDoc("bog-sandbox", token, BOG_D);
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
              { label: "Gas Costs",             vals: [fmtUSD(a[1].gasCost),      fmtUSD(a[2].gasCost),      fmtUSD(a[3].gasCost),      fmtUSD(a[4].gasCost)],      driver: "Wallet onboarding gas + hedge execution gas (~6 on-chain txns per event on Lisk L2)" },
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
  intro: "BlockFinaX operates under a dual-entity structure: a primary operating company incorporated in Ghana, with a Delaware C-Corporation in progress to accommodate US institutional investors and standard venture capital term sheets.",
  investor_note: "Series A investment will be structured through the Delaware C-Corp, enabling standard US venture term sheets, stock option pools, and SAFE/priced round mechanics. The Ghana entity continues as the operational subsidiary.",
  ghana_rows: [
    { k: "Entity type",      v: "Company Limited by Shares (Private)"                          },
    { k: "Governing law",    v: "Companies Act, 2019 (Act 992) — Republic of Ghana"             },
    { k: "Registered with",  v: "Registrar General's Department (RGD), Accra"                   },
    { k: "Country",          v: "Ghana, West Africa"                                             },
    { k: "Primary market",   v: "Ghana (Bank of Ghana sandbox), with East & West Africa expansion" },
    { k: "Tax jurisdiction", v: "Ghana Revenue Authority (GRA)"                                  },
  ],
  delaware_rows: [
    { k: "Entity type",   v: "Delaware C-Corporation"                                                    },
    { k: "Purpose",       v: "US investor vehicle, Series A/B term sheet compatibility, stock option pool" },
    { k: "Timeline",      v: "Q1–Q2 2027 (ahead of Series A close)"                                       },
    { k: "Structure",     v: "Delaware parent holding 100% of Ghana operating subsidiary"                  },
    { k: "Legal counsel", v: "US counsel to be engaged on Series A raise"                                  },
  ],
  timeline_rows: [
    { milestone: "Ghana private limited company incorporated", jur: "Ghana",          target: "Q1 2026",    status: "Complete", color: "green" },
    { milestone: "Ghana operating bank account opened",        jur: "Ghana",          target: "Q1 2026",    status: "Complete", color: "green" },
    { milestone: "BoG sandbox application filed",              jur: "Ghana",          target: "Q1 2026",    status: "Complete", color: "green" },
    { milestone: "Delaware C-Corp formation",                  jur: "United States",  target: "Q1–Q2 2027", status: "Planned",  color: "amber" },
    { milestone: "IP assignment Ghana → Delaware",             jur: "International",  target: "Q2 2027",    status: "Planned",  color: "amber" },
    { milestone: "Kenya subsidiary registration",              jur: "Kenya",          target: "2027",        status: "Roadmap",  color: "blue"  },
    { milestone: "Nigeria subsidiary registration",            jur: "Nigeria",        target: "2028",        status: "Roadmap",  color: "blue"  },
  ],
};

function IncorporationDoc({ token }: { token: string }) {
  const { data, draft, editing, saving, editUnlocked, startEdit, cancelEdit, save, setField, requestEdit } = useEditableDoc("incorporation", token, INCORP_D);
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
      <h2 style={S.h2}>Ghana — Primary Operating Entity</h2>
      <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "10px", padding: "18px", margin: "12px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
          <span style={{ fontSize: "22px" }}>🇬🇭</span>
          <div><div style={{ fontSize: "15px", fontWeight: 700, color: "#14532d" }}>BlockFinaX Limited</div><div style={{ fontSize: "13px", color: "#16a34a" }}>Incorporated · Active</div></div>
          <span style={{ marginLeft: "auto", ...S.tag("green") }}>Active</span>
        </div>
        <table style={S.table}><tbody>{data.ghana_rows.map(r => (
          <tr key={r.k}><td style={{ ...S.td, fontWeight: 600, color: "#334155", width: "40%", whiteSpace: "nowrap" as const }}>{r.k}</td><td style={S.td}>{r.v}</td></tr>
        ))}</tbody></table>
      </div>
      <h2 style={S.h2}>Delaware — US Holding Entity (In Progress)</h2>
      <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "18px", margin: "12px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
          <span style={{ fontSize: "22px" }}>🇺🇸</span>
          <div><div style={{ fontSize: "15px", fontWeight: 700, color: "#0f172a" }}>BlockFinaX Inc. (planned)</div><div style={{ fontSize: "13px", color: "#64748b" }}>Delaware C-Corporation — Formation in progress</div></div>
          <span style={{ marginLeft: "auto", ...S.tag("amber") }}>In Progress</span>
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

const AGREE_D = {
  intro: "This section tracks the status of all formal agreements — investor NDAs, service agreements with contractors and advisors, consulting contracts, and template legal documents. Signed agreements are held by BlockFinaX's legal counsel and available to verified investors on request.",
  request_note: "To request a signed NDA, term sheet, or specific agreement, email anthonykumako8@gmail.com with the subject \"BlockFinaX Agreement Request\".",
  investor_rows: [
    { doc: "Non-Disclosure Agreement (NDA)",    party: "Pre-seed investors", status: "Template Ready", color: "amber", note: "Available on request — email to initiate"         },
    { doc: "SAFE Note / Investment Agreement",   party: "Pre-seed round",     status: "In Drafting",   color: "amber", note: "Being prepared ahead of pre-seed close"           },
    { doc: "Investor Term Sheet",               party: "Series A",           status: "Not Yet",       color: "slate", note: "Will be issued Q4 2027 ahead of Series A"          },
  ],
  service_rows: [
    { doc: "Smart Contract Audit Agreement", party: "Third-party auditor (TBD)",  status: "Pending Auditor Selection", color: "amber", note: "Planned pre-mainnet — budget allocated"              },
    { doc: "Legal Advisory Retainer",        party: "Ghana corporate counsel",    status: "Active",                    color: "green", note: "Ongoing advisory on BoG sandbox application"          },
    { doc: "Compliance Consulting",          party: "AML/KYC consultant",         status: "In Negotiation",            color: "amber", note: "See Compliance Proposals for details"                 },
    { doc: "Cloud Services Agreement",       party: "AWS / GCP",                  status: "Active",                    color: "green", note: "Standard cloud services — no special terms"           },
    { doc: "Delaware Formation Counsel",     party: "US law firm (TBD)",          status: "Not Started",               color: "slate", note: "To be engaged Q4 2026 ahead of formation"            },
  ],
  ip_items: [
    { title: "All source code owned by BlockFinaX Limited",          desc: "No third-party IP encumbrances on the core protocol",      status: "done"    },
    { title: "Smart contracts deployed from founder-controlled wallet", desc: "Full on-chain ownership of Diamond proxy",               status: "done"    },
    { title: "No open-source licence conflicts",                      desc: "Dependencies are MIT / Apache 2.0 compatible",            status: "done"    },
    { title: "IP assignment to Delaware holding company",             desc: "Planned on Delaware formation (Q2 2027)",                  status: "pending" },
    { title: "Trademark registration — BlockFinaX",                   desc: "Ghana and international filing planned",                   status: "pending" },
  ],
};

function AgreementsDoc({ token }: { token: string }) {
  const { data, draft, editing, saving, editUnlocked, startEdit, cancelEdit, save, setField, requestEdit } = useEditableDoc("agreements", token, AGREE_D);
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
// 1,000,000 total authorized shares. Each member holds a % of the total.
// When a new member joins at X%, all existing holders dilute proportionally.
const CAP_TABLE_D = {
  notes: "All shares subject to vesting as noted. Total authorized: 1,000,000. Investor rounds will be added as they close.",
  valuation: "5000000",
  members: [
    { name: "Anthony Kumako", role: "CEO & Co-Founder", type: "founder", pct: "31.5", vesting: "4-year, 1-year cliff" },
    { name: "[Co-Founder 2]", role: "[Role]",            type: "founder", pct: "7.5",  vesting: "4-year, 1-year cliff" },
    { name: "Option Pool",    role: "Employee Equity",   type: "pool",    pct: "5.5",  vesting: "4-year, 1-year cliff per grant" },
    { name: "AYAHQ",          role: "Incubation",        type: "service", pct: "1.0",  vesting: "2-year, 6-month cliff" },
  ],
};
type CapTableData = typeof CAP_TABLE_D;

const TOTAL_AUTHORIZED = 1_000_000;
const parseNum = (s: string) => { const n = parseFloat(String(s).replace(/[^0-9.]/g, "")); return isNaN(n) ? 0 : n; };
const fmtN     = (n: number) => Math.round(n).toLocaleString();

function CapTableDoc({ token }: { token: string }) {
  const { data, draft, editing, saving, editUnlocked, startEdit, cancelEdit, save, setField } =
    useEditableDoc<CapTableData>("cap-table", token, CAP_TABLE_D);

  const [newPct, setNewPct] = useState("");

  const setMember = (i: number, k: string, v: string) => {
    const arr = [...draft.members]; arr[i] = { ...arr[i], [k]: v }; setField("members", arr);
  };

  const totalPct = (members: typeof draft.members) =>
    members.reduce((s, m) => s + parseNum(m.pct), 0);

  const addMemberDiluted = () => {
    const pct = parseNum(newPct);
    if (pct <= 0 || pct >= 100) return;
    const factor = 1 - pct / 100;
    const diluted = draft.members.map(m => ({ ...m, pct: (parseNum(m.pct) * factor).toFixed(4) }));
    setField("members", [...diluted, { name: "", role: "", type: "founder", pct: pct.toFixed(4), vesting: "4-year, 1-year cliff" }]);
    setNewPct("");
  };

  const rowStyle: React.CSSProperties = { padding: "8px 10px", borderBottom: "1px solid #f1f5f9", fontSize: "13px" };
  const hStyle: React.CSSProperties = { ...rowStyle, background: "#f8fafc", fontWeight: 600, fontSize: "12px", color: "#64748b" };
  const typeColor: Record<string, string> = { founder: "#2563eb", pool: "#7c3aed", service: "#0891b2", investor: "#059669", round: "#d97706" };
  const typeLabel: Record<string, string> = { founder: "Founder", pool: "Option Pool", service: "Service Grant", investor: "Investor", round: "Planned Round" };

  if (editing) {
    const dTotal = totalPct(draft.members);
    const available = 100 - dTotal;
    return (
      <div>
        <DocEditBar editUnlocked saving={saving} editing onEdit={() => {}} onSave={save} onCancel={cancelEdit} />

        {/* Stats bar */}
        <div style={{ display: "flex", gap: "10px", marginBottom: "14px", flexWrap: "wrap" as const }}>
          <div style={{ flex: 1, background: "#f8fafc", borderRadius: "6px", padding: "8px 12px", minWidth: "120px" }}>
            <p style={{ fontSize: "11px", color: "#64748b", margin: 0 }}>Total Authorized</p>
            <p style={{ fontSize: "15px", fontWeight: 700, margin: "2px 0 0" }}>{fmtN(TOTAL_AUTHORIZED)}</p>
          </div>
          <div style={{ flex: 1, background: "#f8fafc", borderRadius: "6px", padding: "8px 12px", minWidth: "120px" }}>
            <p style={{ fontSize: "11px", color: "#64748b", margin: 0 }}>Allocated</p>
            <p style={{ fontSize: "15px", fontWeight: 700, margin: "2px 0 0", color: dTotal > 100 ? "#ef4444" : "#0f172a" }}>{dTotal.toFixed(2)}%</p>
          </div>
          <div style={{ flex: 1, background: available < 0 ? "#fef2f2" : "#f0fdf4", borderRadius: "6px", padding: "8px 12px", minWidth: "120px" }}>
            <p style={{ fontSize: "11px", color: "#64748b", margin: 0 }}>Available Pool</p>
            <p style={{ fontSize: "15px", fontWeight: 700, margin: "2px 0 0", color: available < 0 ? "#ef4444" : "#059669" }}>{available.toFixed(2)}% · {fmtN(Math.round(available / 100 * TOTAL_AUTHORIZED))} shares</p>
          </div>
          <div style={{ flex: 1, minWidth: "140px" }}>
            <label style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", display: "block", marginBottom: "3px" }}>Company Valuation ($)</label>
            <input type="number" value={draft.valuation} onChange={e => setField("valuation", e.target.value)} style={{ ...EI, fontFamily: "monospace" }} placeholder="e.g. 5000000" />
          </div>
        </div>

        {/* Members */}
        {draft.members.map((m, i) => (
          <div key={i} style={{ border: "1px solid #e2e8f0", borderRadius: "6px", padding: "10px", marginBottom: "8px", display: "flex", gap: "8px", flexWrap: "wrap" as const, alignItems: "flex-end" }}>
            <div style={{ flex: "2 1 130px" }}><TxtF label="name"    value={m.name}    onChange={v => setMember(i, "name",    v)} rows={1} /></div>
            <div style={{ flex: "2 1 120px" }}><TxtF label="role"    value={m.role}    onChange={v => setMember(i, "role",    v)} rows={1} /></div>
            <div style={{ flex: "1 1 90px" }}>
              <label style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", display: "block", marginBottom: "3px" }}>Type</label>
              <select value={m.type} onChange={e => setMember(i, "type", e.target.value)} style={{ ...EI, padding: "5px 8px" }}>
                <option value="founder">Founder</option>
                <option value="pool">Option Pool</option>
                <option value="service">Service Grant</option>
                <option value="investor">Investor</option>
              </select>
            </div>
            <div style={{ flex: "1 1 80px" }}>
              <label style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", display: "block", marginBottom: "3px" }}>Ownership %</label>
              <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                <input type="number" step="0.01" value={m.pct} onChange={e => setMember(i, "pct", e.target.value)} style={{ ...EI, fontFamily: "monospace", width: "64px" }} />
                <span style={{ fontSize: "12px" }}>%</span>
              </div>
            </div>
            <div style={{ flex: "0 0 80px", paddingBottom: "2px" }}>
              <p style={{ fontSize: "11px", color: "#64748b", margin: "0 0 2px" }}>Shares</p>
              <p style={{ fontSize: "13px", fontWeight: 700, color: typeColor[m.type] || "#2563eb", margin: 0 }}>{fmtN(Math.round(parseNum(m.pct) / 100 * TOTAL_AUTHORIZED))}</p>
            </div>
            <div style={{ flex: "2 1 160px" }}><TxtF label="vesting" value={m.vesting} onChange={v => setMember(i, "vesting", v)} rows={1} /></div>
            <button onClick={() => setField("members", draft.members.filter((_, j) => j !== i))} style={{ fontSize: "11px", color: "#ef4444", background: "none", border: "none", cursor: "pointer", alignSelf: "flex-end" as const, paddingBottom: "4px" }}>✕</button>
          </div>
        ))}

        {/* Add with dilution */}
        <div style={{ border: "1px dashed #bfdbfe", borderRadius: "6px", padding: "10px 12px", marginBottom: "16px", background: "#f8fafc" }}>
          <p style={{ fontSize: "12px", color: "#0369a1", margin: "0 0 8px", fontWeight: 600 }}>Add new member — existing holders dilute proportionally</p>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" as const }}>
            <div>
              <label style={{ fontSize: "11px", color: "#64748b", display: "block", marginBottom: "2px" }}>Give them %</label>
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <input type="number" step="0.01" min="0.01" max="99" value={newPct} onChange={e => setNewPct(e.target.value)} placeholder="e.g. 20" style={{ ...EI, fontFamily: "monospace", width: "70px" }} />
                <span style={{ fontSize: "12px" }}>%</span>
              </div>
            </div>
            {parseNum(newPct) > 0 && (
              <div style={{ fontSize: "12px", color: "#64748b", paddingTop: "14px" }}>
                → Each existing holder shrinks by {parseNum(newPct).toFixed(1)}% · New member gets {fmtN(Math.round(parseNum(newPct) / 100 * TOTAL_AUTHORIZED))} shares
              </div>
            )}
            <button onClick={addMemberDiluted} disabled={parseNum(newPct) <= 0} style={{ marginTop: "14px", fontSize: "12px", color: "#fff", background: "#2563eb", border: "none", borderRadius: "5px", padding: "5px 12px", cursor: "pointer", opacity: parseNum(newPct) <= 0 ? 0.4 : 1 }}>Add &amp; Dilute</button>
          </div>
        </div>

        <h3 style={S.h3}>Notes</h3>
        <TxtF label="notes" value={draft.notes} onChange={v => setField("notes", v)} rows={3} />
      </div>
    );
  }

  const vTotal = totalPct(data.members);
  const available = 100 - vTotal;

  return (
    <div>
      <DocEditBar editUnlocked={editUnlocked} editing={false} saving={false} onEdit={startEdit} onSave={save} onCancel={cancelEdit} />

      {/* Summary stats */}
      {(() => {
        const valuation = parseNum(data.valuation);
        const fmtVal = (n: number) => n >= 1e6 ? `$${(n/1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n/1e3).toFixed(1)}K` : `$${fmtN(n)}`;
        return (
          <>
            <div style={{ display: "flex", gap: "16px", marginBottom: "16px", flexWrap: "wrap" as const }}>
              <div style={{ flex: 1, background: "#f8fafc", borderRadius: "8px", padding: "12px 16px", minWidth: "130px" }}>
                <p style={{ fontSize: "11px", color: "#64748b", margin: 0 }}>Total Authorized</p>
                <p style={{ fontSize: "16px", fontWeight: 700, margin: "4px 0 0", color: "#0f172a" }}>{fmtN(TOTAL_AUTHORIZED)}</p>
              </div>
              <div style={{ flex: 1, background: "#f8fafc", borderRadius: "8px", padding: "12px 16px", minWidth: "130px" }}>
                <p style={{ fontSize: "11px", color: "#64748b", margin: 0 }}>Allocated</p>
                <p style={{ fontSize: "16px", fontWeight: 700, margin: "4px 0 0" }}>{vTotal.toFixed(2)}% · {fmtN(Math.round(vTotal / 100 * TOTAL_AUTHORIZED))} shares</p>
              </div>
              <div style={{ flex: 1, background: "#f0fdf4", borderRadius: "8px", padding: "12px 16px", minWidth: "130px" }}>
                <p style={{ fontSize: "11px", color: "#64748b", margin: 0 }}>Available for Future Rounds</p>
                <p style={{ fontSize: "16px", fontWeight: 700, margin: "4px 0 0", color: "#059669" }}>{available.toFixed(2)}% · {fmtN(Math.round(available / 100 * TOTAL_AUTHORIZED))} shares</p>
              </div>
              {valuation > 0 && (
                <div style={{ flex: 1, background: "linear-gradient(135deg, #eff6ff, #dbeafe)", borderRadius: "8px", padding: "12px 16px", minWidth: "130px", border: "1px solid #bfdbfe" }}>
                  <p style={{ fontSize: "11px", color: "#2563eb", margin: 0, fontWeight: 600 }}>Company Valuation</p>
                  <p style={{ fontSize: "16px", fontWeight: 700, margin: "4px 0 0", color: "#1d4ed8" }}>{fmtVal(valuation)}</p>
                </div>
              )}
            </div>

            {/* Ownership table */}
            <table style={S.table}>
              <thead><tr>
                <th style={hStyle}>Name</th>
                <th style={hStyle}>Role</th>
                <th style={hStyle}>Type</th>
                <th style={hStyle}>Ownership %</th>
                <th style={hStyle}>Shares</th>
                {valuation > 0 && <th style={hStyle}>Stake Value</th>}
                <th style={hStyle}>Vesting</th>
              </tr></thead>
              <tbody>
                {data.members.map((m, i) => {
                  const pct = parseNum(m.pct);
                  const stakeVal = valuation > 0 ? pct / 100 * valuation : 0;
                  const isRound = m.type === "round";
                  const trStyle = isRound ? { background: "#fffbeb" } : {};
                  return (
                    <tr key={i} style={trStyle}>
                      <td style={{ ...rowStyle, fontWeight: 600, fontStyle: isRound ? "italic" : "normal", color: isRound ? "#92400e" : undefined }}>{m.name}</td>
                      <td style={{ ...rowStyle, color: isRound ? "#b45309" : undefined, fontSize: "13px" }}>{m.role}</td>
                      <td style={{ ...rowStyle, fontSize: "12px", color: typeColor[m.type] || "#64748b" }}>{typeLabel[m.type] || m.type}</td>
                      <td style={{ ...rowStyle, fontWeight: 700, color: typeColor[m.type] || "#2563eb" }}>{pct.toFixed(2)}%</td>
                      <td style={{ ...rowStyle, fontFamily: "monospace", color: isRound ? "#92400e" : undefined }}>{fmtN(Math.round(pct / 100 * TOTAL_AUTHORIZED))}</td>
                      {valuation > 0 && <td style={{ ...rowStyle, fontFamily: "monospace", color: isRound ? "#b45309" : "#1d4ed8", fontWeight: 600, fontStyle: isRound ? "italic" : "normal" }}>{isRound ? `~${fmtVal(stakeVal)}` : fmtVal(stakeVal)}</td>}
                      <td style={{ ...rowStyle, fontSize: "12px", color: isRound ? "#b45309" : "#7c3aed", fontStyle: isRound ? "italic" : "normal" }}>{isRound ? "Indicative — subject to term sheet" : m.vesting}</td>
                    </tr>
                  );
                })}
                {available > 0.01 && (
                  <tr style={{ background: "#f0fdf4" }}>
                    <td style={{ ...rowStyle, fontWeight: 600, color: "#059669" }}>Available Pool</td>
                    <td style={{ ...rowStyle, color: "#94a3b8" }}>Future Rounds</td>
                    <td style={{ ...rowStyle, color: "#94a3b8", fontSize: "12px" }}>Unissued</td>
                    <td style={{ ...rowStyle, fontWeight: 700, color: "#059669" }}>{available.toFixed(2)}%</td>
                    <td style={{ ...rowStyle, fontFamily: "monospace", color: "#059669" }}>{fmtN(Math.round(available / 100 * TOTAL_AUTHORIZED))}</td>
                    {valuation > 0 && <td style={{ ...rowStyle, fontFamily: "monospace", color: "#059669" }}>{fmtVal(available / 100 * valuation)}</td>}
                    <td style={{ ...rowStyle, color: "#94a3b8", fontSize: "12px" }}>—</td>
                  </tr>
                )}
                <tr style={{ background: "#f8fafc" }}>
                  <td style={{ ...rowStyle, fontWeight: 700 }}>Total</td>
                  <td colSpan={2} style={rowStyle}></td>
                  <td style={{ ...rowStyle, fontWeight: 700 }}>100.00%</td>
                  <td style={{ ...rowStyle, fontFamily: "monospace", fontWeight: 700 }}>{fmtN(TOTAL_AUTHORIZED)}</td>
                  {valuation > 0 && <td style={{ ...rowStyle, fontFamily: "monospace", fontWeight: 700, color: "#1d4ed8" }}>{fmtVal(valuation)}</td>}
                  <td style={rowStyle}></td>
                </tr>
              </tbody>
            </table>
          </>
        );
      })()}

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
  const { data, draft, editing, saving, editUnlocked, startEdit, cancelEdit, save, setField } =
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
      <DocEditBar editUnlocked={editUnlocked} editing={false} saving={false} onEdit={startEdit} onSave={save} onCancel={cancelEdit} />
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

/* ─── MODAL CONTENT ROUTER ─── */
function DocContent({ docId, token }: { docId: string; token: string }) {
  const meta: Record<string, { title: string; subtitle: string }> = {
    "exec-summary": { title: "Executive Summary", subtitle: "Company overview, problem, solution, and the ask" },
    "revenue-breakdown": { title: "Revenue Breakdown", subtitle: "Fee structure, projections, and unit economics" },
    "cost-breakdown":    { title: "Cost Breakdown",    subtitle: "Annual COGS & OpEx by category with efficiency metrics" },
    "oracle-strategy": { title: "Oracle Strategy", subtitle: "Architecture, limitations, and decentralisation roadmap" },
    "security-audit": { title: "Security Audit", subtitle: "Pre-audit scan results and pre-mainnet checklist" },
    "demo-video": { title: "Product Demo Video", subtitle: "Video walkthrough of the Wallet and Hedge products" },
    "market-opportunity": { title: "Market Opportunity", subtitle: "TAM / SAM / SOM and growth drivers" },
    "competitive-landscape": { title: "Competitive Landscape", subtitle: "Side-by-side comparison across key dimensions" },
    "gtm-strategy": { title: "Go-to-Market Strategy", subtitle: "4-phase GTM, partnerships, and flywheel" },
    "incorporation":         { title: "Incorporation",         subtitle: "Ghana entity (active) · Delaware C-Corp in progress" },
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
      {docId === "revenue-breakdown" && <RevenueBreakdown />}
      {docId === "cost-breakdown"    && <CostBreakdownDoc />}
      {docId === "oracle-strategy"        && <OracleStrategyDoc token={token} />}
      {docId === "security-audit"         && <SecurityAuditDoc token={token} />}
      {docId === "demo-video"             && <DemoVideoDoc token={token} />}
      {docId === "market-opportunity"     && <MarketOpportunityDoc token={token} />}
      {docId === "competitive-landscape"  && <CompetitiveLandscapeDoc token={token} />}
      {docId === "gtm-strategy"           && <GTMStrategyDoc token={token} />}
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
      sessionStorage.setItem(SESSION_KEY, data.token);
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
    sessionStorage.removeItem(SESSION_KEY);
    onLogout();
  }, [token, onLogout]);

  const handleOpen = (doc: typeof CATEGORIES[0]["documents"][0]) => {
    if (doc.type === "coming-soon") { toast({ title: "Coming soon", description: "This document will be available shortly." }); return; }
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
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h1 style={{ fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>BlockFinaX · Investor Data Room</h1>
            <p style={{ fontSize: "12px", color: "#94a3b8" }}>Confidential — authorised access only</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "12px", color: "#16a34a", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "999px", padding: "4px 10px" }}>
              <ShieldCheck style={{ width: "12px", height: "12px" }} /> Secure session
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "12px", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "999px", padding: "4px 10px" }}>
              <Clock style={{ width: "12px", height: "12px" }} /> 24h session
            </span>
            <AnimatePresence>
              {editUnlocked && (
                <motion.span initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }}
                  style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "12px", color: "#92400e", background: "#fef3c7", border: "1px solid #fde68a", borderRadius: "999px", padding: "4px 10px", fontWeight: 600 }}>
                  <Edit3 style={{ width: "11px", height: "11px" }} /> Edit mode
                </motion.span>
              )}
            </AnimatePresence>
            <Button variant="outline" size="sm" onClick={handleLogout} style={{ color: "#64748b", fontSize: "13px" }}>
              <LogOut style={{ width: "13px", height: "13px", marginRight: "5px" }} /> Sign out
            </Button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "32px 24px", display: "flex", gap: "28px" }}>
        {/* Sidebar */}
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
                    style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: "12px", padding: "18px", display: "flex", alignItems: "flex-start", gap: "14px", cursor: doc.type === "coming-soon" ? "not-allowed" : "pointer", opacity: doc.type === "coming-soon" ? 0.5 : 1, transition: "box-shadow 0.15s" }}
                    whileHover={doc.type !== "coming-soon" ? { scale: 1.003, boxShadow: "0 4px 14px rgba(0,0,0,0.06)" } : {}}>
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
                      {doc.type === "external" ? <ExternalLink style={{ width: "15px", height: "15px", color: "#cbd5e1" }} />
                        : doc.type === "coming-soon" ? <span style={{ fontSize: "11px", color: "#94a3b8" }}>Soon</span>
                        : doc.type === "navigate" ? <ExternalLink style={{ width: "15px", height: "15px", color: "#cbd5e1" }} />
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
  const [token, setToken] = useState<string | null>(null);
  const [initialEditEnabled, setInitialEditEnabled] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (!stored) { setChecking(false); return; }
    fetch("/api/investor/verify", { headers: { "x-investor-token": stored } })
      .then(r => r.json())
      .then(d => {
        if (d.valid) { setToken(stored); setInitialEditEnabled(!!d.editEnabled); }
        else sessionStorage.removeItem(SESSION_KEY);
      })
      .catch(() => sessionStorage.removeItem(SESSION_KEY))
      .finally(() => setChecking(false));
  }, []);

  if (checking) return (
    <div style={{ minHeight: "100vh", background: "#0a1628", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: "30px", height: "30px", border: "2px solid #3d8ef5", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
    </div>
  );

  if (token) return (
    <DataRoomContent
      token={token}
      initialEditEnabled={initialEditEnabled}
      onLogout={() => { setToken(null); setInitialEditEnabled(false); }}
    />
  );
  return <PasswordGate onSuccess={(tok, editEnabled) => { setToken(tok); setInitialEditEnabled(editEnabled); }} />;
}
