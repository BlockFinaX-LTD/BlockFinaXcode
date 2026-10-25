import { Callout, Example, Fig, H1, InShort, Lead, LessonTag, P, RangePayoffSVG, Section, TryIt, UL } from '../lesson-blocks';

export default function RangeProduct() {
  return (
    <>
      <LessonTag>Lesson 03 · Learn BlockFinaX</LessonTag>
      <H1>Strike, cap and payout</H1>
      <Lead>Every protection is four choices. Together they decide what you pay and what you can receive.</Lead>
      <InShort>
        Below your starting point (the strike) you receive nothing. Between the strike and the cap, every move is paid to you.
        Beyond the cap, the payout stops growing. The premium is the most protection can ever cost you.
      </InShort>

      <Section n="01" id="choices" title="The four choices">
        <UL>
          <li><strong>The amount</strong>: the dollars you want to protect, such as one supplier invoice.</li>
          <li><strong>The end date</strong>: when the rate is checked, usually when you pay or are paid.</li>
          <li><strong>The strike</strong>: the rate where protection starts. Closer to today's rate costs more.</li>
          <li><strong>The cap</strong>: the rate where the payout stops rising. A wider range costs more.</li>
        </UL>
      </Section>

      <Section n="02" id="outcomes" title="Three possible outcomes">
        <Fig label="Figure 1" caption=" The payout grows between the strike and the cap, and stays flat beyond it.">
          <RangePayoffSVG strikeLabel="Strike" capLabel="Cap" underlyingLabel="Exchange rate at the end date" payoutLabel="Payout" />
        </Fig>
        <UL>
          <li><strong>The rate stays below the strike.</strong> No payout. You buy your dollars at a rate no worse than you planned for.</li>
          <li><strong>It ends between the strike and the cap.</strong> You receive the difference from the strike, on your amount.</li>
          <li><strong>It ends beyond the cap.</strong> You receive the full payout. Moves past the cap are not covered.</li>
        </UL>
      </Section>

      <Section n="03" id="example" title="A worked example">
        <Example
          title="Naira payables protection"
          rows={[
            ['Supplier invoice', '$20,000 due in 30 days'],
            ["Today's rate", '1,350 naira per dollar'],
            ['Strike (2% above today)', '1,377'],
            ['Cap (about 10% above the strike)', '1,515'],
            ['Premium, paid once', 'about $240 plus a $12 fee'],
            ['Rate at the end date 1,350', 'No payout'],
            ['Rate at the end date 1,450', '$1,081'],
            ['Rate at the end date 1,600', '$2,044, the most this cover pays'],
          ]}
        >
          At 1,450 the invoice costs 2,000,000 naira more than at today's rate. The payout covers the part above your strike, so
          the first 2% is yours to carry: that is what keeps the premium low.
        </Example>
        <Callout label="What it does not cover">
          Moves below the strike, moves beyond the cap, and any gap between the reference rate and the rate your bank gives you.
          The quote shows all three before you buy.
        </Callout>
      </Section>

      <Section n="04" id="capped-open" title="Capped or open">
        <P>
          <strong>Capped</strong> cover stops at the cap you choose. <strong>Open</strong> cover has no cap you set; instead the
          pool sets the most it pays per dollar protected, for example 30%. Capped cover is usually cheaper; open cover suits
          bigger, rarer moves.
        </P>
      </Section>

      <Section n="05" id="durations" title="Durations and end times">
        <P>
          Most pools let you choose any end date up to 90 days ahead; some offer only fixed durations. Cover ends at 14:00 UTC on
          its date, the same moment for everyone, and if that day is a Saturday or Sunday it ends on the Monday.
        </P>
      </Section>

      <TryIt>Move the strike and cap in the app and watch the premium change.</TryIt>
    </>
  );
}
