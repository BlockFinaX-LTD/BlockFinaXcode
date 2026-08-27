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
          <RateHistory
            pair={underlying}
            strike={strike}
            strikeAbove={strikeAbove}
            cap={cap}
            maxPayoutLabel={maxPayoutLabel}
          />
          <PayoutOutcomes {...props} />
        </div>
      )}
    </div>
  );
}
