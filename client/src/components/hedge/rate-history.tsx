/**
 * What this pair has actually done, with the strike drawn across it.
 *
 * The purchase decision is not "where is this going", which nobody knows. It
 * is "how violently does this thing move, and has it been past my strike
 * before". A line of closes with the strike marked answers that in about two
 * seconds, which no paragraph of copy manages.
 *
 * Three deliberate omissions:
 *
 * No trend line. A trend line is a prediction rendered as a fact, on a page
 * selling financial protection, for a product mid application to the Bank of
 * Ghana sandbox. Everything here is history, and the reader draws their own
 * conclusion.
 *
 * No candlesticks. The table stores closes and nothing else, so a candle is
 * not drawable, and the intraday high and low it would add are noise to
 * someone buying thirty day cover. They care where the rate settles.
 *
 * No charting library. Hand drawn SVG costs nothing in bundle size, and the
 * strict CSP on this site blocks external scripts anyway.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, Minimize2 } from "lucide-react";

interface Point { date: string; close: number; }
interface History {
  pair: string;
  points: Point[];
  observations?: number;
  intraday?: boolean;
  /** Whether this pair is polled into snapshots at all, so hour views work. */
  hasIntraday?: boolean;
  /** Different rates in the window. Low on an hour view means a staircase. */
  distinctRates?: number;
  /** Live spot, the same figure the rates list shows. */
  live?: number | null;
  /** The last settled daily close, which the line ends on. */
  lastClose?: number;
  latest?: number;
  ticksDropped?: number;
  change?: { percent: number; direction: string } | null;
}

/**
 * Two different series, not one scale.
 *
 * The hour ranges read the oracle's own snapshots, which are the only intraday
 * record that exists. They stop at 24H because that is all the snapshot
 * history there is, and they are honest about their resolution: across 48
 * hours these FX pairs carry roughly 50 snapshots but only THREE distinct
 * rates, because the provider revalues exotic currencies once or twice a day
 * rather than continuously. On those pairs an hour view is a staircase, and
 * the chart says so beneath rather than pretending otherwise.
 *
 * Everything from 1M up reads daily closes.
 */
type Range = { key: string; label: string; days?: number | "ytd" | "max"; hours?: number };

const RANGES: Range[] = [
  { key: "1h",  label: "1H",  hours: 1 },
  { key: "6h",  label: "6H",  hours: 6 },
  { key: "24h", label: "24H", hours: 24 },
  { key: "1m",  label: "1M",  days: 30 },
  { key: "3m",  label: "3M",  days: 90 },
  { key: "6m",  label: "6M",  days: 182 },
  { key: "ytd", label: "YTD", days: "ytd" },
  { key: "1y",  label: "1Y",  days: 365 },
  { key: "5y",  label: "5Y",  days: 1825 },
  { key: "max", label: "MAX", days: "max" },
];

const daysFor = (d: number | "ytd" | "max"): number => {
  if (d === "max") return 9200;
  if (d === "ytd") {
    const now = new Date();
    const jan1 = new Date(now.getFullYear(), 0, 1);
    return Math.max(7, Math.ceil((now.getTime() - jan1.getTime()) / 86400000));
  }
  return d;
};

/**
 * Geometry for the two sizes this chart draws at.
 *
 * One component rather than two: an expanded copy with its own state would
 * drift from the inline one, and would forget which range you were looking at
 * the moment you opened it.
 */
const SIZES = {
  inline:   { VW: 560,  VH: 220, PAD: { t: 10, r: 54, b: 24, l: 6 },  ticks: 3, dates: 3, mark: 44, sub: 12 },
  expanded: { VW: 1100, VH: 480, PAD: { t: 16, r: 68, b: 30, l: 10 }, ticks: 6, dates: 6, mark: 92, sub: 20 },
};

const fmtRate = (v: number) =>
  v.toLocaleString("en-US", {
    minimumFractionDigits: v >= 100 ? 2 : 4,
    maximumFractionDigits: v >= 100 ? 2 : 4,
  });

const fmtDay = (iso: string, intraday = false) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return intraday
    ? d.toLocaleString("en-US", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
};

const fmtAxis = (iso: string, span: number, intraday: boolean) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (intraday) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (span > 1200) return String(d.getFullYear());
  return d.toLocaleDateString("en-US", { month: "short", year: span > 300 ? "2-digit" : undefined });
};

export function RateHistory({
  pair,
  strike,
  strikeAbove,
  cap,
  maxPayoutLabel,
  markRate,
  markLabel,
  entryRate,
  perspective = "hedger",
  initialRange = "1y",
}: {
  pair: string;
  /** Omitted when no particular cover is in view, as on the rates list. */
  strike?: number;
  strikeAbove?: boolean;
  /** The rate past which the payout stops growing. Shades the zones when given. */
  cap?: number;
  /**
   * A rate to mark across the chart: today's rate on a live position, or the
   * settled rate on an ended one. Drawn as a line rather than left to the
   * endpoint dot, because the question is where it sits against the strike,
   * and a dot on the right edge does not answer that at a glance.
   */
  markRate?: number;
  markLabel?: string;
  /**
   * The rate when the cover was bought.
   *
   * The gap between it and the strike is the part of the move the holder
   * carries themselves, which is the one number a payout table never showed
   * and the thing people most often misjudge about a hedge.
   */
  entryRate?: number;
  /**
   * Whose side the colours are read from.
   *
   * A pool has two parties with opposite interests in the same picture. The
   * band between strike and cap is where a hedger gets paid and where an
   * underwriter pays, so it cannot be green for both. Painting it green for an
   * underwriter would tell the person whose capital is at risk that the zone
   * consuming it is good news.
   */
  perspective?: "hedger" | "underwriter";
  /** Labels for the bands, so the chart says what each zone is worth. */
  maxPayoutLabel?: string;
  initialRange?: string;
}) {
  // Without a strike this is simply the pair's history. The strike line and the
  // sentence about where cover starts paying are the only parts that need one.
  const hasStrike = typeof strike === "number" && Number.isFinite(strike) && strike > 0;
  // Zones need both edges. With only a strike the chart draws the one line, as
  // it does on the rates list where no particular cover is in view.
  const hasZones = hasStrike && typeof cap === "number" && Number.isFinite(cap) && cap > 0;

  const [rangeKey, setRangeKey] = useState(initialRange);
  const [data, setData] = useState<History | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "empty">("loading");
  const [hover, setHover] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [hourly, setHourly] = useState(true);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const { VW, VH, PAD, ticks: TICKS, dates: DATES, mark: MARK, sub: SUB } = expanded ? SIZES.expanded : SIZES.inline;

  // Escape closes it, and the page behind must not scroll while it is open.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setExpanded(false); };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [expanded]);

  const range = RANGES.find((r) => r.key === rangeKey) || RANGES[7];
  const rangeDays = range.days !== undefined ? daysFor(range.days) : 0;
  const query = range.hours ? `hours=${range.hours}` : `days=${rangeDays}`;

  useEffect(() => {
    if (!pair) return;
    let live = true;
    setState("loading");
    setHover(null);
    fetch(`/api/fx/history/${encodeURIComponent(pair)}?${query}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: History | null) => {
        if (!live) return;
        // A handful of closes cannot describe a market. Drawing a shape from
        // them would imply something that is not in the data.
        if (!d || !Array.isArray(d.points) || d.points.length < (d.intraday ? 2 : 5)) {
          setData(null);
          setState("empty");
          return;
        }
        if (typeof d.hasIntraday === "boolean") setHourly(d.hasIntraday);
        setData(d);
        setState("ready");
      })
      .catch(() => { if (live) { setData(null); setState("empty"); } });
    return () => { live = false; };
  }, [pair, query]);

  /**
   * The series the line is drawn from, ending at the live rate.
   *
   * The line used to stop at the last daily close while the marker and the
   * headline showed live spot, so the chart carried two "now" markers at
   * different heights. Both were labelled and it still read as a fault,
   * because a reader sees two dots for one moment before they read anything.
   *
   * A close is an end-of-day figure and spot is right now, so the honest fix
   * is to draw that last leg rather than to hide it: the series genuinely
   * continues from the close to where the rate stands. Only added when it
   * actually differs, so a quiet market gains no phantom point.
   */
  const series = useMemo<Point[]>(() => {
    const rows: Point[] = data?.points ?? [];
    if (!rows.length) return rows;
    const live = data?.live;
    if (!live || !Number.isFinite(live)) return rows;
    const lastClose = rows[rows.length - 1].close;
    if (!lastClose || Math.abs(live - lastClose) / lastClose < 0.0002) return rows;
    return [...rows, { date: new Date().toISOString().slice(0, 10), close: live }];
  }, [data]);

  const geom = useMemo(() => {
    if (!data || series.length < 2) return null;
    const closes = series.map((p) => p.close);
    // The strike sits inside the scale on purpose. If it is outside everything
    // the pair has traded, that fact is the most useful thing on the chart, and
    // clipping it would hide exactly what the reader needs to see.
    const edges: number[] = [];
    if (hasStrike) edges.push(strike as number);
    if (hasZones) edges.push(cap as number);
    if (typeof markRate === "number" && Number.isFinite(markRate) && markRate > 0) edges.push(markRate);
    if (typeof entryRate === "number" && Number.isFinite(entryRate) && entryRate > 0) edges.push(entryRate);
    const lo = Math.min(...closes, ...edges);
    const hi = Math.max(...closes, ...edges);
    // A flat series would divide by zero, and a hairline down the middle reads
    // as broken, so give it room either side.
    const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.02 || 1;
    const min = lo - pad;
    const max = hi + pad;

    const iw = VW - PAD.l - PAD.r;
    const ih = VH - PAD.t - PAD.b;
    const x = (i: number) => PAD.l + (i / (series.length - 1)) * iw;
    const y = (v: number) => PAD.t + (1 - (v - min) / (max - min)) * ih;

    const line = series
      .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.close).toFixed(1)}`)
      .join(" ");
    const area = `${line} L${x(series.length - 1).toFixed(1)},${PAD.t + ih} L${PAD.l},${PAD.t + ih} Z`;

    const ticks: number[] = [];
    for (let i = 0; i <= TICKS; i++) ticks.push(min + ((max - min) * i) / TICKS);

    return { min, max, x, y, line, area, ticks, iw, ih };
  }, [data, series, hasStrike, hasZones, strike, cap, markRate, entryRate, VW, VH, PAD, TICKS]);

  const onMove = useCallback((clientX: number) => {
    const svg = svgRef.current;
    if (!svg || !data || !geom) return;
    const box = svg.getBoundingClientRect();
    if (!box.width) return;
    // Map the pointer into viewBox space, then to the nearest close.
    const vx = ((clientX - box.left) / box.width) * VW;
    const frac = (vx - PAD.l) / geom.iw;
    const i = Math.round(frac * (series.length - 1));
    setHover(Math.max(0, Math.min(series.length - 1, i)));
  }, [series, geom, VW, PAD.l]);

  /**
   * Every state goes through here, including loading and empty.
   *
   * These used to return early, before the overlay was applied. Switching to a
   * range with no data while expanded therefore left the scroll lock on with
   * nothing on screen to release it, which froze the page.
   */
  const wrap = (node: JSX.Element): JSX.Element => {
    if (!expanded) return node;

    // The themed wrapper, falling back to body only if the shell is absent.
    const host =
      (typeof document !== "undefined" && document.querySelector(".bfx-app")) ||
      (typeof document !== "undefined" ? document.body : null);
    if (!host) return node;

    return createPortal(
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${pair} price history, enlarged`}
        onClick={() => setExpanded(false)}
        // Opaque and edge to edge. A centred card with scrim either side gives
        // back most of the width that expanding was for.
        style={{
          position: "fixed", inset: 0, zIndex: 100, background: "var(--bg)",
          display: "flex", flexDirection: "column",
        }}
      >
        <div
          // The surround closes it; the content must not, or a drag across the
          // chart that ends outside would dismiss what you were reading.
          onClick={(e) => e.stopPropagation()}
          style={{
            flex: 1, minHeight: 0, overflowY: "auto",
            padding: "18px clamp(16px, 4vw, 48px) 28px",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 6 }}>
            <span style={{ fontSize: 19, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--tx)" }}>{pair}</span>
            <span style={{ fontSize: 12, color: "var(--tx-4)" }}>press Esc to close</span>
            <button
              onClick={() => setExpanded(false)}
              aria-label="Close"
              style={{ marginLeft: "auto", border: "none", background: "transparent", color: "var(--tx-3)", cursor: "pointer", display: "inline-flex", padding: 6 }}
            >
              <Minimize2 style={{ width: 18, height: 18 }} />
            </button>
          </div>
          {node}
        </div>
      </div>,
      host,
    );
  };

  if (state === "loading") {
    return wrap(
      <div style={{ height: expanded ? 420 : 250, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "var(--tx-4)" }}>
        Reading history…
      </div>,
    );
  }
  if (state === "empty" || !data || !geom) {
    return wrap(
      <div style={{ padding: "20px 0", fontSize: 12.5, color: "var(--tx-4)" }}>
        No price history for {pair} over this period.
      </div>,
    );
  }

  // The drawn series, not the raw closes: the endpoint dot, the date labels
  // and the crosshair must all land on the line that is actually painted.
  const pts = series;
  // `last` is where the LINE ends, which must stay a close, or the final point
  // would be plotted against an axis built from closes. `headline` is what the
  // reader sees, and that is the live spot so this agrees with the rates list.
  const last = pts[pts.length - 1].close;
  const headline = data.live ?? data.latest ?? last;
  const active = hover !== null ? pts[hover] : null;
  const shownVal = active ? active.close : headline;

  const chg = data.change?.percent ?? 0;
  const flat = Math.abs(chg) < 0.05;
  const up = chg > 0;
  /**
   * Up is green, down is red, the ordinary market convention.
   *
   * This was inverted at first, on the reasoning that a rise in USD/GHS means
   * more cedis per dollar and therefore dearer imports, so a rise is bad news
   * for a Ghanaian importer. That reasoning is sound and the colour was still
   * wrong, for two reasons.
   *
   * It contradicted the rates list on the very same screen, which colours a
   * rise green. One number, two colours, is a bug however each was argued.
   *
   * And it only holds for one reader. A rise is adverse for an importer and
   * favourable for an exporter, and the underwriters on the other side of
   * these pools have the opposite exposure again. Colour cannot encode an
   * interpretation that depends on who is looking.
   *
   * The meaning is not lost: the line directly beneath spells it out in words,
   * "GHS weaker by 0.6%, so imports cost more", which is unambiguous for every
   * reader and needs no legend.
   */
  const chgColour = flat ? "var(--tx-3)" : up ? "var(--green)" : "var(--red)";

  // One band, two readings. For the hedger it is where cover pays; for the
  // underwriter it is where their capital goes.
  const forLp = perspective === "underwriter";
  const zoneColour = forLp ? "var(--red)" : "var(--green)";

  const strikeY = hasStrike ? geom.y(strike as number) : 0;
  const strikeVisible = hasStrike && strikeY >= PAD.t && strikeY <= VH - PAD.b;
  const everPast = hasStrike
    ? (strikeAbove
        ? Math.max(...pts.map((p) => p.close)) >= (strike as number)
        : Math.min(...pts.map((p) => p.close)) <= (strike as number))
    : false;

  const gradId = `rh-${pair.replace(/[^A-Za-z0-9]/g, "")}`;

  const body = (
    <div style={expanded ? { width: "100%" } : { marginTop: 12 }}>
      {/* Headline: the value under the cursor, or the latest close. */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 2 }}>
        <span className="tnum" style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--tx)" }}>
          {fmtRate(shownVal)}
        </span>
        <span className="tnum" style={{ fontSize: 13.5, fontWeight: 600, color: chgColour }}>
          {flat ? "0.0" : `${up ? "+" : ""}${chg.toFixed(1)}`}%
        </span>
        <span style={{ fontSize: 11.5, color: "var(--tx-4)", marginLeft: "auto" }}>
          {active
            ? fmtDay(active.date, !!data.intraday)
            : data.live
              ? "live rate"
              : `over ${range.label === "MAX" ? "all time" : range.label}`}
        </span>
      </div>

      {data.change && (
        <div style={{ fontSize: 11.5, color: "var(--tx-3)", marginBottom: 10 }}>{data.change.direction}</div>
      )}

      {/* Range picker */}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
        {RANGES.filter((r) => hourly || !r.hours).map((r) => {
          const on = r.key === rangeKey;
          return (
            <button
              key={r.key}
              onClick={() => setRangeKey(r.key)}
              aria-pressed={on}
              style={{
                border: "none",
                borderRadius: 6,
                padding: "4px 9px",
                fontSize: 11.5,
                fontWeight: on ? 600 : 500,
                fontFamily: "var(--mono)",
                cursor: "pointer",
                background: on ? "color-mix(in oklab, var(--blue) 16%, transparent)" : "transparent",
                color: on ? "var(--blue)" : "var(--tx-3)",
              }}
            >
              {r.label}
            </button>
          );
        })}

        {!expanded && (
        <button
          onClick={() => setExpanded(true)}
          aria-label="Enlarge the chart"
          title="Enlarge"
          style={{
            marginLeft: "auto",
            border: "none",
            background: "transparent",
            color: "var(--tx-3)",
            cursor: "pointer",
            padding: "4px 6px",
            display: "inline-flex",
            alignItems: "center",
          }}
        >
          <Maximize2 style={{ width: 14, height: 14 }} />
        </button>
        )}
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${VW} ${VH}`}
        width="100%"
        style={
          expanded
            ? { display: "block", width: "100%", height: "min(62vh, 620px)", touchAction: "pan-y" }
            : { display: "block", touchAction: "pan-y" }
        }
        role="img"
        aria-label={
          hasStrike
            ? `${pair} closing rate over ${range.label}, with the strike at ${strike} marked`
            : `${pair} closing rate over ${range.label}`
        }
        onMouseMove={(e) => onMove(e.clientX)}
        onMouseLeave={() => setHover(null)}
        onTouchStart={(e) => e.touches[0] && onMove(e.touches[0].clientX)}
        onTouchMove={(e) => e.touches[0] && onMove(e.touches[0].clientX)}
        onTouchEnd={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--blue)" stopOpacity="0.20" />
            <stop offset="100%" stopColor="var(--blue)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/*
          Watermark. Screenshots of this chart travel further than the app
          does, so the brand and the subject travel with them.

          Drawn first, so every gridline and the data itself sit on top of it.
          Painted in var(--tx) at a few percent rather than a fixed grey, so it
          stays legible-but-quiet in both themes without a second rule. Vector
          text rather than the PNG logo: crisp at any size, nothing to load,
          and no CSP question.

          pointer-events are off, or it would swallow the crosshair.
        */}
        <g pointerEvents="none" aria-hidden="true">
          <text
            x={PAD.l + geom.iw / 2}
            y={PAD.t + geom.ih / 2}
            textAnchor="middle"
            fontSize={MARK}
            fontWeight="700"
            fontFamily="var(--sans)"
            letterSpacing="-0.02em"
            fill="var(--tx)"
            opacity="0.055"
          >
            BlockFinaX
          </text>
          <text
            x={PAD.l + geom.iw / 2}
            y={PAD.t + geom.ih / 2 + MARK * 0.62}
            textAnchor="middle"
            fontSize={SUB}
            fontFamily="var(--mono)"
            letterSpacing="0.08em"
            fill="var(--tx)"
            opacity="0.05"
          >
            {pair} · {range.label} · blockfinax.com
          </text>
        </g>

        {/* Gridlines, with the price axis on the right the way a quote screen puts it. */}
        {geom.ticks.map((v, i) => (
          <g key={i}>
            <line x1={PAD.l} y1={geom.y(v)} x2={VW - PAD.r} y2={geom.y(v)}
                  stroke="var(--border)" strokeWidth="1" opacity="0.5" vectorEffect="non-scaling-stroke" />
            <text x={VW - PAD.r + 6} y={geom.y(v) + 3.5} fontSize="10" fill="var(--tx-4)" fontFamily="var(--mono)">
              {fmtRate(v)}
            </text>
          </g>
        ))}

        <path d={geom.area} fill={`url(#${gradId})`} />
        <path d={geom.line} fill="none" stroke="var(--blue)" strokeWidth="1.8"
              strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />

        {/*
          The payout zones, drawn straight onto the price history.

          This is the change that makes the cover legible. A payoff diagram
          answers "what do I get if the rate lands here", which is the easy
          half. Laying the same strike and cap over a year of real closes
          answers the half that actually decides a purchase: how often has the
          rate been there.

          Under the price line and over the gridlines, so the price reads first.
        */}
        {/*
          The excess: entry to strike.

          This is the stretch of the move the holder absorbs before cover
          starts, and it is the part people misjudge. Red rather than amber
          because it is genuinely unprotected exposure, not a warning, and
          faint because it is a fact about the position rather than an alarm.

          Only drawn when the strike sits the adverse side of entry, which is
          the normal shape. A pool struck the other side of spot has no excess
          to show, and inventing a band there would be a lie about the terms.
        */}
        {hasStrike && typeof entryRate === "number" && Number.isFinite(entryRate) && entryRate > 0
          && (strikeAbove ? (strike as number) > entryRate : (strike as number) < entryRate)
          && (() => {
          const yEntry = geom.y(entryRate);
          const yStrike = geom.y(strike as number);
          const top = Math.min(yEntry, yStrike);
          const bot = Math.max(yEntry, yStrike);
          return (
            <g pointerEvents="none">
              <rect x={PAD.l} y={top} width={geom.iw} height={Math.max(0, bot - top)}
                    fill="var(--red)" opacity="0.09" />
              <line x1={PAD.l} y1={yEntry} x2={VW - PAD.r} y2={yEntry} stroke="var(--red)"
                    strokeWidth="1.1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" opacity="0.7" />
              <text x={PAD.l + 4} y={yEntry + (strikeAbove ? 12 : -6)}
                    fontSize={expanded ? 11 : 9.5} fontFamily="var(--mono)" fill="var(--red)" opacity="0.9">
                bought at {fmtRate(entryRate)}
              </text>
            </g>
          );
        })()}

        {hasZones && (() => {
          const yStrike = geom.y(strike as number);
          const yCap = geom.y(cap as number);
          const top = Math.min(yStrike, yCap);
          const bot = Math.max(yStrike, yCap);
          return (
            <g pointerEvents="none">
              {/*
                Strike to cap only.

                The region past the cap used to be shaded too, and more
                strongly. That was wrong twice over. Visually it is unbounded,
                so it filled most of the frame and buried the band that
                matters. And semantically it says the wrong thing: past the cap
                the payout stops growing, so a rate that keeps climbing costs
                the importer more while returning nothing further. That is
                where the cover stops helping, and painting it the strongest
                green on the chart read as "better still up here".

                The cap line and its label stay, so the ceiling is legible
                without claiming the space above it is good news.
              */}
              <rect x={PAD.l} y={top} width={geom.iw} height={Math.max(0, bot - top)}
                    fill={zoneColour} opacity="0.13" />
              <line x1={PAD.l} y1={yCap} x2={VW - PAD.r} y2={yCap} stroke={zoneColour}
                    strokeWidth="1.1" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" opacity="0.8" />
              <text x={PAD.l + 4} y={yCap + (strikeAbove ? -6 : 12)}
                    fontSize={expanded ? 11 : 9.5} fontFamily="var(--mono)" fill={zoneColour} opacity="0.9">
                {maxPayoutLabel ? `${forLp ? "PAYS UP TO" : "MAX"} ${maxPayoutLabel}` : forLp ? "MAX EXPOSURE" : "MAX PAYOUT"}
              </text>
            </g>
          );
        })()}

        {/* The strike. Everything the cover is about sits on this line. */}
        {strikeVisible && (
          <>
            <line x1={PAD.l} y1={strikeY} x2={VW - PAD.r} y2={strikeY} stroke={zoneColour} strokeWidth="1.3"
                  strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
            <text x={PAD.l + 4} y={strikeY - 5} fontSize="10" fill={zoneColour} fontFamily="var(--mono)">
              strike {fmtRate(strike as number)}
            </text>
          </>
        )}

        {/*
          Where the rate actually is.

          Over everything else on purpose: this is the line the reader
          measures the others against. Solid rather than dashed so it is not
          mistaken for the strike or the cap, both of which are contract terms
          rather than facts about the market.
        */}
        {typeof markRate === "number" && Number.isFinite(markRate) && markRate > 0 && (() => {
          const y = geom.y(markRate);
          if (y < PAD.t || y > VH - PAD.b) return null;
          return (
            <g pointerEvents="none">
              <line x1={PAD.l} y1={y} x2={VW - PAD.r} y2={y} stroke="var(--tx-2)"
                    strokeWidth="1" vectorEffect="non-scaling-stroke" opacity="0.55" />
              <text x={VW - PAD.r - 4} y={y - 5} textAnchor="end"
                    fontSize={expanded ? 11 : 9.5} fontFamily="var(--mono)" fill="var(--tx-2)" opacity="0.95">
                {markLabel || "now"} {fmtRate(markRate)}
              </text>
            </g>
          );
        })()}

        {/* Crosshair under the pointer. */}
        {active && hover !== null && (
          <>
            <line x1={geom.x(hover)} y1={PAD.t} x2={geom.x(hover)} y2={VH - PAD.b}
                  stroke="var(--tx-4)" strokeWidth="1" opacity="0.55" vectorEffect="non-scaling-stroke" />
            <circle cx={geom.x(hover)} cy={geom.y(active.close)} r="3.5" fill="var(--blue)" stroke="var(--bg-2)" strokeWidth="1.5" />
          </>
        )}

        {/* Where the series stands right now. */}
        <circle cx={geom.x(pts.length - 1)} cy={geom.y(last)} r="3" fill="var(--blue)" />

        {/* Date axis: first, middle, last. Three fit at this width without
            colliding, and more of them read as clutter. */}
        {Array.from({ length: DATES }, (_, n) => Math.round((n / (DATES - 1)) * (pts.length - 1))).map((i, n) => (
          <text
            key={n}
            x={geom.x(i)}
            y={VH - 8}
            fontSize={expanded ? 11 : 10}
            fill="var(--tx-4)"
            fontFamily="var(--mono)"
            textAnchor={n === 0 ? "start" : n === DATES - 1 ? "end" : "middle"}
          >
            {fmtAxis(pts[i].date, rangeDays, !!data.intraday)}
          </text>
        ))}
      </svg>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginTop: 8, fontSize: 11.5, color: "var(--tx-3)" }}>
        {strikeVisible && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 12, height: 0, borderTop: `1.5px dashed ${zoneColour}`, display: "inline-block" }} />
            {forLp ? "You pay" : "Pays"} {strikeAbove ? "above" : "below"} {fmtRate(strike as number)}
          </span>
        )}
        {hasZones && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 10, height: 10, background: zoneColour, opacity: 0.3, borderRadius: 2, display: "inline-block" }} />
            {forLp ? "Your exposure grows to" : "Payout grows to"} {fmtRate(cap as number)}, then holds
          </span>
        )}
        {hasStrike && typeof entryRate === "number" && Number.isFinite(entryRate) && entryRate > 0
          && (strikeAbove ? (strike as number) > entryRate : (strike as number) < entryRate) && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 10, height: 10, background: "var(--red)", opacity: 0.26, borderRadius: 2, display: "inline-block" }} />
            You carry {fmtRate(entryRate)} to {fmtRate(strike as number)}
          </span>
        )}
        {!!data.observations && (
          <span style={{ marginLeft: "auto", color: "var(--tx-4)" }}>
            {data.observations.toLocaleString()} closes
            {data.ticksDropped ? `, ${data.ticksDropped} bad tick${data.ticksDropped === 1 ? "" : "s"} removed` : ""}
          </span>
        )}
      </div>

      {data.intraday && (data.distinctRates ?? 0) <= 5 && (
        <p style={{ fontSize: 11.5, color: "var(--tx-4)", margin: "8px 0 0", lineHeight: 1.5 }}>
          The rate for this pair was revalued {data.distinctRates} time
          {data.distinctRates === 1 ? "" : "s"} over this window. Frontier currencies are
          repriced once or twice a day rather than continuously, so an hourly view steps
          rather than flows.
        </p>
      )}

      {hasStrike && !forLp && (
        <p style={{ fontSize: 11.5, color: "var(--tx-3)", margin: "8px 0 0", lineHeight: 1.5 }}>
          {everPast
            ? `Over this period the rate has been ${strikeAbove ? "above" : "below"} ${fmtRate(strike as number)}, which is where this cover starts paying.`
            : `Over this period the rate has not reached ${fmtRate(strike as number)}. Past movement is not a forecast.`}
        </p>
      )}
    </div>
  );

  return wrap(body);
}
