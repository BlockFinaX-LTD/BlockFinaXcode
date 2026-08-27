/**
 * What this cover is worth, in three cases.
 *
 * Replaces a payoff diagram and a seven row table. Both were correct and
 * neither was readable: a payoff diagram is an options desk artifact shown to
 * people who run import businesses, and seven rows of near identical numbers
 * is a spreadsheet, not an answer.
 *
 * Three cases is what a person holds in their head. Nothing, something, and
 * the most it can pay. The price chart above carries the fourth thing a reader
 * needs, which is how often the rate has actually been in each of those zones,
 * and that is the question a payoff diagram cannot answer at all.
 */

import { buildPayoutModel, type PayoutInputs } from "@/lib/payout-model";

const usd = (v: number) =>
  `$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const rate = (v: number, dp: number) =>
  v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

export function PayoutOutcomes(props: PayoutInputs & { underlying: string; currentRate?: number }) {
  const m = buildPayoutModel(props);
  if (!m.valid) return null;

  const { strike, strikeAbove, totalCost, underlying, currentRate } = props;
  const dp = strike >= 100 ? 2 : 2;
  const dir = strikeAbove ? "above" : "below";
  const stays = strikeAbove ? "stays below" : "stays above";

  // The midpoint of the ramp, as the one representative "something happened"
  // case. Break-even is shown separately because it answers a different
  // question: not what you might get, but what has to happen to stop losing.
  const mid = strikeAbove ? strike + m.width / 2 : strike - m.width / 2;

  const cards = [
    {
      key: "none",
      when: `${stays} ${rate(strike, dp)}`,
      body: "You get nothing back",
      note: `You spent ${usd(totalCost)}`,
      tone: "flat" as const,
    },
    {
      key: "mid",
      when: `Reaches ${rate(mid, dp)}`,
      body: `${usd(m.payoutAt(mid))} back`,
      note: `${m.netAt(mid) >= 0 ? "Up" : "Down"} ${usd(m.netAt(mid))} after costs`,
      tone: m.netAt(mid) >= 0 ? ("good" as const) : ("flat" as const),
    },
    {
      key: "max",
      when: `${rate(m.cap, dp)} or ${strikeAbove ? "higher" : "lower"}`,
      body: `${usd(m.payoutAt(m.cap))} back`,
      note: `Up ${usd(m.netAt(m.cap))}. The most it pays`,
      tone: "good" as const,
    },
  ];

  const tint = (t: "good" | "flat") =>
    t === "good"
      ? { border: "color-mix(in oklab, var(--green) 34%, var(--border))", value: "var(--green)" }
      : { border: "var(--border)", value: "var(--tx-2)" };

  return (
    <div style={{ marginTop: 14 }}>
      <div
        style={{
          fontSize: 11,
          letterSpacing: ".05em",
          textTransform: "uppercase",
          color: "var(--tx-3)",
          marginBottom: 8,
        }}
      >
        If {underlying} settles
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
        {cards.map((c) => {
          const t = tint(c.tone);
          return (
            <div
              key={c.key}
              style={{
                border: `1px solid ${t.border}`,
                borderRadius: 10,
                padding: "11px 12px 12px",
                background: "var(--card)",
              }}
            >
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
            You start making money once {underlying} passes{" "}
            <strong style={{ color: "var(--tx-2)" }}>{rate(m.breakEven, dp)}</strong>.{" "}
          </>
        ) : (
          <>Even the maximum payout does not cover what this position cost. </>
        )}
        {/* The floor is the reassuring half and it is easy to miss on a payoff
            diagram, where it is just a flat line on the left. */}
        The most you can lose is the {usd(totalCost)} you already paid, whatever the rate does.
        {currentRate && Number.isFinite(currentRate) ? (
          <>
            {" "}Right now it is {rate(currentRate, dp)}, which is {strikeAbove
              ? currentRate > strike ? "past" : "short of"
              : currentRate < strike ? "past" : "short of"}{" "}
            the {rate(strike, dp)} where cover begins to pay.
          </>
        ) : null}
      </p>
    </div>
  );
}
