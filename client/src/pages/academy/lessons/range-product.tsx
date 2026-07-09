import { Callout, CodeInline, H1, Lead, LessonTag, P, RangePayoffSVG, Section, UL } from '../lesson-blocks';

export default function RangeProduct() {
  return (
    <>
      <LessonTag>Lesson 03 · How BlockFinaX works</LessonTag>
      <H1>The range product</H1>
      <Lead>
        BlockFinaX&apos;s default payoff isn&apos;t a yes-or-no bet. It&apos;s a
        payout that scales linearly through a bounded range. This lesson
        explains why we chose that shape and what changes because of it.
      </Lead>

      <Section n="01" id="digital" title="Digital vs. range">
        <P>
          A digital option pays a fixed amount if the strike is touched,
          and nothing otherwise. It&apos;s the simplest possible parametric
          payoff.
        </P>
        <P>
          A range option, the default here, pays nothing below the
          strike, scales linearly through a bounded range, and caps out
          at a second price. The picture is a ramp.
        </P>
        <RangePayoffSVG />
        <P>
          Given a <CodeInline>notional</CodeInline>, an
          <CodeInline>initialRate</CodeInline>, a <CodeInline>strike</CodeInline>, and a
          <CodeInline>payoutCap</CodeInline>, the payout is:
        </P>
        <P>
          <CodeInline>payout = notional × clamp(spot − strike, 0, payoutCap − strike) / initialRate</CodeInline>
        </P>
      </Section>

      <Section n="02" id="geometry" title="Three regions of the payoff">
        <UL>
          <li>
            <strong>Below the strike.</strong> No payout. The hedger
            keeps the premium as a sunk cost. The LP keeps it as earned
            income.
          </li>
          <li>
            <strong>Between strike and cap.</strong> Every unit of
            adverse move translates linearly into payout. This is the
            protection window. The range of outcomes the hedger is
            actively insured against.
          </li>
          <li>
            <strong>Above the cap.</strong> Payout stops rising. The
            hedger is uninsured on any move beyond the cap. In return,
            the pool&apos;s liability is bounded. No single event can drain
            more than <em>(cap − strike) × notional / initialRate</em>.
          </li>
        </UL>
        <Callout label="Why the cap exists">
          The cap isn&apos;t stinginess. It&apos;s what lets the pool underwrite
          the trade at all.
        </Callout>
      </Section>

      <Section n="03" id="width" title="Why range width is capped at 10×">
        <P>
          The on-chain contract enforces
          <CodeInline>payoutCap − strike ≤ 10 × notional</CodeInline>. It&apos;s
          protection against a single hedger, or a single creator,
          configuring a range wide enough to eat the whole pool if the
          tail hits.
        </P>
        <P>
          The 10× ceiling is wide enough that most real-world hedging
          cases fit inside. Even a shock devaluation rarely moves an
          emerging-market cross by more than a factor of a few. It&apos;s
          narrow enough that a single event can&apos;t take out the pool&apos;s
          other underwriters.
        </P>
        <P>
          In practice, every pool has a natural liability ceiling.
          Total-reserved never exceeds
          <em> 10 × (sum of active notionals)</em>, and by construction
          never exceeds the pool&apos;s on-chain balance.
        </P>
      </Section>

      <Section n="04" id="legacy" title="Legacy single-strike mode">
        <P>
          Events created with <CodeInline>payoutCap = 0</CodeInline> fall
          back to the old digital behaviour. Full fixed payout if the
          strike is touched at expiry, nothing otherwise. It&apos;s still
          supported for backwards compatibility with the earliest pools,
          but the new default is always the range product.
        </P>
        <P>
          If you&apos;re browsing an older pool and its cap reads zero,
          you&apos;re looking at a digital. The rest of the mechanics
          (solvency, settlement, fees) are identical.
        </P>
      </Section>
    </>
  );
}
