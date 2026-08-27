/**
 * The same pool, read from the underwriter's side.
 *
 * A hedger and an underwriter hold opposite ends of one contract, so the same
 * picture cannot carry the same colours for both. The band between strike and
 * cap is where a hedger gets paid and where an underwriter's capital goes.
 * Showing it green to the person funding it would say the zone that consumes
 * their deposit is good news.
 *
 * Everything here is scaled by the share of the pool this deposit represents.
 * An LP's exposure is not the pool's maximum payout, it is their slice of it,
 * and quoting the pool figure to someone holding a tenth of it would overstate
 * their risk by ten times.
 */

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { RateHistory } from "./rate-history";
import { buildPayoutModel } from "@/lib/payout-model";

const usd = (v: number) =>
  `$${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const rate = (v: number) =>
  v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface UnderwriterDetailProps {
  /** This LP's deposit. */
  amount: number;
  premiumsEarned: number;
  /** Pool totals, which the share is taken against. */
  totalLiquidity: number;
  totalMaxPayout: number;
  underlying: string;
  strike: number;
  strikeAbove: boolean;
  initialRate: number;
  /** From the contract when available; derived from the pool otherwise. */
  payoutCap?: number;
  currentRate?: number;
  settlementPrice?: number;
  settled?: boolean;
}

export function UnderwriterDetail(p: UnderwriterDetailProps) {
  const [open, setOpen] = useState(false);

  const {
    amount, premiumsEarned, totalLiquidity, totalMaxPayout,
    underlying, strike, strikeAbove, initialRate, currentRate, settlementPrice, settled,
  } = p;

  // This deposit's slice of the pool. Guarded because a pool that reads back
  // zero liquidity would otherwise divide into infinity and print it.
  const share = totalLiquidity > 0 ? Math.min(1, amount / totalLiquidity) : 0;
  const myMaxExposure = totalMaxPayout * share;

  // The pool's payout curve, scaled to this deposit. Reuses the hedger model
  // rather than restating the arithmetic, so the two sides of the contract can
  // never disagree about where the cap sits.
  const model = buildPayoutModel({
    notional: totalLiquidity,
    initialRate,
    maxPayout: totalMaxPayout,
    strike,
    strikeAbove,
    totalCost: 0,
  });
  const cap = p.payoutCap && p.payoutCap > 0 ? p.payoutCap : model.cap;
  const myPayoutAt = (r: number) => model.payoutAt(r) * share;

  const valid = totalLiquidity > 0 && totalMaxPayout > 0 && strike > 0;
  if (!valid) return null;

  const mid = strikeAbove ? strike + Math.abs(cap - strike) / 2 : strike - Math.abs(cap - strike) / 2;
  const stays = strikeAbove ? "stays under" : "stays over";

  const cards = [
    {
      key: "safe",
      when: `${underlying} ${stays} ${rate(strike)}`,
      body: `Keep ${usd(premiumsEarned)}`,
      note: "Your deposit is untouched",
      good: true,
    },
    {
      key: "mid",
      when: `Reaches ${rate(mid)}`,
      body: `${usd(myPayoutAt(mid))} paid out`,
      note: `From your deposit, ${usd(premiumsEarned)} premium kept`,
      good: false,
    },
    {
      key: "max",
      when: `${rate(cap)} or ${strikeAbove ? "higher" : "lower"}`,
      body: `${usd(myMaxExposure)} paid out`,
      note: "The most this pool can ask of you",
      good: false,
    },
  ];

  return (
    <div style={{ marginTop: 10 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          display: "flex", alignItems: "center", gap: 7, width: "100%",
          padding: "8px 10px", borderRadius: 9, border: "1px solid var(--border)",
          background: "transparent", color: "var(--tx-3)", fontSize: 12,
          cursor: "pointer", textAlign: "left",
        }}
      >
        <ChevronDown
          style={{
            width: 14, height: 14, flex: "0 0 auto",
            transform: open ? "rotate(180deg)" : undefined,
            transition: "transform .2s var(--ease)",
          }}
        />
        {open ? "Hide the detail" : `${underlying} history and what you are underwriting`}
      </button>

      {open && (
        <div style={{ marginTop: 4 }}>
          <RateHistory
            pair={underlying}
            strike={strike}
            strikeAbove={strikeAbove}
            cap={cap}
            maxPayoutLabel={usd(myMaxExposure)}
            markRate={settled ? settlementPrice : currentRate}
            markLabel={settled ? "settled" : "now"}
            perspective="underwriter"
          />

          <div style={{ fontSize: 11, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--tx-3)", margin: "14px 0 8px" }}>
            What you are underwriting
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
            {cards.map((c) => (
              <div
                key={c.key}
                style={{
                  border: `1px solid ${c.good ? "color-mix(in oklab, var(--green) 34%, var(--border))" : "var(--border)"}`,
                  borderRadius: 10,
                  padding: "11px 12px 12px",
                  background: "var(--card)",
                }}
              >
                <div style={{ fontSize: 11.5, color: "var(--tx-3)", marginBottom: 5 }}>{c.when}</div>
                <div className="tnum" style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em", color: c.good ? "var(--green)" : "var(--tx-2)" }}>
                  {c.body}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--tx-4)", marginTop: 3 }}>{c.note}</div>
              </div>
            ))}
          </div>

          <p style={{ fontSize: 11.5, color: "var(--tx-3)", margin: "10px 0 0", lineHeight: 1.55 }}>
            You hold {(share * 100).toFixed(share < 0.1 ? 1 : 0)}% of this pool, so at most{" "}
            <strong style={{ color: "var(--tx-2)" }}>{usd(myMaxExposure)}</strong> of your{" "}
            {usd(amount)} can be called on, however far the rate moves past {rate(cap)}. The
            premium you have earned is yours either way.
            {currentRate && Number.isFinite(currentRate) ? (
              <>
                {" "}It is {rate(currentRate)} today,{" "}
                {(strikeAbove ? currentRate > strike : currentRate < strike)
                  ? `already past ${rate(strike)}, so a settlement now would call on ${usd(myPayoutAt(currentRate))}.`
                  : `short of the ${rate(strike)} where any of it is called on.`}
              </>
            ) : null}
          </p>
        </div>
      )}
    </div>
  );
}
