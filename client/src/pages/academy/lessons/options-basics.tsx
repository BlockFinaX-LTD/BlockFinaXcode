import { Callout, CodeInline, Fig, H1, H3, KV, KVRow, Lead, LessonTag, OL, P, Pull, RangePayoffSVG, Section, UL } from '../lesson-blocks';

export default function OptionsBasics() {
  return (
    <>
      <LessonTag>Lesson 07 · Fundamentals</LessonTag>
      <H1>Options, <em>in plain English.</em></H1>
      <Lead>
        An option is the simplest kind of contract in finance to describe and
        the easiest to misprice. This lesson gives you the vocabulary and
        the two diagrams you need to think about them at all — and, later,
        the shape of the specific option BlockFinaX sells.
      </Lead>

      <Section n="01" id="right-not-obligation" title="A right, not an obligation">
        <P>
          Every option contract grants a right and imposes an obligation
          — on different parties. The buyer has the right; the seller
          (called the <em>writer</em>) has the obligation to honour it if
          the buyer exercises.
        </P>
        <KV>
          <KVRow term="Call">
            The right to <em>buy</em> the underlying at a fixed price.
            You buy calls when you want protection against the price going up.
          </KVRow>
          <KVRow term="Put">
            The right to <em>sell</em> the underlying at a fixed price.
            You buy puts when you want protection against the price going down.
          </KVRow>
        </KV>
        <P>
          For a Ghanaian importer, a call on USD/GHS is protection against
          the cedi weakening — because "USD going up in cedi terms" is
          exactly the outcome that hurts. For a Ghanaian exporter it's a
          put, for the opposite reason.
        </P>
      </Section>

      <Section n="02" id="strike-expiry" title="Strike and expiry">
        <P>
          Two numbers define a plain option: the <em>strike</em> (the fixed
          price you'd exchange at) and the <em>expiry</em> (the last date
          the right is alive).
        </P>
        <UL>
          <li>
            A strike close to today's price ("at-the-money") gives the most
            protection but costs the most.
          </li>
          <li>
            A strike far from today's price ("out-of-the-money") is cheap
            but only protects the tail.
          </li>
          <li>
            A longer expiry gives more chances for the strike to be
            breached — so longer options are always more expensive than
            shorter ones on the same underlying.
          </li>
        </UL>
      </Section>

      <Section n="03" id="premium" title="The premium is the price of certainty">
        <P>
          The premium is the price the buyer pays up front for the right.
          It has two components, and both are worth being able to name.
        </P>
        <OL>
          <li>
            <strong>Intrinsic value</strong> — what the option would be
            worth if it expired right now. Zero for out-of-the-money
            options; positive and equal to <CodeInline>|spot − strike|</CodeInline> for
            in-the-money ones.
          </li>
          <li>
            <strong>Time value</strong> — the extra premium paid for the
            possibility that the underlying moves further before expiry.
            Erodes as expiry approaches, all else equal.
          </li>
        </OL>
        <Pull>
          <em>Premium = intrinsic value + time value. If it feels like a lot, it's usually because the time value is doing the work.</em>
        </Pull>
      </Section>

      <Section n="04" id="payoff" title="Payoff diagrams">
        <P>
          The single most useful mental model for an option is the payoff
          diagram — what you receive as a function of where the underlying
          lands at expiry. Every trade you'll ever make can be sketched this
          way.
        </P>
        <Fig label="Fig. 03·1" caption="Long call — you pay a premium up front (the flat loss below strike); above the strike, each unit of underlying-move flows straight to your P&L. The break-even is the strike plus premium.">
          <svg viewBox="0 0 600 220">
            <line x1="60" y1="140" x2="560" y2="140" className="stroke-2" />
            <line x1="60" y1="30" x2="60" y2="200" className="stroke-2" />
            {/* Below-strike flat loss */}
            <line x1="60" y1="170" x2="300" y2="170" className="red" strokeWidth="1.8" />
            {/* Above-strike diagonal */}
            <line x1="300" y1="170" x2="560" y2="40" className="accent" strokeWidth="1.8" />
            {/* Strike vertical */}
            <line x1="300" y1="30" x2="300" y2="200" className="stroke" strokeDasharray="2 4" />
            <text x="308" y="200">Strike K</text>
            {/* Break-even */}
            <line x1="360" y1="140" x2="360" y2="200" className="stroke" strokeDasharray="2 4" />
            <text x="368" y="200">Break-even</text>
            <text x="70" y="176">Premium paid</text>
            <text x="470" y="55" style={{ fill: 'var(--ac-accent)' }}>Payoff rises 1-for-1</text>
            <text x="240" y="24" className="lbl-major">Long call · payoff at expiry</text>
          </svg>
        </Fig>
      </Section>

      <Section n="05" id="spreads" title="Spreads: capping the tail">
        <P>
          Bought calls have unlimited upside. That sounds good, but in most
          real cases you don't need it — you only care about a specific
          window of adverse moves. A <em>call spread</em> caps the upside
          in exchange for a cheaper premium: you buy a call at one strike
          and sell a call at a higher strike.
        </P>
        <P>
          The result looks like a ramp — flat below the lower strike, rising
          in between, flat again above the upper strike. This is the exact
          payoff shape BlockFinaX's <em>range product</em> pays. It's not a
          new invention; it's a call spread, made parametric.
        </P>
        <RangePayoffSVG />
        <Callout label="Why this matters here">
          If you understand a call spread's payoff, you already understand
          most of the geometry of the BlockFinaX range product. Lesson 03
          is the same picture, framed in the protocol's vocabulary.
        </Callout>
      </Section>

      <Section n="06" id="american-european" title="When can you settle?">
        <P>
          Options come in two settlement styles:
        </P>
        <KV>
          <KVRow term="American">
            The buyer can exercise at any time up to and including expiry.
            More flexibility, more expensive.
          </KVRow>
          <KVRow term="European">
            The buyer can only exercise at expiry. If the strike was breached
            mid-life but the market retraced, no payout. Cheaper, and much
            simpler to price.
          </KVRow>
        </KV>
        <P>
          BlockFinaX settles <em>European</em>. This is enforced on-chain:
          both settlement paths — <CodeInline>HedgeFacet.settleEvent</CodeInline> and
          <CodeInline>OracleFacet.submitRate</CodeInline> — check the event's expiry
          date before applying any payout. It removes a whole class of
          racing games where an oracle post mid-period could reshape a
          pool that hasn't finished its life.
        </P>
        <Callout label="A subtle point" kind="warn">
          A rate that touches the strike mid-period but retraces by expiry
          does not pay out. This is intentional. It matches how European
          options work everywhere else, and it makes the on-chain solvency
          proof much simpler.
        </Callout>
      </Section>
    </>
  );
}
