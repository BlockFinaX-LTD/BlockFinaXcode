/**
 * What this cover is worth, in three cases, or what it actually did.
 *
 * Replaces a payoff diagram and a seven row table. Both were correct and
 * neither was readable: a payoff diagram is an options desk artifact shown to
 * people who run import businesses, and seven rows of near identical numbers
 * is a spreadsheet, not an answer.
 *
 * On the language. The first version said "you get nothing back", "you spent",
 * "the most you can lose". Every one of those is arithmetically true and all
 * of them misdescribe the product. This is insurance. A policy that does not
 * pay out is not a loss, it means the thing you were afraid of did not happen,
 * and for an importer a rate that stays put is a good week for the business.
 * The wording below says what occurred without inviting the reader to feel
 * they were beaten. It does not hide the cost: the premium is stated plainly
 * in every case.
 */

import { buildPayoutModel, type PayoutInputs } from "@/lib/payout-model";

const usd = (v: number) =>
  `$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const rate = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface OutcomeProps extends PayoutInputs {
  underlying: string;
  currentRate?: number;
  /** Set once the event has settled, which switches this to a result view. */
  settlementPrice?: number;
  settled?: boolean;
  /** What this position actually received, when settled. */
  actualPayout?: number;
}

export function PayoutOutcomes(props: OutcomeProps) {
  const m = buildPayoutModel(props);
  if (!m.valid) return null;

  const {
    strike, strikeAbove, totalCost, underlying, currentRate,
    settlementPrice, settled, actualPayout,
  } = props;

  const dir = strikeAbove ? "above" : "below";
  const stays = strikeAbove ? "stays under" : "stays over";

  /* ── Settled: say what happened, not what might have ──────────────────── */
  if (settled && settlementPrice && Number.isFinite(settlementPrice) && settlementPrice > 0) {
    const paid = actualPayout ?? m.payoutAt(settlementPrice);
    const reached = strikeAbove ? settlementPrice > strike : settlementPrice < strike;
    return (
      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 11, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--tx-3)", marginBottom: 8 }}>
          How it finished
        </div>
        <div
          style={{
            border: `1px solid ${reached ? "color-mix(in oklab, var(--green) 34%, var(--border))" : "var(--border)"}`,
            borderRadius: 10,
            padding: "13px 14px 14px",
            background: "var(--card)",
          }}
        >
          <div style={{ fontSize: 12, color: "var(--tx-3)", marginBottom: 5 }}>
            {underlying} settled at {rate(settlementPrice)}
          </div>
          <div className="tnum" style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em", color: reached ? "var(--green)" : "var(--tx-2)" }}>
            {reached ? `${usd(paid)} paid out` : "No payout was needed"}
          </div>
          <p style={{ fontSize: 12, color: "var(--tx-3)", margin: "7px 0 0", lineHeight: 1.55 }}>
            {reached ? (
              <>
                The rate moved {dir} {rate(strike)} where your cover starts paying, so it did its
                job. Your cover cost {usd(totalCost)}.
              </>
            ) : (
              <>
                The rate finished {strikeAbove ? "under" : "over"} {rate(strike)}, so the move you
                protected against never came. Your costs held steady and the cover cost{" "}
                {usd(totalCost)}, which was the whole of your exposure.
              </>
            )}
          </p>
        </div>
      </div>
    );
  }

  /* ── Live: the three cases ────────────────────────────────────────────── */
  const mid = strikeAbove ? strike + m.width / 2 : strike - m.width / 2;

  const cards = [
    {
      key: "none",
      when: `${underlying} ${stays} ${rate(strike)}`,
      body: "No payout needed",
      note: `Your costs hold steady. Cover costs ${usd(totalCost)}`,
      tone: "flat" as const,
    },
    {
      key: "mid",
      when: `Reaches ${rate(mid)}`,
      body: `${usd(m.payoutAt(mid))} back`,
      note: `${usd(m.netAt(mid))} ahead of what the cover cost`,
      tone: "good" as const,
    },
    {
      key: "max",
      when: `${rate(m.cap)} or ${strikeAbove ? "higher" : "lower"}`,
      body: `${usd(m.payoutAt(m.cap))} back`,
      note: `Full protection. ${usd(m.netAt(m.cap))} ahead`,
      tone: "good" as const,
    },
  ];

  const tint = (t: "good" | "flat") =>
    t === "good"
      ? { border: "color-mix(in oklab, var(--green) 34%, var(--border))", value: "var(--green)" }
      : { border: "var(--border)", value: "var(--tx-2)" };

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 11, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--tx-3)", marginBottom: 8 }}>
        What this cover does
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
        {cards.map((c) => {
          const t = tint(c.tone);
          return (
            <div key={c.key} style={{ border: `1px solid ${t.border}`, borderRadius: 10, padding: "11px 12px 12px", background: "var(--card)" }}>
              <div style={{ fontSize: 11.5, color: "var(--tx-3)", marginBottom: 5 }}>{c.when}</div>
              <div className="tnum" style={{ fontSize: 18, fontWeight: 700, color: t.value, letterSpacing: "-0.01em" }}>
                {c.body}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--tx-4)", marginTop: 3 }}>{c.note}</div>
            </div>
          );
        })}
      </div>

      <p style={{ fontSize: 11.5, color: "var(--tx-3)", margin: "10px 0 0", lineHeight: 1.55 }}>
        {m.breakEven !== null ? (
          <>
            The cover pays for itself once {underlying} passes{" "}
            <strong style={{ color: "var(--tx-2)" }}>{rate(m.breakEven)}</strong>.{" "}
          </>
        ) : (
          <>Even a full payout would not cover what this position cost. </>
        )}
        {/* The fixed cost is the reassuring half and it is easy to miss on a
            payoff diagram, where it is just a flat line on the left. */}
        Your cost is fixed at {usd(totalCost)} whatever the rate does, so you always know your
        worst case from the day you buy.
        {currentRate && Number.isFinite(currentRate) ? (
          <>
            {" "}It is {rate(currentRate)} today,{" "}
            {(strikeAbove ? currentRate > strike : currentRate < strike)
              ? "already past the point where cover pays."
              : `still short of the ${rate(strike)} where cover begins.`}
          </>
        ) : null}
      </p>
    </div>
  );
}
