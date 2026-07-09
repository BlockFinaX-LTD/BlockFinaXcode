import { Callout, CodeInline, Fig, H1, KV, KVRow, Lead, LessonTag, P, Section, Step, Steps, UL } from '../lesson-blocks';

export default function LpRisk() {
  return (
    <>
      <LessonTag>Lesson 09 · Deep dives</LessonTag>
      <H1>LP risk and sizing</H1>
      <Lead>
        Underwriting is a discipline about the tail. This lesson is the
        arithmetic of that discipline. How to read a pool, how to bound
        your worst case, and a framework for sizing capital across many
        pools without kidding yourself.
      </Lead>

      <Section n="01" id="reserve" title="Worst-case reservation">
        <P>
          Every time a hedger buys cover, the pool reserves that
          hedger&apos;s maximum possible payout from unencumbered liquidity.
          Reserved capital is off-limits for new hedgers, but it isn&apos;t
          lost. It comes back to the pool if the event settles out of
          the money.
        </P>
        <P>The mechanical statement is:</P>
        <P>
          <CodeInline>reserved(position) = (cap − strike) × notional / initialRate</CodeInline>
        </P>
        <P>
          A pool&apos;s total reservation is the sum of that over all
          active positions. The on-chain balance is always at least that
          sum. The protocol will not let a purchase break this
          invariant.
        </P>
        <Callout label="The direct implication for LPs">
          You cannot be surprised by a bigger loss than the pool&apos;s
          reservation. Read it. Size against it.
        </Callout>
      </Section>

      <Section n="02" id="loss-share" title="Loss share vs. withdrawal order">
        <P>
          When an event settles in the money, the payouts are debited
          from the pool. Every LP&apos;s share of the loss is computed
          against a snapshot of the pool&apos;s shares at the moment of
          settlement, not at the moment of withdrawal.
        </P>
        <P>
          This is a deliberate design choice. In a lot of DeFi pool
          designs, the last LP to withdraw eats losses the earlier ones
          escaped. Here, the on-chain settlement snapshot locks each
          LP&apos;s proportional share of the loss the moment the pool
          ends, so racing to withdraw doesn&apos;t buy you anything.
        </P>
        <Fig label="Fig. 09·1" caption="Loss share is a snapshot, not a race. Three LPs, one settling event. Withdrawal order doesn't move the loss around.">
          <svg viewBox="0 0 600 220" preserveAspectRatio="xMidYMid meet">
            <text x="20" y="24" className="lbl-major">Pool shares at settlement</text>

            <rect x="20"  y="60" width="80" height="90" fill="var(--ac-hair)" stroke="var(--ac-hair-3)" />
            <rect x="110" y="80" width="80" height="70" fill="var(--ac-hair)" stroke="var(--ac-hair-3)" />
            <rect x="200" y="100" width="80" height="50" fill="var(--ac-accent-soft)" stroke="var(--ac-accent)" />

            <text x="60"  y="54" textAnchor="middle">LP · A</text>
            <text x="150" y="54" textAnchor="middle">LP · B</text>
            <text x="240" y="54" textAnchor="middle">LP · C</text>
            <text x="60"  y="170" textAnchor="middle">40%</text>
            <text x="150" y="170" textAnchor="middle">35%</text>
            <text x="240" y="170" textAnchor="middle">25%</text>

            <line x1="320" y1="100" x2="380" y2="100" stroke="var(--ac-tx-3)" strokeWidth="1" />
            <path d="M 373 94 L 383 100 L 373 106" stroke="var(--ac-tx-3)" fill="none" />
            <text x="350" y="90" textAnchor="middle">Settle</text>

            <text x="410" y="60" style={{ fill: 'var(--ac-tx-3)' }}>Loss allocation</text>
            <text x="410" y="88">LP A</text>
            <text x="580" y="88" textAnchor="end">40%</text>
            <text x="410" y="112">LP B</text>
            <text x="580" y="112" textAnchor="end">35%</text>
            <text x="410" y="136">LP C</text>
            <text x="580" y="136" textAnchor="end">25%</text>
          </svg>
        </Fig>
      </Section>

      <Section n="03" id="capacity" title="Capacity, utilization, and limits">
        <P>Two on-chain limits are worth remembering.</P>
        <KV>
          <KVRow term="500 positions per event">
            An event can hold at most 500 outstanding hedger positions.
            Prevents a griefer from bloating settlement gas.
          </KVRow>
          <KVRow term="200 deposits per event">
            An event can hold at most 200 LP deposits. Same reason.
          </KVRow>
        </KV>
        <P>
          The metric you care about isn&apos;t the position count. It&apos;s the
          pool&apos;s utilization. The fraction of pool liquidity currently
          reserved against active hedgers. High utilization means the
          pool is close to its capacity ceiling for new hedgers, and
          any settlement in the money will move a large fraction of LP
          capital.
        </P>
      </Section>

      <Section n="04" id="sizing" title="A sizing framework">
        <Steps>
          <Step title="Compute your household ceiling">
            The largest single-pool loss you can absorb without
            changing the way you live. Be honest.
          </Step>
          <Step title="Compute the pool&apos;s worst case for your position">
            <CodeInline>(cap − strike) × sum(active notional) × your share</CodeInline>. This is the
            number you compare against your ceiling. Not the pool&apos;s
            headline TVL. Not its premium yield.
          </Step>
          <Step title="Diversify across regimes, not just pairs">
            Two USD-quoted African crosses aren&apos;t independent bets. A
            dollar shock hits both together. Real diversification means
            spreading across correlation clusters, not currency codes.
          </Step>
          <Step title="Never underwrite more than 40% of a pool">
            An arbitrary but useful ceiling. It prevents any one pool
            from being &quot;your book&quot; and forces you to keep some capital
            in reserve for the pool you&apos;ll want to size into next
            month.
          </Step>
          <Step title="Re-evaluate on new information, not on the calendar">
            The scheduled portfolio review is a comfort ritual.
            Rebalance when the facts change. A rate regime shift, a
            governance change, a new pool at better economics.
          </Step>
        </Steps>
      </Section>

      <Section n="05" id="tail" title="The tail nobody wants to price">
        <P>
          Everything above assumes you can price the tail of the
          underlying rate correctly. Emerging-market currencies have a
          nasty habit of moving in ways your history-fitted model
          didn&apos;t allow for. Political shocks. Capital controls. Sudden
          regime changes.
        </P>
        <P>Two disciplines survive that.</P>
        <UL>
          <li>
            <strong>Size the tail you can name.</strong> If your model
            has a 3% probability of a 30% move, size against a 5%
            probability of a 40% move. The premium you leave on the
            table is the price of not being wrong.
          </li>
          <li>
            <strong>Accept some risk you can&apos;t name.</strong> There will
            always be a shock you didn&apos;t have in your prior. That&apos;s
            what the household ceiling in step 1 is for.
          </li>
        </UL>
        <Callout kind="risk" label="Read this twice">
          The 90-day grace after expiry, after which unclaimed payouts
          sweep to platform fees, is a small comfort against zombie
          pools. Not against a rogue oracle. Governance is what
          protects you from the second failure mode. Lesson 11 has the
          details.
        </Callout>
      </Section>
    </>
  );
}
