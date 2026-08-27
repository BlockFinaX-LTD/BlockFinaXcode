/**
 * The price history and the outcome cards, behind one disclosure.
 *
 * Closed by default and per position. A position card is a summary, and a
 * chart plus three cards opened on every one of them turns a list into a
 * wall: the reader has to scroll past detail for positions they were not
 * asking about to reach the one they were.
 *
 * The two are grouped rather than collapsed separately because they answer one
 * question between them. The chart shows how often the rate has been in the
 * paying zone; the cards show what it is worth when it is there. Opening one
 * without the other leaves half an answer.
 */

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { RateHistory } from "./rate-history";
import { PayoutOutcomes, type OutcomeProps } from "./payout-outcomes";
import { buildPayoutModel } from "@/lib/payout-model";


/**
 * Where the position stands today, in one line.
 *
 * Deliberately not "you are down $261". Nothing has settled, so there is no
 * outcome to be down on, and a premium is a cost rather than a loss in the
 * same way that car insurance is not a loss in a year you do not crash. What
 * IS true is stated instead: what has been paid, and what the cover would pay
 * at today's rate. Both numbers, no verdict.
 */
function WhereItStands(props: OutcomeProps) {
  const m = buildPayoutModel(props);
  const { currentRate, strike, strikeAbove, totalCost, underlying, settled } = props;
  if (settled || !m.valid || !currentRate || !Number.isFinite(currentRate)) return null;

  const would = m.payoutAt(currentRate);
  const inZone = strikeAbove ? currentRate > strike : currentRate < strike;
  const money = (v: number) =>
    `$${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

  return (
    <div
      style={{
        marginTop: 12,
        padding: "10px 12px",
        borderRadius: 9,
        border: "1px solid var(--border)",
        background: "var(--card)",
        fontSize: 12.5,
        color: "var(--tx-2)",
        lineHeight: 1.55,
      }}
    >
      {inZone ? (
        <>
          {underlying} is past your strike today, so if it settled now this cover would pay{" "}
          <strong style={{ color: "var(--green)" }}>{money(would)}</strong> against the{" "}
          {money(totalCost)} it cost.
        </>
      ) : (
        <>
          {underlying} has not reached your strike, so a settlement today would pay nothing. The{" "}
          {money(totalCost)} is what the protection costs for the period, not a position that is
          down.
        </>
      )}
    </div>
  );
}

export function CoverDetail(props: OutcomeProps & { cap: number; maxPayoutLabel: string }) {
  const [open, setOpen] = useState(false);
  const { cap, maxPayoutLabel, underlying, strike, strikeAbove, settled } = props;

  return (
    <div style={{ marginTop: 10 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          width: "100%",
          padding: "8px 10px",
          borderRadius: 9,
          border: "1px solid var(--border)",
          background: "transparent",
          color: "var(--tx-3)",
          fontSize: 12,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <ChevronDown
          style={{
            width: 14,
            height: 14,
            flex: "0 0 auto",
            transform: open ? "rotate(180deg)" : undefined,
            transition: "transform .2s var(--ease)",
          }}
        />
        {/* The label says what is inside, so it is worth opening or skipping
            without having to open it first. */}
        {open
          ? "Hide the detail"
          : settled
            ? `How this ${underlying} cover finished`
            : `${underlying} history and what this cover pays`}
      </button>

      {open && (
        <div style={{ marginTop: 4 }}>
          {/* The marked line is the settled rate once it is over, and today's
              rate while it runs. Either way it is the fact the strike and cap
              are read against. */}
          <RateHistory
            pair={underlying}
            strike={strike}
            strikeAbove={strikeAbove}
            cap={cap}
            maxPayoutLabel={maxPayoutLabel}
            markRate={settled ? props.settlementPrice : props.currentRate}
            markLabel={settled ? "settled" : "now"}
            entryRate={props.initialRate}
          />

          <WhereItStands {...props} />
          <PayoutOutcomes {...props} />
        </div>
      )}
    </div>
  );
}
