/**
 * whitepaper.tsx — the protocol's design document.
 *
 * Rebuilt from scratch. The previous version was a marketing brochure that
 * described the product incorrectly in three separate places: it called
 * settlement "binary" with "no partial settlements" when the payout is
 * continuous between the strike and the cap; it described one-touch settlement
 * that has since been removed for destroying the payout it triggered; and it
 * borrowed the regulatory validation of binary outcome contracts through an
 * equivalence that does not hold.
 *
 * This one is organised around decisions rather than features. Each significant
 * choice states what was chosen, what was rejected, and why — including the
 * cases where the first answer was wrong and what it cost. A protocol document
 * that only records the destination is not much use to anyone deciding whether
 * to trust it.
 *
 * Figures are computed in-page rather than drawn, so no diagram can drift from
 * the numbers it illustrates. They use the Garman–Kohlhagen kernel without the
 * Merton jump overlay — enough for shape and magnitude, and stated as such in
 * the captions rather than passed off as the full model.
 */

import { useState, useEffect, useRef } from "react";
import { ArrowLeft, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import logoPath from "@/assets/logo.png";

const VERSION = "2.0";
const DATE = "August 2026";

const PRINT_STYLES = `
@media print {
  @page { margin: 18mm 16mm; size: A4; }
  body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  .no-print { display: none !important; }
  .wp-nav { display: none !important; }
  .wp-body { max-width: none !important; }
  h2, h3 { break-after: avoid; }
  figure, table, .wp-decision, .wp-callout { break-inside: avoid; }
  a { text-decoration: none !important; color: inherit !important; }
}
`;

/* ─────────────────────────── building blocks ─────────────────────────── */

function SectionTitle({ id, n, title, sub }: { id: string; n: string; title: string; sub?: string }) {
  return (
    <div id={id} className="scroll-mt-24 mb-6 mt-16 first:mt-0">
      <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{n}</p>
      <h2 className="text-2xl font-bold leading-tight text-foreground" style={{ textWrap: "balance" }}>{title}</h2>
      {sub && <p className="mt-1.5 text-sm text-muted-foreground">{sub}</p>}
    </div>
  );
}

function H3({ id, children }: { id?: string; children: React.ReactNode }) {
  return <h3 id={id} className="scroll-mt-24 mb-3 mt-9 text-base font-semibold text-foreground">{children}</h3>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mb-4 text-[15px] leading-[1.7] text-muted-foreground">{children}</p>;
}

function Em({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold text-foreground">{children}</strong>;
}

function Mono({ children }: { children: React.ReactNode }) {
  return <code className="rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">{children}</code>;
}

/** A design decision: what was chosen, what was rejected, and why. */
function Decision({ id, title, chose, rejected, children }: {
  id?: string; title: string; chose: string; rejected: string; children: React.ReactNode;
}) {
  return (
    <div id={id} className="wp-decision scroll-mt-24 my-7 rounded-lg border border-border bg-muted/20 p-5">
      <h3 className="mb-4 text-base font-semibold text-foreground">{title}</h3>
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded border border-primary/30 bg-primary/5 p-3">
          <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-primary">Chosen</p>
          <p className="text-[13px] leading-snug text-foreground">{chose}</p>
        </div>
        <div className="rounded border border-border bg-background/60 p-3">
          <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Rejected</p>
          <p className="text-[13px] leading-snug text-muted-foreground">{rejected}</p>
        </div>
      </div>
      <div className="[&>p:last-child]:mb-0">{children}</div>
    </div>
  );
}

/** Something that went wrong, what it cost, and what fixed it. */
function WentWrong({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="wp-callout my-6 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
      <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-amber-600 dark:text-amber-400">
        What went wrong
      </p>
      <p className="mb-2 text-sm font-semibold text-foreground">{title}</p>
      <div className="text-[14px] leading-relaxed text-muted-foreground [&>p]:mb-2 [&>p:last-child]:mb-0">{children}</div>
    </div>
  );
}

function Table({ headers, rows, align }: { headers: string[]; rows: React.ReactNode[][]; align?: ("l" | "r")[] }) {
  return (
    <div className="my-6 overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="bg-muted/40">
            {headers.map((h, i) => (
              <th key={i} className={`border-b border-border px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground ${align?.[i] === "r" ? "text-right" : "text-left"}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border last:border-0">
              {r.map((c, j) => (
                <td key={j} className={`px-4 py-2.5 align-top text-muted-foreground ${align?.[j] === "r" ? "text-right font-mono tabular-nums" : ""}`}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Figure({ caption, label, children }: { caption: string; label: string; children: React.ReactNode }) {
  return (
    <figure className="my-7">
      <div className="overflow-x-auto rounded-lg border border-border bg-muted/10 p-5">{children}</div>
      <figcaption className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
        <span className="mr-2 font-mono text-[10px] uppercase tracking-[0.1em] text-primary">{label}</span>
        {caption}
      </figcaption>
    </figure>
  );
}

/** Display equation. Hand-set — no maths library survives the CSP. */
function Eq({ children, note }: { children: React.ReactNode; note?: string }) {
  return (
    <div className="my-5 overflow-x-auto rounded-lg border border-border border-l-2 border-l-primary bg-muted/20 px-6 py-5 text-center">
      <div className="text-[16px] leading-loose text-foreground">{children}</div>
      {note && <p className="mt-3 font-mono text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}

function V({ children }: { children: React.ReactNode }) {
  return <span className="italic">{children}</span>;
}

/* ───────────────────────────── the maths, for figures ───────────────────────────── */

const erf = (x: number) => {
  const s = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
};
const N = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));
const gkCall = (S: number, K: number, T: number, sig: number) => {
  if (T <= 0 || sig <= 0) return Math.max(0, S - K);
  const q = Math.sqrt(T);
  const d1 = (Math.log(S / K) + 0.5 * sig * sig * T) / (sig * q);
  return S * N(d1) - K * N(d1 - sig * q);
};
const spread = (S: number, K: number, C: number, T: number, sig: number) =>
  Math.max(0, gkCall(S, K, T, sig) - gkCall(S, C, T, sig));

const NS = "http://www.w3.org/2000/svg";
const mk = (n: string, a: Record<string, string | number>) => {
  const e = document.createElementNS(NS, n);
  for (const k in a) e.setAttribute(k, String(a[k]));
  return e;
};
const poly = (pts: [number, number][]) => pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");

/* ───────────────────────────── figures ───────────────────────────── */

function PayoffFigure() {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    svg.innerHTML = "";
    const K = 11.9, C = 12.3, S0 = 11.731549, notional = 9000;
    const ox = 78, oy = 26, W = 560, H = 150, lo = 11.7, hi = 12.5;
    const pay = (s: number) => (notional * Math.max(0, Math.min(s, C) - K)) / S0;
    const maxP = pay(C);
    const X = (s: number) => ox + ((s - lo) / (hi - lo)) * W;
    const Y = (p: number) => oy + H - (p / (maxP * 1.18)) * H;

    svg.appendChild(mk("line", { x1: ox, y1: oy + H, x2: ox + W, y2: oy + H, stroke: "currentColor", "stroke-opacity": 0.28 }));
    svg.appendChild(mk("line", { x1: ox, y1: oy, x2: ox, y2: oy + H, stroke: "currentColor", "stroke-opacity": 0.28 }));
    svg.appendChild(mk("line", { x1: ox, y1: Y(maxP), x2: ox + W, y2: Y(maxP), stroke: "currentColor", "stroke-opacity": 0.13, "stroke-dasharray": "3 4" }));

    const pts: [number, number][] = [];
    for (let s = lo; s <= hi + 1e-9; s += 0.005) pts.push([X(s), Y(pay(s))]);
    svg.appendChild(mk("path", { d: poly(pts), fill: "none", stroke: "hsl(var(--primary))", "stroke-width": 2.4, "stroke-linejoin": "round" }));

    for (const [v, lab] of [[K, "K 11.90"], [C, "C 12.30"]] as [number, string][]) {
      svg.appendChild(mk("line", { x1: X(v), y1: oy, x2: X(v), y2: oy + H, stroke: "currentColor", "stroke-opacity": 0.13, "stroke-dasharray": "3 4" }));
      const t = mk("text", { x: X(v), y: oy + H + 17, "text-anchor": "middle", fill: "currentColor", "fill-opacity": 0.55, "font-size": 10.5, "font-family": "ui-monospace, monospace" });
      t.textContent = lab;
      svg.appendChild(t);
    }
    const labels: [number, number, string, string][] = [
      [ox + W, Y(maxP) - 8, "end", "maximum = notional x (C - K) / S0"],
      [ox - 8, oy + H + 4, "end", "$0"],
      [ox + W, oy + H + 34, "end", "settlement rate at expiry"],
      [X(11.76), Y(0) - 10, "start", "nothing below the strike"],
    ];
    for (const [x, y, anchor, text] of labels) {
      const t = mk("text", { x, y, "text-anchor": anchor, fill: "currentColor", "fill-opacity": 0.55, "font-size": 11, "font-family": "ui-monospace, monospace" });
      t.textContent = text;
      svg.appendChild(t);
    }
  }, []);
  return <svg ref={ref} viewBox="0 0 660 230" className="block h-auto w-full text-foreground" role="img" aria-label="Payout rising linearly from the strike to the cap, then flat" />;
}

function PremiumSurfaceFigure() {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    svg.innerHTML = "";
    const K = 11.9, C = 12.3, SIG = 0.4445;
    const panel = (ox: number, title: string, sub: string, pts: [number, number][], xlab: string) => {
      const W = 250, H = 150, oy = 52;
      const t1 = mk("text", { x: ox, y: 22, fill: "hsl(var(--primary))", "font-size": 11, "font-family": "ui-monospace, monospace" });
      t1.textContent = title;
      svg.appendChild(t1);
      const t2 = mk("text", { x: ox, y: 39, fill: "currentColor", "fill-opacity": 0.55, "font-size": 11.5 });
      t2.textContent = sub;
      svg.appendChild(t2);
      for (let i = 0; i <= 3; i++) {
        const y = oy + (H * i) / 3;
        svg.appendChild(mk("line", { x1: ox, y1: y, x2: ox + W, y2: y, stroke: "currentColor", "stroke-opacity": i === 3 ? 0.28 : 0.1, ...(i === 3 ? {} : { "stroke-dasharray": "2 4" }) }));
      }
      svg.appendChild(mk("line", { x1: ox, y1: oy, x2: ox, y2: oy + H, stroke: "currentColor", "stroke-opacity": 0.28 }));
      const max = Math.max(...pts.map(p => p[1])) * 1.15 || 1;
      const xlo = pts[0][0], xhi = pts[pts.length - 1][0];
      const scaled = pts.map(p => [ox + ((p[0] - xlo) / (xhi - xlo)) * W, oy + H - (p[1] / max) * H] as [number, number]);
      svg.appendChild(mk("path", { d: poly(scaled), fill: "none", stroke: "hsl(var(--primary))", "stroke-width": 2.2 }));
      const t3 = mk("text", { x: ox + W, y: oy + H + 18, "text-anchor": "end", fill: "currentColor", "fill-opacity": 0.5, "font-size": 10.5, "font-family": "ui-monospace, monospace" });
      t3.textContent = xlab;
      svg.appendChild(t3);
    };
    const decay: [number, number][] = [];
    for (let d = 0.4; d <= 30; d += 0.4) decay.push([d, spread(11.731549, K, C, d / 365.25, SIG) / 11.731549]);
    panel(52, "TIME", "spot fixed, expiry approaching", decay, "days remaining");

    const money: [number, number][] = [];
    for (let s = 11.45; s <= 12.05; s += 0.01) money.push([s, spread(s, K, C, 5 / 365.25, SIG) / s]);
    panel(372, "MONEYNESS", "5 days fixed, spot rising to the strike", money, "spot to strike");
  }, []);
  return <svg ref={ref} viewBox="0 0 660 240" className="block h-auto w-full text-foreground" role="img" aria-label="Premium falling with time and rising with moneyness" />;
}

function ArchitectureFigure() {
  return (
    <svg viewBox="0 0 660 250" className="block h-auto w-full text-foreground" role="img" aria-label="Off-chain pricing engine signs a quote which the contract verifies">
      <g fontFamily="ui-monospace, monospace" fontSize="11">
        <rect x="16" y="30" width="185" height="86" rx="6" fill="none" stroke="currentColor" strokeOpacity="0.28" />
        <text x="28" y="52" fill="hsl(var(--primary))" fontSize="10">OFF-CHAIN ENGINE</text>
        <text x="28" y="72" fill="currentColor" fillOpacity="0.65">GARCH volatility</text>
        <text x="28" y="88" fill="currentColor" fillOpacity="0.65">Garman–Kohlhagen</text>
        <text x="28" y="104" fill="currentColor" fillOpacity="0.65">Merton jump overlay</text>

        <rect x="238" y="30" width="185" height="86" rx="6" fill="none" stroke="currentColor" strokeOpacity="0.28" />
        <text x="250" y="52" fill="hsl(var(--primary))" fontSize="10">SIGNED QUOTE</text>
        <text x="250" y="72" fill="currentColor" fillOpacity="0.65">premium + nonce</text>
        <text x="250" y="88" fill="currentColor" fillOpacity="0.65">valid 120 seconds</text>
        <text x="250" y="104" fill="currentColor" fillOpacity="0.65">ECDSA signature</text>

        <rect x="460" y="30" width="185" height="86" rx="6" fill="none" stroke="hsl(var(--primary))" strokeOpacity="0.5" />
        <text x="472" y="52" fill="hsl(var(--primary))" fontSize="10">ON-CHAIN DIAMOND</text>
        <text x="472" y="72" fill="currentColor" fillOpacity="0.65">ecrecover ~3,000 gas</text>
        <text x="472" y="88" fill="currentColor" fillOpacity="0.65">freshness + nonce</text>
        <text x="472" y="104" fill="currentColor" fillOpacity="0.65">charges the premium</text>

        <path d="M201 73 L232 73" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1.2" markerEnd="url(#ar)" />
        <path d="M423 73 L454 73" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1.2" markerEnd="url(#ar)" />
        <defs>
          <marker id="ar" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <path d="M0 0 L7 3.5 L0 7 z" fill="currentColor" fillOpacity="0.4" />
          </marker>
        </defs>

        <text x="16" y="160" fill="currentColor" fillOpacity="0.55" fontSize="11.5" fontFamily="inherit">
          The model never runs on-chain. Pricing needs ln, exp and erf, a Poisson series, and
        </text>
        <text x="16" y="178" fill="currentColor" fillOpacity="0.55" fontSize="11.5" fontFamily="inherit">
          sixty days of history — roughly 200,000 gas and precision loss, against ~3,000 gas
        </text>
        <text x="16" y="196" fill="currentColor" fillOpacity="0.55" fontSize="11.5" fontFamily="inherit">
          to verify a signature with none. The chain checks the price; it does not compute it.
        </text>
        <text x="16" y="224" fill="hsl(var(--primary))" fontSize="10.5">
          Fails closed: no valid signature, no sale.
        </text>
      </g>
    </svg>
  );
}

/* ───────────────────────────── nav ───────────────────────────── */

const SECTIONS = [
  { id: "abstract", label: "Abstract" },
  { id: "problem", label: "1. The problem" },
  { id: "decisions", label: "2. Design decisions" },
  { id: "mechanics", label: "3. Protocol mechanics" },
  { id: "pricing", label: "4. Pricing" },
  { id: "settlement", label: "5. Settlement" },
  { id: "fees", label: "6. Fees" },
  { id: "security", label: "7. Security" },
  { id: "limits", label: "8. Limitations" },
];

export default function Whitepaper() {
  const [active, setActive] = useState("abstract");

  useEffect(() => {
    const obs = new IntersectionObserver(
      entries => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: "-80px 0px -70% 0px" },
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <style dangerouslySetInnerHTML={{ __html: PRINT_STYLES }} />

      <header className="no-print sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <Link href="/data-room" className="flex items-center gap-2.5 no-underline">
            <ArrowLeft className="h-4 w-4 text-muted-foreground" />
            <img src={logoPath} alt="" className="h-6 w-6" />
            <span className="text-sm font-semibold text-foreground">BlockFinaX</span>
            <span className="ml-2 font-mono text-[11px] text-muted-foreground">Whitepaper v{VERSION}</span>
          </Link>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Download className="mr-1.5 h-3.5 w-3.5" /> PDF
          </Button>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-10 px-5 py-10">
        <nav className="wp-nav no-print hidden w-52 shrink-0 lg:block">
          <div className="sticky top-24">
            <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Contents</p>
            <ul className="space-y-0.5 border-l border-border">
              {SECTIONS.map(s => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className={`-ml-px block border-l-2 py-1.5 pl-3 text-[13px] no-underline transition-colors ${
                      active === s.id ? "border-l-primary font-medium text-foreground" : "border-l-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </nav>

        <main className="wp-body min-w-0 max-w-[68ch] flex-1">
          {/* ── masthead ── */}
          <div className="mb-12 border-b border-border pb-8">
            <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              Protocol design document
            </p>
            <h1 className="mb-4 text-[38px] font-bold leading-[1.08] tracking-tight text-foreground" style={{ textWrap: "balance" }}>
              Parametric FX cover, priced and settled on-chain
            </h1>
            <p className="mb-6 text-[17px] leading-relaxed text-muted-foreground">
              How BlockFinaX writes currency protection for businesses that banks will not serve —
              the decisions behind it, the mistakes found along the way, and what fixed them.
            </p>
            <div className="flex flex-wrap gap-x-7 gap-y-2 font-mono text-[11px] text-muted-foreground">
              <span>Version {VERSION}</span>
              <span>{DATE}</span>
              <span>Base 8453</span>
              <span>Deployed; verify current chain state</span>
            </div>
            <p className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm leading-relaxed text-muted-foreground">
              This document describes a protocol design and historical implementation decisions. It is not a statement that every described feature is active on every network, that current bytecode matches this document, or that settlement or payout is guaranteed. Check the live chain reads and transaction details before relying on a feature.
            </p>
          </div>

          {/* ── abstract ── */}
          <SectionTitle id="abstract" n="Abstract" title="What this protocol does" />
          <P>
            Illustratively, a business with a foreign-currency supplier payment due in thirty days
            may face uncertainty between agreeing a price and paying the supplier. Its exposure,
            existing hedges, bank access and margin impact depend on the business and corridor; this
            is not a customer case or a market-wide statistic.
          </P>
          <P>
            BlockFinaX lets anyone with stablecoins underwrite that risk, and anyone exposed to it buy
            protection, without either party knowing or trusting the other. An underwriter locks USDC
            into a pool against a named currency pair, a strike and an expiry. A hedger pays a premium
            for cover on a notional amount. At expiry an oracle posts the rate and the contract pays
            out arithmetically — <Em>no claim, no assessor, no negotiation</Em>. Both sides know the
            worst case before they commit.
          </P>
          <P>
            The protocol runs as an EIP-2535 Diamond on Base. Pricing is a
            Garman–Kohlhagen kernel with a Merton jump overlay and GARCH volatility, computed
            off-chain and verified on-chain by signature. Everything below explains why each of those
            choices was made, and what the alternatives cost.
          </P>

          {/* ── 1. problem ── */}
          <SectionTitle id="problem" n="Section 01" title="The problem" sub="Why the risk exists and why nobody covers it" />
          <P>
            Frontier currencies do not drift — they hold, then step. The cedi lost roughly a fifth of
            its value against the dollar across 2022; the naira was devalued twice inside a year;
            Egypt moved 35% in a week. A business planning around a stable rate is planning around the
            interval between steps, not the absence of them.
          </P>
          <P>
            Conventional hedging does exist, and it is closed to them for structural reasons rather
            than unwillingness:
          </P>
          <Table
            headers={["Barrier", "Why it excludes the SME"]}
            rows={[
              [<Em key="a">Minimum ticket</Em>, "Bank FX forwards typically start around $250,000. An importer hedging $20,000 is below the floor at which a desk will quote."],
              [<Em key="b">Credit assessment</Em>, "A forward is a credit exposure — the bank must be paid if the rate moves the customer's way. That underwriting costs more than the trade earns."],
              [<Em key="c">Collateral</Em>, "Margin on an unfunded forward ties up working capital the business is hedging precisely because it does not have spare."],
              [<Em key="d">Thin markets</Em>, "There is no deep forward market in cedi or kwacha. Even willing banks are warehousing risk they cannot lay off."],
            ]}
          />
          <P>
            Each of these is a consequence of the hedge being a <Em>promise</Em>. A promise requires
            trust, trust requires assessment, and assessment has a fixed cost that small trades cannot
            carry. The design below removes the promise: every obligation is pre-funded in a contract
            before it is sold.
          </P>

          {/* ── 2. decisions ── */}
          <SectionTitle id="decisions" n="Section 02" title="Design decisions" sub="What was chosen, what was rejected, and what the wrong answers cost" />
          <P>
            Six choices define the protocol. Each is stated with its alternative, because a decision
            recorded without its alternative is indistinguishable from an accident.
          </P>

          <Decision
            id="d1"
            title="2.1 Cover is a capped range, not a binary bet"
            chose="Payout rises in proportion to how far the rate travels past the strike, stopping at a cap fixed when the pool is created."
            rejected="A fixed payout on any breach — simpler to explain, and what most on-chain outcome markets do."
          >
            <P>
              A binary pays the same whether the rate breaches by a hundredth or by twenty percent,
              which is the wrong shape for hedging: an importer's loss scales with the size of the
              move, so their cover should too. A proportional payout tracks the exposure it exists to
              offset.
            </P>
            <P>
              The cap is what makes the pool underwritable. Without it an underwriter's loss is
              unbounded and no amount of locked capital is provably sufficient. With it, the worst
              case is <Mono>(C − K)</Mono> per unit of notional, known when the position is written,
              so the contract can reserve exactly that and refuse anything it cannot cover. Solvency
              becomes an invariant rather than a policy.
            </P>
          </Decision>

          <Figure label="Figure 1" caption="Payout profile, computed from the deployed formula. Nothing below the strike; proportional between strike and cap; flat above it. Drawn with event 9's live terms — strike 11.90, cap 12.30, $9,000 notional — where the maximum evaluates to $306.864848 against the $306.864847 the contract reserved.">
            <PayoffFigure />
          </Figure>

          <Decision
            id="d2"
            title="2.2 Settlement happens at expiry, not on first touch"
            chose="One settlement, at expiry, on the rate prevailing then. A rate may cross the strike and return; what counts is where it finishes."
            rejected="Settling the instant the rate touches the strike — intuitive, and what the protocol originally did."
          >
            <P>
              The two halves have to agree. A payout measured as distance travelled past the strike
              cannot be triggered at the moment of touching, because at that instant the distance is
              zero. The original design paired a one-touch trigger with a proportional payout and the
              combination annihilated itself.
            </P>
            <WentWrong title="Every triggered position paid almost nothing">
              <p>
                Two events triggered before this was found. Event 5, strike 11.70 with a cap at 13.00,
                settled at 11.711956 — <Em>0.92% of its maximum</Em>. Position #4 in that pool put up
                $1,000, paid $16.93 in premium and received <Em>$1.04</Em> on a position that won. Held
                to expiry the same position would have paid $17 at 11.90 and $113.62 at the cap.
              </p>
              <p>
                The trigger fired at the exact instant intrinsic value was zero and then froze it
                there. The fix was to delete the trigger: settlement now reads the rate once, at
                expiry. That also aligns settlement with the pricing engine, which had been quoting a
                European spread all along.
              </p>
            </WentWrong>
            <P>
              The cost of this choice is real and worth stating plainly: a rate can now cross the
              strike, deliver the loss the hedger feared, and retreat before expiry — leaving the
              position worthless. That is what a European instrument is, and it is what the premium
              buys. Covering the path rather than the endpoint is a barrier option, priced
              differently, and is noted in Section 8 as future work rather than smuggled in here.
            </P>
          </Decision>

          <Decision
            id="d3"
            title="2.3 Pricing runs off-chain and is verified on-chain"
            chose="The engine prices and signs; the contract recovers the signature, checks freshness and nonce, and charges the signed premium."
            rejected="Computing the option price in Solidity, so the chain is self-contained."
          >
            <P>
              The model needs <Mono>ln</Mono>, <Mono>exp</Mono> and the error function, a Poisson
              series over jump counts, and sixty days of price history. On-chain that is roughly
              200,000 gas, meaningful precision loss in fixed-point arithmetic, and historical data
              that cannot live there at any price. Verifying an ECDSA signature costs about 3,000 gas
              and loses nothing.
            </P>
            <P>
              The trade is that pricing depends on a service. That is why it <Em>fails closed</Em>: no
              valid signature, no sale. Selling mispriced cover is worse than briefly selling none,
              and an underwriter is not harmed by a pause.
            </P>
          </Decision>

          <Figure label="Figure 2" caption="The chain checks the price rather than computing it. The signature is bound to the chain, the diamond, the pool, the notional and a nonce, so a quote cannot be replayed across contexts or reused.">
            <ArchitectureFigure />
          </Figure>

          <Decision
            id="d4"
            title="2.4 Jump-diffusion, not plain Black–Scholes"
            chose="Garman–Kohlhagen with a Merton compound-Poisson jump overlay, and GARCH volatility over the remaining horizon."
            rejected="Lognormal diffusion alone; or Monte Carlo; or a binomial lattice."
          >
            <P>
              A pure diffusion model assumes returns arrive in small continuous increments. Frontier
              currencies do not behave that way — they are stable for months and then gap. A diffusion
              fitted to the quiet periods prices the gap at close to zero, which is exactly the risk
              the hedger is buying and the underwriter is selling.
            </P>
            <P>
              Monte Carlo was rejected for a reason specific to this design rather than cost: a signed
              quote must be reproducible by whoever verifies it, and a simulation is not deterministic
              unless seeded, at which point it is a slow approximation of a closed form we already
              have. A binomial lattice adds nothing for a European payoff and introduces convergence
              noise that breaks the same reproducibility.
            </P>
          </Decision>

          <Decision
            id="d5"
            title="2.5 An underwriter's premium is treated as a volatility view"
            chose="Invert the model at pool creation to recover the volatility their premium implies, then quote against that for the pool's life."
            rejected="Freezing the premium (what the protocol did); or re-quoting from live market volatility."
          >
            <P>
              A single premium fixed at creation cannot be right for long. A hedger arriving on day 25
              of a 30-day pool buys a fifth of the protection the day-one buyer did, and pays the same
              for it. But re-pricing from market volatility alone discards the underwriter's judgement
              entirely, and they are the party with capital at risk.
            </P>
            <P>
              Their price <Em>is</Em> a volatility view. Recovering it — <V>σ</V>* — keeps their level
              while letting the model supply the shape. On event 9 a 1.0% premium inverts to{" "}
              <V>σ</V>* = 44.45% against a market reading 32%: a margin the underwriter chose, and one
              a market re-quote would have silently deleted on day two.
            </P>
            <P>
              This is also why a simple time discount was rejected. It only ever reduces the price,
              and the correction is not one-directional — see Figure 3.
            </P>
          </Decision>

          <Figure label="Figure 3" caption="The two effects pull against each other, drawn at σ* = 44.45% on event 9's terms. Time decay lowers the premium; spot approaching the strike raises it. With three days left, spot at 11.73 prices at $75 per $10,000 and spot at 11.95 at $125 — a time-only discount would have charged around $43 for the second. Curves use the diffusion kernel alone; the engine adds the jump overlay of 4.2, which lifts both by a few percent without changing the shape.">
            <PremiumSurfaceFigure />
          </Figure>

          <Decision
            id="d6"
            title="2.6 Sales stop on a leverage bound, not a price level"
            chose="Quote only while 1.5 ≤ max payout ÷ premium ≤ 100."
            rejected="Refusing to sell once spot passes the strike."
          >
            <P>
              The instinct is to stop selling when a pool moves into the money. But for a capped
              spread the premium converges on the maximum payout by itself — measured at strike 11.00
              and cap 11.40, the ratio falls to 1.02 at spot 11.60 and reaches exactly 1.00 at 12.00.
              No special rule is needed to make deep in-the-money cover expensive; the arithmetic
              already does.
            </P>
            <P>
              What is needed is a floor, because <Em>expensive</Em> becomes <Em>pointless</Em> before
              it becomes impossible. Under the deployed fees a hedger breaks even at a ratio of
              1.0714; below that they lose money even if the rate finishes at the cap. Stopping at 1.5
              leaves a real margin and, unlike a price threshold, cannot be evaded by moving the
              strike. The upper bound catches the opposite failure: a premium so cheap relative to the
              payout that the model is plainly wrong.
            </P>
            <WentWrong title="A pool was created charging more than it could ever pay">
              <p>
                Event 10 was written at a 3.0% premium against a strike and cap worth 2.681% — a ratio
                of 0.894. Every buyer lost money the moment they bought, whatever the rate did. Two
                did, for <Em>$55.76</Em> between them.
              </p>
              <p>
                The only check on the creation form caught premiums more than 10% <Em>below</Em> the
                engine's suggestion. Nothing looked at the other direction. Pool creation now runs the
                same three checks — a premium above the maximum payout, one leaving under 1.5x, one
                implying a volatility the market cannot support — and refuses rather than warns,
                because <Mono>premiumRate</Mono> is immutable once the pool exists.
              </p>
            </WentWrong>
          </Decision>

          {/* ── 3. mechanics ── */}
          <SectionTitle id="mechanics" n="Section 03" title="Protocol mechanics" sub="Roles, lifecycle and capital flow" />
          <H3>3.1 Participants</H3>
          <Table
            headers={["Role", "Commits", "Earns", "Worst case"]}
            rows={[
              ["Underwriter (LP)", "Stablecoin capital locked to a pool", "Premiums from every hedger in the pool, pro rata", "Pays out up to (C − K) per unit of notional written"],
              ["Hedger", "A premium, paid upfront", "A payout scaling with the move past the strike", "Loses the premium; nothing more"],
              ["Pool creator", "A creation fee and initial liquidity", "5% of every protocol fee the pool generates", "Their own liquidity, as any underwriter"],
              ["Oracle", "Gas to post the settlement rate", "—", "—"],
            ]}
          />
          <P>
            A hedger's downside is bounded by construction: they cannot lose more than the premium,
            there is no margin, and no position can be called. The asymmetry is deliberate — the party
            least able to absorb a surprise is the one protected from it.
          </P>

          <H3>3.2 Lifecycle</H3>
          <Table
            headers={["Stage", "What happens"]}
            rows={[
              [<Em key="1">Creation</Em>, "The creator sets pair, strike, cap, expiry and premium, and seeds liquidity. The premium is validated against the checks in 2.6 and refused if it cannot be sold honestly."],
              [<Em key="2">Funding</Em>, "Underwriters deposit into the pool. Capacity is whatever remains after reserving the worst case of every position already written."],
              [<Em key="3">Cover sold</Em>, "A hedger names a notional. The contract reserves that position's maximum payout against free capacity and refuses if it does not fit — solvency is enforced here, not monitored later."],
              [<Em key="4">Expiry</Em>, "The oracle posts the prevailing rate. The contract computes each payout arithmetically."],
              [<Em key="5">Claim</Em>, "Winning hedgers claim; underwriters withdraw remaining capital plus premiums; the creator draws loyalty fees."],
            ]}
          />
          <P>
            Capacity is the load-bearing invariant. Before a position is written the contract checks
            that its worst case fits inside{" "}
            <Mono>totalLiquidity − totalMaxPayout</Mono> and reverts if it does not. A pool can
            therefore always pay every position it has sold, without monitoring, alerting or
            discretion.
          </P>

          {/* ── 4. pricing ── */}
          <SectionTitle id="pricing" n="Section 04" title="Pricing" sub="How a premium is derived" />
          <P>
            Cover is a call spread — long at the strike, short at the cap — so its value is the
            difference between two options on the same underlying. Writing the settlement rate{" "}
            <V>S</V>, strike <V>K</V>, cap <V>C</V> and years remaining <V>τ</V>:
          </P>
          <H3>4.1 Volatility over the remaining horizon</H3>
          <P>
            Volatility is a forecast over the window that remains, not a constant. The engine uses the
            GARCH(1,1) closed form, with <V>φ</V> the pair's persistence and{" "}
            <V>V<sub>L</sub></V> its long-run variance:
          </P>
          <Eq note="N = round(252 τ) trading days remaining">
            <V>V̄</V>(<V>τ</V>) = <V>V<sub>L</sub></V> + ( 1 − <V>φ</V><sup><V>N</V></sup> ) ÷ ({" "}
            <V>N</V>(1 − <V>φ</V>) ) × ( <V>σ</V><sub>0</sub><sup>2</sup> − <V>V<sub>L</sub></V> )
          </Eq>
          <H3>4.2 The option kernel</H3>
          <P>
            Each leg is priced by Garman–Kohlhagen, then a Merton overlay weights that price across
            the number of jumps that might occur before expiry — a Poisson series in which each term
            carries its own drift and volatility:
          </P>
          <Eq note="w(n) = Poisson weight for n jumps; σ(n) and r(n) adjusted per leg">
            <V>C</V><sub>M</sub>(<V>K</V>) = Σ <V>w</V><sub><V>n</V></sub> · <V>c</V>( <V>S</V>,{" "}
            <V>K</V>, <V>τ</V> ; <V>r</V><sub><V>n</V></sub>, <V>σ</V><sub><V>n</V></sub> )
          </Eq>
          <Eq note="the short leg at the cap is what bounds the underwriter's loss">
            <V>V</V><sub>spread</sub> = max( 0 , <V>C</V><sub>M</sub>(<V>K</V>) − <V>C</V><sub>M</sub>(<V>C</V>) )
            &nbsp;&nbsp;&nbsp; <V>ρ</V> = <V>V</V><sub>spread</sub> ÷ <V>S</V>
          </Eq>
          <H3>4.3 What moves a live quote</H3>
          <Table
            headers={["Input", "Direction", "Why"]}
            rows={[
              ["Time remaining", "Falls as expiry nears", "Less protection left to buy"],
              ["Spot toward the strike", "Rises", "The payout becomes more likely"],
              ["Pool utilisation", "Rises as capacity fills", "An underwriter's marginal risk is not linear in how full their pool is"],
            ]}
          />
          <P>
            Utilisation is applied as a quadratic markup, so early buyers are barely affected and the
            last of a pool's capacity is genuinely dear. An underwriter may also set a floor beneath
            which they decline to write at all — necessary once quotes can fall, since a premium of
            1.0% at seven days is worth a third of that with one day left.
          </P>

          {/* ── 5. settlement ── */}
          <SectionTitle id="settlement" n="Section 05" title="Settlement" sub="One reading, at expiry, computed arithmetically" />
          <Eq>
            payout = notional × max( 0 , min( <V>S<sub>T</sub></V>, <V>C</V> ) − <V>K</V> ) ÷{" "}
            <V>S</V><sub>0</sub>
          </Eq>
          <P>
            An oracle service polls rates every five minutes across all supported pairs and submits
            the prevailing rate once an event's expiry has passed. Settlement is a single on-chain
            transaction; the contract does the arithmetic. There is no assessor, no claim form and no
            discretion, which is what makes the cover parametric rather than insurance.
          </P>
          <WentWrong title="Settlement stopped silently for hours, and nothing said so">
            <p>
              An expired pool once sat unsettled with $630 of capital behind it because the account
              that submits settlements had run out of gas — five times short of a fraction of a cent.
              Every cycle failed, and the poller logged only its successes, so a service failing
              forever looked identical to one with nothing to do.
            </p>
            <p>
              Both are now reported, and each cycle checks whether the settler can still afford to
              work — warning while there is time to act rather than after capital is already locked.
              The lesson generalises: a component whose failure is invisible will eventually fail
              invisibly.
            </p>
          </WentWrong>

          {/* ── 6. fees ── */}
          <SectionTitle id="fees" n="Section 06" title="Fees" sub="Charged by the contract, on-chain, at the moment of each event" />
          <Table
            headers={["Fee", "Rate", "Charged to", "Distribution"]}
            align={["l", "l", "l", "l"]}
            rows={[
              ["Entry", "5% of the premium", "Hedger, at purchase", "95% treasury · 5% pool creator"],
              ["Payout claim", "2% of the payout", "Hedger, at claim", "95% treasury · 5% pool creator"],
              ["Underwriter profit", "2% of premium income", "LP, at claim", "95% treasury · 5% pool creator"],
              ["Pool creation", "$25 on Base", "Creator, once", "100% treasury"],
            ]}
          />
          <P>
            The entry fee is charged on the <Em>premium</Em>, not the notional. That distinction is
            not cosmetic: a fee on notional does not move with the price of the protection, so on a
            cheap pool it can exceed the premium several times over. An earlier configuration charged
            5% of notional, which on a 1% premium was five times the thing it was a fee on.
          </P>

          {/* ── 7. security ── */}
          <SectionTitle id="security" n="Section 07" title="Security" sub="Architecture, audit status and the risks that remain" />
          <P>
            The protocol is an EIP-2535 Diamond: a routing contract that delegates each function to a
            facet, so components can be replaced without migrating state. That upgradeability is a
            capability and a risk, and the honest position is that it is both.
          </P>
          <H3>7.1 Audit</H3>
          <P>
            The April 2026 review summary available to the company reports nineteen findings —
            two critical, three high, five medium, five low and four informational. It covered the
            retired Lisk deployment. The finding statuses shown in that report are historical; they
            have not been revalidated here against current Base or BNB Smart Chain bytecode. This
            review must not be represented as an audit of those current deployments. See the Data
            Room for the report scope and live governance reads.
          </P>
          <H3>7.2 Risks that remain</H3>
          <Table
            headers={["Risk", "Status"]}
            rows={[
              [<Em key="a">Oracle authorisation</Em>, "Settlement authority depends on the active on-chain mode, configured signer roster and quorum. Check the live Data Room governance read; this document does not assert a current mode."],
              [<Em key="b">Upgrade authority</Em>, "The current Diamond owner and active diamondCut selector implementation are read live in the Data Room. A Safe's existence does not establish that it controls the Diamond, and a facet address alone does not prove a delay is enforced."],
              [<Em key="c">Pricing dependency</Em>, "Quoted purchases require the engine to be reachable. It fails closed, so the failure mode is an inability to buy rather than a mispriced sale."],
              [<Em key="d">Rate source</Em>, "Settlement depends on third-party FX data. Sources are separated by asset class, but a coordinated failure would delay settlement."],
            ]}
          />

          {/* ── 8. limits ── */}
          <SectionTitle id="limits" n="Section 08" title="Limitations" sub="What this design does not do" />
          <Table
            headers={["Limitation", "Consequence"]}
            rows={[
              ["European settlement only", "A rate that spikes past the strike and returns before expiry pays nothing, even though the hedger's loss was real. Barrier-style cover is a different instrument and is not offered."],
              ["Capital-inefficient by design", "Every payout is fully pre-funded. This is what removes counterparty risk, and it means an underwriter's capital is locked rather than margined."],
              ["Liquidity-constrained", "Cover cannot exceed what underwriters have committed. Deep markets require underwriters before hedgers, which is the harder side to attract."],
              ["Stablecoin-denominated", "Both sides transact in USDC or USDT. A business earning cedis still needs a route in and out of stablecoins, which is outside the protocol."],
              ["No secondary market", "A position is held to expiry. There is no mechanism to sell cover on, so a hedger whose exposure disappears cannot recover the premium."],
            ]}
          />
          <P>
            The last two are the binding constraints on adoption rather than on the design, and are
            named here because a document that lists only what a protocol does is not a design
            document.
          </P>

          <div className="mt-16 border-t border-border pt-6">
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              BlockFinaX Inc. (Delaware) and BlockFinaX Ltd (Ghana). Whitepaper v{VERSION} — {DATE}.
              Figures 1 and 3 are computed in-page rather than drawn. Figure 1 is exact; Figure 3 uses the diffusion kernel without the jump overlay, as its caption notes.
              This document describes a protocol, not an offer, and is not financial advice.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
