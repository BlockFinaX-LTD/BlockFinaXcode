import { Example, P, Section, Step, Steps, Table, UL } from '../lesson-blocks';
import { A, EX, Head } from './common';

const PART = 'Providing underwriting capital';

export function Underwriting() {
  return (
    <>
      <Head part={PART} title="How underwriting works">
        Underwriters deposit USDC into a pool that sells one contract, a Cap or a Floor, on one currency. When protection is sold from the pool,
        part of their capital is reserved to pay it and they receive its premium at once. If the contract pays out, the payout
        comes from that reserve.
      </Head>

      <Section n="01" id="commit" title="What you commit to">
        <P>
          By keeping capital in a pool with backing switched on, you agree to fund new contracts sold from it, within the pool's
          terms and your own limits. Each contract reserves the most it can pay from the underwriters backing it, in proportion
          to their free capital. That reserve stays committed until the contract settles, which can be up to 90 days later.
        </P>
      </Section>

      <Section n="02" id="earn" title="How premiums are earned">
        <P>
          You receive your share of each premium at the moment of sale, less a 2% underwriting fee. It is added to your free
          capital and is yours whether or not the contract later pays out. Contracts sold before you joined a pool neither earn
          you premium nor charge you payouts.
        </P>
      </Section>

      <Section n="03" id="payouts" title="How payouts reduce capital">
        <P>
          At settlement, the payout is taken from the reserves of the underwriters who backed the contract, in proportion to what
          each reserved. Whatever is not needed returns to their free capital. Your loss on a contract can never exceed what was
          reserved from you for it.
        </P>
      </Section>

      <Section n="04" id="example" title="A worked example">
        <P>{EX.convention} Hypothetical: you are the only underwriter backing a $500,000 limited USD/GHS Cap, bought at 11.60 with strike 11.83, limit 13.01 and a premium of $5,750.</P>
        <Table
          head={['', 'No payout (11.70)', 'Payout (12.40)', 'Full payout (13.50)']}
          rows={[
            ['Reserved at sale', '$50,862.07', '$50,862.07', '$50,862.07'],
            ['Premium credited at sale (less 2%)', '+$5,635.00', '+$5,635.00', '+$5,635.00'],
            ['Paid to the buyer from your reserve', '$0', '−$24,568.97', '−$50,862.07'],
            ['Reserve returned to free capital', '$50,862.07', '$26,293.10', '$0'],
            ['Net result for this contract', '+$5,635.00', '−$18,933.97', '−$45,227.07'],
          ]}
        />
        <P>
          Premium income is not profit until the contracts it came from end without large payouts. One sharp move can cost more
          than many quiet months of premiums. <A to="underwriting-risks">Underwriting risks</A> covers this in more detail.
        </P>
      </Section>
    </>
  );
}

export function AddingCapital() {
  return (
    <>
      <Head part={PART} title="Adding capital">
        You can add USDC to an existing pool that accepts outside underwriters, or open your own pool and set its terms.
      </Head>

      <Section n="01" id="join" title="Adding to an existing pool">
        <Steps>
          <Step title="Switch to Underwriter">Use the role switch at the top of the menu.</Step>
          <Step title="Choose a pool">Open My pools or a pool from the Markets page and review its pair, whether it sells a Cap or a Floor, its durations and fees.</Step>
          <Step title="Add liquidity">Enter an amount and approve with your passkey. The USDC moves from your wallet to the pool contract and becomes free capital.</Step>
        </Steps>
      </Section>

      <Section n="02" id="create" title="Creating a pool">
        <Steps>
          <Step title="Create pool">From the Underwriter menu, select Create pool.</Step>
          <Step title="Currency and contract">Choose, for example, USD/GHS Cap.</Step>
          <Step title="Durations and prices">Choose any day, up to a maximum, or only listed durations, and set your price for each listed duration as a multiple of BlockFinaX's fair price.</Step>
          <Step title="Structures">Allow limited cover, open cover or both, with the closest strike and the limit range you accept.</Step>
          <Step title="Fund and approve">Enter your starting capital and approve. The 25 USDC creation fee is charged with it.</Step>
        </Steps>
      </Section>

      <Section n="03" id="requirements" title="Requirements">
        <UL>
          <li>USDC only. The minimum deposit and the minimum starting capital for a new pool are 10 USDC.</li>
          <li>A pool accepts up to 50 underwriters.</li>
          <li>New deposits and new pools are not possible while the protocol is paused.</li>
          <li>Your account must hold the USDC on Stellar; deposits made on Base are moved there first, as described in <A to="getting-started">Before your first purchase</A>.</li>
        </UL>
      </Section>
    </>
  );
}

export function UnderwritingTerms() {
  return (
    <>
      <Head part={PART} title="Setting underwriting terms">
        Every underwriter can choose whether their capital backs new sales and the longest contract it backs. Pool creators can
        also change the pool's prices, durations and structures. Changes apply to new sales only.
      </Head>

      <Section n="01" id="everyone" title="Settings for every underwriter">
        <Table
          head={['Setting', 'Effect']}
          rows={[
            ['Back new protection', 'When off, your free capital is not used for new contracts. Existing reserves stay until their contracts settle.'],
            ['Longest protection I back', 'Your capital only backs contracts up to this many days. Zero means any duration the pool sells.'],
          ]}
        />
      </Section>

      <Section n="02" id="creators" title="Settings for pool creators">
        <Table
          head={['Setting', 'Effect']}
          rows={[
            ['Prices per duration', 'The markup on the fair price for each listed duration; between listed durations it is interpolated. Between 0.9 and 5 times fair.'],
            ['Durations', 'Any day from a minimum, up to a maximum, or only listed durations (up to 16), within the 90-day protocol maximum.'],
            ['Structures', 'Whether limited and open cover are sold, the allowed limit range, the open-cover maximum and the closest strike to today\'s rate.'],
          ]}
        />
      </Section>

      <Section n="03" id="fixed" title="Settings that cannot be changed">
        <P>
          A pool's pair, whether it sells a Cap or a Floor, and its fee rates are fixed when it is created. Contracts already sold keep the terms
          they were sold with.
        </P>
      </Section>
    </>
  );
}

export function CapitalAndPositions() {
  return (
    <>
      <Head part={PART} title="Capital and positions">
        Your capital in a pool is either free, reserved for running contracts, or set aside for withdrawal. Only free capital
        can back new sales or be withdrawn.
      </Head>

      <Section n="01" id="states" title="Free, reserved and pending">
        <Table
          head={['State', 'Meaning']}
          rows={[
            ['Free', 'Available to back new sales and to withdraw. Premiums are added here at each sale.'],
            ['Reserved', 'Set aside for the maximum payout of contracts you back. Returns to free, less any payout, when each settles.'],
            ['Pending withdrawal', 'Free capital you have asked to withdraw. It no longer backs new sales.'],
          ]}
        />
      </Section>

      <Section n="02" id="shared" title="How contracts share capital">
        <P>
          Each sale reserves its maximum payout from the underwriters backing it at that moment, split by their free capital. A
          pool's capacity is the free capital of those underwriters; a purchase larger than that fails without moving money.
          Contracts sold one after another each take their own reserve, so capacity falls with every sale and recovers as
          contracts settle.
        </P>
        <P>{EX.convention} Hypothetical: two underwriters back a pool, A with $60,000 free and B with $40,000, when the $500,000 contract from <A to="underwriting">How underwriting works</A> is sold.</P>
        <Example
          title="one sale shared 60:40"
          rows={[
            ['Reserve: A / B', '$30,517.24 / $20,344.83'],
            ['Premium credited: A / B', '$3,381.00 / $2,254.00'],
            ['Free afterwards: A / B', '$32,863.76 / $21,909.17'],
            ['Payout at 12.40 charged: A / B', '$14,741.38 / $9,827.59'],
            ['Capital after settlement: A / B', '$48,639.62 / $32,426.41'],
          ]}
        />
      </Section>

      <Section n="03" id="monitor" title="Monitoring positions">
        <UL>
          <li>Underwriter home: your total capital, premiums earned and payouts made across pools.</li>
          <li>My pools: for each pool, your free and reserved capital, premiums earned and payouts paid.</li>
          <li>Risk and exposure: what your capital backs, by duration and by structure, and when reserved capital is due back.</li>
        </UL>
      </Section>
    </>
  );
}

export function Withdrawals() {
  return (
    <>
      <Head part={PART} title="Withdrawals and proceeds">
        Free capital, including premiums you have earned, can be withdrawn at any time. Reserved capital becomes free when the
        contracts it backs settle.
      </Head>

      <Section n="01" id="when" title="When money is available">
        <P>
          Premiums are added to your free capital at each sale, so there is no separate payout of earnings. Reserved capital is
          released at settlement, which happens shortly after each contract's end time. Withdrawals continue to work while the
          protocol is paused.
        </P>
      </Section>

      <Section n="02" id="how" title="Withdrawing">
        <Steps>
          <Step title="Request">On Withdraw capital, choose the pool and amount, up to your free capital, and approve.</Step>
          <Step title="Withdraw">The request shows as Ready straight away. Select it and approve again; the USDC returns to your wallet.</Step>
        </Steps>
        <P>To move USDC to Base, use Withdraw on the Wallet page, which sends it through Circle with a fee shown before you confirm.</P>
      </Section>

      <Section n="03" id="creator" title="Pool creator earnings">
        <P>A pool creator's share of fees accumulates in the pool. Withdrawing it is not yet available in the app.</P>
      </Section>
    </>
  );
}
