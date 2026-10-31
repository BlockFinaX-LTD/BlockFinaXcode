import { Callout, Example, Fig, P, RangePayoffSVG, Section, Step, Steps, Table, UL } from '../lesson-blocks';
import { A, EX, Head } from './common';

const PART = 'About BlockFinaX';

export function Introduction() {
  return (
    <>
      <Head part={PART} title="Introduction">
        BlockFinaX lets a business or investor buy protection against a specified exchange-rate movement between the US
        dollar and an emerging-market currency. If the rate moves past a level the buyer chooses, the buyer receives a payout
        in USDC. Underwriters provide the capital that pays these payouts and earn the premiums buyers pay.
      </Head>

      <Section n="01" id="what" title="What BlockFinaX does">
        <P>
          A company that has to pay a supplier in dollars, or expects to receive dollars, carries the risk that its own currency
          moves before the payment date. BlockFinaX gives that company a contract that pays out if the exchange rate on a chosen
          date is beyond a chosen level, up to a chosen limit. The buyer pays a premium once, when the contract is bought.
        </P>
        <P>
          The capital behind each contract comes from underwriters who deposit USDC into currency pools. BlockFinaX provides the
          software that prices contracts, records them, collects the exchange rate at expiry and settles them. Payments, reserves
          and payouts are handled by smart contracts on the Stellar network, which apply the same rules to every contract.
        </P>
      </Section>

      <Section n="02" id="who" title="Who uses it">
        <UL>
          <li>Importers and exporters with dollar payables or receivables.</li>
          <li>Treasury teams holding money in one currency and owing it in another.</li>
          <li>Investors whose returns depend on an exchange rate.</li>
          <li>Underwriters: individuals, funds and treasuries with USDC who want to earn premiums by backing protection.</li>
        </UL>
      </Section>

      <Section n="03" id="today" title="What is available today">
        <P>
          BlockFinaX currently runs on the Stellar test network with test USDC, which has no monetary value. You can create an
          account, fund it from the in-app faucet, buy protection, underwrite pools and follow contracts through settlement.
          Everything described in this guide works on the test network unless the page says otherwise.
        </P>
      </Section>

      <Section n="04" id="guide" title="How this guide is organised">
        <Table
          head={['Part', 'Read it if you want to']}
          rows={[
            [<A to="how-protection-works">About BlockFinaX</A>, 'understand the product, its terms and its costs'],
            [<A to="getting-started">Buying protection</A>, 'protect a payment, from account set-up to payout'],
            [<A to="underwriting">Providing underwriting capital</A>, 'earn premiums by backing protection'],
            [<A to="funds">Funds, data and risk</A>, 'understand where money sits, where rates come from and what can go wrong'],
            [<A to="faq">Help and reference</A>, 'find an answer, a definition or a way to contact us'],
          ]}
        />
      </Section>
    </>
  );
}

export function HowProtectionWorks() {
  return (
    <>
      <Head part={PART} title="How protection works">
        A buyer pays a premium for a contract that pays out if an exchange rate, measured at a set time on the end date, is past
        the buyer's strike. Underwriters' capital is set aside to cover the most the contract can pay. At the end date the rate
        is recorded, the payout is calculated, and the buyer claims it.
      </Head>

      <Section n="01" id="parties" title="The parties">
        <Table
          head={['Party', 'Role']}
          rows={[
            ['Buyer', 'Chooses the terms, pays the premium and fee, and claims any payout.'],
            ['Underwriters', 'Deposit USDC into a pool, receive the premium of each contract their money backs, and pay its payout.'],
            ['Pool creator', 'An underwriter who opened the pool and set its terms: currency, direction, durations, structures and prices.'],
            ['Rate operators', 'Report the exchange rate after each contract ends. Two must agree before a payout is fixed.'],
            ['BlockFinaX', 'Prices quotes, provides the wallet, arranges network fee cover, runs the rate operators and starts settlement.'],
          ]}
        />
      </Section>

      <Section n="02" id="life" title="From purchase to payout">
        <Steps>
          <Step title="Quote">The buyer chooses the terms. BlockFinaX calculates a price and signs a quote valid for 120 seconds.</Step>
          <Step title="Purchase">The buyer approves with a passkey. The premium and fee leave the buyer's wallet, the premium is credited to the backing underwriters, and the most the contract can pay is reserved from their capital.</Step>
          <Step title="Expiry">The contract ends at 14:00 UTC on its end date. Nothing that happens to the rate before then affects the outcome.</Step>
          <Step title="Settlement">Rate operators submit the rate. Once two agree within 1%, the contract records their average and fixes the payout. Unused reserve returns to the underwriters.</Step>
          <Step title="Claim">If there is a payout, the buyer claims it with a passkey. It arrives in the buyer's wallet in USDC, less a 2% fee.</Step>
        </Steps>
      </Section>

      <Section n="03" id="example" title="A worked example">
        <P>{EX.convention} All figures are hypothetical.</P>
        <Example
          title="limited USD/GHS Cap"
          rows={[
            ['Rate when bought', '11.60'],
            ['Amount protected', '$500,000'],
            ['Strike', '11.83'],
            ['Limit', '13.01'],
            ['Premium plus fee', '$6,037.50'],
            ['Rate at the end date: 12.40', 'payout $24,077.59 after the 2% fee'],
            ['Rate at the end date: 11.70', 'no payout'],
          ]}
        >
          The buyer pays $6,037.50 in either case. In the first outcome the cedi weakened past the strike and the contract pays;
          in the second it did not, and the premium is the cost of having had the protection. <A to="expiry-and-settlement">Expiry
          and settlement</A> shows the calculation.
        </Example>
      </Section>
    </>
  );
}

export function ContractTerms() {
  return (
    <>
      <Head part={PART} title="Markets and contract terms">
        Each contract covers one US dollar exchange rate, in one direction, for one amount, until one end date. Its strike sets
        where the payout starts and its limit or maximum sets where the payout stops growing.
      </Head>

      <Section n="01" id="markets" title="Markets">
        <P>
          A currency is available when an underwriter has opened a pool for it. The protocol currently allows pools for USD/NGN
          (naira), USD/GHS (cedi), USD/KES (shilling), USD/ZAR (rand) and USD/EGP (Egyptian pound). Each pool sells one of two
          contracts, named after the pair, such as USD/GHS Cap:
        </P>
        <Table
          head={['Contract', 'It pays if', 'Suits']}
          rows={[
            ['Cap', 'the rate rises above your strike: the local currency weakens', 'dollars you have to pay'],
            ['Floor', 'the rate falls below your strike: the local currency strengthens', 'dollars you will receive'],
          ]}
        />
        <P>Buyers and underwriters use the same names. The Markets page in the app lists the open pools and how much capacity each has.</P>
      </Section>

      <Section n="02" id="terms" title="Contract terms">
        <Table
          head={['Term', 'Meaning']}
          rows={[
            ['Reference rate', 'The USD exchange rate the contract settles on, recorded by the rate operators. See Exchange-rate data.'],
            ['Amount (notional)', 'The dollar amount protected. The contract minimum is 10 USDC.'],
            ['Protection period', 'From purchase until 14:00 UTC on the end date.'],
            ['Strike', 'The rate where the payout starts. For a Cap it is at or above the rate when bought.'],
            ['Limit', 'For limited cover, the rate where the payout stops growing. Set within the pool\'s allowed distance from the strike.'],
            ['Maximum payout', 'For open cover, a percentage of the amount set by the pool, for example 30%.'],
          ]}
        />
      </Section>

      <Section n="03" id="formula" title="The payout formula">
        <P>With S the rate when bought, K the strike, L the limit and R the settlement rate:</P>
        <Callout label="Cap">Payout = amount × (lower of R and L, minus K) ÷ S, and zero if R is at or below K.</Callout>
        <Callout label="Floor">Payout = amount × (K minus higher of R and L) ÷ S, and zero if R is at or above K.</Callout>
        <P>
          The result never exceeds the maximum payout reserved at purchase. A 2% fee is deducted when the payout is claimed.
          Dividing by S, the rate when bought, converts the rate difference into dollars on the amount you protected.
        </P>
        <Fig label="Figure 1" caption=" Payout against the settlement rate for a limited Cap.">
          <RangePayoffSVG strikeLabel="Strike (K)" capLabel="Limit (L)" underlyingLabel="Settlement rate (R)" payoutLabel="Payout" />
        </Fig>
        <P>
          Open cover uses the same formula. Its limit is calculated for you as the strike plus the pool's maximum percentage of the
          rate when bought, so the maximum payout equals that percentage of the amount.
        </P>
      </Section>

      <Section n="04" id="durations" title="Durations and end times">
        <P>
          Each pool sets which durations it sells: any number of days from its minimum up to the protocol maximum of 90 days, any
          number up to a lower maximum it chooses, or only a listed set such as 7, 14 and 30 days. Contracts end at 14:00 UTC on
          the end date. If that date is a Saturday or Sunday, the contract ends on the following Monday at 14:00 UTC.
        </P>
      </Section>
    </>
  );
}

export function PricingAndCharges() {
  return (
    <>
      <Head part={PART} title="Pricing and charges">
        The premium is the price of the protection, paid once at purchase and kept by the underwriters whatever happens. On top
        of it, a direct buyer pays a 5% platform fee on the premium, and 2% of any payout when it is claimed. Network fees
        are covered.
      </Head>

      <Section n="01" id="premium" title="The premium">
        <P>
          The premium pays underwriters for setting aside capital that may be paid out. It rises with how volatile the currency
          is, how long the contract runs, how close the strike is to today's rate and how wide the range between strike and limit.
        </P>
      </Section>

      <Section n="02" id="quote" title="How a quote is set">
        <P>
          BlockFinaX's pricing engine calculates a fair rate for the exact terms you choose, using today's exchange rate, the
          currency's recent and long-run behaviour, and US interest rates. The pool then applies its markup, set by the pool
          creator for each duration, for example 1.15 times the fair rate. Premium = amount × fair rate × markup.
        </P>
        <P>
          Where several pools can sell the same cover, BlockFinaX quotes the one with the lowest markup that has enough free
          capital. The engine declines to quote cover whose maximum payout is more than 100 times its premium, because the
          price would not be credible, or less than 1.5 times, because the buyer could not come out ahead.
        </P>
      </Section>

      <Section n="03" id="fees" title="Fees and when they apply">
        <Table
          head={['Charge', 'Amount', 'Paid by', 'When']}
          rows={[
            ['Premium', 'Set by the quote', 'Buyer', 'At purchase'],
            ['Platform fee', '5% of the premium (direct purchases)', 'Buyer', 'At purchase, shown as Execution cost'],
            ['Payout fee', '2% of the payout', 'Buyer', 'When a payout is claimed'],
            ['Underwriting fee', '2% of the premium', 'Underwriters', 'Taken from the premium at purchase'],
            ['Pool creation fee', '25 USDC', 'Pool creator', 'When a pool is opened'],
            ['Network fees', 'None for users', 'Relayers', 'Every transaction'],
            ['Circle transfer fee', 'Shown before you confirm', 'User', 'Only when moving USDC between Base and Stellar'],
          ]}
        />
        <P>
          Pool creators receive 5% of the platform, payout and underwriting fees from their pool. If you buy through a partner's
          product, the partner sets its own fee. The rates above are the current settings; each pool keeps the rates in force when
          it was created.
        </P>
      </Section>

      <Section n="04" id="example" title="All charges on one contract">
        <P>{EX.convention} Hypothetical figures, assuming a fair rate of 1.00% and a markup of 1.15.</P>
        <Example
          title="$500,000 limited USD/GHS Cap, rate 12.40 at the end date"
          rows={[
            ['Premium: 500,000 × 1.00% × 1.15', '$5,750.00'],
            ['Platform fee: 5% of 5,750', '$287.50'],
            ['Buyer pays at purchase', '$6,037.50'],
            ['Underwriters receive: 5,750 less 2%', '$5,635.00'],
            ['Payout: 500,000 × (12.40 − 11.83) ÷ 11.60', '$24,568.97'],
            ['Payout fee: 2%', '$491.38'],
            ['Buyer receives', '$24,077.59'],
          ]}
        />
      </Section>
    </>
  );
}
