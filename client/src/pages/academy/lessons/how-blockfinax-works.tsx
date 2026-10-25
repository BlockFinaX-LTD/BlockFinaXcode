import { H1, InShort, Lead, LessonTag, P, Section, Step, Steps, TryIt, UL } from '../lesson-blocks';

export default function HowBlockFinaXWorks() {
  return (
    <>
      <LessonTag>Lesson 02 · Learn BlockFinaX</LessonTag>
      <H1>How BlockFinaX works</H1>
      <Lead>The people involved, where the money sits, and the life of one protection from quote to payout.</Lead>
      <InShort>
        A business picks the cover it needs and pays a premium. Underwriters' USDC backs it, set aside the moment it is sold.
        At the end date the agreed rate decides the payout, and the business claims it.
      </InShort>

      <Section n="01" id="roles" title="Who is involved">
        <UL>
          <li><strong>Businesses</strong> buy protection: <em>Payables protection</em> for dollars they have to pay, or <em>Receivables protection</em> for dollars they will receive.</li>
          <li><strong>Underwriters</strong> put USDC into pools, earn the premiums and pay the payouts.</li>
          <li><strong>Pool creators</strong> open a pool for one currency and one direction, and set its terms.</li>
          <li><strong>Rate operators</strong> report the exchange rate when protection ends.</li>
          <li><strong>BlockFinaX</strong> provides the infrastructure: pricing, the wallet, network fees and settlement.</li>
        </UL>
      </Section>

      <Section n="02" id="money" title="Your account and your money">
        <P>
          You sign in with email or Google and approve every payment with a passkey: your fingerprint, face or device code.
          There is no seed phrase to keep. Your wallet holds USDC, a digital dollar, and BlockFinaX covers the network fees, so
          USDC is all you need.
        </P>
        <P>
          To add money, send USDC from an exchange or another wallet. If it arrives on another network, such as Base, it is moved
          to your account automatically through Circle, the issuer of USDC, with nothing for you to approve.
        </P>
      </Section>

      <Section n="03" id="life" title="The life of one protection">
        <Steps>
          <Step title="1. A pool is open">An underwriter has opened a naira pool, for example, and added USDC to it.</Step>
          <Step title="2. You ask for a price">You choose the amount, the end date, where protection starts and the most it pays. The price is held for about two minutes.</Step>
          <Step title="3. You buy">You approve with your passkey. The most the cover can pay is set aside from the pool at the same moment, so it is always funded.</Step>
          <Step title="4. It ends">At 14:00 UTC on the end date, the agreed exchange rate is recorded.</Step>
          <Step title="5. You are paid">If the rate passed your starting point, you claim the payout in USDC. If not, the reserve returns to the underwriters.</Step>
        </Steps>
      </Section>

      <Section n="04" id="rfq" title="When no pool fits">
        <P>
          If no open pool offers the cover you want, for example a larger amount or a different end date, you can request a
          quote. Approved underwriters reply with firm prices, and you choose whether to accept one.
        </P>
      </Section>

      <TryIt>See the steps for yourself: price a protection in the app without buying it.</TryIt>
    </>
  );
}
