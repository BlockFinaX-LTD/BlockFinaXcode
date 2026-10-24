import { CodeInline, H1, KV, KVRow, Lead, LessonTag, P, Section } from '../lesson-blocks';

export default function Cheatsheet() {
  return (
    <>
      <LessonTag>Lesson 12 · Reference</LessonTag>
      <H1>Cheatsheet and glossary</H1>
      <Lead>
        The whole protocol on one page. Not a substitute for the
        earlier lessons. A place to look up a term or a number when you
        already know what you&apos;re doing.
      </Lead>

      <Section n="01" id="roles" title="Roles">
        <KV>
          <KVRow term="Creator">
            Opens a hedge event, sets its parameters, seeds initial
            liquidity. Earns loyalty on every fee levied against the
            pool.
          </KVRow>
          <KVRow term="LP (underwriter)">
            Adds liquidity to a pool. Earns premium proportional to
            share. Backs payouts.
          </KVRow>
          <KVRow term="Hedger">
            Buys parametric cover. Pays premium plus platform fee. Can
            claim payout if in the money at expiry.
          </KVRow>
          <KVRow term="Oracle">
            Registered signer or signers who post the settlement rate
            at or after expiry.
          </KVRow>
          <KVRow term="Owner">
            Current owner type and address vary by network. Check the
            live Governance & Protocol Control panel before assuming an
            EOA or Safe controls admin and upgrade actions.
          </KVRow>
        </KV>
      </Section>

      <Section n="02" id="lifecycle" title="Lifecycle">
        <P>
          <CodeInline>initializeHedgeFees</CodeInline> then
          <CodeInline>createEvent</CodeInline> then
          <CodeInline>setPoolSettings</CodeInline> then
          <CodeInline>deposit</CodeInline> then
          <CodeInline>buyProtection</CodeInline> then wait for expiry
          then <CodeInline>settleEvent</CodeInline> or oracle consensus,
          then <CodeInline>claimPayout</CodeInline> and
          <CodeInline>claimPremiums</CodeInline> and
          <CodeInline>withdrawCapital</CodeInline> and
          <CodeInline>withdrawCreatorEarnings</CodeInline>.
        </P>
      </Section>

      <Section n="03" id="numbers" title="Numbers that matter">
        <KV>
          <KVRow term="PRECISION">
            <CodeInline>1e6</CodeInline>. Rate integer of
            <CodeInline>25000</CodeInline> equals 2.5%.
          </KVRow>
          <KVRow term="Rate caps">
            Any single fee rate at most 10%. Creator loyalty at most
            50%.
          </KVRow>
          <KVRow term="Fee rates">
            Rates and fee bases are network-specific and governable.
            Read the current contract configuration and transaction
            preview; this cheatsheet does not provide a live quote.
          </KVRow>
          <KVRow term="Range width cap">
            <CodeInline>payoutCap − strike ≤ 10 × notional</CodeInline>.
          </KVRow>
          <KVRow term="Oracle limits">
            At most 10 signers. Quorum at least 2. Tolerance at most
            10%.
          </KVRow>
          <KVRow term="Loop bounds">
            500 positions per event. 200 deposits per event.
          </KVRow>
          <KVRow term="Grace window">
            90 days after expiry for unclaimed payouts. After that they
            sweep into platform fees via
            <CodeInline>recoverExpiredPayouts</CodeInline>.
          </KVRow>
          <KVRow term="Mainnet Diamond">
            Base 8453: <CodeInline>0xbCC51E62C4948FD35ab505bd71804C849601e4Ef</CodeInline> (USDC).
          </KVRow>
        </KV>
      </Section>

      <Section n="04" id="glossary" title="Glossary">
        <KV>
          <KVRow term="Basis risk">
            Difference between the rate your hedge references and the
            rate at which you actually convert money.
          </KVRow>
          <KVRow term="Digital option">
            All-or-nothing payoff. Full fixed payment if the strike is
            touched at expiry, otherwise zero. Legacy mode here
            (cap = 0).
          </KVRow>
          <KVRow term="European settlement">
            The option can only be exercised at expiry. A strike
            touched mid-life but retraced by expiry doesn&apos;t pay out.
          </KVRow>
          <KVRow term="Intrinsic value">
            What the option would pay if it settled now. Zero for
            out-of-the-money options.
          </KVRow>
          <KVRow term="Parametric cover">
            A payout tied to a measured value. Settled by observation,
            not by delivery of the underlying.
          </KVRow>
          <KVRow term="Payout cap">
            The rate at which payout stops rising. Bounds the pool&apos;s
            liability per position.
          </KVRow>
          <KVRow term="Premium">
            Price paid for the option. Split between LP income and
            platform fee.
          </KVRow>
          <KVRow term="Range product">
            Payout scales linearly from strike to cap. BlockFinaX
            default.
          </KVRow>
          <KVRow term="Reserved capital">
            Liquidity the pool has set aside against outstanding hedger
            positions. Not &quot;at risk.&quot; Becomes at risk only on
            in-the-money settlement.
          </KVRow>
          <KVRow term="Strike">Rate at which payout begins.</KVRow>
          <KVRow term="Time value">
            Premium above intrinsic value. Reflects the possibility of
            further adverse movement.
          </KVRow>
          <KVRow term="Utilization">
            Fraction of pool liquidity currently reserved against
            active hedgers. A capacity metric, not a loss forecast.
          </KVRow>
        </KV>
      </Section>
    </>
  );
}
