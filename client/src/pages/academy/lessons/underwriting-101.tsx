import { Callout, H1, InShort, Lead, LessonTag, P, Section, Sources, TryIt, UL } from '../lesson-blocks';

export default function Underwriting101() {
  return (
    <>
      <LessonTag>Lesson 06 · Learn BlockFinaX</LessonTag>
      <H1>Underwriting: the other side of the trade</H1>
      <Lead>How your USDC backs protection, where your returns come from, and the controls you keep.</Lead>
      <InShort>
        You add USDC to a pool that covers one currency and one direction. When protection is sold from your money, you are paid
        its premium at once. If that cover pays out, your reserve pays it, never more than was set aside.
      </InShort>

      <Section n="01" id="what" title="What underwriting means">
        <P>
          A business buying Naira payables protection is worried the naira will weaken. Someone has to agree to pay if it does.
          As an underwriter of <em>Naira depreciation cover</em>, that is you, and the premium is what you are paid for it.
        </P>
      </Section>

      <Section n="02" id="pools" title="How a pool works">
        <UL>
          <li><strong>One currency, one direction.</strong> A pool covers, for example, the naira weakening against the dollar, never both ways, so you know exactly what you back.</li>
          <li><strong>Backed sale by sale.</strong> Each protection is funded by the underwriters in the pool when it is sold, in proportion to their free money.</li>
          <li><strong>Fully reserved.</strong> The most each protection can pay is set aside from those underwriters at the moment of sale. A pool cannot sell cover it cannot pay.</li>
          <li><strong>Free money stays free.</strong> Money not set aside for running cover can be withdrawn whenever you like.</li>
        </UL>
      </Section>

      <Section n="03" id="returns" title="Where returns come from">
        <P>
          Only from premiums businesses pay for protection, never from new deposits. In quiet months most cover ends without a
          payout and you keep the premiums. When a currency moves sharply, some of your reserve pays out.
        </P>
        <Callout label="A useful benchmark">
          TCX, the largest dedicated emerging-market currency-risk fund, reported an average annualised return of 1.6% across
          about 5,000 hedges from 2007 to 2023. Currency underwriting is a steady, modest business, not a windfall.
        </Callout>
      </Section>

      <Section n="04" id="controls" title="What you control">
        <UL>
          <li><strong>Which risk</strong>: the currency and the direction of the pools you join or create.</li>
          <li><strong>How long</strong>: the longest cover your money backs.</li>
          <li><strong>Whether to keep backing</strong>: stop backing new sales at any time, without withdrawing.</li>
          <li><strong>Your own pool</strong>: as a creator you set the durations, how close to today's rate cover may start, and its price.</li>
        </UL>
      </Section>

      <TryIt label="Open the underwriter view">Switch to Underwriter in the app to see open pools and what each has earned.</TryIt>
      <Sources items={['TCX, Scaling Up Currency Risk Hedging for Low and Lower Middle-Income Countries, September 2023, Appendix 3.']} />
    </>
  );
}
