import { Callout, Fig, H1, KV, KVRow, Lead, LessonTag, OL, P, Section, UL } from '../lesson-blocks';

export default function Underwriting101() {
  return (
    <>
      <LessonTag>Lesson 08 · Fundamentals</LessonTag>
      <H1>Underwriting: the other side of the trade</H1>
      <Lead>
        For every hedger buying cover there is someone on the other side
        of the contract, agreeing to pay if the tail hits. That someone
        is you, if you provide liquidity. This lesson is the
        underwriter&apos;s mental model.
      </Lead>

      <Section n="01" id="who" title="Who writes the cover">
        <P>
          In a traditional market it would be an insurance company or a
          derivatives desk. An entity with a large balance sheet, a
          licence, and a risk team pricing tail events for a living.
        </P>
        <P>
          BlockFinaX replaces that single balance sheet with a pool of
          liquidity providers. When you deposit into a pool, your
          capital sits alongside every other LP&apos;s. Premiums accrue to
          the pool as new hedgers buy in. Payouts, if any, are debited
          from the pool at expiry. Your share of everything is
          proportional to how much you deposited and how long it
          stayed.
        </P>
      </Section>

      <Section n="02" id="analogy" title="The insurance analogy and its limits">
        <P>
          &quot;LPs are the insurance company&quot; is a useful first pass. It
          gets you three important things right.
        </P>
        <UL>
          <li>The premium is compensation for absorbing a loss you didn&apos;t cause.</li>
          <li>Diversification across many small policies is safer than concentration in one.</li>
          <li>The pool is only as solvent as the sum of its reserves.</li>
        </UL>
        <P>Where the analogy breaks:</P>
        <UL>
          <li>
            There is no claims department, and there is no way to deny
            a valid claim. The oracle publishes a rate. If the event is
            in the money, the payout is owed and can be pulled at any
            time by the hedger.
          </li>
          <li>
            You can exit, but only once the pool has settled. Until
            then, your capital is reserved against the worst-case
            payout of every active hedger.
          </li>
          <li>
            The exposure isn&apos;t independent across pools. FX regimes
            move together. A cedi shock and a naira shock are not two
            uncorrelated tails. They&apos;re one story told twice.
          </li>
        </UL>
      </Section>

      <Section n="03" id="capital" title="Reserved capital vs. earned premium">
        <P>
          When a hedger buys cover, the pool reserves their worst-case
          payout from the deposited liquidity. That reservation is what
          keeps the pool solvent. The money to pay them exists,
          on-chain, at the moment they buy in.
        </P>
        <P>
          Reserved capital is not the same as capital &quot;at risk.&quot; You
          only lose reserved capital if the event settles in the money
          at expiry. If it doesn&apos;t, the reservation is released and the
          premium the hedger paid stays in the pool as your earnings.
        </P>
        <Fig label="Fig. 08·1" caption="A schematic pool. The larger block is your unencumbered deposit. The smaller is reserved against outstanding cover.">
          <svg viewBox="0 0 600 180">
            <rect x="60" y="40" width="500" height="80" fill="none" stroke="var(--ac-hair-3)" strokeWidth="1" />
            <rect x="60" y="40" width="300" height="80" fill="var(--ac-hair)" />
            <rect x="60" y="40" width="300" height="80" fill="none" stroke="var(--ac-hair-3)" />
            <text x="72" y="60" style={{ fill: 'var(--ac-tx-2)' }}>Unencumbered</text>
            <text x="72" y="76">Withdrawable after settlement</text>
            <rect x="360" y="40" width="200" height="80" className="accent-fill" />
            <rect x="360" y="40" width="200" height="80" fill="none" stroke="var(--ac-accent)" />
            <text x="372" y="60" style={{ fill: 'var(--ac-tx)' }}>Reserved</text>
            <text x="372" y="76">Backing outstanding cover</text>
            <text x="60" y="24" className="lbl-major">Pool composition (LP view)</text>
          </svg>
        </Fig>
      </Section>

      <Section n="04" id="edge" title="Where an LP&apos;s edge comes from">
        <P>
          Underwriting an option is not a bet on which way the rate
          goes. It&apos;s a wager on whether the rate crosses the strike by
          more than the premium implies. Your edge, if you have one, is
          in seeing the tail more clearly than the buyer does.
        </P>
        <P>Practically, an LP&apos;s edge tends to come from three places.</P>
        <OL>
          <li>
            <strong>Local knowledge.</strong> You have a view on what
            actually drives the cedi that the offshore desk pricing the
            hedge does not.
          </li>
          <li>
            <strong>Diversification.</strong> You can underwrite across
            currencies and expiries in a way a single hedger can&apos;t.
          </li>
          <li>
            <strong>Cheap capital.</strong> You have USDC sitting
            on-chain that would otherwise earn a lending rate. Premium
            is your excess return over that idle rate.
          </li>
        </OL>
      </Section>

      <Section n="05" id="ruin" title="The one number you must not ignore">
        <P>
          Every underwriter, on-chain or off, eventually has the same
          conversation with themselves. What&apos;s the largest loss I can
          take on this pool without being ruined by it?
        </P>
        <P>
          On BlockFinaX, that number has a mechanical upper bound. Your
          proportional share of the pool&apos;s reserved payouts, if every
          active hedger&apos;s cover settles in the money at the cap. Read
          the pool&apos;s utilisation and cap width before you commit
          capital. If the answer to &quot;what&apos;s the worst case?&quot; is &quot;more
          than I can lose and still function next quarter,&quot; you are
          oversized.
        </P>
        <Callout kind="risk" label="A hard rule">
          Never let any single pool&apos;s worst-case loss exceed a
          fraction of your capital you are comfortable losing.
        </Callout>
      </Section>
    </>
  );
}
