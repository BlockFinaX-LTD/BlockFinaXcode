import { Callout, H1, InShort, Lead, LessonTag, P, Section, Sources } from '../lesson-blocks';

export default function OptionsBasics() {
  return (
    <>
      <LessonTag>Lesson 10 · Understanding FX risk</LessonTag>
      <H1>Forwards, swaps and options</H1>
      <Lead>The main instruments businesses use to manage currency risk, how each works, and what each asks of you.</Lead>
      <InShort>
        Forwards and swaps lock in a rate: you are protected if it moves against you, but give up any gain. Options cap the
        downside for an upfront premium and let you keep the upside.
      </InShort>

      <Section n="01" id="forwards" title="Forwards and NDFs">
        <P>
          A forward is a private agreement with a bank to exchange a fixed amount at a set rate on a future date. A
          non-deliverable forward (NDF) settles the difference in a convertible currency such as dollars, with no exchange of the
          local currency, which is why NDFs are used where capital controls apply.
        </P>
        <P>
          Where long forwards are unavailable, businesses roll short ones, renewing them as they end. That carries rollover risk:
          the next one may be more expensive, or not available at all.
        </P>
      </Section>

      <Section n="02" id="swaps" title="Swaps">
        <P>
          A currency swap exchanges currencies both at the start and at the end. Swaps are used to match the currency of a loan's
          repayments to the currency of a project's income, often over several years.
        </P>
      </Section>

      <Section n="03" id="futures" title="Futures">
        <P>
          Futures work like forwards but are standardised and traded on exchanges. They suit smaller users in markets with
          developed financial infrastructure, which many emerging markets lack.
        </P>
      </Section>

      <Section n="04" id="options" title="Options">
        <P>
          An option gives the right, but not the obligation, to exchange currencies at a fixed rate. You pay a premium upfront. If
          the rate moves against you, the option pays; if it moves your way, you let it go and benefit from the better rate.
        </P>
        <Callout label="Where BlockFinaX fits">
          BlockFinaX protection works like an option with a cap, settled in USDC like an NDF: a known premium, a payout between
          your strike and cap, and no obligation to exchange currency.
        </Callout>
      </Section>

      <Section n="05" id="compare" title="Side by side">
        <div className="ac-example">
          <div className="ac-example-h">Comparing the instruments</div>
          <dl>
            <div><dt>Forward or NDF</dt><dd>Locks the rate · no upfront cost · gives up gains · needs a bank credit line</dd></div>
            <div><dt>Swap</dt><dd>Matches loan and income currencies · long tenors · complex documents</dd></div>
            <div><dt>Future</dt><dd>Standardised · exchange traded · rare in many emerging markets</dd></div>
            <div><dt>Option</dt><dd>Caps the downside · keeps the upside · premium paid upfront</dd></div>
          </dl>
        </div>
        <P>
          Prices for all of them depend on the currency's volatility, the length of cover, how deep the market is and who is on the
          other side. In many emerging markets they are high enough to erase the benefit of borrowing in dollars.
        </P>
      </Section>

      <Sources items={['Climate Policy Initiative, FX Hedging Instruments: Types of instruments and providers; Pricing considerations.']} />
    </>
  );
}
