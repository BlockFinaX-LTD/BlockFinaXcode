import { useState, useEffect, useRef } from "react";
import {
  ArrowLeft, ChevronRight, Shield, Globe, Zap, Lock,
  BarChart3, BookOpen, Layers, CircleDollarSign, AlertTriangle,
  CheckCircle2, ArrowUpRight, ArrowDownRight, Cpu, FileText, Scale,
  Landmark, Coins, Wheat, RefreshCw, Activity, Info, Download
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import logoPath from "@/assets/logo.png";

const PRINT_STYLES = `
@media print {
  @page { margin: 18mm 16mm; size: A4; }
  body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  .no-print { display: none !important; }
  .print-break-before { break-before: page; }
  nav, aside, header .no-print { display: none !important; }
  #wp-sidebar { display: none !important; }
  #wp-topbar { position: static !important; box-shadow: none !important; border-bottom: 1px solid #e5e7eb; }
  .sticky { position: static !important; }
  a[href]:after { content: none !important; }
  main { max-width: 100% !important; padding: 0 !important; }
  h2 { page-break-after: avoid; }
  table { page-break-inside: avoid; }
  .rounded-xl, .rounded-lg { border-radius: 4px !important; }
}
`;

const sections = [
  { id: "abstract",     label: "Abstract" },
  { id: "intro",        label: "1. Introduction" },
  { id: "problem",      label: "2. The Problem" },
  { id: "market",       label: "3. Market Opportunity" },
  { id: "solution",     label: "4. The Solution" },
  { id: "assets",       label: "5. Asset Coverage" },
  { id: "mechanics",    label: "6. Protocol Mechanics" },
  { id: "settlement",   label: "7. Settlement Engine" },
  { id: "lp",           label: "8. Liquidity Provider Model" },
  { id: "technical",    label: "9. Technical Architecture" },
  { id: "economics",    label: "10. Fee Structure" },
  { id: "wallet",       label: "11. Wallet & Transfers" },
  { id: "regulatory",   label: "12. Regulatory Framework" },
  { id: "roadmap",      label: "13. Roadmap" },
  { id: "risks",        label: "14. Risk Factors" },
  { id: "conclusion",   label: "Conclusion" },
  { id: "references",  label: "References" },
];

function SectionTitle({ id, number, title, subtitle }: { id: string; number?: string; title: string; subtitle?: string }) {
  return (
    <div id={id} className="mb-8 scroll-mt-20 pt-4">
      {number && <p className="text-[10px] font-mono text-primary/60 uppercase tracking-widest mb-1">{number}</p>}
      <h2 className="text-2xl font-bold text-foreground mb-2">{title}</h2>
      {subtitle && <p className="text-muted-foreground text-sm">{subtitle}</p>}
      <div className="mt-3 h-px bg-gradient-to-r from-primary/40 to-transparent" />
    </div>
  );
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="text-base font-semibold text-foreground mb-3 mt-7">{children}</h3>;
}

function P({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-sm leading-relaxed text-muted-foreground mb-4 ${className}`}>{children}</p>;
}

function Callout({ icon: Icon, color, title, children }: { icon: any; color: string; title?: string; children: React.ReactNode }) {
  return (
    <div className={`flex gap-3 p-4 rounded-lg border ${color} my-6`}>
      <Icon className="h-5 w-5 mt-0.5 shrink-0" />
      <div className="text-sm leading-relaxed">
        {title && <strong className="block mb-1">{title}</strong>}
        {children}
      </div>
    </div>
  );
}

function DataTable({ headers, rows }: { headers: string[]; rows: (string | React.ReactNode)[][] }) {
  return (
    <div className="overflow-x-auto my-6 rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/60">
          <tr>
            {headers.map((h, i) => (
              <th key={i} className="text-left px-4 py-2.5 font-semibold text-foreground text-xs uppercase tracking-wide">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className={ri % 2 === 0 ? "bg-background" : "bg-muted/20"}>
              {row.map((cell, ci) => (
                <td key={ci} className="px-4 py-2.5 text-muted-foreground text-xs">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BulletList({ items }: { items: { title: string; body: string }[] }) {
  return (
    <div className="space-y-3 mb-6">
      {items.map(({ title, body }) => (
        <div key={title} className="flex gap-3 p-3 rounded-lg bg-muted/30 border border-border">
          <ChevronRight className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-foreground">{title}</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{body}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function Ref({ n }: { n: number }) {
  return (
    <sup className="text-primary/70 text-[9px] font-semibold ml-0.5 hover:text-primary" title={`Reference ${n}`}>[{n}]</sup>
  );
}

function StepList({ steps }: { steps: { title: string; body: string }[] }) {
  const bgClass = "bg-primary/15";
  const textClass = "text-primary";
  return (
    <div className="space-y-3 mb-6">
      {steps.map(({ title, body }, i) => (
        <div key={title} className="flex gap-4 p-3 rounded-lg border border-border bg-muted/20">
          <div className={`w-7 h-7 rounded-full ${bgClass} flex items-center justify-center shrink-0`}>
            <span className={`text-xs font-bold ${textClass}`}>{i + 1}</span>
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">{title}</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{body}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Whitepaper() {
  const [activeSection, setActiveSection] = useState("abstract");
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const style = document.createElement("style");
    style.id = "wp-print-styles";
    style.textContent = PRINT_STYLES;
    document.head.appendChild(style);
    return () => document.getElementById("wp-print-styles")?.remove();
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => { if (e.isIntersecting) setActiveSection(e.target.id); });
      },
      { rootMargin: "-20% 0px -70% 0px" }
    );
    sections.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  function handleDownloadPdf() {
    const title = document.title;
    document.title = "BlockFinaX_Whitepaper_v1.1_April2026";
    window.print();
    setTimeout(() => { document.title = title; }, 2000);
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
            </Link>
            <div className="h-4 w-px bg-border" />
            <div className="flex items-center gap-2">
              <img src={logoPath} alt="BlockFinaX" className="h-5 w-5 object-contain" />
              <span className="text-sm font-semibold">BlockFinaX</span>
              <span className="text-xs text-muted-foreground font-mono">Whitepaper v1.1</span>
            </div>
          </div>
          <div className="flex items-center gap-3 no-print">
            <span className="text-xs text-muted-foreground hidden md:block">March 2026</span>
            <Button
              size="sm"
              variant="outline"
              onClick={handleDownloadPdf}
              className="gap-1.5 text-xs h-8"
            >
              <Download className="h-3.5 w-3.5" />
              Download PDF
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8 flex gap-10">
        {/* Sidebar TOC */}
        <aside id="wp-sidebar" className="hidden lg:block w-52 shrink-0">
          <div className="sticky top-20">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">Contents</p>
            <nav className="space-y-0.5">
              {sections.map(s => (
                <button
                  key={s.id}
                  onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  className={`w-full text-left text-xs px-2 py-1.5 rounded transition-colors ${
                    activeSection === s.id
                      ? "text-primary font-medium bg-primary/10"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </nav>
          </div>
        </aside>

        {/* Main content */}
        <main ref={mainRef} className="flex-1 max-w-3xl">

          {/* Cover */}
          <div className="mb-14 pb-10 border-b border-border">
            <div className="flex items-center gap-4 mb-6">
              <img src={logoPath} alt="BlockFinaX" className="h-14 w-14 object-contain" />
              <div>
                <h1 className="text-4xl font-bold tracking-tight">BlockFinaX</h1>
                <p className="text-muted-foreground">P2P Parametric Protection Protocol</p>
              </div>
            </div>
            <p className="text-base font-light text-muted-foreground leading-relaxed max-w-2xl mb-2">
              A peer-to-peer on-chain marketplace for parametric risk protection across foreign exchange,
              commodities, and digital assets — enabling businesses and individuals to manage market
              volatility through transparent, predetermined settlement contracts.
            </p>
            <p className="text-sm text-muted-foreground/70 mb-6">
              Designed for emerging market participants, institutional liquidity providers, and globally
              dispersed traders who require accessible, structured, and auditable risk management tools.
            </p>
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              {["Version 1.1", "March 2026", "EVM Blockchain", "Mainnet Live", "Lisk Mainnet"].map(t => (
                <span key={t} className="px-2.5 py-1 rounded-full bg-muted border border-border">{t}</span>
              ))}
            </div>
          </div>

          {/* Abstract */}
          <div id="abstract" className="mb-12 scroll-mt-20">
            <p className="text-[10px] font-mono text-primary/60 uppercase tracking-widest mb-1">Abstract</p>
            <div className="h-px bg-gradient-to-r from-primary/40 to-transparent mb-6" />

            <P>
              Price volatility is an inescapable feature of global markets. For importers and exporters
              navigating fluctuating currency rates, commodity producers exposed to unpredictable input costs,
              and digital asset holders managing the inherent volatility of crypto markets, unmanaged price risk
              translates directly into balance sheet losses, margin compression, and operational uncertainty.
            </P>
            <P>
              Structured risk management instruments — forwards, options, swaps — have long existed to address
              these exposures. However, access to these instruments remains concentrated among large financial
              institutions and well-capitalised corporations. Small and medium enterprises (SMEs), independent
              commodity traders, diaspora workers, and retail participants are systematically excluded from
              formal hedging markets due to minimum contract thresholds, credit requirements, counterparty
              vetting processes, and the complexity of bilateral legal documentation.
            </P>
            <P>
              BlockFinaX presents a parametric protection protocol built on an EVM-compatible blockchain network.
              The protocol enables any participant to either purchase protection against adverse price movements
              across 63 market pairs — spanning African FX, global commodities, and major digital assets —
              or provide liquidity to earn premiums from protection buyers. Settlement is binary and
              predetermined: if a defined price level is reached before expiry, a fixed payout is made
              automatically by the protocol. If the level is not reached, liquidity providers retain the
              premiums. There is no mark-to-market, no margin call, and no counterparty negotiation.
            </P>
            <P>
              This paper outlines the problem BlockFinaX addresses, the design of the protocol, the
              mechanics of settlement, the economic model for all participants, the technical architecture,
              and the regulatory considerations that shape the product's design and go-to-market approach.
            </P>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
              {[
                { stat: "63", label: "Market pairs covered" },
                { stat: "3", label: "Asset classes" },
                { stat: "$0", label: "Minimum position size" },
                { stat: "5 min", label: "Oracle settlement interval" },
              ].map(({ stat, label }) => (
                <div key={label} className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                  <p className="text-xl font-bold text-primary">{stat}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">{label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Section 1 — Introduction */}
          <SectionTitle id="intro" number="Section 01" title="Introduction" subtitle="The case for accessible parametric risk management" />

          <P>
            Price risk is universal. A Ghanaian cocoa exporter invoicing in US dollars, a Nigerian importer
            sourcing goods priced in euros, a South African gold miner with USD-denominated production costs
            and rand-denominated expenses, a commodities trader holding crude oil exposure, and a digital
            asset fund managing Bitcoin volatility all share the same fundamental challenge: their operational
            or financial outcomes are materially affected by price movements they cannot control.
          </P>
          <P>
            The conventional response to this challenge is hedging — using financial instruments to offset
            the risk of an adverse price move by securing a future price or establishing a payoff that
            compensates for losses. In developed markets with deep capital markets, this is achievable
            through forwards, futures, vanilla options, and swaps, all of which are well understood,
            well regulated, and liquid.
          </P>
          <P>
            In Africa and across many emerging markets, the same instruments exist in principle but not
            in practice for the vast majority of participants. Regulatory frameworks that govern derivatives
            are often designed with large financial institutions as the assumed user. The infrastructure
            for credit assessment, collateral management, and trade confirmation is absent or prohibitively
            expensive for smaller participants. The result is a large, persistent gap between the risk
            management needs of emerging market businesses and the instruments available to them.
          </P>
          <P>
            BlockFinaX is designed to close this gap. By implementing parametric protection contracts
            on a public blockchain, the protocol creates a shared settlement infrastructure accessible
            to any participant with a digital wallet. The structure of each contract is simple, transparent,
            and legally unambiguous: a defined underlying asset, a strike price, an expiry date, and a
            predetermined payout if the strike is reached. No bilateral negotiation. No credit assessment.
            No minimum contract size.
          </P>
          <P>
            BlockFinaX brings structured risk management to the participants that existing markets have
            consistently failed to reach. Where traditional hedging requires a bank relationship,
            a credit facility, and a legal team, BlockFinaX requires only a digital wallet and an
            internet connection. Where traditional settlement happens through opaque bilateral
            agreements, BlockFinaX settles on a public ledger that any party — participant,
            regulator, or auditor — can verify in real time. This is not a gap-filler.
            It is a new market layer built for the participants the old one was never designed to serve.
          </P>

          {/* Section 2 — The Problem */}
          <SectionTitle id="problem" number="Section 02" title="The Problem" subtitle="Three markets. Three volatility crises. One unserved population." />

          <P>
            The risk management gap that BlockFinaX addresses is not limited to foreign exchange.
            It spans three distinct but equally important market segments, each with its own structural
            failure in delivering accessible protection to the participants who need it most.
          </P>

          <H3>2.1 Foreign Exchange Volatility in Emerging Markets</H3>
          <P>
            Sub-Saharan Africa comprises 54 countries and a combined GDP of nearly $2 trillion,<Ref n={1} /> yet the
            continent's intra-regional trade — which the African Continental Free Trade Area (AfCFTA)
            aims to significantly expand<Ref n={2} /> — is denominated almost entirely in US dollars, euros, and British pounds.
            African businesses transacting across borders are therefore exposed to both the volatility
            of their domestic currency and the relative movement against the invoicing currency.
          </P>
          <P>
            This exposure is significant and unpredictable. The Ghanaian cedi depreciated approximately
            30% against the US dollar in 2022.<Ref n={3} /> The Nigerian naira moved more than 40% in the twelve
            months following the 2023 unification of its official and parallel exchange rates.<Ref n={4} /> The
            Egyptian pound lost over half its value against the dollar between 2022 and 2023.<Ref n={5} /> For a
            business with USD payables and local currency revenues, these moves are not merely
            accounting entries — they are direct, unrecoverable operating losses.
          </P>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 my-5 py-3 border-y border-border">
            {[
              { stat: "30–50%", label: "annual volatility, major African FX pairs" },
              { stat: "<3%", label: "African SMEs with formal FX hedging" },
              { stat: "$1.5T+", label: "annual African cross-border trade" },
            ].map(({ stat, label }, i, arr) => (
              <div key={stat} className="flex items-baseline gap-2">
                <span className="text-base font-bold text-primary">{stat}</span>
                <span className="text-xs text-muted-foreground">{label}</span>
                {i < arr.length - 1 && <span className="text-border ml-4">·</span>}
              </div>
            ))}
          </div>

          <P>
            The barriers preventing SMEs from accessing bank-provided FX hedging products are structural.
            Commercial banks require an existing credit relationship and an approved treasury limit before
            offering a forward contract or option. Interbank minimum notional sizes — typically $100,000
            or above — exceed the transaction values of most small businesses. ISDA master agreements
            and credit support annexes require legal counsel and weeks of onboarding. And once set up,
            the mark-to-market margining requirements of some instruments create operational burden that
            small finance teams cannot manage.
          </P>
          <P>
            The consequence is that the majority of African SMEs handle FX risk through two informal
            mechanisms: conservative pricing (building buffer into invoice prices to absorb potential
            rate moves) and natural hedging (attempting to match currency inflows and outflows). Both
            approaches are inefficient and reduce the competitiveness of African businesses in
            international trade.
          </P>

          <H3>2.2 Commodity Price Volatility</H3>
          <P>
            Africa's economic base is heavily tied to commodity production. Ghana and Côte d'Ivoire
            together account for over 60% of global cocoa supply.<Ref n={6} /> Nigeria is the continent's largest
            oil producer. South Africa, Ghana, Mali, and Burkina Faso are major gold producers.
            Tanzania and Zambia are significant copper and gemstone producers. Ethiopia and Uganda
            are major coffee exporters.
          </P>
          <P>
            Each of these industries is exposed to commodity price movements that can be as dramatic
            as currency fluctuations. Cocoa prices have ranged from $2,500 to over $10,000 per metric
            tonne over the past decade.<Ref n={7} /> Crude oil has traded between $20 and $130 per barrel in the
            same period.<Ref n={8} /> Gold, long considered a stable store of value, can move 15–25% in a calendar
            year. For producers whose cost base is largely fixed in local currency, a sharp price
            decline in their commodity can make an entire crop cycle or production run unprofitable.
          </P>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 my-5 py-3 border-y border-border">
            {[
              { label: "Gold (XAU)", range: "±25%/yr" },
              { label: "Crude Oil (XTI)", range: "±40%/yr" },
              { label: "Natural Gas (XNG)", range: "±60%/yr" },
              { label: "Cocoa (XCF)", range: "±35%/yr" },
            ].map(({ label, range }, i, arr) => (
              <div key={label} className="flex items-baseline gap-2">
                <span className="text-base font-bold text-primary">{range}</span>
                <span className="text-xs text-muted-foreground">{label}</span>
                {i < arr.length - 1 && <span className="text-border ml-4">·</span>}
              </div>
            ))}
          </div>

          <P>
            Commodity price risk management is even less accessible than FX hedging for African producers.
            Commodity futures markets (Chicago Mercantile Exchange, Intercontinental Exchange) require
            brokerage accounts with international firms, significant margin deposits, and the operational
            sophistication to manage daily mark-to-market settlements. Over-the-counter commodity swaps
            with banks are available only to large producers with established banking relationships.
            Most small and medium commodity producers have no practical mechanism for locking in a
            floor price or protecting against a price collapse.
          </P>

          <H3>2.3 Digital Asset Volatility</H3>
          <P>
            The digital asset market has matured substantially since Bitcoin's inception but remains
            characterised by high volatility. Bitcoin experienced peak-to-trough drawdowns of 83% in
            the 2018 bear market and 77% in the 2022 bear market.<Ref n={9} /> Ethereum, the second-largest digital asset by market
            capitalisation, has shown similar patterns. Even over shorter timeframes — weeks or months —
            double-digit percentage swings are common across major digital assets.
          </P>
          <P>
            For institutional participants holding digital assets on behalf of clients, for crypto-native
            businesses that pay operational costs in fiat while holding reserves in digital assets, and
            for individual holders managing long-term savings in digital assets, this volatility creates
            real financial exposure. Centralised exchange-based derivatives (perpetual swaps, futures,
            options) exist for the largest digital assets but carry counterparty risk, require account
            registration, and involve margining complexity that many participants wish to avoid.
          </P>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 my-5 py-3 border-y border-border">
            {[
              { stat: "±77–83%", label: "BTC peak-to-trough drawdown, 2018 and 2022 bear markets" },
              { stat: "~$200B", label: "average daily global crypto spot volume (2024)" },
            ].map(({ stat, label }, i, arr) => (
              <div key={stat} className="flex items-baseline gap-2">
                <span className="text-base font-bold text-primary">{stat}</span>
                <span className="text-xs text-muted-foreground">{label}</span>
                {i < arr.length - 1 && <span className="text-border ml-4">·</span>}
              </div>
            ))}
          </div>

          <Callout icon={AlertTriangle} color="border-border bg-muted/40 text-muted-foreground" title="The common thread across all three markets:">
            Volatility is measurable and predictable in its existence, if not its direction.
            Structured protection instruments to manage this volatility are well established.
            Yet for the majority of the world's market participants — particularly in emerging economies —
            these instruments are inaccessible in practice. BlockFinaX addresses this access gap directly.
          </Callout>

          {/* Section 3 — Market Opportunity */}
          <SectionTitle id="market" number="Section 03" title="Market Opportunity" subtitle="Trillions in unhedged exposure. No accessible instrument. Until now." />

          <P>
            BlockFinaX addresses three independently large and underserved markets: African FX risk
            management, global commodity price exposure, and digital asset volatility. Taken together,
            these markets represent trillions of dollars in annual unhedged exposure — and a near-total
            absence of accessible, transparent instruments to manage it. Meanwhile, on-chain prediction
            markets (Polymarket, Kalshi) have crossed $44 billion in annual volume trading election
            and sports outcomes — proof that binary settlement infrastructure works at scale, but
            applied entirely to speculation rather than the commercial risk that real businesses face.
            The commercial risk management market dwarfs prediction markets by orders of magnitude:
            Africa alone accounts for over $2 trillion in annual unhedged trade and commodity exposure,
            a figure that excludes crypto volatility entirely. BlockFinaX is the first protocol to
            apply proven binary settlement infrastructure where the need — and the market — is largest.
          </P>

          <H3>3.1 Addressable Market Size</H3>
          <P>
            The markets BlockFinaX addresses are not speculative projections. They represent
            documented, ongoing financial exposures experienced by real businesses and individuals
            every day — exposures that currently go unmanaged for lack of accessible instruments.
          </P>

          <DataTable
            headers={["Market Segment", "Size", "Current Hedge Access", "BlockFinaX Opportunity"]}
            rows={[
              ["African cross-border trade", "$1.5 trillion/year", "<5% formally hedged", "FX protection for all 54 African countries"],
              ["African SME FX exposure", "$400 billion/year", "<3% with bank access", "Primary addressable market at launch"],
              ["African commodity production", "$500 billion/year", "<10% via banks/futures", "Commodity price protection, 11 pairs"],
              ["Diaspora remittances (Africa)", "~$96 billion/year [13]", "0% hedge instruments", "Wallet + corridor FX protection"],
              ["On-chain prediction markets (global)", "$44B+ annual vol. [14]", "Speculative only", "Commercial, regulated binary outcomes"],
              ["Crypto digital asset market (global)", "~$200B avg. daily vol. [11]", "~8% via CeFi derivatives", "Digital asset protection, 6+ pairs"],
              ["African digital asset market", "$50 billion/year (est.)", "<1% structured products", "Fastest-growing crypto audience globally"],
            ]}
          />

          <H3>3.2 Why Now</H3>
          <BulletList items={[
            {
              title: "AfCFTA is accelerating intra-African trade",
              body: "The African Continental Free Trade Area, operational since 2021 and expanding, is projected to increase intra-African trade by 52.3% by 2025 (UN Africa Renewal, 2023).[2] More cross-border trade means more FX exposure — and more demand for the risk management instruments to go with it.",
            },
            {
              title: "On-chain binary outcomes are legally and commercially validated",
              body: "The Kalshi CFTC ruling and the Polymarket scale provide regulatory and market validation that binary outcome contracts — the same mechanism BlockFinaX uses — are legitimate, in-demand, and regulatorily viable. BlockFinaX applies this validation to commercial hedging for the first time.",
            },
            {
              title: "Blockchain infrastructure has matured",
              body: "EVM ecosystem Layer-2 transaction costs are over 90% lower than 2021 mainnet fees, with some L2s achieving 95%+ reductions following the Dencun upgrade (L2Beat, 2024).[15] Smart contract security tooling, stablecoin liquidity, and oracle infrastructure have all matured to a point where a protocol like BlockFinaX can operate reliably at low cost — which was not true five years ago.",
            },
            {
              title: "African digital asset adoption is accelerating",
              body: "Africa has the fastest-growing crypto adoption rate of any global region (Chainalysis, 2024 Geography of Cryptocurrency Report).[10] The infrastructure for on-chain participation — wallets, stablecoins, on-ramps — is reaching critical mass. BlockFinaX is positioned to capture this audience at the inflection point.",
            },
          ]} />

          <H3>3.3 Go-to-Market Strategy</H3>
          <BulletList items={[
            {
              title: "Community-first mainnet growth",
              body: "A daily tasks and rewards system incentivises early adopter participation on mainnet. Participants earn points for on-chain actions (buying protection, providing liquidity), social engagement, and referrals — building a protocol-native community from day one.",
            },
            {
              title: "B2B API for African fintechs",
              body: "Integration with established African fintech platforms (payment gateways, neobanks, remittance providers) via an API layer that allows these platforms to offer their users parametric FX protection as an embedded financial service — without building the infrastructure themselves.",
            },
            {
              title: "Institutional LP acquisition",
              body: "Outreach to African impact funds, development finance institutions, fintech-focused family offices, and crypto treasury managers to deploy stablecoins as structured liquidity — generating yield while underwriting protection for African businesses.",
            },
            {
              title: "Regulatory sandbox as market entry",
              body: "Bank of Ghana sandbox participation provides formal regulatory visibility and serves as the template for entry into secondary African markets. Regulatory approval is a competitive moat, not just a compliance requirement.",
            },
          ]} />

          {/* Section 4 — The Solution */}
          <SectionTitle id="solution" number="Section 04" title="The Solution" subtitle="Parametric protection, open to all participants" />



          <P>
            BlockFinaX implements a parametric protection marketplace on a public blockchain network.
            The term "parametric" has a specific and important meaning: the payout is triggered
            automatically when a predefined, objectively observable condition is met — in this case,
            when a market price reaches a predetermined level before a predefined expiry date.
            This distinguishes parametric contracts from indemnity-based contracts, where payout
            depends on assessing actual loss.
          </P>
          <P>
            Parametric structures are well-established in insurance markets (e.g., catastrophe bonds,
            parametric crop insurance, flight delay insurance) and are increasingly recognised by
            financial regulators as a distinct and transparent product category. The key regulatory
            advantages of parametric structures are that payout conditions are unambiguous and
            verifiable, settlement does not require claims assessment or adjudication, and the
            full economic terms are known to all parties at inception.
          </P>

          <H3>3.1 Three Participant Roles</H3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 my-6">
            {[
              {
                role: "Protection Buyer (Hedger)",
                icon: Shield,
                desc: "Pays a premium to enter a protection contract against a defined price move. If the strike is reached before expiry, receives a predetermined stablecoin payout. Maximum loss is limited to the premium paid.",
                color: "border-border bg-muted/20",
              },
              {
                role: "Liquidity Provider (LP)",
                icon: CircleDollarSign,
                desc: "Deposits stablecoins into a protection pool to act as the capital backing for protection buyers. Earns premiums continuously. Capital is at risk only if the strike price is reached and payouts are triggered.",
                color: "border-border bg-muted/20",
              },
              {
                role: "Pool Creator",
                icon: Layers,
                desc: "Configures and deploys a new protection event by selecting the asset pair, strike price, direction, premium rate, initial liquidity, and expiry. Earns 5% of all protocol fees generated by the pool.",
                color: "border-border bg-muted/20",
              },
            ].map(({ role, icon: Icon, desc, color }) => (
              <div key={role} className={`rounded-lg border p-4 ${color}`}>
                <Icon className="h-5 w-5 mb-2 text-foreground/80" />
                <p className="text-sm font-semibold text-foreground mb-1">{role}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>

          <H3>3.2 Why Blockchain Settlement?</H3>
          <P>
            Blockchain settlement is not chosen as a technological statement — it is chosen because
            it solves three specific, practical problems that have historically prevented small participants
            from accessing structured protection products:
          </P>
          <BulletList items={[
            {
              title: "Counterparty risk elimination",
              body: "In a bilateral contract, each party is exposed to the other's default. In BlockFinaX, all funds are held in a self-executing smart contract. Neither party can withdraw funds outside of the protocol's defined settlement rules. Counterparty default risk is replaced by smart contract execution risk — which is publicly auditable and deterministic.",
            },
            {
              title: "No minimum contract size",
              body: "Traditional derivatives require minimum notional sizes that exclude most participants. A smart contract does not impose economic minimums — the protocol can process a $50 protection purchase with the same mechanism as a $500,000 one. This unlocks participation for SMEs, individual traders, and micro-businesses.",
            },
            {
              title: "Transparent and auditable settlement",
              body: "Every transaction — premium payment, pool deposit, payout claim — is recorded immutably on the blockchain and can be verified by any participant, regulator, or auditor at any time. There is no off-chain matching, no opaque pricing, and no hidden counterparty.",
            },
          ]} />

          {/* Section 4 — Asset Coverage */}
          <SectionTitle id="assets" number="Section 05" title="Asset Coverage" subtitle="63 pairs across FX, commodities, and digital assets" />

          <P>
            BlockFinaX covers 63 market pairs across three asset classes. Each asset class is served by
            a dedicated rate feed from an established third-party data provider, with rates updated
            continuously and independently verified by the oracle settlement engine.
          </P>

          <H3>4.1 Foreign Exchange — 42 African Currency Pairs</H3>
          <P>
            The FX module covers 42 African currency pairs, providing the broadest coverage of
            African currencies available on any parametric platform. Pairs include both USD-denominated
            rates and cross-currency pairs between African and major global currencies.
          </P>

          <DataTable
            headers={["Region", "Key Pairs", "Count"]}
            rows={[
              ["West Africa", "USD/GHS, USD/NGN, USD/XOF (CFA), USD/XAF, USD/GMD, USD/SLL, USD/GNF, USD/LRD, USD/CVE, USD/MRU, EUR/GHS, GBP/NGN", "12"],
              ["East Africa", "USD/KES, USD/UGX, USD/TZS, USD/ETB, USD/RWF, USD/SOS, USD/DJF, USD/ERN, USD/SSP", "9"],
              ["Southern Africa", "USD/ZAR, USD/ZMW, USD/MWK, USD/MZN, USD/AOA, USD/BWP, USD/SZL, USD/LSL, USD/NAD", "9"],
              ["Central Africa", "USD/CDF, USD/BIF, USD/KMF", "3"],
              ["North Africa", "USD/EGP, USD/LYD, USD/TND, USD/MAD, USD/DZD, USD/SDG", "6"],
              ["Indian Ocean", "USD/MUR, USD/SCR, USD/MGA", "3"],
            ]}
          />

          <P>
            All African FX rates are sourced from ExchangeRate-API, a commercial rate aggregator
            that sources data from central bank publications, interbank market feeds, and financial
            data providers. Rates are polled at five-minute intervals.
          </P>

          <H3>4.2 Commodities — 11 Pairs</H3>
          <P>
            The commodities module covers four precious metals, three energy commodities, and
            four agricultural commodities — representing the primary commodity exposures of
            African producers, traders, and processors.
          </P>

          <DataTable
            headers={["Category", "Pair", "Underlying", "Relevance"]}
            rows={[
              ["Precious Metals", "XAU/USD", "Gold spot", "Ghana, Mali, South Africa, Tanzania gold producers"],
              ["Precious Metals", "XAG/USD", "Silver spot", "Industrial and jewellery sector exposure"],
              ["Precious Metals", "XPT/USD", "Platinum spot", "South Africa — world's largest platinum producer"],
              ["Precious Metals", "XPD/USD", "Palladium spot", "Automotive catalyst supply chain exposure"],
              ["Energy", "XTI/USD", "WTI Crude Oil", "Nigeria, Angola, Gabon oil producers and refiners"],
              ["Energy", "XBR/USD", "Brent Crude Oil", "East African and global crude benchmarking"],
              ["Energy", "XNG/USD", "Natural Gas", "Tanzania, Mozambique, Egypt gas producers"],
              ["Agriculture", "XCO/USD", "Corn", "East and Southern Africa grain traders"],
              ["Agriculture", "XCF/USD", "Cocoa", "Ghana and Côte d'Ivoire cocoa exporters"],
              ["Agriculture", "XWH/USD", "Wheat", "North Africa and food import hedging"],
              ["Agriculture", "XSG/USD", "Sugar", "SADC sugar industry exposure"],
            ]}
          />

          <P>
            Commodity rates are sourced from Yahoo Finance market data feeds, which aggregate
            exchange-traded futures prices from major commodity exchanges. Rates are denominated
            in USD per standard unit (troy ounce for metals, barrel for energy, metric tonne
            for agricultural commodities).
          </P>

          <H3>4.3 Digital Assets — 10 Pairs</H3>
          <P>
            The digital asset module covers the six most liquid major digital assets by global
            market capitalisation, plus four additional assets relevant to African digital
            asset adoption patterns.
          </P>

          <DataTable
            headers={["Asset", "Pair", "Market Cap Rank", "Notes"]}
            rows={[
              ["Bitcoin", "BTC/USD", "#1", "Primary reserve asset for digital asset funds"],
              ["Ethereum", "ETH/USD", "#2", "Smart contract platform; widely held by DeFi participants"],
              ["BNB", "BNB/USD", "#3", "Exchange-native token; widely traded in African CEX markets"],
              ["Solana", "SOL/USD", "#5", "High-throughput L1; growing African adoption"],
              ["XRP", "XRP/USD", "#6", "Cross-border payment token; remittance use cases"],
              ["Cardano", "ADA/USD", "#8", "Active development focus on African markets and identity"],
            ]}
          />

          <P>
            Digital asset rates are sourced from CoinGecko, a leading digital asset data aggregator
            that compiles volume-weighted average prices from over 1,000 exchanges globally.
          </P>

          {/* Section 5 — Mechanics */}
          <SectionTitle id="mechanics" number="Section 06" title="Protocol Mechanics" subtitle="How parametric protection events are created, funded, and settled" />

          <H3>5.1 Event Structure</H3>
          <P>
            Each protection event on BlockFinaX is defined by seven parameters, all set at creation
            and immutable once the event is deployed:
          </P>

          <DataTable
            headers={["Parameter", "Description", "Example"]}
            rows={[
              ["Underlying asset", "The market pair the event references", "XAU/USD (Gold)"],
              ["Initial rate", "The market price of the underlying at event creation", "$2,150 per oz"],
              ["Strike price", "The price level that triggers a payout if reached", "$2,300 per oz"],
              ["Direction", "Whether the strike is above or below the initial rate", "Above (upward hedge)"],
              ["Premium rate", "Percentage of notional charged as a premium per position", "3.5%"],
              ["Expiry date", "The timestamp at which the event closes if strike not reached", "30 days from creation"],
              ["Pool capacity", "Total stablecoin capital available to cover payouts", "$50,000"],
            ]}
          />

          <H3>5.2 Payout Calculation</H3>
          <P>
            The payout for each protection position is calculated at the moment the position is
            entered and is fixed for the life of the contract. There is no mark-to-market
            revaluation. The hedger knows exactly what they will receive if the strike is
            reached before entering the contract.
          </P>

          <div className="rounded-lg bg-muted/40 border border-border p-5 my-5 font-mono text-xs space-y-4">
            <div>
              <p className="text-muted-foreground/60 mb-1.5">{"// Upward protection — strike above initial rate"}</p>
              <p className="text-foreground font-medium">Payout = Notional × (Strike − InitialRate) ÷ InitialRate</p>
              <p className="text-muted-foreground/60 mt-2 text-[11px]">Example: Notional $10,000 · Gold at $2,150 · Strike $2,300</p>
              <p className="text-primary text-[11px]">Payout = $10,000 × (2,300 − 2,150) ÷ 2,150 = $697.67 USDC</p>
            </div>
            <div className="border-t border-border/40 pt-4">
              <p className="text-muted-foreground/60 mb-1.5">{"// Downward protection — strike below initial rate"}</p>
              <p className="text-foreground font-medium">Payout = Notional × (InitialRate − Strike) ÷ InitialRate</p>
              <p className="text-muted-foreground/60 mt-2 text-[11px]">Example: Notional $10,000 · BTC at $85,000 · Strike $72,000</p>
              <p className="text-primary text-[11px]">Payout = $10,000 × (85,000 − 72,000) ÷ 85,000 = $1,529.41 USDC</p>
            </div>
            <div className="border-t border-border/40 pt-4">
              <p className="text-muted-foreground/60 mb-1.5">{"// Trigger condition"}</p>
              <p className="text-foreground">if strikeAbove: triggered when currentRate ≥ strike</p>
              <p className="text-foreground">if strikeBelow: triggered when currentRate ≤ strike</p>
            </div>
          </div>

          <H3>5.3 Bidirectional Protection</H3>
          <P>
            Every event on BlockFinaX has a defined direction. This means the protocol can serve
            both sides of a market exposure simultaneously:
          </P>

          <div className="grid grid-cols-2 gap-3 mb-6">
            <div className="rounded-lg border border-border bg-muted/20 p-4">
              <div className="flex items-center gap-2 mb-2">
                <ArrowUpRight className="h-4 w-4 text-primary" />
                <p className="text-sm font-medium text-foreground">Upward Protection</p>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">Strike is set above the current price. Triggered if price rises to or above the strike. Use cases: importers hedging against currency weakening; commodity buyers hedging against price increases; crypto holders hedging a short position.</p>
            </div>
            <div className="rounded-lg border border-border bg-muted/20 p-4">
              <div className="flex items-center gap-2 mb-2">
                <ArrowDownRight className="h-4 w-4 text-primary" />
                <p className="text-sm font-medium text-foreground">Downward Protection</p>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">Strike is set below the current price. Triggered if price falls to or below the strike. Use cases: exporters hedging against currency strengthening; commodity producers hedging against price collapse; digital asset holders protecting downside.</p>
            </div>
          </div>

          <H3>5.4 Protection Buyer Journey</H3>
          <StepList steps={[
            { title: "Browse active events", body: "Buyers view the marketplace filtered by asset class (FX, Commodities, Crypto), direction, time to expiry, premium rate, and available pool capacity. All parameters are displayed transparently before any transaction." },
            { title: "Select notional and review terms", body: "The buyer enters a notional amount in their chosen stablecoin. The interface immediately displays the premium cost, the predetermined payout amount if triggered, the platform fee, and the effective protection rate — all confirmed before signing." },
            { title: "Approve and enter position", body: "A single blockchain transaction approves the premium transfer and registers the position. The buyer's position is immediately recorded on-chain and visible in their portfolio." },
            { title: "Hold and monitor", body: "The buyer holds the position until expiry. The oracle engine monitors the market rate every five minutes. If the strike is reached, the event is automatically settled. If expiry passes without the strike being reached, the event closes and premiums are distributed to LPs." },
            { title: "Claim payout", body: "If the event settled in the buyer's favour, they claim their predetermined payout directly from the smart contract in whichever stablecoin the pool is denominated in. Claim transactions are available immediately after settlement." },
          ]} />

          {/* Section 6 — Settlement Engine */}
          <SectionTitle id="settlement" number="Section 07" title="Settlement Engine" subtitle="Automated, oracle-driven, on-chain settlement" />

          <P>
            Settlement is the most operationally critical component of any parametric protection
            protocol. BlockFinaX's settlement engine is designed to be automatic, auditable,
            and resistant to dispute.
          </P>

          <H3>6.1 Oracle Architecture</H3>
          <P>
            The oracle is a backend service that polls price feeds for all 63 pairs every five
            minutes. At each polling interval, the oracle compares the current market rate against
            the strike price of every active event in the protocol. If a strike condition is met,
            the oracle initiates a settlement transaction on-chain, which executes the payout
            distribution defined in the smart contract.
          </P>
          <P>
            Rate sources are separated by asset class to avoid single-point-of-failure risk:
          </P>

          <DataTable
            headers={["Asset Class", "Primary Source", "Update Frequency", "Fallback Plan"]}
            rows={[
              ["FX — African pairs", "ExchangeRate-API (commercial tier)", "5 minutes", "Central bank published rates (daily)"],
              ["Commodities (metals)", "Yahoo Finance market data", "5 minutes", "Exchange-published settlement prices"],
              ["Commodities (energy/agri)", "Yahoo Finance market data", "5 minutes", "Bloomberg / Reuters API (v2)"],
              ["Digital assets", "CoinGecko aggregated VWAP", "5 minutes", "Exchange-specific REST APIs"],
            ]}
          />

          <H3>6.2 Settlement Outcomes</H3>
          <P>
            Every event has one of two possible settlement outcomes. There are no partial settlements,
            no disputed outcomes, and no adjudication process:
          </P>

          <div className="grid grid-cols-2 gap-3 mb-6">
            <div className="rounded-lg border border-border bg-muted/20 p-4">
              <CheckCircle2 className="h-4 w-4 text-primary mb-2" />
              <p className="text-sm font-semibold text-foreground mb-1">Strike Reached (Triggered)</p>
              <p className="text-xs text-muted-foreground leading-relaxed">Protection buyers receive their predetermined payout from the LP pool. Protocol fees (1% of payouts) are collected. Remaining pool capital is returned to LPs proportionally.</p>
            </div>
            <div className="rounded-lg border border-muted-foreground/20 bg-muted/20 p-4">
              <RefreshCw className="h-4 w-4 text-muted-foreground mb-2" />
              <p className="text-sm font-semibold text-foreground mb-1">Strike Not Reached (Expired)</p>
              <p className="text-xs text-muted-foreground leading-relaxed">The event closes at expiry with no payout. All premiums collected from protection buyers are distributed to LPs. Full LP capital is returned. Pool creator earns loyalty fees.</p>
            </div>
          </div>

          <H3>6.3 Settlement Integrity</H3>
          <P>
            The settlement mechanism is designed to be tamper-resistant by construction. The smart
            contract defines the payout formula, the fee distribution, and the settlement rules.
            Once deployed, none of these parameters can be altered by any party — including the
            protocol operators. Settlement is executed by the smart contract logic, not by any
            human decision.
          </P>
          <P>
            The oracle admin key — the credential used to call the settlement function — is the
            only centralised component of the current architecture. This is disclosed transparently
            as a risk factor (see Section 14). The v2 roadmap includes migration to a decentralised
            oracle network with cryptographic price attestation, eliminating this remaining
            centralisation point.
          </P>

          {/* Section 7 — LP Model */}
          <SectionTitle id="lp" number="Section 08" title="Liquidity Provider Model" subtitle="Structured yield from parametric protection premiums" />

          <P>
            Liquidity providers are the capital counterpart to protection buyers. They deposit
            stablecoins into protection pools and earn premiums in return for accepting the risk
            that the strike price is reached and payouts are required. The LP model is designed
            to be transparent, predictable, and manageable.
          </P>

          <H3>7.1 How LP Returns Are Generated</H3>
          <P>
            When a protection buyer enters a position, they pay a premium calculated as a percentage
            of their notional amount. This premium is immediately distributed to the LP pool
            proportionally to each LP's share of the pool. Premiums accrue continuously as new
            positions are entered, and LPs can claim accrued premiums at any time without
            withdrawing their principal.
          </P>
          <P>
            The LP's yield is therefore determined by two factors: the premium rate set by the
            pool creator (typically 2–8% of notional per event period), and the fill rate of the
            pool (how much protection the pool sells relative to its capacity). A fully utilised
            pool at a 5% premium rate delivers a 5% return on deployed capital for that event
            period — regardless of whether the strike is reached, as long as it is not.
          </P>

          <H3>7.2 LP Risk Management</H3>
          <P>
            The primary risk for an LP is that the strike price is reached and payouts reduce
            the pool's capital. The protocol manages this risk through several structural mechanisms:
          </P>
          <BulletList items={[
            {
              title: "Capacity reservation",
              body: "When a protection buyer enters a position, the pool reserves capital equal to the maximum payout for that position. This means the pool can never be over-committed — the total reserved capacity at any time equals the total outstanding payout liability.",
            },
            {
              title: "Transparent utilisation",
              body: "LPs can see in real time how much of the pool is reserved versus available. A pool at 90% utilisation has 90% of its capital reserved against potential payouts — a risk level LPs can assess before depositing.",
            },
            {
              title: "Event-level isolation",
              body: "Each event is a separate pool. An LP's exposure is limited to the events they have deposited into. A triggered event in one pool does not affect an LP's capital in another pool.",
            },
            {
              title: "Strike distance as a risk proxy",
              body: "The distance between the initial rate and the strike price is a proxy for the probability of trigger. A pool with a 2% premium rate and a 15% strike distance has a very different risk profile from one with a 15% premium rate and a 5% strike distance. Both are visible to LPs before depositing.",
            },
          ]} />

          <H3>7.3 LP Journey</H3>
          <StepList steps={[
            { title: "Browse pools by yield and risk", body: "LPs filter events by asset class, premium rate, utilisation level, strike distance, and time to expiry. Each pool displays its total capacity, current utilisation, accrued premiums, and implied yield." },
            { title: "Deposit stablecoins", body: "LPs deposit any amount in a supported stablecoin. The deposit is recorded on-chain immediately. Premiums begin accruing from the moment of deposit, proportional to the LP's share of the pool." },
            { title: "Claim premiums at any time", body: "Accrued premiums can be claimed at any time via a blockchain transaction, without withdrawing principal. This separates yield extraction from capital management." },
            { title: "Monitor and manage", body: "LPs monitor pool utilisation and market rates. If the oracle detects a strike trigger, the pool settles automatically. LPs do not need to take any action — settlement is handled by the smart contract." },
            { title: "Withdraw after settlement", body: "Once an event settles, LPs withdraw their remaining capital. In a triggered event, capital is reduced proportionally by the payouts distributed. In an expired event, full capital plus all remaining premiums is returned." },
          ]} />

          {/* Section 8 — Technical */}
          <SectionTitle id="technical" number="Section 09" title="Technical Architecture" subtitle="Diamond Standard smart contracts with upgradeable facets" />

          <H3>8.1 Smart Contract Design — EIP-2535 Diamond Standard</H3>
          <P>
            BlockFinaX uses the EIP-2535 Diamond Standard (also known as the Diamond Pattern) for
            its on-chain architecture. This is a proxy contract pattern in which a single
            "Diamond" contract address delegates function calls to multiple implementation
            contracts called "facets." The Diamond Standard is chosen for three reasons:
          </P>
          <BulletList items={[
            {
              title: "Upgradeability without migration",
              body: "New functionality can be added, and existing functionality can be updated, without changing the contract address that users interact with and without requiring funds to be migrated. This is critical for a protocol expected to evolve over multiple years.",
            },
            {
              title: "Modular security surface",
              body: "Each facet is a separate, independently auditable contract. Security audits can be scoped to individual facets rather than requiring full re-audits of the entire codebase with every upgrade.",
            },
            {
              title: "Storage safety",
              body: "The Diamond Standard enforces a structured approach to storage layout (AppStorage pattern) that prevents storage slot collisions between facets — a common source of bugs in upgradeable proxy patterns.",
            },
          ]} />

          <H3>8.2 Current Facet Architecture</H3>
          <DataTable
            headers={["Facet", "Responsibility"]}
            rows={[
              ["DiamondCutFacet", "Protocol governance: adding, replacing, or removing facets via the diamondCut() function. Access-controlled to the protocol admin."],
              ["DiamondLoupeFacet", "Introspection: allows any external observer to enumerate all facets and their function selectors. Supports EIP-165 interface detection."],
              ["HedgeFacet", "Complete hedge protocol logic: event creation, LP deposits, hedger position entry, premium distribution, oracle settlement, payout claims, and fee collection. Contains all user-facing protocol functionality."],
            ]}
          />

          <H3>8.3 Settlement Contract: HedgeFacet</H3>
          <P>
            The HedgeFacet contains the complete economic logic of the protocol. Key functions include:
          </P>
          <div className="rounded-lg bg-muted/40 border border-border p-5 my-5 font-mono text-xs space-y-2">
            {[
              ["createEvent()", "Deploy a new protection pool with all parameters set immutably"],
              ["depositLiquidity()", "LP deposits stablecoins into a pool; updates pool capacity and LP share"],
              ["buyProtection()", "Hedger pays premium; reserves payout capacity; mints position on-chain"],
              ["settleEvent()", "Oracle-called; evaluates trigger condition; distributes payouts or premiums"],
              ["claimPayout()", "Hedger claims predetermined payout after triggered settlement"],
              ["claimPremiums()", "LP claims accrued premiums without withdrawing principal"],
              ["withdrawLiquidity()", "LP withdraws capital after event settlement"],
              ["collectProtocolFees()", "Treasury collection of accumulated platform fees"],
            ].map(([fn, desc]) => (
              <div key={fn} className="flex gap-4">
                <span className="text-primary w-44 shrink-0">{fn}</span>
                <span className="text-muted-foreground">{desc}</span>
              </div>
            ))}
          </div>

          <H3>8.4 Security Architecture</H3>
          <div className="space-y-2 mb-6">
            {[
              { icon: Lock, text: "AES-256 client-side encryption for all private key storage — keys never transmitted to servers in unencrypted form" },
              { icon: Shield, text: "Session-based wallet authentication with automatic timeout — wallet access requires password re-entry after inactivity" },
              { icon: CheckCircle2, text: "EIP-191 cryptographic signature verification on sensitive API routes — prevents replay and impersonation attacks" },
              { icon: Activity, text: "Tiered API rate limiting — prevents oracle manipulation attempts and protects backend infrastructure" },
              { icon: Lock, text: "Pool capacity hard-reservation at position entry — the contract enforces that total reserved payouts never exceed pool capital" },
              { icon: Shield, text: "No administrative withdrawal function — protocol operators cannot withdraw user funds; all capital movements are governed by contract logic" },
            ].map(({ icon: Icon, text }, i) => (
              <div key={i} className="flex gap-2.5 text-xs text-muted-foreground p-2.5 rounded-lg border border-border bg-muted/20">
                <Icon className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                <span>{text}</span>
              </div>
            ))}
          </div>

          <H3>8.5 Settlement Currency: Regulated Stablecoins</H3>
          <P>
            All protocol operations — premiums, payouts, LP deposits, and fees — are denominated
            in regulated, USD-pegged stablecoins. The initial deployment uses USDC (USD Coin),
            a fully reserved stablecoin subject to monthly independent attestation and regulatory
            oversight. The protocol is architecturally designed to support additional regulated
            stablecoins over time, giving participants and liquidity providers the choice of
            whichever instrument best suits their jurisdiction and operational requirements.
            Stablecoins are admitted to the protocol based on reserve transparency, regulatory
            standing, on-chain liquidity, and peg stability — not on any exclusive arrangement
            with a single issuer.
          </P>

          {/* Section 9 — Economics */}
          <SectionTitle id="economics" number="Section 10" title="Fee Structure & Economics" subtitle="Transparent, on-chain fees aligned with participant outcomes" />

          <P>
            All protocol fees are defined in the smart contract, collected on-chain, and distributed
            automatically. There are no hidden fees, no variable spread charges, and no off-chain
            fee adjustments. Every fee charged is visible to participants before they enter a
            transaction.
          </P>

          <DataTable
            headers={["Fee", "Rate", "Charged to", "Distribution"]}
            rows={[
              ["Event creation fee", "$2 USDC", "Pool creator at deployment", "100% to protocol treasury"],
              ["Protection entry fee", "0.5% of notional", "Hedger at position entry", "95% treasury · 5% pool creator loyalty"],
              ["Payout claim fee", "1% of payout amount", "Hedger at payout claim", "95% treasury · 5% pool creator loyalty"],
              ["LP premium claim fee", "1% of premiums claimed", "LP at premium claim", "95% treasury · 5% pool creator loyalty"],
              ["Stablecoin transfer fee", "0.3% (min $0.50)", "Sender per wallet transfer", "100% to protocol treasury"],
            ]}
          />

          <H3>9.1 Creator Loyalty Model</H3>
          <P>
            Pool creators receive 5% of every platform fee generated by their pools — spanning
            protection entry fees, payout fees, and LP claim fees. This creates a sustainable
            incentive for capable market participants to deploy well-structured pools with
            competitive premium rates, which in turn attracts both hedgers and LPs to the protocol.
            Creator loyalty fees are collected automatically by the smart contract and claimable
            on-chain.
          </P>

          <H3>9.2 Revenue Model</H3>
          <P>
            BlockFinaX generates revenue from three primary streams: hedge protocol fees (comprising
            the entry, payout, and LP claim fees across all events), a flat $2 event creation fee
            charged per hedge event deployed, and wallet transfer fees.
            The protocol treasury accumulates all net fees after creator loyalty distributions.
          </P>

          <DataTable
            headers={["Year", "Projected Events", "Est. Total Notional", "Projected Net Revenue"]}
            rows={[
              ["2026 (H2 — mainnet launch)", "5,000", "$50M–$100M", "$475K–$825K"],
              ["2027", "40,000+", "$400M–$700M", "$3.8M–$6M"],
              ["2028", "150,000+", "$1.5B–$2.5B", "$14M–$21M"],
              ["2029", "500,000+", "$5B–$8B", "$47M–$69M"],
              ["2030 (target)", "1,500,000+", "$15B+", "$142M+"],
            ]}
          />
          <p className="text-[11px] text-muted-foreground/60 -mt-4 mb-6">
            Revenue projections are illustrative estimates based on a blended fee rate of 0.7% across all transaction types, plus a flat $2 event creation fee per hedge event.
            Actual outcomes will depend on market conditions, regulatory developments, and adoption rates.
            These figures do not constitute a financial forecast or investment guarantee.
          </p>

          {/* Section 10 — Wallet */}
          <SectionTitle id="wallet" number="Section 11" title="Wallet & Cross-Border Transfers" subtitle="Non-custodial stablecoin wallet with integrated protection" />

          <P>
            BlockFinaX includes an integrated non-custodial stablecoin wallet that serves as the
            entry point for all protocol interactions. The wallet is designed to be accessible to users
            who may be new to blockchain-based financial tools, while maintaining the security
            standards appropriate for financial applications.
          </P>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            {[
              { title: "Non-custodial key management", body: "Private keys are generated in the user's browser using cryptographically secure random number generation. Keys are encrypted with AES-256 using the user's password and stored locally. The platform operators never have access to unencrypted private keys.", icon: Lock },
              { title: "Cross-border stablecoin transfers", body: "Users can send supported stablecoins to any EVM-compatible wallet address globally. The platform charges a 0.3% fee (minimum $0.50) per transfer, which is transparent and confirmed before signing. There are no correspondent banking delays or SWIFT processing windows.", icon: Globe },
              { title: "Gas sponsorship", body: "The platform automatically sponsors 0.005 ETH in gas fees when a wallet's native token balance falls below the threshold required for transactions. This removes the requirement for users to separately acquire gas tokens — a significant usability barrier for new blockchain users.", icon: Zap },
              { title: "Real-time balance and history", body: "Live token balances are pulled directly from the blockchain at each page load. Transaction history, including all hedge protocol interactions, is displayed in full. No off-chain database is required for balance accuracy.", icon: BarChart3 },
            ].map(({ title, body, icon: Icon }) => (
              <div key={title} className="rounded-lg border border-border bg-muted/20 p-4">
                <Icon className="h-5 w-5 text-primary mb-2" />
                <p className="text-sm font-medium text-foreground mb-1">{title}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
              </div>
            ))}
          </div>

          {/* Section 11 — Regulatory */}
          <SectionTitle id="regulatory" number="Section 12" title="Regulatory Framework & Compliance" subtitle="Designed for regulatory cooperation, not regulatory avoidance" />

          <P>
            BlockFinaX is designed with regulatory engagement as a core principle, not an afterthought.
            The platform's founders recognise that financial innovation that creates consumer value
            and financial innovation that operates responsibly within regulatory frameworks are not
            in conflict — they are mutually reinforcing. A well-regulated parametric protection
            platform builds institutional trust, attracts sophisticated LPs, and creates sustainable
            market infrastructure. An unregulated one does not.
          </P>

          <H3>11.1 Product Classification: Parametric Protection</H3>
          <P>
            The instruments offered by BlockFinaX are classified internally and presented publicly
            as parametric protection products, consistent with the parametric insurance and
            structured protection categories recognised by financial regulators in multiple
            jurisdictions.
          </P>
          <P>
            The defining features of a parametric protection product — as distinct from a speculative
            financial derivative — are as follows:
          </P>
          <BulletList items={[
            {
              title: "Predetermined, objective trigger conditions",
              body: "The payout condition (strike price reached before expiry) is defined precisely at inception and is observable by all parties from publicly available market data. There is no subjectivity in determining whether a payout is triggered.",
            },
            {
              title: "Fixed, predetermined payout",
              body: "The payout amount is calculated and disclosed to the protection buyer at the moment they enter the contract. There is no mark-to-market valuation, no margining, and no uncertainty about the payout quantum.",
            },
            {
              title: "Risk transfer, not risk creation",
              body: "Protection buyers are managing a pre-existing commercial or financial exposure — currency risk, commodity price risk, or digital asset price risk. The contract transfers this risk to a willing liquidity provider rather than creating new leveraged risk.",
            },
            {
              title: "No leverage",
              body: "The maximum loss for a protection buyer is the premium paid. The maximum loss for an LP is the capital deposited. The protocol does not create notional exposures in excess of capital committed. There are no margin calls and no liquidation cascades.",
            },
          ]} />

          <H3>11.2 Bank of Ghana Regulatory Sandbox</H3>
          <P>
            BlockFinaX is actively pursuing participation in the Bank of Ghana's Regulatory Sandbox
            Programme — a structured framework that allows fintech innovators to test products and
            services under regulatory supervision before seeking full licensing. The sandbox is
            designed to enable regulators and innovators to develop appropriate regulatory
            frameworks together, with real product experience as the basis for policy development.
          </P>
          <P>
            The Bank of Ghana Regulatory Sandbox operates under guidelines issued by the Bank of
            Ghana under its mandate to promote financial inclusion and innovation while maintaining
            systemic financial stability. BlockFinaX's application positions the platform as a
            financial inclusion instrument — specifically, as a mechanism for providing risk
            management tools to Ghanaian and broader African businesses that currently have
            no access to formal hedging markets.
          </P>

          <H3>11.3 Transparency and Auditability</H3>
          <P>
            BlockFinaX operates with a level of transparency that exceeds the reporting requirements
            of most regulated financial entities. Every transaction is recorded immutably on a
            public blockchain and can be inspected by any party at any time — including regulators,
            auditors, journalists, and members of the public. There is no off-chain ledger, no
            internal reconciliation process, and no information asymmetry between operators and
            participants.
          </P>
          <P>
            The protocol's fee collection, treasury balance, and all payout histories are publicly
            verifiable on-chain. The platform additionally provides an admin dashboard with
            aggregated analytics for authorised regulatory access requests.
          </P>

          <H3>11.4 Stablecoin Selection Criteria</H3>
          <P>
            The use of regulated stablecoins as the protocol's settlement layer is a deliberate
            compliance choice. BlockFinaX supports stablecoins that meet defined criteria: full
            reserve backing verified by independent attestation, regulatory standing in one or more
            major jurisdictions, broad on-chain liquidity, and established track records of peg
            stability. This approach ensures that the protocol's value flows are denominated in
            instruments with transparent reserve structures — as opposed to native tokens, algorithmic
            stablecoins, or instruments without regulatory oversight. As the regulatory landscape for
            stablecoins evolves globally, the protocol's stablecoin selection will be reviewed and
            updated in consultation with legal counsel and, where applicable, with the input of
            relevant regulatory authorities.
          </P>

          <H3>11.5 Progressive Compliance Roadmap</H3>
          <P>
            BlockFinaX's compliance approach evolves with the protocol's scale and regulatory
            environment:
          </P>
          <BulletList items={[
            { title: "Phase 1 (Mainnet Foundation)", body: "Live protocol on Lisk, Base, and BSC Mainnet using real stablecoins (USDC and USDT). Data collection on usage patterns and user demographics to inform regulatory submissions. Smart contract audits (v5 + v6 patches) applied." },
            { title: "Phase 2 (Mainnet launch, 2026)", body: "Launch with voluntary KYC/AML verification available for institutional LPs. Geofencing of high-risk jurisdictions where legal advice indicates regulatory prohibitions. Engagement with Bank of Ghana sandbox formally initiated." },
            { title: "Phase 3 (Regulated operations, 2027)", body: "Full KYC/AML integration for all participants above defined thresholds, in jurisdictions requiring it. Formal licensing applications in Ghana and secondary markets as determined by regulatory engagement." },
            { title: "Phase 4 (Pan-African regulatory framework)", body: "Work with AfCFTA financial services protocol development to advocate for a harmonised regulatory framework for parametric protection products across member states." },
          ]} />

          <Callout icon={Scale} color="border-border bg-muted/40 text-muted-foreground" title="Our position:">
            BlockFinaX is not designed to operate in regulatory grey areas. We seek clear regulatory
            frameworks, engage proactively with regulators, and design our products to comply with
            the spirit as well as the letter of applicable law. Where regulations do not yet address
            the specific structure of on-chain parametric protection, we actively participate in
            policy development to create appropriate frameworks.
          </Callout>

          {/* Section 13 — Roadmap */}
          <SectionTitle id="roadmap" number="Section 13" title="Roadmap" subtitle="Phased development from mainnet launch to regional financial infrastructure" />

          <div className="space-y-5 mb-6">
            {[
              {
                phase: "Phase 1", label: "Mainnet Foundation", timeline: "Q1–Q2 2026", status: "Complete",
                color: "border-green-500/40 bg-green-500/5",
                items: [
                  "EVM mainnet deployment — live on Lisk, Base, and BSC",
                  "63 pairs across FX (42), Commodities (11), Crypto (6, plus 4 planned)",
                  "Bidirectional (upward + downward) parametric protection",
                  "LP deposit, premium claim, and payout claim functionality",
                  "Five-minute oracle settlement engine across all pairs",
                  "Non-custodial wallet with gas sponsorship",
                  "Daily tasks and community rewards system",
                  "Admin dashboard with revenue, user, and pool analytics",
                  "Bank of Ghana sandbox application preparation",
                ],
              },
              {
                phase: "Phase 2", label: "Mainnet Launch", timeline: "March 2026", status: "Live",
                color: "border-primary/40 bg-primary/5",
                items: [
                  "Production blockchain mainnet deployment — complete",
                  "Live settlement in USDC and USDT",
                  "Multi-round smart contract audit patches applied (v5 + v6)",
                  "Institutional LP onboarding programme",
                  "Decentralised oracle integration (Chainlink or equivalent)",
                  "Mobile-optimised progressive web application",
                  "Optional KYC/AML verification for institutional participants",
                  "Formal Bank of Ghana sandbox participation",
                ],
              },
              {
                phase: "Phase 3", label: "Scale & Partnerships", timeline: "H2 2026 – 2027", status: "Planned",
                color: "border-border bg-muted/20",
                items: [
                  "B2B API for embedded parametric protection in third-party platforms",
                  "Integration with African fintech payment platforms",
                  "Accounting software plugins for automated FX protection documentation",
                  "White-label pool infrastructure for licensed financial intermediaries",
                  "Additional African currency pairs (20+ pairs in v2)",
                  "Formal licensing applications in Ghana and secondary markets",
                  "Treasury management dashboard for corporate clients",
                ],
              },
              {
                phase: "Phase 4", label: "Protocol Maturity", timeline: "2028+", status: "Vision",
                color: "border-border bg-muted/20",
                items: [
                  "Multi-chain deployment across major EVM networks",
                  "Decentralised governance for protocol parameters",
                  "Cross-chain liquidity bridges for LP capital efficiency",
                  "Institutional-grade risk management and reporting tools",
                  "Pan-African regulatory framework advocacy through AfCFTA process",
                  "Potential native governance token for protocol ownership distribution",
                ],
              },
            ].map(({ phase, label, timeline, status, color, items }) => (
              <div key={phase} className={`rounded-lg border p-5 ${color}`}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-widest">{phase}</p>
                    <p className="text-sm font-bold text-foreground">{label}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">{timeline}</p>
                    <p className="text-[10px] uppercase tracking-wide text-primary mt-0.5">{status}</p>
                  </div>
                </div>
                <ul className="space-y-1">
                  {items.map(item => (
                    <li key={item} className="flex gap-2 text-xs text-muted-foreground">
                      <ChevronRight className="h-3 w-3 text-primary/60 mt-0.5 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Section 14 — Risks */}
          <SectionTitle id="risks" number="Section 14" title="Risk Factors" subtitle="Material risks that participants should understand before engaging with the protocol" />

          <P>
            BlockFinaX is committed to transparent disclosure of the risks associated with
            participation in the protocol. The following risk factors are disclosed in good faith
            and represent the team's honest assessment of material uncertainties.
          </P>

          <div className="space-y-3 mb-6">
            {[
              {
                risk: "Smart contract risk",
                detail: "The protocol's smart contracts have undergone multiple rounds of internal security review and audit patching (v5 and v6 fix sets applied pre-mainnet). Smart contracts are deployed on Lisk Mainnet and handle real value. A formal third-party audit is planned as a near-term priority. Smart contracts may still contain bugs or unintended behaviours and participants should size positions accordingly.",
              },
              {
                risk: "Oracle and data source risk",
                detail: "Settlement depends on rate data from third-party providers (ExchangeRate-API, Yahoo Finance, CoinGecko). If these sources provide incorrect, delayed, or manipulated data, settlements could be inaccurate. In the current architecture, the oracle admin key introduces a degree of centralisation. Decentralised oracle integration is planned for v2.",
              },
              {
                risk: "Liquidity risk",
                detail: "Protection pools may have insufficient capital to cover all payout liabilities if a large number of events trigger simultaneously. Pool utilisation is publicly visible and hard-capped by the capital reservation mechanism, but market correlation risk — where many pools trigger in the same direction — could create system-wide strain.",
              },
              {
                risk: "Regulatory and legal risk",
                detail: "The regulatory treatment of on-chain parametric protection instruments is not settled in most jurisdictions. Regulatory action, legislative changes, or adverse rulings could require the protocol to restrict access in certain markets, add compliance requirements, or modify product structures. BlockFinaX actively engages with regulators to mitigate this risk, but it cannot be eliminated.",
              },
              {
                risk: "Stablecoin risk",
                detail: "Protocol values are denominated in regulated stablecoins, initially USDC. While the protocol selects stablecoins based on reserve transparency and regulatory standing, all stablecoin instruments carry risks including reserve adequacy, regulatory action, or peg disruption. Participants should independently assess the risks of each supported stablecoin before participating.",
              },
              {
                risk: "Technology and infrastructure risk",
                detail: "The protocol depends on backend infrastructure for oracle settlement and wallet gas sponsorship. Infrastructure outages could delay or temporarily prevent settlement. The protocol is designed to handle expiry-based settlement as a fallback, and no user funds are at risk of loss due to infrastructure outages — but settlement timing could be affected.",
              },
              {
                risk: "Centralisation risk (current phase)",
                detail: "In the current architecture, the oracle admin key and the protocol treasury are controlled by the founding team. This is a transitional arrangement while decentralised governance is developed. This risk is disclosed transparently and is a planned remediation item in the v2 roadmap.",
              },
              {
                risk: "Market risk for liquidity providers",
                detail: "LPs take the risk that strike prices are reached and payouts reduce their deposited capital. Past performance of any market pair does not guarantee future behaviour. LPs should assess each pool's strike distance, premium rate, and utilisation level independently and manage their exposure across pools accordingly.",
              },
            ].map(({ risk, detail }) => (
              <div key={risk} className="flex gap-3 p-3 rounded-lg border border-border bg-muted/20">
                <AlertTriangle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-foreground">{risk}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{detail}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Conclusion */}
          <SectionTitle id="conclusion" title="Conclusion" />

          <P>
            The gap between the risk management instruments available to large financial institutions
            and those accessible to small and medium businesses is one of the most consequential
            structural inequalities in global finance. It is particularly acute in Africa, where
            currency volatility, commodity price swings, and digital asset exposure create real
            operational risk for a large number of businesses and individuals with no practical
            means of managing it.
          </P>
          <P>
            BlockFinaX offers a carefully designed, transparent, and structurally sound response
            to this gap. By implementing parametric protection contracts on a public blockchain,
            the protocol creates settlement infrastructure that is accessible to any participant,
            auditable by any observer, and governed by publicly verifiable code rather than
            bilateral legal relationships.
          </P>
          <P>
            The protocol covers 63 pairs across three asset classes — 42 African FX pairs, 11
            commodity pairs, and 10 digital asset pairs — providing a unified risk management
            interface for the diverse market exposures of African businesses, commodity producers,
            and digital asset participants. The bidirectional structure of protection events means
            the platform serves both those seeking protection against price rises and those
            seeking protection against price declines.
          </P>
          <P>
            BlockFinaX is not positioned as a technology in search of a problem. It is a
            practical response to a documented, persistent market failure — one that regulators,
            development finance institutions, and trade finance bodies across Africa have
            acknowledged for decades. The protocol is designed to work with regulatory frameworks,
            not around them, and to create the transparency and accountability that responsible
            financial innovation requires.
          </P>
          <P>
            BlockFinaX is live on Lisk Mainnet. We invite businesses, traders,
            liquidity providers, regulators, and builders to engage with the protocol, explore its
            mechanics, and contribute to the development of parametric protection infrastructure
            that serves the full breadth of Africa's market participants.
          </P>

          {/* References */}
          <SectionTitle id="references" title="References" />

          <div className="space-y-2.5 mb-10">
            {[
              { n: 1,  citation: "World Bank. 'World Development Indicators: Sub-Saharan Africa.' GDP (current US$), 2024. data.worldbank.org/region/sub-saharan-africa" },
              { n: 2,  citation: "United Nations Africa Renewal. 'AfCFTA: Trade in Africa — An Opportunity Not to Be Missed.' May 2023. un.org/africarenewal. Projected to boost intra-African trade by 52.3% by 2025 and increase Africa's income by up to $450 billion by 2035 (IMF estimate)." },
              { n: 3,  citation: "Bank of Ghana. Annual Report 2022. Accra: Bank of Ghana, 2023. The Ghanaian cedi depreciated approximately 30% against the US dollar in 2022. bog.gov.gh" },
              { n: 4,  citation: "Central Bank of Nigeria. CBN FX Market Unification Policy Statement, June 2023. The official NGN/USD rate moved from approximately NGN 464 to over NGN 760 per US dollar in the month following the FX policy change, a depreciation exceeding 40%. cbn.gov.ng" },
              { n: 5,  citation: "International Monetary Fund. 'Arab Republic of Egypt: Article IV Consultation.' IMF Country Report No. 23/290, July 2023. The Egyptian pound lost approximately 50% of its value against the US dollar between March 2022 and mid-2023. imf.org" },
              { n: 6,  citation: "International Cocoa Organization (ICCO). 'Quarterly Bulletin of Cocoa Statistics.' Volume L, No. 1, 2024. Ghana and Cote d'Ivoire account for approximately 60-65% of global cocoa production annually. icco.org" },
              { n: 7,  citation: "International Cocoa Organization (ICCO). 'ICCO Monthly Averages of Daily Prices.' 2024. Cocoa futures prices reached a historic high above $10,000 per metric tonne in April 2024, having traded below $2,500 for most of the preceding decade. icco.org" },
              { n: 8,  citation: "U.S. Energy Information Administration (EIA). 'Petroleum and Other Liquids: Spot Prices.' eia.gov. WTI crude oil reached a low of approximately $20/bbl in April 2020; Brent crude peaked at approximately $127/bbl in March 2022." },
              { n: 9,  citation: "CoinMarketCap. 'Bitcoin Historical Price Data.' coinmarketcap.com. BTC peak-to-trough: December 2017 to December 2018 (-83%); November 2021 to November 2022 (-77%)." },
              { n: 10, citation: "Chainalysis. '2024 Geography of Cryptocurrency Report.' October 2024. Sub-Saharan Africa identified as among the fastest-growing regions globally for on-chain cryptocurrency adoption, driven by financial inclusion use cases and currency instability. go.chainalysis.com" },
              { n: 11, citation: "CoinGecko. '2024 Annual Crypto Industry Report.' January 2025. Global average daily spot crypto trading volume approximately $189-200 billion in 2024; full-year spot trading volume approximately $58.5 trillion. coingecko.com" },
              { n: 12, citation: "Afreximbank. 'Africa Trade Report 2024.' Cairo: African Export-Import Bank, 2024. Total intra-African merchandise trade: $192.2 billion in 2023, representing 14.9% of total African trade. afreximbank.com" },
              { n: 13, citation: "World Bank. 'Migration and Development Brief 41.' November 2024. Remittances to Africa estimated at approximately $96 billion in 2024. worldbank.org/en/topic/migrationremittancesdiasporaissues" },
              { n: 14, citation: "The Block Research / Sacra. 'Polymarket and Kalshi 2025 Volume Analysis.' December 2025. Combined trading volumes exceeded $44 billion across 2025. Kalshi Series E valuation: $11 billion (December 2025). Polymarket valuation: $9 billion (October 2025). theblock.co; sacra.com" },
              { n: 15, citation: "L2Beat. 'Layer-2 Ecosystem Data.' December 2024. EVM Layer-2 solutions achieve 90-95%+ transaction cost reductions versus Ethereum mainnet, accelerated by EIP-4844 (Dencun Upgrade, March 2024). l2beat.com" },
              { n: 16, citation: "FSD Africa / World Bank Group. 'Access to Financial Services in Sub-Saharan Africa.' 2023. Surveys indicate fewer than 5% of African SMEs report access to formal FX risk management or hedging products through the banking sector. fsdafrica.org; ifc.org" },
            ].map(({ n, citation }) => (
              <div key={n} className="flex gap-3 text-xs text-muted-foreground leading-relaxed">
                <span className="text-primary font-semibold shrink-0 w-6">[{n}]</span>
                <span>{citation}</span>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="border-t border-border pt-8 pb-12 mt-8">
            <div className="flex items-center gap-2 mb-4">
              <img src={logoPath} alt="BlockFinaX" className="h-6 w-6 object-contain" />
              <span className="font-semibold">BlockFinaX</span>
              <span className="text-xs text-muted-foreground">— P2P Parametric Protection Protocol</span>
            </div>
            <div className="space-y-2 text-xs text-muted-foreground/70 leading-relaxed max-w-2xl">
              <p>
                <strong className="text-muted-foreground">Disclaimer:</strong> This whitepaper is published for informational
                purposes only. It does not constitute financial advice, investment advice, legal advice,
                or any other form of professional advice. Nothing in this document should be construed
                as an offer to sell or a solicitation of an offer to buy any security, financial
                instrument, or investment product.
              </p>
              <p>
                Participation in the BlockFinaX protocol involves significant risk, including the risk
                of total loss of capital deployed as liquidity. Prospective participants should conduct
                their own due diligence and seek independent professional advice appropriate to their
                circumstances before engaging with the protocol.
              </p>
              <p>
                Revenue projections and market size estimates contained in this document are
                illustrative and do not represent guaranteed outcomes. Regulatory approvals referenced
                as planned or in progress are subject to regulatory discretion and are not guaranteed.
              </p>
              <p className="text-muted-foreground/50">© 2026 BlockFinaX. All rights reserved. Whitepaper v1.1 — March 2026.</p>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
