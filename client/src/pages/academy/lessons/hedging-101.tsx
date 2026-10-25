import { Callout, Example, H1, InShort, Lead, LessonTag, P, Section, Sources, TryIt, UL } from '../lesson-blocks';

export default function Hedging101() {
  return (
    <>
      <LessonTag>Lesson 09 · Understanding FX risk</LessonTag>
      <H1>Currency risk, from first principles</H1>
      <Lead>What currency risk is, how it reaches a business, and the ways businesses manage it.</Lead>
      <InShort>
        Currency risk is the chance that an exchange-rate move changes what you pay or receive. It hits hardest when your costs
        are in one currency and your income in another, and it can turn a profitable deal into a loss.
      </InShort>

      <Section n="01" id="what" title="What currency risk is">
        <P>
          Economists call it market risk: the risk that the local currency loses value against the hard currency a payment or loan
          is in. Even a modest fall can make a business or project unviable, or force costly refinancing.
        </P>
        <P>
          It is sharpest for businesses that earn in local currency but owe dollars. Exporters and logistics firms that earn in
          dollars feel it far less.
        </P>
      </Section>

      <Section n="02" id="exposure" title="Payables and receivables">
        <UL>
          <li><strong>Payables</strong>: dollars you have to pay, such as a supplier invoice. You lose if your currency weakens before you pay.</li>
          <li><strong>Receivables</strong>: dollars you will receive, such as an export sale. You lose if your currency strengthens before you are paid.</li>
        </UL>
        <P>Writing down each dollar amount, its date and its direction is the first step in managing currency risk.</P>
      </Section>

      <Section n="03" id="example" title="An import invoice">
        <Example
          title="a Lagos importer"
          rows={[
            ['Goods ordered', '$20,000, payable in 30 days'],
            ['Rate when priced', '1,350 naira per dollar'],
            ['Cost planned', '27,000,000 naira'],
            ['Rate on the payment date', '1,450'],
            ['Cost paid', '29,000,000 naira'],
            ['Margin lost', '2,000,000 naira'],
          ]}
        >
          A 7% move in the rate took 2,000,000 naira out of the deal. If the goods were priced with a 10% margin, most of the profit
          is gone.
        </Example>
      </Section>

      <Section n="04" id="manage" title="Ways to manage it">
        <UL>
          <li><strong>Price or invoice in dollars</strong>, passing the risk to your customer, where your market allows it.</li>
          <li><strong>Match currencies</strong>: pay dollar costs from dollar income.</li>
          <li><strong>Time payments</strong> or keep a buffer, accepting that you are guessing.</li>
          <li><strong>Lock a rate</strong> with a forward or swap from a bank, if you can get one.</li>
          <li><strong>Buy protection</strong>: pay a known premium for a payout if the rate passes a level you choose.</li>
        </UL>
        <Callout label="Doing nothing is a choice too">
          Not hedging means betting the rate will not move against you. Sometimes that is reasonable, but it should be a decision,
          not a default.
        </Callout>
      </Section>

      <TryIt>Price protection for an invoice of your own in the app.</TryIt>
      <Sources items={['Climate Policy Initiative, FX Hedging Instruments: Risks addressed; Application and impacts.']} />
    </>
  );
}
