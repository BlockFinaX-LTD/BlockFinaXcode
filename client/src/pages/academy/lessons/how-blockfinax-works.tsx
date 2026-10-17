import { Callout, CodeInline, H1, KV, KVRow, Lead, LessonTag, P, Section, Step, Steps, UL } from '../lesson-blocks';

export default function HowBlockFinaXWorks() {
  return (
    <>
      <LessonTag>Lesson 02 · How BlockFinaX works</LessonTag>
      <H1>How BlockFinaX works</H1>
      <Lead>
        This lesson describes the intended roles and transaction flow.
        Active functions and behavior vary by network and deployed facet;
        confirm them from live chain data before relying on this overview.
      </Lead>

      <Section n="01" id="shape" title="The main pieces">
        <P>
          BlockFinaX lives inside an on-chain contract that holds all the
          state. The address never changes. Upgrades swap the code behind
          it. From the outside you interact with four things.
        </P>
        <KV>
          <KVRow term="Hedge events">
            A pool of dollars for a specific currency pair, strike, cap
            and expiry. Somebody had to create it. LPs underwrote it.
            Hedgers can buy cover from it.
          </KVRow>
          <KVRow term="Deposits (LP shares)">
            Your proportional claim on a pool&apos;s liquidity and premium
            stream, tracked per LP per event.
          </KVRow>
          <KVRow term="Positions (hedger cover)">
            An individual hedger&apos;s protection contract on an event.
            Notional, strike range, and worst-case payout already
            reserved.
          </KVRow>
          <KVRow term="Payment tokens">
            The payment token depends on the network and is fixed for an
            event at creation. Check the token address shown before signing.
          </KVRow>
        </KV>
      </Section>

      <Section n="02" id="roles" title="The four roles">
        <KV>
          <KVRow term="Creator">
            Opens a hedge event, sets its strike and cap, seeds the pool
            with initial liquidity. Earns a loyalty share of every
            platform fee levied on that pool.
          </KVRow>
          <KVRow term="LP (underwriter)">
            Adds USDC or USDT to the pool. Collects premiums
            proportionally. Backs payouts if the event settles in the
            money.
          </KVRow>
          <KVRow term="Hedger">
            Buys cover. Pays a premium, from which the platform takes a
            small fee. If the event settles in the money at expiry,
            claims a payout.
          </KVRow>
          <KVRow term="Oracle">
            Registered signer addresses submit rates after expiry. Their
            independence is not established by registration alone. When
            multi-signer mode is active and quorum agrees, an oracle
            transaction settles the event. Check the live mode and quorum
            in the Data Room.
          </KVRow>
        </KV>
      </Section>

      <Section n="03" id="lifecycle" title="Lifecycle of a pool">
        <Steps>
          <Step title="Create">
            The creator calls <CodeInline>createEvent</CodeInline> with a
            currency pair, strike, cap, expiry, direction, and initial
            liquidity. The fee rates in force at that moment are
            snapshotted onto the event. Future changes to the global
            config don&apos;t touch it.
          </Step>
          <Step title="Underwrite">
            LPs call <CodeInline>deposit</CodeInline>. Each deposit issues
            a proportional share of the pool. Deposits stay open until
            expiry, provided the creator hasn&apos;t paused new LP inflows.
          </Step>
          <Step title="Buy cover">
            Hedgers call <CodeInline>buyProtection</CodeInline> with a
            notional. The pricing engine quotes a premium. The hedger
            pays it. The pool reserves the worst-case payout out of
            unencumbered liquidity so the pool stays solvent.
          </Step>
          <Step title="Wait for expiry">
            Nothing pays out mid-life, even if the rate briefly crosses
            the strike. Both settlement paths enforce this on-chain.
          </Step>
          <Step title="Settle">
            At or after expiry, the settlement path depends on the live
            contract configuration. The current authority mode, oracle
            roster and quorum are shown in the Data Room&apos;s live governance
            read. A successful settlement transaction then determines payouts.
            If the required oracle transaction or quorum is unavailable,
            settlement can be delayed.
          </Step>
          <Step title="Claim and withdraw">
            Winning hedgers call <CodeInline>claimPayout</CodeInline>.
            LPs call <CodeInline>claimPremiums</CodeInline> for accrued
            income and <CodeInline>withdrawCapital</CodeInline> for
            principal. Unclaimed payouts sweep to platform fees only
            after a 90-day grace.
          </Step>
        </Steps>
      </Section>

      <Section n="04" id="solvency" title="Collateral checks and remaining risks">
        <P>
          The intended design uses available liquidity and position payout
          limits when evaluating a purchase. Do not treat this lesson, an
          indexer value, or a single balance read as proof that all liabilities
          are fully backed. That requires review of the active facet bytecode,
          token balances, accounting counters, every open position, and the
          relevant transaction history.
        </P>
        <P>Even a verified purchase-time check would not remove every risk:</P>
        <UL>
          <li>Token behavior, accounting defects, upgrades, oracle inputs and failed execution can affect outcomes.</li>
          <li>Pool liquidity and notional are different measures; neither alone establishes the amount owed or available.</li>
          <li>Reconcile on-chain balances and liabilities before treating any displayed capacity as withdrawable or safe to underwrite.</li>
        </UL>
        <Callout kind="warn" label="No solvency guarantee">
          The codebase and live registry have not been shown here to provide
          independent proof that all positions are covered. Do not describe
          pools as always solvent or payouts as guaranteed.
        </Callout>
      </Section>

      <Section n="05" id="not-position" title="Why the protocol takes no position">
        <P>
          The protocol earns fees on every event. A flat fee at creation.
          A slice of hedger premiums. A slice of payouts. A slice of LPs&apos;
          realised premium income. All four streams are detailed in
          lesson 05.
        </P>
        <P>
          The consequence is that the protocol is neutral about the
          outcome. It doesn&apos;t want the tail to hit. It doesn&apos;t want the
          tail to miss. It wants events to keep being created and volume
          to keep flowing. That neutrality is what lets it be honest
          about risk.
        </P>
      </Section>
    </>
  );
}
