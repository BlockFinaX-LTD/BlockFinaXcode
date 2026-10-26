import { P, Section, Table, UL } from '../lesson-blocks';
import { A, Head } from './common';

const PART = 'Funds, data and risk';

export function Funds() {
  return (
    <>
      <Head part={PART} title="Where funds are held">
        Your USDC sits in your own smart wallet until you buy protection or add capital. From then until settlement or
        withdrawal it is held by the pool contract on Stellar, which can only move it according to its rules.
      </Head>

      <Section n="01" id="stages" title="At each stage">
        <Table
          head={['Stage', 'Where the USDC is', 'Who can move it']}
          rows={[
            ['In your wallet', 'Your Stellar smart wallet', 'Only you, with your passkey'],
            ['Deposited on Base', 'Your personal Base deposit address', 'Nobody can redirect it: it can only be sent to your own Stellar wallet through Circle'],
            ['Premium paid', 'The pool contract, credited to the backing underwriters', 'The underwriters, by withdrawing their free capital'],
            ['Underwriting capital', 'The pool contract, in your free or reserved balance', 'You, for free capital; the contract, for payouts from reserves'],
            ['Payout fixed', 'The pool contract, owed to the buyer', 'Only the buyer, by claiming'],
            ['Fees', 'The pool contract, in the protocol treasury balance', 'The protocol owner, up to the fees accumulated'],
          ]}
        />
        <P>All pools share one pool contract and one USDC balance; each pool and each underwriter has its own accounting within it.</P>
      </Section>

      <Section n="02" id="permissions" title="Who can move what">
        <P>
          Buying, adding capital, withdrawing, sending and claiming each need your passkey. BlockFinaX submits these transactions
          and pays their network fees, but cannot approve them for you. Settlement can be started by anyone; it only applies the
          recorded rate to the contract's terms.
        </P>
      </Section>

      <Section n="03" id="admin" title="Administrative powers">
        <P>The pool contract has an owner, currently BlockFinaX, who can:</P>
        <UL>
          <li>pause new pools, purchases and deposits (settlement, claims and withdrawals continue);</li>
          <li>set the fee rates that new pools start with, and the longest duration allowed, up to 365 days;</li>
          <li>enable currencies for new pools;</li>
          <li>change the key that signs price quotes;</li>
          <li>withdraw the accumulated protocol fees;</li>
          <li>replace the contract's code. An upgrade keeps the contract's address and stored balances, and could change how future transactions are handled.</li>
        </UL>
        <P>
          The rate contract's owner chooses the rate operators and how many must agree, within limits the pool contract checks:
          at least two operators, agreement within 1%, and rates no more than 15 minutes old.
        </P>
      </Section>
    </>
  );
}

export function RateData() {
  return (
    <>
      <Head part={PART} title="Exchange-rate data">
        Quotes are priced from a live reference rate and historical daily rates. Settlement uses a reference rate reported by
        the rate operators after the end time.
      </Head>

      <Section n="01" id="pricing" title="Data used for pricing">
        <P>
          The pricing engine uses today's USD reference rate, five years of daily closing rates for the currency, and US Treasury
          interest rates. Daily rates come from Twelve Data or Yahoo Finance, depending on the currency. If the latest daily rate
          is more than eight days old, the engine stops quoting that currency until it is updated.
        </P>
      </Section>

      <Section n="02" id="settlement" title="Data used for settlement">
        <P>
          The rate operators read the USD rate published by ExchangeRate-API (open.er-api.com), refreshed every five minutes by
          BlockFinaX's service, and submit it after the contract's end time. An operator skips a submission when the rate has moved
          more than 7% since its previous reading, to avoid recording an obvious error. The contract records the average of the
          agreeing submissions.
        </P>
      </Section>

      <Section n="03" id="bank" title="Reference rate and your bank rate">
        <P>
          The reference rate is a mid-market rate. The rate you are offered by a bank, a payment provider or a parallel market can
          differ from it, sometimes widely in currencies with capital controls. Your payout follows the reference rate, so it can
          be more or less than the change in what you actually pay.
        </P>
      </Section>
    </>
  );
}

export function ProtectionLimits() {
  return (
    <>
      <Head part={PART} title="Protection limits">
        A payout covers the move in the reference rate between your strike and your cap, on the amount you protected. Several
        differences mean it may not equal your actual loss.
      </Head>

      <Section n="01" id="limits" title="Where a payout falls short">
        <Table
          head={['Difference', 'Effect']}
          rows={[
            ['Strike', 'The move from the rate when bought to the strike is not covered.'],
            ['Cap or maximum', 'Any move beyond the cap, or beyond the open-cover maximum, is not covered.'],
            ['Timing', 'The payout uses the rate at 14:00 UTC on the end date, or the following Monday. Your payment may happen at another time.'],
            ['Reference rate', 'Your bank or provider rate can differ from the reference rate. See Exchange-rate data.'],
            ['Amount', 'Only the amount protected is covered. Payments larger than it are exposed on the difference.'],
            ['Costs', 'The premium, the 5% platform fee and the 2% payout fee reduce the net benefit.'],
            ['Currency of payout', 'Payouts are in USDC. Converting them to local currency happens outside BlockFinaX at your provider\'s rate.'],
          ]}
        />
        <P>The quote shows the strike, cap, end time and costs before you buy. <A to="your-quote">Understanding your quote</A> walks through them.</P>
      </Section>
    </>
  );
}

export function UnderwritingRisks() {
  return (
    <>
      <Head part={PART} title="Underwriting risks">
        Underwriters can lose up to the reserve on each contract they back. Because many contracts follow the same currency,
        losses tend to arrive together.
      </Head>

      <Section n="01" id="loss" title="Loss on a contract">
        <P>
          On each contract you keep the premium and pay the payout from your reserve. The largest possible loss is the reserve
          less the premium. <A to="underwriting">How underwriting works</A> shows the outcomes for one contract.
        </P>
      </Section>

      <Section n="02" id="correlated" title="Losses that arrive together">
        <P>
          A pool covers one currency in one direction, so a sharp devaluation affects every running contract in a depreciation
          pool at the same time. Several contracts drawing on the same capital can together consume most of it, even though each
          is limited to its own reserve. Spreading capital across currencies, directions and end dates reduces this concentration.
        </P>
      </Section>

      <Section n="03" id="other" title="Other risks">
        <UL>
          <li>Capital is committed until the contracts it backs settle, up to 90 days, and cannot be withdrawn early.</li>
          <li>Prices come from a model. If it underestimates how far a currency can move, premiums will not cover payouts over time.</li>
          <li>The settlement rate comes from a reference source and the rate operators. A wrong rate that passes their checks would be settled on.</li>
          <li>Smart-contract and operational risks are described in <A to="technical-risks">Technical and operational risks</A>.</li>
        </UL>
      </Section>
    </>
  );
}

export function TechnicalRisks() {
  return (
    <>
      <Head part={PART} title="Technical and operational risks">
        BlockFinaX depends on the Stellar network, Circle's USDC, the BlockFinaX services that submit transactions and report
        rates, and your passkey. Safeguards reduce these risks without removing them.
      </Head>

      <Section n="01" id="dependencies" title="Dependencies">
        <Table
          head={['Dependency', 'What happens if it fails']}
          rows={[
            ['Pool and rate contracts', 'An error in the contract code could affect funds held in them.'],
            ['Stellar network', 'If the network is unavailable, no purchase, withdrawal, settlement or claim can be made until it recovers.'],
            ['USDC and Circle', 'Balances are in USDC issued by Circle. Transfers between Base and Stellar depend on Circle\'s transfer service.'],
            ['BlockFinaX transaction service', 'BlockFinaX submits your approved transactions and pays network fees. If it is down, the app cannot complete actions.'],
            ['Pricing service', 'If it is down or its data is stale, no quotes are issued.'],
            ['Rate operators and data source', 'If they stop reporting, settlement is delayed until they resume.'],
            ['Your passkey and device', 'Losing every device with your passkey means losing access to your wallet. Add a backup passkey under Account.'],
          ]}
        />
      </Section>

      <Section n="02" id="safeguards" title="Safeguards">
        <UL>
          <li>The maximum payout of every contract is reserved before it is sold.</li>
          <li>Each quote is signed for one buyer, one set of terms and 120 seconds, and can be used once.</li>
          <li>Settlement needs two rate operators to agree within 1% on fresh rates, after the end time and within a band around the rate when bought.</li>
          <li>Only a contract's buyer can claim its payout, and only an underwriter can withdraw their free capital.</li>
          <li>The owner can pause new sales and deposits without stopping settlement, claims or withdrawals.</li>
          <li>BlockFinaX's transaction service refuses any transaction whose network cost is far above normal.</li>
        </UL>
      </Section>
    </>
  );
}
