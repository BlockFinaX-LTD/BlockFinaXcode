import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import {
  Lock, LogOut, ExternalLink, FileText, BarChart2, Globe,
  PlayCircle, Beaker, ShieldCheck, BookOpen, ChevronRight,
  Eye, Clock, Building2, ArrowLeft, Pencil, Check, X, Video
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

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
      { id: "bog-sandbox", title: "Bank of Ghana Sandbox", description: "Regulatory sandbox application status, compliance framework, and market entry roadmap", href: null, type: "modal" as const, badge: "In Progress", badgeColor: "bg-orange-100 text-orange-700", icon: ShieldCheck },
      { id: "token-legal", title: "Token Legal Opinion", description: "USDC-only model — no native token, no securities classification risk", href: null, type: "coming-soon" as const, badge: "Coming Soon", badgeColor: "bg-slate-100 text-slate-400", icon: FileText },
      { id: "nda-request", title: "Request NDA / Term Sheet", description: "Contact us to request a non-disclosure agreement or investment term sheet", href: "mailto:anthonykumako8@gmail.com?subject=BlockFinaX%20NDA%20Request", type: "external" as const, badge: "Email", badgeColor: "bg-slate-100 text-slate-600", icon: ExternalLink },
    ],
  },
];

/* ─── CONTENT COMPONENTS ─── */

function ExecSummary() {
  return (
    <div>
      <p style={S.p}>BlockFinaX is a blockchain-native P2P parametric protection platform designed for African SMEs, traders, and cross-border businesses. Built on the EIP-2535 Diamond Standard on Lisk L2, it offers fully collateralised downside protection, stop-loss rebates, and volatility buffers across 63 asset pairs — covering 40+ African FX pairs, commodities, and major crypto assets.</p>

      <h2 style={S.h2}>The Problem</h2>
      <p style={S.p}>African SMEs conducting cross-border trade are structurally exposed to FX volatility, with swings of <strong>8–25%</strong> common on pairs like GHS/USD, NGN/USD, and KES/USD. No accessible, transparent hedging product exists for sub-$1M trade flows. Banks ignore them. OTC brokers are opaque and expensive. DeFi protocols don't cover African pairs.</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", margin: "16px 0" }}>
        <div style={S.stat}><div style={S.statVal}>$210B</div><div style={S.statLbl}>African cross-border trade (2024)</div></div>
        <div style={S.stat}><div style={S.statVal}>$35B</div><div style={S.statLbl}>Annual FX losses for SMEs</div></div>
        <div style={S.stat}><div style={S.statVal}>63</div><div style={S.statLbl}>Asset pairs covered at launch</div></div>
      </div>

      <h2 style={S.h2}>The Solution</h2>
      <p style={S.p}><strong>BlockFinaX Hedge</strong> — P2P one-touch parametric contracts. Hedgers buy downside protection against a specific FX strike level. LPs provide liquidity and earn premiums. No counterparty risk: payouts are reserved on-chain the moment a hedge is purchased. Settlement is automatic — triggered when the price touches the strike, or at expiry.</p>
      <p style={S.p}><strong>BlockFinaX Wallet</strong> — Non-custodial USDC wallet with AES-256 encrypted key storage, gasless transactions, and real-time cross-border transfers at 0.3% (min $0.50).</p>

      <h2 style={S.h2}>Traction</h2>
      <p style={S.p}>Live on Lisk Sepolia testnet. Smart contracts verified on Blockscout. FX oracle running — polling ExchangeRate-API, Yahoo Finance, and CoinGecko every 5 minutes, automatically settling expired hedge events. Bank of Ghana regulatory sandbox application filed Q1 2026.</p>

      <h2 style={S.h2}>Technology</h2>
      <p style={S.p}>Diamond Standard (EIP-2535) for upgradeable contract architecture. HedgeFacet encapsulates all P2P hedge logic. USDC as the sole settlement token. Lisk L2 for near-zero gas fees, enabling micro-hedges starting from $10.</p>
      <p style={{ fontSize: "13px", color: "#64748b", fontFamily: "monospace", background: "#f8fafc", padding: "8px 12px", borderRadius: "6px" }}>
        Diamond: 0x3582D8f5f88ef557ce10Af26834FAC8B8e1445bf · HedgeFacet: 0x1B2aca3f871e9AF5D88C28862375601a2552bBb2
      </p>

      <h2 style={S.h2}>The Ask</h2>
      <table style={S.table}>
        <thead><tr><th style={S.th}>Round</th><th style={S.th}>Amount</th><th style={S.th}>Timing</th><th style={S.th}>Use of Funds</th></tr></thead>
        <tbody>
          <tr><td style={S.td}><span style={S.tag("blue")}>Pre-Seed</span></td><td style={S.td}>$500K</td><td style={S.td}>Now (H1 2026)</td><td style={S.td}>Engineering, audit, regulatory sandbox</td></tr>
          <tr><td style={S.td}><span style={S.tag("green")}>Series A</span></td><td style={S.td}>$5M</td><td style={S.td}>H2 2027</td><td style={S.td}>Market expansion, BD, multi-signer oracle, institutional LP onboarding</td></tr>
          <tr><td style={S.td}><span style={S.tag("amber")}>Series B</span></td><td style={S.td}>$7M</td><td style={S.td}>H2 2028</td><td style={S.td}>New markets (Kenya, Nigeria), enterprise integrations, liquidity depth</td></tr>
        </tbody>
      </table>

      <h2 style={S.h2}>Mainnet Timeline</h2>
      <p style={S.p}><strong>July 7, 2026</strong> — Mainnet launch on Lisk L2, following third-party security audit and Bank of Ghana sandbox approval.</p>
    </div>
  );
}

function RevenueBreakdown() {
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
      <table style={S.table}>
        <thead><tr><th style={S.th}>Year</th><th style={S.th}>Notional Hedged</th><th style={S.th}>Hedge Revenue</th><th style={S.th}>Wallet Revenue</th><th style={S.th}>Total Revenue</th></tr></thead>
        <tbody>
          <tr><td style={S.td}><strong>2027 (Year 1)</strong></td><td style={S.td}>$583M</td><td style={S.td}>$4.8M</td><td style={S.td}>$0.7M</td><td style={S.td}><strong>$5.5M</strong></td></tr>
          <tr><td style={S.td}><strong>2028 (Year 2)</strong></td><td style={S.td}>$3.3B</td><td style={S.td}>$28M</td><td style={S.td}>$4M</td><td style={S.td}><strong>$32M</strong></td></tr>
          <tr><td style={S.td}><strong>2029 (Year 3)</strong></td><td style={S.td}>$11B</td><td style={S.td}>$94M</td><td style={S.td}>$14M</td><td style={S.td}><strong>$108M</strong></td></tr>
        </tbody>
      </table>

      <h2 style={S.h2}>Unit Economics</h2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "10px", margin: "12px 0" }}>
        <div style={S.stat}><div style={S.statVal}>~0.94%</div><div style={S.statLbl}>Blended take rate (hedge)</div></div>
        <div style={S.stat}><div style={S.statVal}>$50K</div><div style={S.statLbl}>Avg hedge event notional</div></div>
        <div style={S.stat}><div style={S.statVal}>$470</div><div style={S.statLbl}>Avg revenue per event</div></div>
        <div style={S.stat}><div style={S.statVal}>14–30d</div><div style={S.statLbl}>Avg hedge duration</div></div>
      </div>

      <h2 style={S.h2}>Revenue Mix</h2>
      <p style={S.p}>In Year 1 (2027), hedge fees account for approximately <strong>87%</strong> of total revenue, with wallet transfers contributing <strong>13%</strong>. By Year 3, the wallet share grows as cross-border payment volume scales independently of hedge activity.</p>

      <h2 style={S.h2}>Margin Profile</h2>
      <p style={S.p}>The platform is asset-light — BlockFinaX does not take principal risk. Hedges are fully collateralised by LPs. Revenue is purely fee-based. Gross margins are expected to exceed <strong>80%</strong> at scale, as infrastructure costs (Lisk L2 gas, oracle, hosting) do not scale linearly with volume.</p>
    </div>
  );
}

function OracleStrategyDoc() {
  return (
    <div>
      <p style={S.p}>BlockFinaX operates as a P2P parametric protection platform covering 63 asset pairs across African FX, commodities, and crypto. At the core of every hedge settlement is a price oracle — the mechanism that determines whether a strike price has been touched and triggers payouts.</p>

      <h2 style={S.h2}>Current Implementation</h2>
      <p style={S.p}>BlockFinaX uses a <strong>custodial push oracle</strong> model. The platform backend fetches prices from multiple external APIs on a 5-minute polling cycle and submits settlement prices directly to the Diamond smart contract when a strike condition is met.</p>

      <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "14px 18px", margin: "12px 0" }}>
        <p style={{ ...S.p, marginBottom: "6px" }}><strong>Data Sources:</strong></p>
        <ul style={{ fontSize: "13px", color: "#475569", paddingLeft: "18px", lineHeight: 1.8 }}>
          <li><strong>FX Rates:</strong> ExchangeRate-API (two endpoints, equal-weight averaged)</li>
          <li><strong>Commodities:</strong> Yahoo Finance (metals, energy, agriculture)</li>
          <li><strong>Crypto:</strong> CoinGecko (BTC, ETH, BNB, SOL, XRP, ADA)</li>
        </ul>
      </div>

      <p style={{ ...S.p, fontFamily: "monospace", fontSize: "12px", background: "#f8fafc", padding: "8px 12px", borderRadius: "6px" }}>
        Oracle admin: 0xef5Bed7c221c85A2c88e3c0223ee45482d6F037d
      </p>

      <h2 style={S.h2}>Known Limitations</h2>
      <table style={S.table}>
        <thead><tr><th style={S.th}>Risk</th><th style={S.th}>Description</th><th style={S.th}>Status</th></tr></thead>
        <tbody>
          <tr><td style={S.td}>Centralisation</td><td style={S.td}>Single private key controls all settlements</td><td style={S.td}><span style={S.tag("amber")}>Pre-mainnet fix</span></td></tr>
          <tr><td style={S.td}>Single point of failure</td><td style={S.td}>Backend outage halts all settlements</td><td style={S.td}><span style={S.tag("amber")}>Phase 2</span></td></tr>
          <tr><td style={S.td}>No on-chain provenance</td><td style={S.td}>Price source is not verifiable on-chain</td><td style={S.td}><span style={S.tag("amber")}>Phase 3</span></td></tr>
          <tr><td style={S.td}>5-minute latency</td><td style={S.td}>Fast-moving markets may miss intraday touches</td><td style={S.td}><span style={S.tag("blue")}>Accepted for now</span></td></tr>
          <tr><td style={S.td}>No decentralised alternative</td><td style={S.td}>Chainlink/Pyth don't support 40+ African FX pairs</td><td style={S.td}><span style={S.tag("blue")}>Phase 4</span></td></tr>
        </tbody>
      </table>

      <h2 style={S.h2}>Decentralisation Roadmap</h2>

      <h3 style={S.h3}>Phase 1 — Multi-Source Aggregation (Live)</h3>
      <p style={S.p}>Dual-source averaging for FX (two ExchangeRate-API endpoints). Anomaly detection planned — reject rates deviating more than 5% from the median of all sources before submission.</p>

      <h3 style={S.h3}>Phase 2 — Multi-Signer Oracle Relay (Pre-Mainnet)</h3>
      <p style={S.p}>Replace single admin key with a 3-of-5 multisig oracle relay. Multiple independent signers must agree on a price before any settlement is submitted. Gnosis Safe as the signing infrastructure.</p>

      <h3 style={S.h3}>Phase 3 — Chainlink / Pyth Integration (Series A, 2027)</h3>
      <p style={S.p}>Integrate Chainlink Data Feeds for crypto prices (already available). Advocate for Chainlink or Pyth coverage of major African FX pairs (GHS/USD, KES/USD, NGN/USD). Hybrid model: on-chain oracle for available pairs; signed off-chain feed for African FX.</p>

      <h3 style={S.h3}>Phase 4 — On-Chain Oracle DAO (Series B, 2028)</h3>
      <p style={S.p}>Open oracle participation to permissioned third-party data providers. Stake-weighted median aggregation. Dispute window before settlement is final. Moves BlockFinaX from "trusted operator" to "verifiable protocol".</p>
    </div>
  );
}

function SecurityAuditDoc() {
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "10px", marginBottom: "20px" }}>
        <div style={{ ...S.stat, borderColor: "#86efac" }}><div style={{ ...S.statVal, color: "#16a34a" }}>70.94</div><div style={S.statLbl}>Audit score (out of 100)</div></div>
        <div style={S.stat}><div style={{ ...S.statVal, color: "#dc2626" }}>0</div><div style={S.statLbl}>Critical findings</div></div>
        <div style={S.stat}><div style={{ ...S.statVal, color: "#d97706" }}>1</div><div style={S.statLbl}>High severity (fixed)</div></div>
        <div style={S.stat}><div style={S.statVal}>3</div><div style={S.statLbl}>Medium severity</div></div>
      </div>

      <p style={S.p}>Pre-audit scan conducted Q1 2026 using SmartLock automated analysis + manual review of all HedgeFacet functions. A formal third-party audit (Certik or Trail of Bits) is scheduled for Q2 2026 ahead of mainnet launch.</p>

      <h2 style={S.h2}>Findings Summary</h2>
      <table style={S.table}>
        <thead><tr><th style={S.th}>Severity</th><th style={S.th}>Issue</th><th style={S.th}>Status</th></tr></thead>
        <tbody>
          <tr><td style={S.td}><span style={S.tag("red")}>High</span></td><td style={S.td}>Reentrancy vulnerability in <code>claimPayout()</code> — malicious LP could trigger recursive withdrawal</td><td style={S.td}><span style={S.tag("green")}>Fixed — ReentrancyGuard added</span></td></tr>
          <tr><td style={S.td}><span style={S.tag("amber")}>Medium</span></td><td style={S.td}>Access control: <code>settleEvent()</code> callable by any address on testnet</td><td style={S.td}><span style={S.tag("amber")}>Mitigated — admin-only modifier</span></td></tr>
          <tr><td style={S.td}><span style={S.tag("amber")}>Medium</span></td><td style={S.td}>Integer overflow risk in premium calculation for large notional values</td><td style={S.td}><span style={S.tag("green")}>Fixed — SafeMath checks added</span></td></tr>
          <tr><td style={S.td}><span style={S.tag("amber")}>Medium</span></td><td style={S.td}>Event expiry boundary condition allows settlement 1 block after expiry</td><td style={S.td}><span style={S.tag("green")}>Fixed — strict timestamp comparison</span></td></tr>
          <tr><td style={S.td}><span style={S.tag("blue")}>Low</span></td><td style={S.td}>Gas optimisation: redundant SLOAD in <code>getLpBalance()</code></td><td style={S.td}><span style={S.tag("green")}>Fixed</span></td></tr>
          <tr><td style={S.td}><span style={S.tag("blue")}>Low</span></td><td style={S.td}>Missing event emission on LP withdrawal</td><td style={S.td}><span style={S.tag("green")}>Fixed</span></td></tr>
          <tr><td style={S.td}><span style={S.tag("blue")}>Low</span></td><td style={S.td}>ERC-20 return value not checked in USDC transfer</td><td style={S.td}><span style={S.tag("green")}>Fixed — SafeERC20 used</span></td></tr>
          <tr><td style={S.td}><span style={S.tag("blue")}>Low</span></td><td style={S.td}>Unchecked return value on internal fee transfer</td><td style={S.td}><span style={S.tag("green")}>Fixed</span></td></tr>
          <tr><td style={S.td}><span style={S.tag("blue")}>Low</span></td><td style={S.td}>Hardcoded USDC address — not upgradeable without DiamondCut</td><td style={S.td}><span style={S.tag("blue")}>Accepted risk</span></td></tr>
        </tbody>
      </table>

      <h2 style={S.h2}>Pre-Mainnet Security Checklist</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", margin: "12px 0" }}>
        {[
          ["Formal third-party audit (Certik / Trail of Bits)", "Q2 2026", "pending"],
          ["Gnosis Safe multisig on oracle admin wallet", "Pre-launch", "pending"],
          ["Timelock on Diamond upgrades (48h delay)", "Pre-launch", "pending"],
          ["Emergency pause mechanism on HedgeFacet", "Pre-launch", "pending"],
          ["Multi-signer oracle relay (3-of-5)", "Pre-launch", "pending"],
          ["ReentrancyGuard on all state-changing functions", "Done", "done"],
          ["SafeERC20 for all USDC transfers", "Done", "done"],
          ["Contract verification on Blockscout", "Done", "done"],
        ].map(([item, timing, status]) => (
          <div key={item as string} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px", background: status === "done" ? "#f0fdf4" : "#f8fafc", borderRadius: "6px", border: `1px solid ${status === "done" ? "#bbf7d0" : "#e2e8f0"}` }}>
            <span style={{ fontSize: "16px" }}>{status === "done" ? "✅" : "⬜"}</span>
            <span style={{ fontSize: "13px", color: "#334155", flex: 1 }}>{item}</span>
            <span style={{ fontSize: "11px", color: "#64748b" }}>{timing}</span>
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
          <Button variant="outline" size="sm" onClick={() => setEditing(true)} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
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

function MarketOpportunityDoc() {
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "20px" }}>
        <div style={S.stat}><div style={S.statVal}>$210B</div><div style={S.statLbl}>TAM — African cross-border trade (2024)</div></div>
        <div style={S.stat}><div style={S.statVal}>$35B</div><div style={S.statLbl}>SAM — Annual FX losses for SMEs</div></div>
        <div style={{ ...S.stat, borderColor: "#86efac" }}><div style={{ ...S.statVal, color: "#16a34a" }}>$583M</div><div style={S.statLbl}>SOM Year 1 — 1.7% of SAM (2027)</div></div>
      </div>

      <h2 style={S.h2}>Total Addressable Market (TAM)</h2>
      <p style={S.p}>African cross-border trade flows exceed <strong>$210B annually</strong>, growing at approximately 12% CAGR, driven by mobile money adoption, infrastructure improvements, and regional trade agreements (AfCFTA). The majority of this trade is conducted by SMEs — importers, exporters, manufacturers, and remittance-dependent businesses — that lack access to professional FX hedging tools.</p>

      <h2 style={S.h2}>Serviceable Available Market (SAM)</h2>
      <p style={S.p}>An estimated <strong>$35B per year</strong> is lost by African SMEs to unhedged FX volatility. Key corridors include GHS/USD (Ghana), NGN/USD (Nigeria), KES/USD (Kenya), and ZAR/USD (South Africa). Volatility ranges from 8–25% annually on these pairs — unacceptable for businesses operating on thin margins.</p>
      <p style={S.p}>BlockFinaX's SAM is the subset of these losses that can be addressed by parametric hedging products: businesses with predictable, scheduled FX exposure (e.g., import payment in 30 days) who would pay a small premium to cap their downside.</p>

      <h2 style={S.h2}>Serviceable Obtainable Market (SOM) — Projections</h2>
      <table style={S.table}>
        <thead><tr><th style={S.th}>Year</th><th style={S.th}>Notional Hedged</th><th style={S.th}>SAM Share</th><th style={S.th}>Active Users</th><th style={S.th}>Revenue</th></tr></thead>
        <tbody>
          <tr><td style={S.td}><strong>2027</strong></td><td style={S.td}>$583M</td><td style={S.td}>1.7%</td><td style={S.td}>~2,500</td><td style={S.td}><strong>$5.5M</strong></td></tr>
          <tr><td style={S.td}><strong>2028</strong></td><td style={S.td}>$3.3B</td><td style={S.td}>9.4%</td><td style={S.td}>~15,000</td><td style={S.td}><strong>$32M</strong></td></tr>
          <tr><td style={S.td}><strong>2029</strong></td><td style={S.td}>$11B</td><td style={S.td}>31%</td><td style={S.td}>~50,000</td><td style={S.td}><strong>$108M</strong></td></tr>
        </tbody>
      </table>

      <h2 style={S.h2}>Key Growth Drivers</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: "10px", margin: "12px 0" }}>
        {[
          ["594M mobile money accounts in Sub-Saharan Africa", "Infrastructure"],
          ["Lisk L2 near-zero gas fees enable micro-hedges from $10", "Technology"],
          ["USDC as settlement — no FX execution risk at point of hedge", "Product"],
          ["No incumbent serving sub-$1M cross-border trade hedging", "Market gap"],
          ["AfCFTA driving 60% more intra-African trade by 2030", "Macro"],
          ["Bank of Ghana regulatory sandbox — first-mover advantage in Ghana", "Regulatory"],
        ].map(([text, label]) => (
          <div key={text as string} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px", background: "#f8fafc", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
            <span style={{ fontSize: "13px", color: "#334155", flex: 1 }}>{text}</span>
            <span style={S.tag("blue")}>{label}</span>
          </div>
        ))}
      </div>

      <h2 style={S.h2}>Regional Focus</h2>
      <p style={S.p}><strong>Pilot:</strong> Ghana (GHS pairs, Bank of Ghana sandbox approval) → <strong>2027:</strong> Nigeria, Kenya → <strong>2028:</strong> South Africa, Francophone West Africa (CEMAC/BCEAO currencies)</p>
    </div>
  );
}

function CompetitiveLandscapeDoc() {
  const rows = [
    ["P2P structure", "✅", "❌", "❌", "⚡ Partial", "✅"],
    ["African FX coverage", "✅", "✅ Limited", "⚡ Some", "❌", "❌"],
    ["On-chain settlement", "✅", "❌", "❌", "✅", "✅"],
    ["No counterparty risk", "✅", "❌", "❌", "⚡ Varies", "⚡ Varies"],
    ["Accessible to SMEs", "✅", "❌ Min $1M+", "❌ Opaque", "❌ Complex", "⚡ Limited"],
    ["Fully collateralised", "✅", "❌", "❌", "✅", "⚡"],
    ["Regulatory sandbox", "✅ In progress", "✅", "⚡ Varies", "❌", "❌"],
    ["Min trade size", "$10 USDC", "~$250K", "~$100K", "Gas-limited", "~$10"],
    ["Africa-native product", "✅", "❌", "❌", "❌", "❌"],
  ];

  return (
    <div>
      <p style={S.p}>BlockFinaX occupies a unique position — the only blockchain-native P2P parametric protection platform designed specifically for African FX, commodity, and crypto pairs. No direct competitor combines all five core attributes: P2P structure, African pair coverage, on-chain settlement, SME accessibility, and regulatory engagement.</p>

      <h2 style={S.h2}>Comparison Table</h2>
      <div style={{ overflowX: "auto" }}>
        <table style={{ ...S.table, minWidth: "700px" }}>
          <thead>
            <tr>
              <th style={S.th}>Feature</th>
              <th style={{ ...S.th, background: "#eff6ff", color: "#1d4ed8" }}>BlockFinaX</th>
              <th style={S.th}>Traditional Banks</th>
              <th style={S.th}>OTC Brokers</th>
              <th style={S.th}>DeFi Protocols</th>
              <th style={S.th}>Prediction Markets</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([feature, ...vals]) => (
              <tr key={feature as string}>
                <td style={{ ...S.td, fontWeight: 500, color: "#334155" }}>{feature}</td>
                <td style={{ ...S.td, background: "#f0f9ff", fontWeight: 600, color: "#1e40af" }}>{vals[0]}</td>
                <td style={S.td}>{vals[1]}</td>
                <td style={S.td}>{vals[2]}</td>
                <td style={S.td}>{vals[3]}</td>
                <td style={S.td}>{vals[4]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 style={S.h2}>Key Differentiators</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: "10px", margin: "12px 0" }}>
        {[
          ["Africa-first by design", "63 pairs launch with 40+ African FX pairs — no competitor covers this universe"],
          ["Fully collateralised P2P", "LP capital locks payout before any hedger buys — zero platform risk"],
          ["Parametric = instant settlement", "No disputes, no documentation — price touches strike, payout triggers automatically"],
          ["Lisk L2 economics", "Gas fees under $0.01 per transaction make micro-hedges viable for the first time"],
          ["Regulatory-aligned", "USDC-only, no leverage, on-chain audit trail — designed for sandbox approval"],
        ].map(([title, desc]) => (
          <div key={title as string} style={{ padding: "12px 16px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "#1e293b", marginBottom: "3px" }}>{title}</div>
            <div style={{ fontSize: "13px", color: "#64748b" }}>{desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function GTMStrategyDoc() {
  const phases = [
    {
      num: "1", title: "Community Beta", period: "H1 2026", color: "#dbeafe",
      target: "Crypto-native users, DeFi traders, Web3 community members",
      channels: "Discord, Twitter/X, Web3 communities, testnet campaigns, hackathons",
      goal: "1,000 wallets, 500 active hedge positions, $500K TVL",
      metrics: "Cost of acquisition: <$10/user · Avg position size: $500",
    },
    {
      num: "2", title: "SME Direct", period: "H2 2026 – H1 2027", color: "#dcfce7",
      target: "African SMEs with structured FX exposure: importers, exporters, diaspora businesses",
      channels: "Direct sales, fintech conferences (AfricaFinTech, Money2020 Africa), referral programme",
      goal: "10,000 wallets, $50M monthly notional, Bank of Ghana approval",
      metrics: "Cost of acquisition: <$50/user · Avg position size: $5,000",
    },
    {
      num: "3", title: "Channel Partners", period: "H2 2027 – H1 2028", color: "#fef3c7",
      target: "Banks, fintechs, treasury desks, payment platforms",
      channels: "API integration, white-label product, revenue-share partnerships",
      goal: "3 institutional LP partners, $200M monthly notional",
      metrics: "Revenue share: 15% of platform fees to channel partners",
    },
    {
      num: "4", title: "Flywheel", period: "H2 2028+", color: "#f3e8ff",
      target: "Full regional expansion: East Africa, Francophone, Southern Africa",
      channels: "Network effects, LP depth driving better pricing, new pair additions",
      goal: "$1B+ monthly notional, 50,000+ active users, multi-regulator approvals",
      metrics: "LTV:CAC >10x · Net revenue retention >120%",
    },
  ];

  return (
    <div>
      <p style={S.p}>BlockFinaX's go-to-market strategy follows a deliberate 4-phase progression: build community trust and product-market fit, then expand to SME direct sales, then leverage channel partners for institutional liquidity, then activate the LP network flywheel for exponential growth.</p>

      {phases.map(ph => (
        <div key={ph.num} style={{ background: ph.color, border: "1px solid rgba(0,0,0,0.06)", borderRadius: "12px", padding: "18px 20px", marginBottom: "14px" }}>
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
          <tr><td style={S.td}>Mobile money</td><td style={S.td}>M-Pesa, MTN MoMo</td><td style={S.td}>On/off ramp + distribution</td><td style={S.td}><span style={S.tag("green")}>Phase 2</span></td></tr>
          <tr><td style={S.td}>Pan-African fintechs</td><td style={S.td}>Chipper Cash, Flutterwave</td><td style={S.td}>User distribution, FX corridors</td><td style={S.td}><span style={S.tag("green")}>Phase 2</span></td></tr>
          <tr><td style={S.td}>Trade finance banks</td><td style={S.td}>Ecobank, Access Bank</td><td style={S.td}>LP liquidity + institutional credibility</td><td style={S.td}><span style={S.tag("amber")}>Phase 3</span></td></tr>
          <tr><td style={S.td}>Lisk ecosystem</td><td style={S.td}>Lisk Foundation</td><td style={S.td}>Grant funding + co-marketing</td><td style={S.td}><span style={S.tag("blue")}>Phase 1</span></td></tr>
        </tbody>
      </table>
    </div>
  );
}

function BoGSandboxDoc() {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "14px 18px", background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: "10px", marginBottom: "20px" }}>
        <span style={{ fontSize: "22px" }}>⏳</span>
        <div>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "#92400e" }}>Application In Progress</div>
          <div style={{ fontSize: "13px", color: "#b45309" }}>Filed Q1 2026 · Decision expected Q3 2026</div>
        </div>
      </div>

      <p style={S.p}>BlockFinaX has applied for admission to the Bank of Ghana's Regulatory Sandbox — a controlled environment for testing innovative fintech products under regulatory supervision. Admission would grant a time-limited licence to operate in Ghana while formal regulation is developed around on-chain parametric protection products.</p>

      <h2 style={S.h2}>What We Applied For</h2>
      <ul style={{ fontSize: "14px", color: "#475569", paddingLeft: "18px", lineHeight: 2 }}>
        <li>A sandbox licence to offer parametric FX protection contracts to Ghanaian SMEs</li>
        <li>Permission to settle contracts in USDC on a public blockchain (Lisk Sepolia / Lisk Mainnet)</li>
        <li>Regulatory safe harbour during the sandbox period for on-chain settlement mechanisms</li>
        <li>Access to the Bank of Ghana's FinTech and Innovation Office for dialogue on licensing frameworks</li>
      </ul>

      <h2 style={S.h2}>Compliance Framework</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", margin: "12px 0" }}>
        {[
          ["USDC-only settlement", "No native token — no securities classification risk", "done"],
          ["Fully pre-funded pools", "Hedger payouts reserved on-chain before purchase — no undercollateralisation", "done"],
          ["Immutable on-chain audit trail", "Every settlement recorded permanently on Lisk L2", "done"],
          ["No leverage", "Hedgers can only lose their premium — no amplified loss risk", "done"],
          ["No algorithmic trading", "All contracts are user-initiated — no automated position-taking", "done"],
          ["KYC/AML roadmap", "Wallet-based identity linkage to mobile number (planned for commercial launch)", "pending"],
          ["Designated compliance officer", "To be appointed ahead of commercial launch", "pending"],
        ].map(([title, desc, status]) => (
          <div key={title as string} style={{ display: "flex", gap: "10px", padding: "10px 14px", background: status === "done" ? "#f0fdf4" : "#f8fafc", borderRadius: "6px", border: `1px solid ${status === "done" ? "#bbf7d0" : "#e2e8f0"}` }}>
            <span style={{ fontSize: "16px", flexShrink: 0 }}>{status === "done" ? "✅" : "⬜"}</span>
            <div><div style={{ fontSize: "13px", fontWeight: 600, color: "#1e293b" }}>{title}</div><div style={{ fontSize: "12px", color: "#64748b" }}>{desc}</div></div>
          </div>
        ))}
      </div>

      <h2 style={S.h2}>Timeline</h2>
      <table style={S.table}>
        <thead><tr><th style={S.th}>Milestone</th><th style={S.th}>Date</th><th style={S.th}>Status</th></tr></thead>
        <tbody>
          <tr><td style={S.td}>Application filed</td><td style={S.td}>Q1 2026</td><td style={S.td}><span style={S.tag("green")}>Complete</span></td></tr>
          <tr><td style={S.td}>Bank of Ghana decision</td><td style={S.td}>Q3 2026</td><td style={S.td}><span style={S.tag("amber")}>Pending</span></td></tr>
          <tr><td style={S.td}>Sandbox period (if approved)</td><td style={S.td}>Q4 2026 – Q2 2027</td><td style={S.td}><span style={S.tag("blue")}>Planned</span></td></tr>
          <tr><td style={S.td}>Commercial launch in Ghana</td><td style={S.td}>Q1 2027</td><td style={S.td}><span style={S.tag("blue")}>Planned</span></td></tr>
        </tbody>
      </table>

      <h2 style={S.h2}>Other Markets Roadmap</h2>
      <table style={S.table}>
        <thead><tr><th style={S.th}>Market</th><th style={S.th}>Regulator</th><th style={S.th}>Target</th></tr></thead>
        <tbody>
          <tr><td style={S.td}>Kenya</td><td style={S.td}>Capital Markets Authority</td><td style={S.td}>Sandbox application 2027</td></tr>
          <tr><td style={S.td}>Nigeria</td><td style={S.td}>SEC Nigeria Fintech Sandbox</td><td style={S.td}>2028</td></tr>
          <tr><td style={S.td}>Francophone W. Africa</td><td style={S.td}>BCEAO</td><td style={S.td}>Dialogue 2028</td></tr>
        </tbody>
      </table>
    </div>
  );
}

function CostBreakdownDoc() {
  const years = [
    {
      period: "2026 (H2 only)",
      revenue: "$60K",
      personnel: "$95K", marketing: "$14K", legal: "$102K", infra: "$6K", ga: "$10K", totalOpEx: "$227K",
      gas: "$16K", oracle: "$3K", loyalty: "$2K", kyc: "$2K", totalCOGS: "$23K",
      totalCosts: "$250K", costPct: "n/a",
      stage: "Invest", stageColor: "#d97706", stageBg: "#fef3c7",
      note: "Pre-revenue burn phase. Legal & pre-seed setup dominate.",
    },
    {
      period: "2027 (Full Year)",
      revenue: "$5.5M",
      personnel: "$552K", marketing: "$750K", legal: "$252K", infra: "$42K", ga: "$63K", totalOpEx: "$1.66M",
      gas: "$450K", oracle: "$22K", loyalty: "$245K", kyc: "$43K", totalCOGS: "$760K",
      totalCosts: "$2.42M", costPct: "44%",
      stage: "Scale", stageColor: "#1d4ed8", stageBg: "#dbeafe",
      note: "Series A year. Marketing spend drives wallet growth. Gas & creator loyalty grow with volume.",
    },
    {
      period: "2028 (Full Year)",
      revenue: "$32M",
      personnel: "$924K", marketing: "$1.68M", legal: "$300K", infra: "$93K", ga: "$105K", totalOpEx: "$3.10M",
      gas: "$1.26M", oracle: "$39K", loyalty: "$1.37M", kyc: "$126K", totalCOGS: "$2.80M",
      totalCosts: "$5.90M", costPct: "18%",
      stage: "Profitable", stageColor: "#16a34a", stageBg: "#dcfce7",
      note: "Break-even achieved. Revenue scales faster than costs. COGS grows with user volume.",
    },
    {
      period: "2029 (Full Year)",
      revenue: "$108M",
      personnel: "$1.68M", marketing: "$4.60M", legal: "$444K", infra: "$456K", ga: "$270K", totalOpEx: "$7.45M",
      gas: "$4.32M", oracle: "$156K", loyalty: "$4.72M", kyc: "$432K", totalCOGS: "$9.63M",
      totalCosts: "$17.1M", costPct: "16%",
      stage: "High Growth", stageColor: "#7c3aed", stageBg: "#ede9fe",
      note: "Creator loyalty and gas sponsorship dominate COGS — both tied directly to revenue volume.",
    },
    {
      period: "2030 (Full Year)",
      revenue: "$240M",
      personnel: "$2.40M", marketing: "$8.80M", legal: "$528K", infra: "$852K", ga: "$432K", totalOpEx: "$13.0M",
      gas: "$5.94M", oracle: "$330K", loyalty: "$10.0M", kyc: "$594K", totalCOGS: "$16.9M",
      totalCosts: "$29.9M", costPct: "12%",
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
              { label: "Gas Sponsorship",      vals: ["$450K","$1.26M","$4.32M","$5.94M"], driver: "New wallets × $15/wallet — gasless UX subsidy" },
              { label: "Oracle / RPC",          vals: ["$22K",  "$39K",  "$156K", "$330K"],  driver: "On-chain settlement infrastructure, scales with pairs" },
              { label: "Creator Loyalty (5%)",  vals: ["$245K","$1.37M","$4.72M","$10.0M"], driver: "5% of hedge fees paid to event creators" },
              { label: "KYC / AML",             vals: ["$43K",  "$126K", "$432K", "$594K"],  driver: "AML identity verification at $1.50/wallet" },
              { label: "Total COGS",            vals: ["$760K","$2.80M","$9.63M","$16.9M"], driver: "", bold: true },
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
              { label: "Personnel",     vals: ["$552K","$924K",  "$1.68M","$2.40M"], driver: "Headcount × salary/FTE — lean Africa-based team" },
              { label: "Marketing/CAC", vals: ["$750K","$1.68M", "$4.60M","$8.80M"], driver: "New wallets × CAC — paid acquisition & partnerships" },
              { label: "Legal",         vals: ["$252K","$300K",  "$444K", "$528K"],  driver: "Regulatory counsel, sandbox fees, IP, compliance" },
              { label: "Infra / Cloud", vals: ["$42K", "$93K",   "$456K", "$852K"],  driver: "Hosting, RPC nodes, CDN, monitoring, CI/CD" },
              { label: "G&A",           vals: ["$63K", "$105K",  "$270K", "$432K"],  driver: "Office, finance ops, tooling, HR, insurance" },
              { label: "Total OpEx",    vals: ["$1.66M","$3.10M","$7.45M","$13.0M"], driver: "", bold: true },
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
      <p style={S.p}>As revenue grows 44× from 2027 to 2030, the cost mix shifts: personnel dominates early, while creator loyalty and gas (both volume-linked) grow to represent the majority of COGS at scale.</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", margin: "12px 0" }}>
        {[
          {
            year: "2027", total: 2.42,
            items: [
              { label: "Marketing/CAC", val: 0.75,  pct: 31, color: "#a855f7" },
              { label: "Personnel",     val: 0.552, pct: 23, color: "#3b82f6" },
              { label: "Creator Loyalty", val: 0.245, pct: 10, color: "#ec4899" },
              { label: "Gas Sponsorship", val: 0.45,  pct: 19, color: "#f97316" },
              { label: "Legal",         val: 0.252, pct: 10, color: "#f59e0b" },
              { label: "Other",         val: 0.171, pct: 7,  color: "#94a3b8" },
            ],
          },
          {
            year: "2030", total: 29.9,
            items: [
              { label: "Creator Loyalty", val: 10.0, pct: 33, color: "#ec4899" },
              { label: "Marketing/CAC", val: 8.8,  pct: 29, color: "#a855f7" },
              { label: "Gas Sponsorship", val: 5.94, pct: 20, color: "#f97316" },
              { label: "Personnel",     val: 2.4,  pct: 8,  color: "#3b82f6" },
              { label: "Other",         val: 2.76, pct: 10, color: "#94a3b8" },
            ],
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
        <div style={S.stat}><div style={S.statVal}>$2.42M</div><div style={S.statLbl}>Total costs Year 1 (2027)</div></div>
        <div style={S.stat}><div style={S.statVal}>12%</div><div style={S.statLbl}>Cost/Revenue ratio by 2030</div></div>
        <div style={S.stat}><div style={S.statVal}>$96</div><div style={S.statLbl}>Cost per hedge event (2027)</div></div>
        <div style={S.stat}><div style={S.statVal}>$19</div><div style={S.statLbl}>Cost per hedge event (2030)</div></div>
      </div>
      <table style={S.table}>
        <thead><tr><th style={S.th}>Metric</th><th style={S.th}>2027</th><th style={S.th}>2028</th><th style={S.th}>2029</th><th style={S.th}>2030</th></tr></thead>
        <tbody>
          {[
            { label: "Total Costs",            vals: ["$2.42M","$5.90M","$17.1M","$29.9M"] },
            { label: "Cost per Hedge Event",   vals: ["$96",   "$43",   "$22",   "$19"] },
            { label: "Cost per New Wallet",    vals: ["$80",   "$70",   "$60",   "$51"] },
            { label: "Personnel % Total Cost", vals: ["23%",   "16%",   "10%",   "8%"] },
            { label: "Gross Margin",           vals: ["86%",   "91%",   "91%",   "93%"] },
            { label: "EBITDA Margin",          vals: ["56%",   "80%",   "83%",   "88%"] },
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
    "bog-sandbox": { title: "Bank of Ghana Sandbox", subtitle: "Application status, compliance framework, and timeline" },
  };

  const m = meta[docId];
  if (!m) return null;

  return (
    <div>
      <div style={{ marginBottom: "20px" }}>
        <h1 style={S.h1}>{m.title}</h1>
        <p style={{ fontSize: "13px", color: "#64748b" }}>{m.subtitle}</p>
      </div>
      {docId === "exec-summary" && <ExecSummary />}
      {docId === "revenue-breakdown" && <RevenueBreakdown />}
      {docId === "cost-breakdown"    && <CostBreakdownDoc />}
      {docId === "oracle-strategy" && <OracleStrategyDoc />}
      {docId === "security-audit" && <SecurityAuditDoc />}
      {docId === "demo-video" && <DemoVideoDoc token={token} />}
      {docId === "market-opportunity" && <MarketOpportunityDoc />}
      {docId === "competitive-landscape" && <CompetitiveLandscapeDoc />}
      {docId === "gtm-strategy" && <GTMStrategyDoc />}
      {docId === "bog-sandbox" && <BoGSandboxDoc />}
    </div>
  );
}

/* ─── PASSWORD GATE ─── */
function PasswordGate({ onSuccess }: { onSuccess: (token: string) => void }) {
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
      onSuccess(data.token);
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
function DataRoomContent({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [, navigate] = useLocation();
  const [activeCategory, setActiveCategory] = useState("overview");
  const [openDoc, setOpenDoc] = useState<string | null>(null);
  const { toast } = useToast();

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
    <div style={{ minHeight: "100vh", background: "#f8fafc" }}>
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
            <a href="mailto:anthonykumako8@gmail.com?subject=BlockFinaX%20Investor%20Request" style={{ fontSize: "13px", color: "#2563eb", fontWeight: 600, display: "flex", alignItems: "center", gap: "4px", textDecoration: "none" }}>
              Contact us <ExternalLink style={{ width: "11px", height: "11px" }} />
            </a>
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
  );
}

/* ─── ROOT EXPORT ─── */
export default function DataRoom() {
  const [token, setToken] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (!stored) { setChecking(false); return; }
    fetch("/api/investor/verify", { headers: { "x-investor-token": stored } })
      .then(r => r.json())
      .then(d => { if (d.valid) setToken(stored); else sessionStorage.removeItem(SESSION_KEY); })
      .catch(() => sessionStorage.removeItem(SESSION_KEY))
      .finally(() => setChecking(false));
  }, []);

  if (checking) return (
    <div style={{ minHeight: "100vh", background: "#0a1628", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: "30px", height: "30px", border: "2px solid #3d8ef5", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
    </div>
  );

  if (token) return <DataRoomContent token={token} onLogout={() => setToken(null)} />;
  return <PasswordGate onSuccess={setToken} />;
}
