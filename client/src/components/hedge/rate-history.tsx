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
 * Ghana sandbox. Everything here is history, and the buyer draws their own
 * conclusion.
 *
 * No candlesticks. The table stores closes and nothing else, so a candle is
 * not drawable, and the intraday high and low it would add are noise to
 * someone buying thirty day cover. They care where the rate settles.
 *
 * No charting library. Hand drawn SVG costs nothing in bundle size, and the
 * strict CSP on this site blocks external scripts anyway.
 */

import { useEffect, useState } from "react";

interface Point { date: string; close: number; }
interface Move { percent: number; from: string; to: string; direction: string; }
interface History {
  pair: string;
  points: Point[];
  latest?: number;
  change?: { percent: number; direction: string } | null;
  worstMove?: Move | null;
}

const W = 320;
const H = 96;
const PAD_T = 8;
const PAD_B = 16;

export function RateHistory({
  pair,
  strike,
  strikeAbove,
  days = 365,
}: {
  pair: string;
  /** Omitted when no particular cover is in view, as on the rates list. */
  strike?: number;
  strikeAbove?: boolean;
  days?: number;
}) {
  // Without a strike this is simply the pair's recent history. The strike line
  // and the sentence about where cover starts paying are the only parts that
  // need one, so both are skipped rather than the whole chart.
  const hasStrike = typeof strike === "number" && Number.isFinite(strike) && strike > 0;
  const [data, setData] = useState<History | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "empty">("loading");

  useEffect(() => {
    if (!pair) return;
    let live = true;
    setState("loading");
    fetch(`/api/fx/history/${encodeURIComponent(pair)}?days=${days}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: History | null) => {
        if (!live) return;
        // Two points cannot describe a market. Showing a chart drawn from one
        // or two closes would imply a shape that is not in the data.
        if (!d || !Array.isArray(d.points) || d.points.length < 10) {
          setState("empty");
          return;
        }
        setData(d);
        setState("ready");
      })
      .catch(() => live && setState("empty"));
    return () => { live = false; };
  }, [pair, days]);

  if (state === "loading") {
    return <div style={{ height: H + 46, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "var(--tx-4)" }}>Reading history…</div>;
  }
  // Silent when there is nothing to show. A chart is supporting evidence; its
  // absence must not block or clutter the purchase.
  if (state === "empty" || !data) return null;

  const closes = data.points.map((p) => p.close);
  // The strike is inside the scale on purpose. If it sits outside the range
  // the pair has traded, that fact is the most useful thing on the chart and
  // clipping it would hide exactly what the buyer needs to see.
  const lo = hasStrike ? Math.min(...closes, strike as number) : Math.min(...closes);
  const hi = hasStrike ? Math.max(...closes, strike as number) : Math.max(...closes);
  const span = hi - lo || hi || 1;

  const x = (i: number) => (i / (data.points.length - 1)) * W;
  const y = (v: number) => PAD_T + (1 - (v - lo) / span) * (H - PAD_T - PAD_B);

  const line = data.points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.close).toFixed(1)}`).join(" ");
  const area = `${line} L${W},${H - PAD_B} L0,${H - PAD_B} Z`;
  const strikeY = hasStrike ? y(strike as number) : 0;

  // Where the worst historical run sits on the axis, so it can be shaded.
  const idx = (d: string) => data.points.findIndex((p) => p.date === d);
  const wFrom = data.worstMove ? idx(data.worstMove.from) : -1;
  const wTo = data.worstMove ? idx(data.worstMove.to) : -1;
  const showBand = wFrom >= 0 && wTo > wFrom;

  const last = data.points[data.points.length - 1].close;
  const everPast = hasStrike ? (strikeAbove ? hi >= (strike as number) : lo <= (strike as number)) : false;
  const yearLabel = days >= 360 ? `${Math.round(days / 365)} year${days >= 700 ? "s" : ""}` : `${days} days`;

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6, gap: 8 }}>
        <span style={{ fontSize: 11, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--tx-3)" }}>
          Last {yearLabel}
        </span>
        {data.change && (
          <span style={{ fontSize: 11.5, color: "var(--tx-3)" }}>{data.change.direction}</span>
        )}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img"
           aria-label={
             hasStrike
               ? `${pair} closing rate over the last ${yearLabel}, with the strike at ${strike} marked`
               : `${pair} closing rate over the last ${yearLabel}`
           }>
        <defs>
          <linearGradient id="rh-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--blue)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--blue)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* The worst run in this window, shaded. Pure history, and the single
            strongest argument for holding cover on the whole page. */}
        {showBand && (
          <rect x={x(wFrom)} y={PAD_T} width={Math.max(1, x(wTo) - x(wFrom))} height={H - PAD_T - PAD_B}
                fill="var(--red)" opacity="0.09" />
        )}

        <path d={area} fill="url(#rh-fill)" />
        <path d={line} fill="none" stroke="var(--blue)" strokeWidth="1.6" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />

        {/* The strike. Everything the cover is about sits on this line. */}
        {hasStrike && (
          <line x1="0" y1={strikeY} x2={W} y2={strikeY} stroke="var(--green)" strokeWidth="1.2"
                strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
        )}
      </svg>

      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--tx-4)", marginTop: 2 }}>
        <span>{data.points[0].date}</span>
        <span>now {last.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginTop: 8, fontSize: 11.5, color: "var(--tx-3)" }}>
        {hasStrike && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 12, height: 0, borderTop: "1.5px dashed var(--green)", display: "inline-block" }} />
            Strike {(strike as number).toLocaleString()}
          </span>
        )}
        {showBand && data.worstMove && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 10, height: 10, background: "var(--red)", opacity: 0.22, borderRadius: 2, display: "inline-block" }} />
            Worst 60 day run, {data.worstMove.percent}%
          </span>
        )}
      </div>

      {/* The one sentence that turns the picture into an answer. Stated as a
          fact about the past, with no claim about what happens next. */}
      {hasStrike && (
        <p style={{ fontSize: 11.5, color: "var(--tx-3)", margin: "8px 0 0", lineHeight: 1.5 }}>
          {everPast
            ? `Over this period the rate has been ${strikeAbove ? "above" : "below"} ${(strike as number).toLocaleString()}, which is where this cover starts paying.`
            : `Over this period the rate has not reached ${(strike as number).toLocaleString()}. Past movement is not a forecast.`}
        </p>
      )}
    </div>
  );
}
