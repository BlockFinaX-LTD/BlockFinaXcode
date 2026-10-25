import { Callout, Example, H1, InShort, Lead, LessonTag, P, Section, TryIt, UL } from '../lesson-blocks';

export default function LpRisk() {
  return (
    <>
      <LessonTag>Lesson 07 · Learn BlockFinaX</LessonTag>
      <H1>Underwriter risk and sizing</H1>
      <Lead>What you can lose on a single protection, three worked outcomes, and how to size and spread your capital.</Lead>
      <InShort>
        On each protection you earn the premium and can lose up to its reserve. Losses arrive together when a currency moves
        sharply, so size for the bad month, not the average one.
      </InShort>

      <Section n="01" id="risk" title="The risk you take">
        <P>
          When protection is sold from your money, the most it can pay is set aside from your free balance. If the rate ends past
          the strike, part or all of that reserve goes to the business. You can never lose more than was reserved, but the same
          move hits every protection on that currency at once.
        </P>
      </Section>

      <Section n="02" id="scenarios" title="Three scenarios">
        <Example
          title="one naira protection, backed by you alone"
          rows={[
            ['You put in', '$10,000'],
            ['Reserved for this protection', '$2,044'],
            ['Premium you receive at once', '$235'],
            ['Rate ends at 1,350 (below the strike)', 'You keep $235; the $2,044 returns'],
            ['Rate ends at 1,450', 'You pay $1,081; net result −$846'],
            ['Rate ends at 1,600 (past the cap)', 'You pay $2,044; net result −$1,809'],
          ]}
        >
          Most months look like the first row. The point of underwriting is that the premiums across many quiet months outweigh the
          payouts in the rare sharp ones.
        </Example>
      </Section>

      <Section n="03" id="sizing" title="Sizing a position">
        <UL>
          <li>Only commit money you can leave in a pool until the cover it backs ends, up to 90 days.</li>
          <li>Ask what a 20% move in the currency would cost you across everything you back, and size so you could carry it.</li>
          <li>Prefer cover with a strike further from today's rate if you want fewer, smaller payouts for a lower premium.</li>
        </UL>
      </Section>

      <Section n="04" id="spread" title="Spreading risk">
        <P>
          Currencies in the same region can move together, especially around global dollar strength. Spread across currencies,
          directions and end dates rather than concentrating in one pool, and set the longest duration you back to suit your own
          plans.
        </P>
        <Callout kind="risk" label="Remember">
          Underwriting can lose money. Returns come from carrying real risk, and in a sharp devaluation the payouts can be larger
          than many months of premiums.
        </Callout>
      </Section>

      <TryIt label="See a pool's exposure">Risk and exposure in the underwriter view shows what your money currently backs.</TryIt>
    </>
  );
}
