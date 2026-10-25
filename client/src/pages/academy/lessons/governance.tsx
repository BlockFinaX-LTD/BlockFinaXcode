import { H1, InShort, Lead, LessonTag, P, Section, UL } from '../lesson-blocks';

export default function Governance() {
  return (
    <>
      <LessonTag>Lesson 08 · Learn BlockFinaX</LessonTag>
      <H1>Trust and security</H1>
      <Lead>What the rules in code guarantee, what only you can approve, and what you are trusting when you use BlockFinaX.</Lead>
      <InShort>
        Prices, reserves, settlement and payouts follow rules written into the contracts, and every contract is recorded on a
        public ledger. Nobody can move your money without your passkey.
      </InShort>

      <Section n="01" id="code" title="What the code guarantees">
        <UL>
          <li><strong>Every cover is funded.</strong> The most it can pay is set aside when it is sold.</li>
          <li><strong>Prices cannot be invented.</strong> Each price is signed by the pricing engine for you, these terms and a short time window, and can be used once.</li>
          <li><strong>The rate needs agreement.</strong> Independent rate operators must agree before a payout is fixed.</li>
          <li><strong>Terms do not change after you buy.</strong> Fees and terms are fixed for each contract when it is sold.</li>
        </UL>
      </Section>

      <Section n="02" id="you" title="What only you can approve">
        <P>
          Buying protection, adding or withdrawing money, sending funds and claiming a payout all need your passkey. Your passkey
          stays on your device; BlockFinaX never holds it and cannot approve on your behalf.
        </P>
      </Section>

      <Section n="03" id="changes" title="How changes are handled">
        <P>
          The contracts can be updated to add features or fix problems. An update cannot rewrite contracts already sold: they keep
          the terms they were bought with, and payouts already fixed stay fixed.
        </P>
      </Section>

      <Section n="04" id="trust" title="What you are trusting">
        <UL>
          <li><strong>USDC</strong>, issued by Circle, as the money everything is paid in.</li>
          <li><strong>The rate operators</strong> to report the market rate faithfully.</li>
          <li><strong>The pricing engine</strong> to price cover fairly, and the underwriters to price it competitively.</li>
          <li><strong>The public ledger</strong> where every contract, settlement and payout can be checked by anyone.</li>
        </UL>
      </Section>
    </>
  );
}
