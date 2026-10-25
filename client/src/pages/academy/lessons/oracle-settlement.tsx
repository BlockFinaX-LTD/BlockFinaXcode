import { Callout, H1, InShort, Lead, LessonTag, P, Section, Step, Steps, TryIt } from '../lesson-blocks';

export default function OracleSettlement() {
  return (
    <>
      <LessonTag>Lesson 04 · Learn BlockFinaX</LessonTag>
      <H1>How the rate is set and you get paid</H1>
      <Lead>Who reports the exchange rate when protection ends, how the payout is fixed, and how you collect it.</Lead>
      <InShort>
        At 14:00 UTC on the end date, independent rate operators report the exchange rate. When they agree, the payout is
        fixed by rules in code, and you claim it in USDC whenever you like.
      </InShort>

      <Section n="01" id="when" title="When protection ends">
        <P>
          Only the rate at the end date counts. A move past your strike during the contract that reverses before the end does
          not pay, and a move that happens after it does not either. If the end date falls on a weekend, the rate is taken on
          the Monday, when markets are open.
        </P>
      </Section>

      <Section n="02" id="rate" title="How the rate is agreed">
        <Steps>
          <Step title="Several operators report">Each rate operator submits the rate it observes, signed with its own key.</Step>
          <Step title="They must agree">Two operators are needed, and their rates must be within 1% of each other. Rates more than 15 minutes old are not accepted.</Step>
          <Step title="The average is recorded">The agreed rate is stored with the contract and cannot be changed afterwards.</Step>
        </Steps>
        <Callout label="Why not one source">
          Requiring independent operators to agree means no single party can choose the rate your payout depends on.
        </Callout>
      </Section>

      <Section n="03" id="settle" title="Fixing the payout">
        <P>
          Once the rate is recorded, anyone can ask the contract to settle. It reads the rate itself, applies the terms you bought
          and fixes the payout. Nobody can pass in a different number, and the payout can never exceed what was set aside when
          you bought.
        </P>
      </Section>

      <Section n="04" id="claim" title="Claiming">
        <P>
          The payout waits for you until you claim it, and only you can. It arrives in your wallet in USDC, less a 2% fee on the
          payout. If there is no payout, the reserve returns to the underwriters who backed your cover.
        </P>
      </Section>

      <TryIt label="See your protections">Open My protections in the app to follow each contract to its end date.</TryIt>
    </>
  );
}
