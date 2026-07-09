import { Callout, CodeInline, Fig, H1, Lead, LessonTag, P, Pull, RangePayoffSVG, Section, UL } from '../lesson-blocks';

export default function RangeProduct() {
  return (
    <>
      <LessonTag>Lesson 06 · How BlockFinaX works</LessonTag>
      <H1>The <em>range product.</em></H1>
      <Lead>
        BlockFinaX's default payoff isn't a digital yes/no. It's a call/put
        spread — a payout that scales linearly through a bounded range.
        This lesson explains why we chose that shape and what it changes
        for both sides of the market.
      </Lead>

      <Section n="01" id="digital" title="Digital vs. range">
        <P>
          A <em>digital</em> option pays a fixed amount if the strike is
          touched, and nothing otherwise. It's the simplest possible
          parametric payoff.
        </P>
        <P>
          A <em>range</em> option — the default here — pays nothing below
          the strike, scales linearly through a bounded range, and caps out
          at a second price. The picture is a ramp.
        </P>
        <RangePayoffSVG />
        <P>
          Formally, given <CodeInline>notional</CodeInline>, an
          <CodeInline>initialRate</CodeInline>, a <CodeInline>strike</CodeInline>, and a
          <CodeInline>payoutCap</CodeInline>, the payout is:
        </P>
        <P>
          <CodeInline>
            payout = notional × clamp(spot − strike, 0, payoutCap − strike) / initialRate
          </CodeInline>
        </P>
      </Section>

      <Section n="02" id="geometry" title="The geometry of the payoff">
        <P>
          Three regions, each with a different behaviour:
        </P>
        <UL>
          <li>
            <strong>Below the strike.</strong> No payout. The hedger keeps
            the premium as a sunk cost; the LP keeps it as earned income.
          </li>
          <li>
            <strong>Between strike and cap.</strong> Every unit of
            adverse move translates linearly into payout. This is the
            "protection window" — the range of outcomes the hedger is
            actively insured against.
          </li>
          <li>
            <strong>Above the cap.</strong> Payout stops rising. The
            hedger is uninsured on any move beyond the cap. In return,
            the pool's liability is bounded — no single event can drain
            more than <em>(cap − strike) × notional / initialRate</em>.
          </li>
        </UL>
        <Pull>
          <em>The cap isn't a stinginess. It's what lets the pool underwrite the trade at all.</em>
        </Pull>
      </Section>

      <Section n="03" id="width" title="Why range width is capped at 10×">
        <P>
          The on-chain contract enforces <CodeInline>payoutCap − strike ≤ 10 × notional</CodeInline>. It's the
          protocol's protection against a single hedger — or a single
          creator — configuring a range wide enough to eat the whole pool
          if the tail hits.
        </P>
        <Callout label="Why 10×">
          Wide enough that most real-world hedging cases fit inside — even
          a shock devaluation rarely moves an emerging-market cross by
          more than a factor of a few. Narrow enough that a single event
          can't take out the pool's other underwriters.
        </Callout>
        <P>
          In practice this means every pool has a natural liability
          ceiling: total-reserved never exceeds
          <em> 10 × (sum of active notionals)</em>, and by construction
          never exceeds the pool's on-chain balance.
        </P>
      </Section>

      <Section n="04" id="legacy" title="Legacy single-strike mode">
        <P>
          Events created with <CodeInline>payoutCap = 0</CodeInline> fall
          back to the old digital behaviour: full fixed payout if the
          strike is touched at expiry, nothing otherwise. It's still
          supported for backwards compatibility with the earliest pools,
          but the new default is always the range product.
        </P>
        <P>
          If you're browsing an older pool and its cap reads zero, you're
          looking at a digital. The rest of the mechanics — solvency,
          settlement, fees — are identical.
        </P>
      </Section>
    </>
  );
}
