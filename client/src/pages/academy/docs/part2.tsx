import { P, Section, Step, Steps, Table, UL } from '../lesson-blocks';
import { A, EX, Head } from './common';

const PART = 'Buying protection';

export function GettingStarted() {
  return (
    <>
      <Head part={PART} title="Before your first purchase">
        You need a BlockFinaX account, which comes with a wallet, and enough USDC in that wallet to pay the premium and fee.
      </Head>

      <Section n="01" id="account" title="Account and wallet">
        <Steps>
          <Step title="Sign in">Open the app and sign in with an email code or a Google account.</Step>
          <Step title="Create a passkey">Your device asks you to create a passkey, approved with your fingerprint, face or device PIN. The passkey stays on your device.</Step>
          <Step title="Your wallet is created">BlockFinaX creates a smart wallet for you on Stellar, controlled by your passkey, and a linked account on Base for receiving deposits.</Step>
        </Steps>
        <P>
          Every purchase, withdrawal, transfer and claim is approved with your passkey. Your sign-in ends when you close the tab
          and lasts at most 12 hours, after which you sign in again. To add a second device, open Account and add a backup
          passkey.
        </P>
      </Section>

      <Section n="02" id="funding" title="Adding USDC">
        <P>BlockFinaX uses USDC only. You never need XLM or ETH, because BlockFinaX pays the network fees.</P>
        <Table
          head={['Method', 'How', 'Notes']}
          rows={[
            ['Test USDC (test network)', 'Wallet, then Get 10,000 test USDC', 'Once a day. Test USDC has no value.'],
            ['USDC on Stellar', 'Send to the Stellar address shown under Wallet, then Deposit', 'Arrives directly.'],
            ['USDC on Base', 'Send to your personal Base deposit address under Wallet, then Deposit', 'Minimum 1 USDC. Moved to your Stellar wallet automatically through Circle, usually within a few minutes, with nothing to approve.'],
          ]}
        />
        <P>Send only USDC. Other tokens sent to these addresses are not credited.</P>
      </Section>

      <Section n="03" id="verification" title="Verification">
        <P>
          The Account page shows a verification level that sets how much value you can move and how much payout exposure you can
          hold in any 30 days:
        </P>
        <Table
          head={['Level', 'Limit per 30 days', 'Requires']}
          rows={[
            ['Unverified', '$0', 'Nothing'],
            ['Basic', '$1,000', 'Full name, phone, country, Ghana Card or passport number'],
            ['Verified', '$10,000', 'Photo ID, proof of address, date of birth, source of funds'],
            ['Enhanced', '$1,000,000', 'Company documents, ownership declarations and source of wealth'],
          ]}
        />
      </Section>
    </>
  );
}

export function ChoosingProtection() {
  return (
    <>
      <Head part={PART} title="Choosing your protection">
        On the Protect page you choose the currency, a Cap or a Floor depending on the move you are protecting against, the amount, the end
        date, where protection starts and how far it reaches. The price updates as you change each one.
      </Head>

      <Section n="01" id="steps" title="Making your choices">
        <Steps>
          <Step title="Currency">Choose from the currencies with open pools, for example the cedi.</Step>
          <Step title="Cap or Floor">A Cap for dollars you will pay, which pays if the local currency weakens; a Floor for dollars you will receive, which pays if it strengthens.</Step>
          <Step title="Amount">The dollar amount to protect, usually the size of the invoice or payment.</Step>
          <Step title="End date">Pick a date or a duration, usually the day the payment is due. Pools offering any day show a date picker; others show their fixed durations.</Step>
          <Step title="Where protection starts">The strike, set as a percentage from today's rate or as a rate. Some pools require a minimum distance from today's rate.</Step>
          <Step title="Limited or open">For limited cover, choose the limit as a percentage beyond the strike. For open cover, the pool's maximum applies.</Step>
        </Steps>
        <P>
          A strike closer to today's rate pays sooner and costs more. A wider range between strike and limit pays more in a large
          move and costs more.
        </P>
      </Section>

      <Section n="02" id="pools" title="Which pool you buy from">
        <P>
          BlockFinaX picks the pool with the lowest price that has enough free capital for your terms. To choose a pool yourself,
          open it from the Markets page and continue to Protect.
        </P>
      </Section>

      <Section n="03" id="rfq" title="When no pool fits">
        <P>
          If no pool can price your terms, for example because the amount exceeds every pool's free capital or the currency has
          no pool, use Request a quote. Requests start at $5,000 protected, run up to 90 days and stay open for 3 days.
          Underwriters reply with a strike, limit and premium, valid for 1 hour on contracts under 30 days and 24 hours otherwise.
          Offers appear under My protections, cheapest first, and you accept one with your passkey.
        </P>
      </Section>
    </>
  );
}

export function YourQuote() {
  return (
    <>
      <Head part={PART} title="Understanding your quote">
        The quote lists what you pay now, the most you can receive, and the terms that decide the payout. Review the covered
        amount, end date, strike, limit and total before confirming.
      </Head>

      <Section n="01" id="lines" title="What the quote shows">
        <Table
          head={['Line', 'Meaning']}
          rows={[
            ['Duration and end', 'Number of days and the exact end time, 14:00 UTC on the end date.'],
            ['Protection starts above or below', 'The strike.'],
            ['Most you can receive', 'The maximum payout, before the 2% payout fee.'],
            ['Premium', 'The price of the protection.'],
            ['Execution cost', 'The 5% platform fee on the premium.'],
            ['Network fees', 'Covered by BlockFinaX.'],
            ['Total', 'Premium plus execution cost, taken from your wallet when you confirm.'],
          ]}
        />
      </Section>

      <Section n="02" id="exposure" title="What remains your risk">
        <P>
          {EX.convention} Hypothetical figures: a $500,000 USD/GHS Cap bought at 11.60 with the strike at 11.83. The
          limited version has a limit at 13.01. The open version is from a pool whose maximum payout is 30% of the amount, which
          places its effective limit at 11.83 + (11.60 × 30%) = 15.31.
        </P>
        <Table
          head={['', 'Limited cover', 'Open cover (30% maximum)']}
          rows={[
            ['Move from 11.60 to 11.83', 'Not covered: the first 2% is yours', 'Not covered: the first 2% is yours'],
            ['Covered range', '11.83 to 13.01', '11.83 to 15.31'],
            ['Move beyond the covered range', 'Not covered', 'Not covered'],
            ['Most you can receive, before the 2% fee', '$50,862.07', '$150,000.00'],
            ['Premium and fees', 'Paid whatever the outcome', 'Paid whatever the outcome, and higher for the wider range'],
          ]}
        />
        <P>
          With either structure, a payout may not match your actual loss exactly, because it uses the reference rate on the end
          date rather than the rate and time at which you pay. <A to="protection-limits">Protection limits</A> explains each case.
        </P>
      </Section>

      <Section n="03" id="validity" title="How long a quote lasts">
        <P>
          A quote is valid for 120 seconds and can be used once. The app shows a countdown and fetches a new price when it runs
          out. If the price moves while you are deciding, you confirm at the new price shown.
        </P>
      </Section>
    </>
  );
}

export function Confirming() {
  return (
    <>
      <Head part={PART} title="Confirming a purchase">
        Confirming takes one passkey approval. Your premium and fee leave your wallet and the contract becomes active in the same
        transaction, usually within a few seconds.
      </Head>

      <Section n="01" id="steps" title="Steps">
        <Steps>
          <Step title="Review">Select Review protection and read the summary.</Step>
          <Step title="Approve">Select Confirm protection and approve with your passkey.</Step>
          <Step title="Done">The app confirms the purchase and the contract appears under My protections.</Step>
        </Steps>
      </Section>

      <Section n="02" id="funds" title="When funds move">
        <P>
          In the single transaction that creates your contract, the total is transferred from your wallet to the pool contract,
          the premium less the 2% underwriting fee is credited to the underwriters backing your cover, and the maximum payout is
          reserved from their capital. If any step fails, for example because the quote expired or capacity ran out, nothing
          moves.
        </P>
        <P>Protection is active from that moment. Only the rate at the end date decides the payout.</P>
      </Section>
    </>
  );
}

export function ActiveContracts() {
  return (
    <>
      <Head part={PART} title="Following an active contract">
        My protections lists each contract with its terms, end date, status and today's rate. A contract cannot be changed,
        cancelled or sold back before it ends.
      </Head>

      <Section n="01" id="view" title="What you can see">
        <UL>
          <li>The pair, whether it is a Cap or a Floor, the amount, strike, limit and end date.</li>
          <li>What the contract would pay if it ended at today's rate. This is an estimate; only the rate at the end date counts.</li>
          <li>The status: active, settled with the payout amount, or claimed.</li>
        </UL>
      </Section>

      <Section n="02" id="changes" title="Changes and cancellation">
        <P>
          The terms are fixed when you buy. There is no early exit and no refund of the premium. If your payment date changes, you
          can buy another contract for the new date; the first one still runs to its own end date.
        </P>
      </Section>
    </>
  );
}

export function ExpiryAndSettlement() {
  return (
    <>
      <Head part={PART} title="Expiry and settlement">
        The outcome is set by the reference rate recorded after 14:00 UTC on the end date. BlockFinaX settles the contract
        automatically; if there is a payout, you claim it with your passkey.
      </Head>

      <Section n="01" id="when" title="When the outcome is set">
        <P>
          A contract ends at 14:00 UTC on its end date, or on the following Monday if the date falls on a weekend. Rates submitted
          before that time are rejected by the contract.
        </P>
      </Section>

      <Section n="02" id="rate" title="The settlement rate">
        <P>
          BlockFinaX's rate service checks for ended contracts every five minutes. Each rate operator submits the rate it reads,
          signed with its own key. The contract accepts a result when two operators have submitted within 15 minutes of each
          other and their rates are within 1%; it records the average. The rate must also be between half and twice the rate when
          you bought. Once recorded, it cannot be changed. <A to="rate-data">Exchange-rate data</A> describes where the rate comes from.
        </P>
      </Section>

      <Section n="03" id="payout" title="Calculating the payout">
        <P>
          Settlement applies the formula in <A to="contract-terms">Markets and contract terms</A>, fixes the payout, and returns
          any unused reserve to the underwriters. Settlement is started by BlockFinaX's service, usually within minutes of the end
          time; anyone can start it, so it does not depend on you.
        </P>
      </Section>

      <Section n="04" id="claim" title="Claiming">
        <Steps>
          <Step title="Open My protections">Settled contracts with a payout show a Receive payout button.</Step>
          <Step title="Claim">Select Receive payout and approve with your passkey. Only your wallet can claim.</Step>
          <Step title="Receive">The payout less the 2% fee arrives in your wallet in USDC. There is no deadline for claiming.</Step>
        </Steps>
      </Section>

      <Section n="05" id="examples" title="Outcomes compared">
        <P>
          {EX.convention} Hypothetical: a $500,000 USD/GHS Cap bought at 11.60 with the strike at 11.83. Limited cover has a
          limit at 13.01 and costs $6,037.50 in total. Open cover comes from a pool with a 30% maximum, so its effective limit is 15.31
          and its maximum payout $150,000; its premium would be higher.
        </P>
        <Table
          head={['Rate at end', 'Limited cover payout', 'Open cover payout', 'Why']}
          rows={[
            ['11.70', '$0', '$0', 'Below the strike'],
            ['12.40', '$24,568.97 ($24,077.59 after fee)', '$24,568.97 ($24,077.59 after fee)', '500,000 × (12.40 − 11.83) ÷ 11.60; inside both ranges'],
            ['13.50', '$50,862.07 ($49,844.83 after fee)', '$71,982.76 ($70,543.10 after fee)', 'Limited stops at 13.01; open continues: 500,000 × (13.50 − 11.83) ÷ 11.60'],
            ['16.00', '$50,862.07 ($49,844.83 after fee)', '$150,000.00 ($147,000.00 after fee)', 'Both at their maximum'],
          ]}
        />
        <P>
          At 11.70 the cedi weakened but not past the strike, so neither pays and the premium was the cost of being protected. At
          12.40 both pay the same, because the rate is inside both ranges. Above 13.01 they differ: limited cover has stopped
          growing, while open cover keeps paying until it reaches 30% of the amount.
        </P>
      </Section>
    </>
  );
}
