import { Example, H1, InShort, Lead, LessonTag, P, Section, TryIt, UL } from '../lesson-blocks';

export default function Fees() {
  return (
    <>
      <LessonTag>Lesson 05 · Learn BlockFinaX</LessonTag>
      <H1>Fees and earnings</H1>
      <Lead>What a business pays, what underwriters and pool creators earn, and one purchase traced through every fee.</Lead>
      <InShort>
        A business pays the premium plus a 5% fee on it, shown in full before approving. Underwriters keep the premium less 2%.
        If there is a payout, 2% of it goes in fees. Network fees are covered.
      </InShort>

      <Section n="01" id="business" title="What a business pays">
        <UL>
          <li><strong>The premium</strong>, set by the pool's underwriters on top of BlockFinaX's fair price.</li>
          <li><strong>A 5% fee on the premium</strong>, for buying directly in the BlockFinaX app. Partners who offer protection in their own products set their own fees.</li>
          <li><strong>2% of any payout</strong>, taken when you claim.</li>
          <li><strong>No network fees</strong>: BlockFinaX pays them.</li>
        </UL>
      </Section>

      <Section n="02" id="underwriters" title="What underwriters earn">
        <P>
          Underwriters receive the premium of every protection their money backs, less 2%, the moment it is sold. It is theirs
          whether or not the cover pays out.
        </P>
      </Section>

      <Section n="03" id="creators" title="What pool creators earn">
        <P>
          Opening a pool costs a one-time fee of 25 USDC. In return, the creator receives 5% of the fees from every protection
          sold from the pool.
        </P>
      </Section>

      <Section n="04" id="example" title="One purchase, every fee">
        <Example
          title="the naira invoice from Lesson 03"
          rows={[
            ['Premium', '$240.00'],
            ['Fee, 5% of the premium', '$12.00'],
            ['The business pays', '$252.00'],
            ['Underwriters receive (premium less 2%)', '$235.20'],
            ['Payout if the rate ends at 1,450', '$1,081.48'],
            ['Fee, 2% of the payout', '$21.63'],
            ['The business receives', '$1,059.85'],
          ]}
        >
          The business knows its full cost, $252, before approving. Everything after that depends only on the rate at the end
          date.
        </Example>
      </Section>

      <TryIt>Every quote in the app lists the premium, the fee and the total before you approve.</TryIt>
    </>
  );
}
