import { Callout, Fig, H1, H3, KV, KVRow, Lead, LessonTag, OL, P, Pull, Section, UL } from '../lesson-blocks';

export default function Underwriting101() {
  return (
    <>
      <LessonTag>Lesson 04 · Fundamentals</LessonTag>
      <H1>Underwriting: <em>the other side of the trade.</em></H1>
      <Lead>
        For every hedger buying cover there is someone standing on the other
        side of the contract, agreeing to pay if the tail hits. That
        someone is you, if you provide liquidity. This lesson is the
        underwriter's mental model — where the premium comes from, what
        you're actually reserving, and the one number you must not ignore.
      </Lead>

      <Section n="01" id="who" title="Who writes the cover">
        <P>
          In a traditional market it would be an insurance company or a
          derivatives desk — an entity with a large balance sheet, a
          licence, and a risk team pricing tail events for a living.
        </P>
        <P>
          BlockFinaX replaces that single balance sheet with a pool of
          liquidity providers. When you <em>deposit</em> into a pool, your
          capital sits alongside every other LP's; premiums accrue to the
          pool as new hedgers buy in; payouts, if any, are debited from the
          pool at expiry. Your share of everything is proportional to how
          much you deposited and how long it stayed.
        </P>
      </Section>

      <Section n="02" id="analogy" title="The insurance analogy — and its limits">
        <P>
          "LPs are the insurance company" is a useful first pass. It gets
          you three important things right:
        </P>
        <UL>
          <li>The premium is compensation for absorbing a loss you didn't cause.</li>
          <li>Diversification across many small policies is safer than concentration in one.</li>
          <li>The pool is only as solvent as the sum of its reserves.</li>
        </UL>
        <P>
          Where the analogy breaks:
        </P>
        <UL>
          <li>
            There is no claims department, and there is no way to deny a
            valid claim. The oracle publishes a rate; if the event is in
            the money, the payout <em>is</em> owed and can be pulled at
            any time by the hedger.
          </li>
          <li>
            You can exit — but only once the pool has settled. Until then,
            your capital is reserved against the worst-case payout of every
            active hedger.
          </li>
          <li>
            The exposure isn't independent across pools. FX regimes move
            together. A cedi shock and a naira shock are not two
            uncorrelated tails; they're one story told twice.
          </li>
        </UL>
      </Section>

      <Section n="03" id="capital" title="Reserved capital vs. earned premium">
        <P>
          When a hedger buys protection, the pool <em>reserves</em> their
          worst-case payout from the deposited liquidity. That reservation
          is what keeps the pool solvent: the money to pay them exists,
          on-chain, at the moment they buy in.
        </P>
        <P>
          Reserved capital is not the same as capital "at risk." You only
          lose reserved capital if the event settles in the money at
          expiry. If it doesn't, the reservation is released and the
          premium the hedger paid stays in the pool as your earnings.
        </P>
        <Fig label="Fig. 04·1" caption="A schematic pool. Green is your unencumbered deposit; blue is reserved against outstanding cover; the tiny gold sliver is premium accrued but not yet claimed.">
          <svg viewBox="0 0 600 180">
            <rect x="60" y="40" width="500" height="80" fill="none" stroke="var(--ac-hair-3)" strokeWidth="1" />
            {/* free */}
            <rect x="60" y="40" width="260" height="80" fill="var(--ac-mint)" opacity="0.14" />
            <rect x="60" y="40" width="260" height="80" fill="none" stroke="var(--ac-mint)" />
            <text x="70" y="60" style={{ fill: 'var(--ac-mint)' }}>Unencumbered</text>
            <text x="70" y="76">Withdrawable after settlement</text>
            {/* reserved */}
            <rect x="320" y="40" width="200" height="80" className="accent-fill" />
            <rect x="320" y="40" width="200" height="80" fill="none" stroke="var(--ac-accent)" />
            <text x="330" y="60" style={{ fill: 'var(--ac-accent-2)' }}>Reserved</text>
            <text x="330" y="76">Backing outstanding cover</text>
            {/* premium */}
            <rect x="520" y="40" width="40" height="80" fill="var(--ac-amber)" opacity="0.14" />
            <rect x="520" y="40" width="40" height="80" fill="none" stroke="var(--ac-amber)" />
            <text x="520" y="140" style={{ fill: 'var(--ac-amber)' }}>Premium</text>
            <text x="60" y="24" className="lbl-major">Pool composition (LP view)</text>
          </svg>
        </Fig>
      </Section>

      <Section n="04" id="edge" title="Where an LP's edge comes from">
        <P>
          Underwriting an option is not a bet on which way the rate goes.
          It's a wager on whether the rate crosses the strike by <em>more</em>
          than the premium implies. Your edge, if you have one, is in
          seeing the tail more clearly than the buyer does.
        </P>
        <Pull>
          <em>Premium income is boring. It's the tail events you have to survive.</em>
        </Pull>
        <P>
          Practically, an LP's edge tends to come from three places:
        </P>
        <OL>
          <li>
            <strong>Local knowledge.</strong> You have a view on what
            actually drives the cedi that the offshore desk pricing the
            hedge does not.
          </li>
          <li>
            <strong>Diversification.</strong> You can underwrite across
            currencies and expiries in a way a single hedger can't.
          </li>
          <li>
            <strong>Cheap capital.</strong> You have USDC sitting on-chain
            that would otherwise earn a lending rate. Premium is your
            excess return over that idle rate.
          </li>
        </OL>
      </Section>

      <Section n="05" id="ruin" title="The one number you must not ignore">
        <P>
          Every underwriter, on-chain or off, eventually has the same
          conversation with themselves: <em>what's the largest loss I can
          take on this pool without being ruined by it?</em>
        </P>
        <P>
          On BlockFinaX, that number has a mechanical upper bound: your
          proportional share of the pool's reserved payouts, if every
          active hedger's cover settles in the money at the cap. Read the
          pool's utilisation and cap width before you commit capital. If
          the answer to "what's the worst case?" is "more than I can lose
          and still function next quarter," you are oversized.
        </P>
        <Callout kind="risk" label="A hard rule">
          Never let any single pool's worst-case loss exceed a fraction of
          your capital you are genuinely comfortable losing. Not
          "uncomfortable but okay" — genuinely comfortable.
        </Callout>
      </Section>
    </>
  );
}
