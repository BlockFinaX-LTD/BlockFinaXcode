/**
 * PayoutScenarios — visualizes what a hedge position pays across the full range
 * of settlement rates the underlying could land on.
 *
 * The on-chain product is a capped range (call/put spread):
 *   upward (strikeAbove):   payout = notional * (min(S, cap) - strike) / initialRate,  0 below strike
 *   downward:               payout = notional * (strike - max(S, cap)) / initialRate,  0 above strike
 *
 * The position stores the MAX payout (payoutAmount), reached when settlement hits
 * the cap. We invert that to recover the implied cap, then plot payout + net P&L
 * across rates and tabulate representative scenarios.
 */
import { useMemo, useState } from "react";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  ReferenceLine,
  ReferenceDot,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { ChevronDown, TrendingUp, TrendingDown } from "lucide-react";

export interface PayoutScenariosProps {
  notional: number;
  /** Total upfront cost to the hedger (premium + platform fee). */
  totalCost: number;
  /** Max payout reserved for this position (reached at the cap). */
  maxPayout: number;
  strike: number;
  initialRate: number;
  strikeAbove: boolean;
  underlying: string;
  /** Live rate, if known — drawn as a "you are here" marker. */
  currentRate?: number;
  /** Final rate, if the event has settled. */
  settlementPrice?: number;
  /** Claim-time fee on payout (default 1%). */
  payoutFeeRate?: number;
  /** Start expanded. Defaults to false (toggle). */
  defaultOpen?: boolean;
}

function decimalsFor(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 2;
  if (rate < 10) return 4;
  if (rate < 1000) return 2;
  return 0;
}

function fmtRate(rate: number, d: number): string {
  return rate.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function PayoutScenarios(props: PayoutScenariosProps) {
  const {
    notional, totalCost, maxPayout, strike, initialRate, strikeAbove,
    underlying, currentRate, settlementPrice, payoutFeeRate = 0.01, defaultOpen = false,
  } = props;

  const [open, setOpen] = useState(defaultOpen);

  const model = useMemo(() => {
    const valid = notional > 0 && initialRate > 0 && maxPayout > 0;
    // Recover the implied cap from the reserved max payout.
    const maxPriceMove = valid ? (maxPayout * initialRate) / notional : 0;
    const payoutCap = strikeAbove ? strike + maxPriceMove : strike - maxPriceMove;
    const width = Math.abs(payoutCap - strike) || strike * 0.05 || 1;

    const payoutAt = (S: number): number => {
      if (!valid) return 0;
      if (strikeAbove) {
        if (S <= strike) return 0;
        return (notional * (Math.min(S, payoutCap) - strike)) / initialRate;
      }
      if (S >= strike) return 0;
      return (notional * (strike - Math.max(S, payoutCap))) / initialRate;
    };

    // Plot range: half a zone-width of padding on each side of [strike, cap].
    const lo = strikeAbove ? strike - width * 0.5 : payoutCap - width * 0.5;
    const hi = strikeAbove ? payoutCap + width * 0.5 : strike + width * 0.5;
    let xMin = Math.min(lo, hi);
    let xMax = Math.max(lo, hi);
    // Make sure live + initial rates are visible.
    for (const r of [currentRate, initialRate, settlementPrice]) {
      if (r && Number.isFinite(r)) {
        xMin = Math.min(xMin, r);
        xMax = Math.max(xMax, r);
      }
    }

    const N = 56;
    const curve = Array.from({ length: N }, (_, i) => {
      const rate = xMin + ((xMax - xMin) * i) / (N - 1);
      const gross = payoutAt(rate);
      const netPnl = gross * (1 - payoutFeeRate) - totalCost;
      return { rate, payout: gross, netPnl };
    });

    // Representative table rows: strike, quarters of the zone, cap, plus padded ends.
    const fracs = strikeAbove
      ? [-0.5, 0, 0.25, 0.5, 0.75, 1, 1.5]
      : [1.5, 1, 0.75, 0.5, 0.25, 0, -0.5];
    const rowRates = fracs.map(f => (strikeAbove ? strike + width * f : strike - width * f));
    const rows = rowRates.map(rate => {
      const gross = payoutAt(rate);
      const netPnl = gross * (1 - payoutFeeRate) - totalCost;
      return { rate, payout: gross, netPnl };
    });

    return { valid, payoutCap, width, xMin, xMax, curve, rows, payoutAt };
  }, [notional, totalCost, maxPayout, strike, initialRate, strikeAbove, currentRate, settlementPrice, payoutFeeRate]);

  if (!model.valid) return null;

  const d = decimalsFor(strike);
  // Which table row is closest to the live rate — highlight it.
  let nearestIdx = -1;
  if (currentRate && Number.isFinite(currentRate)) {
    let best = Infinity;
    model.rows.forEach((r, i) => {
      const dist = Math.abs(r.rate - currentRate);
      if (dist < best) { best = dist; nearestIdx = i; }
    });
  }

  const liveGross = currentRate ? model.payoutAt(currentRate) : null;

  return (
    <div className="rounded-xl border border-gray-100 dark:border-border/40 bg-muted/20 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-muted/40 transition-colors"
      >
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
          {strikeAbove ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
          Payout scenarios
        </span>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3">
          {/* Chart */}
          <div className="h-44 -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={model.curve} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
                <defs>
                  <linearGradient id="payoutFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="rate"
                  type="number"
                  domain={[model.xMin, model.xMax]}
                  tickFormatter={(v) => fmtRate(v, d)}
                  tick={{ fontSize: 9, fill: "currentColor" }}
                  className="text-muted-foreground"
                  tickLine={false}
                  axisLine={false}
                  minTickGap={28}
                />
                <YAxis
                  tickFormatter={(v) => `$${v >= 1000 ? (v / 1000).toFixed(1) + "k" : v.toFixed(0)}`}
                  tick={{ fontSize: 9, fill: "currentColor" }}
                  className="text-muted-foreground"
                  tickLine={false}
                  axisLine={false}
                  width={38}
                />
                <Tooltip
                  cursor={{ stroke: "#94a3b8", strokeDasharray: "3 3" }}
                  contentStyle={{
                    fontSize: 11,
                    borderRadius: 10,
                    border: "1px solid rgba(0,0,0,0.08)",
                    padding: "6px 10px",
                  }}
                  labelFormatter={(v) => `Rate ${fmtRate(Number(v), d)}`}
                  formatter={(value: any, name: any) => [
                    `$${fmtUsd(Number(value))}`,
                    name === "payout" ? "Payout" : "Net P&L",
                  ]}
                />
                <ReferenceLine y={0} stroke="#cbd5e1" strokeWidth={1} />
                {/* Strike = where protection starts paying */}
                <ReferenceLine
                  x={strike}
                  stroke="#1a4480"
                  strokeDasharray="4 3"
                  strokeWidth={1.2}
                  label={{ value: "strike", position: "insideTopLeft", fontSize: 8, fill: "#1a4480" }}
                />
                {/* Cap = max payout */}
                <ReferenceLine
                  x={model.payoutCap}
                  stroke="#10b981"
                  strokeDasharray="4 3"
                  strokeWidth={1.2}
                  label={{ value: "cap", position: "insideTopRight", fontSize: 8, fill: "#059669" }}
                />
                <Area
                  type="monotone"
                  dataKey="payout"
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="url(#payoutFill)"
                  isAnimationActive={false}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="netPnl"
                  stroke="#f59e0b"
                  strokeWidth={1.5}
                  strokeDasharray="5 3"
                  isAnimationActive={false}
                  dot={false}
                />
                {/* Live rate marker */}
                {currentRate && liveGross !== null && (
                  <ReferenceDot
                    x={currentRate}
                    y={liveGross}
                    r={4}
                    fill="#1a4480"
                    stroke="#fff"
                    strokeWidth={1.5}
                  />
                )}
                {settlementPrice && (
                  <ReferenceLine
                    x={settlementPrice}
                    stroke="#dc2626"
                    strokeWidth={1.5}
                    label={{ value: "settled", position: "insideBottomRight", fontSize: 8, fill: "#dc2626" }}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 px-1 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-[3px] rounded-full bg-emerald-500" /> Payout
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-[3px] rounded-full bg-amber-500" /> Net P&amp;L (after premium)
            </span>
            {currentRate ? (
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full bg-[#1a4480]" /> Now {fmtRate(currentRate, d)}
              </span>
            ) : null}
          </div>

          {/* Scenario table */}
          <div className="rounded-lg border border-gray-100 dark:border-border/40 overflow-hidden">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="bg-muted/40 text-muted-foreground">
                  <th className="text-left font-semibold px-3 py-1.5 uppercase tracking-wider text-[9.5px]">
                    {underlying} settles at
                  </th>
                  <th className="text-right font-semibold px-3 py-1.5 uppercase tracking-wider text-[9.5px]">Payout</th>
                  <th className="text-right font-semibold px-3 py-1.5 uppercase tracking-wider text-[9.5px]">Net P&amp;L</th>
                </tr>
              </thead>
              <tbody className="font-mono-data tabular-nums">
                {model.rows.map((r, i) => {
                  const isNow = i === nearestIdx;
                  return (
                    <tr
                      key={i}
                      className={`border-t border-gray-100 dark:border-border/30 ${isNow ? "bg-[#1a4480]/5" : ""}`}
                    >
                      <td className="px-3 py-1.5 text-left">
                        {fmtRate(r.rate, d)}
                        {isNow && (
                          <span className="ml-1.5 text-[8.5px] uppercase tracking-wide text-[#1a4480] font-sans font-semibold">now</span>
                        )}
                      </td>
                      <td className={`px-3 py-1.5 text-right font-semibold ${r.payout > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
                        ${fmtUsd(r.payout)}
                      </td>
                      <td className={`px-3 py-1.5 text-right font-semibold ${r.netPnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
                        {r.netPnl >= 0 ? "+" : "−"}${fmtUsd(Math.abs(r.netPnl))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-[9.5px] text-muted-foreground leading-relaxed px-1">
            Payout ramps from $0 at the strike to ${fmtUsd(maxPayout)} max at the cap ({fmtRate(model.payoutCap, d)}),
            then stays flat. Net P&amp;L is payout minus your ${fmtUsd(totalCost)} premium (and a {(payoutFeeRate * 100).toFixed(0)}% claim fee).
          </p>
        </div>
      )}
    </div>
  );
}
