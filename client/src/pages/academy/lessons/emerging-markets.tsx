import { Callout, H1, InShort, Lead, LessonTag, P, Section, Sources, TryIt, UL } from '../lesson-blocks';

export default function EmergingMarkets() {
  return (
    <>
      <LessonTag>Lesson 11 · Understanding FX risk</LessonTag>
      <H1>Why hedging is hard to find in emerging markets</H1>
      <Lead>How large the exposure is, how far currencies move, and why small businesses are left without protection.</Lead>
      <InShort>
        Developing economies carry about $2 trillion of unhedged currency exposure, yet in most of them commercial hedges barely
        exist beyond a year, and what does exist is priced for large institutions.
      </InShort>

      <Section n="01" id="size" title="The size of the exposure">
        <UL>
          <li>Unhedged currency exposure in developing economies is about <strong>$2 trillion</strong>, and could triple to $6 trillion by 2030.<sup>1</sup></li>
          <li>More than <strong>80%</strong> of development lending to low and lower middle-income countries is in hard currency.<sup>1</sup></li>
        </UL>
      </Section>

      <Section n="02" id="moves" title="How far currencies move">
        <P>
          Since 1971, in any given year about <strong>12.5%</strong> of developing-country currencies have fallen 20% or more against
          the dollar, and about 5% have fallen by more than half.<sup>1</sup> Large moves are not rare events; they are part of the
          normal range.
        </P>
      </Section>

      <Section n="03" id="gap" title="Why supply is thin">
        <UL>
          <li>Commercial 10-year hedges are priced for only <strong>11</strong> developing economies, all large; at 3 years, about 20.<sup>1</sup></li>
          <li>More than 100 low-income economies together make up under <strong>0.2%</strong> of currency trading.<sup>1</sup></li>
          <li>Where hedging markets are thin, forward prices rarely extend beyond <strong>six to twelve months</strong>.<sup>2</sup></li>
          <li>Hedging premiums can reach <strong>6 to 7%</strong> of the amount covered.<sup>3</sup></li>
        </UL>
        <Callout label="What this means for a small business">
          Hedging providers need credit lines, legal agreements and minimum sizes. A business with a $20,000 invoice rarely clears
          any of those bars, so it carries the risk itself.
        </Callout>
      </Section>

      <Section n="04" id="africa" title="In our markets">
        <P>
          TCX, the specialist fund for emerging-market currencies, has hedged nearly $20 billion in 71 currencies since 2007.<sup>4</sup>{' '}
          In 2025 it wrote 8 hedges worth $24.2 million in Ghana and 2 worth $7.5 million in Nigeria.<sup>2</sup> Across two of the
          region's largest economies, that is the measured size of formal hedging supply.
        </P>
        <P>
          BlockFinaX exists to widen that supply: protection in amounts as small as one invoice, backed by underwriters who choose
          the currencies and terms they cover.
        </P>
      </Section>

      <TryIt>See which currencies have open pools today.</TryIt>
      <Sources items={[
        'TCX, Scaling Up Currency Risk Hedging for Low and Lower Middle-Income Countries, September 2023, pages 2, 4, 5 and 7.',
        'TCX Impact Report 2025, pages 6 and 37.',
        'Climate Policy Initiative, FX Hedging Instruments: Key challenges to uptake.',
        'TCX, 2025 annual results press release, 28 May 2026.',
      ]} />
    </>
  );
}
