import { Callout, CodeInline, H1, KV, KVRow, Lead, LessonTag, P, Section, Step, Steps, UL } from '../lesson-blocks';

export default function HowBlockFinaXWorks() {
  return (
    <>
      <LessonTag>Lesson 02 · How BlockFinaX works</LessonTag>
      <H1>How BlockFinaX works</H1>
      <Lead>
        Four roles, one on-chain contract, one lifecycle. This lesson
        stitches the pieces together end to end so the deep-dive lessons
        that follow have somewhere to land.
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
            USDC on Base. Every pool is denominated in a payment token,
            fixed at creation.
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
            One or more independent signers registered with the protocol.
            After expiry they post the settlement rate. Consensus
            triggers settlement automatically.
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
            At or after expiry, either the single-key admin (current
            deployment) or a quorum of oracle signers posts the
            settlement rate. If it&apos;s in the money, payouts are computed.
            If not, all reserved capital returns to the pool.
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

      <Section n="04" id="solvency" title="Why pools are always solvent">
        <P>
          The single most important design choice is this. The pool&apos;s
          solvency is checked at the moment of every
          <CodeInline>buyProtection</CodeInline>, not at expiry. If the
          pool can&apos;t reserve the buyer&apos;s worst-case payout out of
          unencumbered liquidity, the purchase reverts.
        </P>
        <P>Consequences worth internalising:</P>
        <UL>
          <li>
            LPs cannot lose more than the pool holds. There is no
            outstanding claim without matching on-chain reserves.
          </li>
          <li>
            Pools have real capacity limits. A small pool cannot
            underwrite a large notional even if the LP would like the
            premium. This is a feature.
          </li>
          <li>
            Utilisation, the fraction of the pool that is reserved, is a
            first-class metric for LPs. Lesson 09 turns it into a sizing
            rule.
          </li>
        </UL>
        <Callout label="Guarantee">
          At any block between event creation and expiry, the pool&apos;s
          on-chain balance is at least the sum of all reserved payouts
          across every active hedger position on that event.
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
