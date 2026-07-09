import { Callout, CodeInline, Fig, H1, KV, KVRow, Lead, LessonTag, OL, P, RangePayoffSVG, Section, UL } from '../lesson-blocks';

export default function OptionsBasics() {
  return (
    <>
      <LessonTag>Lesson 07 · Fundamentals</LessonTag>
      <H1>Options, in plain English</H1>
      <Lead>
        An option is the simplest kind of contract in finance to describe
        and the easiest to misprice. This lesson gives you the vocabulary
        and the two diagrams you need to think about them at all.
      </Lead>

      <Section n="01" id="right-not-obligation" title="A right, not an obligation">
        <P>
          Every option contract grants a right and imposes an
          obligation on different parties. The buyer has the right. The
          seller (called the writer) has the obligation to honour it if
          the buyer exercises.
        </P>
        <KV>
          <KVRow term="Call">
            The right to buy the underlying at a fixed price. You buy
            calls when you want protection against the price going up.
          </KVRow>
          <KVRow term="Put">
            The right to sell the underlying at a fixed price. You buy
            puts when you want protection against the price going down.
          </KVRow>
        </KV>
        <P>
          For a Ghanaian importer, a call on USD/GHS is protection
          against the cedi weakening, because &quot;USD going up in cedi
          terms&quot; is exactly the outcome that hurts. For a Ghanaian
          exporter it&apos;s a put, for the opposite reason.
        </P>
      </Section>

      <Section n="02" id="strike-expiry" title="Strike and expiry">
        <P>
          Two numbers define a plain option. The strike (the fixed
          price you&apos;d exchange at) and the expiry (the last date the
          right is alive).
        </P>
        <UL>
          <li>
            A strike close to today&apos;s price (&quot;at-the-money&quot;) gives the
            most protection but costs the most.
          </li>
          <li>
            A strike far from today&apos;s price (&quot;out-of-the-money&quot;) is
            cheap but only protects the tail.
          </li>
          <li>
            A longer expiry gives more chances for the strike to be
            breached. So longer options are always more expensive than
            shorter ones on the same underlying.
          </li>
        </UL>
      </Section>

      <Section n="03" id="premium" title="The premium is the price of certainty">
        <P>
          The premium is the price the buyer pays up front for the
          right. It has two components, and both are worth being able
          to name.
        </P>
        <OL>
          <li>
            <strong>Intrinsic value.</strong> What the option would be
            worth if it expired right now. Zero for out-of-the-money
            options. Positive and equal to
            <CodeInline>|spot − strike|</CodeInline> for in-the-money
            ones.
          </li>
          <li>
            <strong>Time value.</strong> The extra premium paid for the
            possibility that the underlying moves further before expiry.
            Erodes as expiry approaches, all else equal.
          </li>
        </OL>
        <Callout label="The rule">
          Premium is intrinsic value plus time value. If it feels like
          a lot, it&apos;s usually because the time value is doing the work.
        </Callout>
      </Section>

      <Section n="04" id="payoff" title="Payoff diagrams">
        <P>
          The single most useful mental model for an option is the
          payoff diagram. What you receive as a function of where the
          underlying lands at expiry. Every trade you&apos;ll ever make can
          be sketched this way.
        </P>
        <Fig label="Fig. 07·1" caption="Long call. You pay a premium up front (the flat loss below strike). Above the strike, each unit of underlying-move flows straight to your P&L. The break-even is the strike plus premium.">
          <svg viewBox="0 0 600 240" preserveAspectRatio="xMidYMid meet">
            <text x="60" y="24" className="lbl-major">Long call, payoff at expiry</text>

            <line x1="60" y1="150" x2="580" y2="150" className="stroke-2" />
            <line x1="60" y1="40" x2="60" y2="210" className="stroke-2" />

            <line x1="60" y1="180" x2="300" y2="180" className="red" strokeWidth="1.8" />
            <line x1="300" y1="180" x2="580" y2="50" className="accent" strokeWidth="1.8" />

            <line x1="300" y1="40" x2="300" y2="210" className="stroke" strokeDasharray="2 4" />
            <line x1="380" y1="40" x2="380" y2="210" className="stroke" strokeDasharray="2 4" />

            <text x="300" y="226" textAnchor="middle">Strike</text>
            <text x="380" y="226" textAnchor="middle">Break-even</text>
            <text x="70" y="176">Premium paid</text>
          </svg>
        </Fig>
      </Section>

      <Section n="05" id="spreads" title="Spreads: capping the tail">
        <P>
          Bought calls have unlimited upside. That sounds good, but in
          most real cases you don&apos;t need it. You only care about a
          specific window of adverse moves. A call spread caps the
          upside in exchange for a cheaper premium. You buy a call at
          one strike and sell a call at a higher strike.
        </P>
        <P>
          The result looks like a ramp. Flat below the lower strike,
          rising in between, flat again above the upper strike. This is
          the exact payoff shape BlockFinaX&apos;s range product pays. It&apos;s
          not a new invention. It&apos;s a call spread, made parametric.
        </P>
        <RangePayoffSVG />
        <Callout label="Why this matters here">
          If you understand a call spread&apos;s payoff, you already
          understand most of the geometry of the BlockFinaX range
          product. Lesson 03 is the same picture, framed in the
          protocol&apos;s vocabulary.
        </Callout>
      </Section>

      <Section n="06" id="american-european" title="When can you settle?">
        <KV>
          <KVRow term="American">
            The buyer can exercise at any time up to and including
            expiry. More flexibility, more expensive.
          </KVRow>
          <KVRow term="European">
            The buyer can only exercise at expiry. If the strike was
            breached mid-life but the market retraced, no payout.
            Cheaper, and much simpler to price.
          </KVRow>
        </KV>
        <P>
          BlockFinaX settles European. This is enforced on-chain. Both
          settlement paths (<CodeInline>HedgeFacet.settleEvent</CodeInline> and
          <CodeInline>OracleFacet.submitRate</CodeInline>) check the
          event&apos;s expiry date before applying any payout. It removes a
          whole class of racing games where an oracle post mid-period
          could reshape a pool that hasn&apos;t finished its life.
        </P>
      </Section>
    </>
  );
}
