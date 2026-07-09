import { Callout, CodeInline, Fig, H1, H3, KV, KVRow, Lead, LessonTag, OL, P, Pull, Section, Step, Steps, UL } from '../lesson-blocks';

export default function HowBlockFinaXWorks() {
  return (
    <>
      <LessonTag>Lesson 05 · How BlockFinaX works</LessonTag>
      <H1>How BlockFinaX <em>works.</em></H1>
      <Lead>
        Four roles, one on-chain diamond, one lifecycle. This lesson stitches
        the pieces together end-to-end so the deep-dive lessons that follow
        have somewhere to land.
      </Lead>

      <Section n="01" id="shape" title="The shape of the protocol">
        <P>
          BlockFinaX lives inside an on-chain diamond — an EIP-2535 proxy
          that holds all the state and routes function calls to a set of
          <em> facets</em>. The proxy's address never changes. Upgrades swap
          the facet code behind it.
        </P>
        <P>
          From the outside, you interact with four things:
        </P>
        <KV>
          <KVRow term="Hedge events">
            A pool of liquidity for a specific currency pair, strike, cap,
            and expiry. Somebody had to create it, LPs underwrote it,
            hedgers can buy protection on it.
          </KVRow>
          <KVRow term="Deposits (LP shares)">
            Your proportional claim on a pool's liquidity and premium
            stream, tracked per LP per event.
          </KVRow>
          <KVRow term="Positions (hedger cover)">
            An individual hedger's protection contract on an event —
            notional, strike range, worst-case payout already reserved.
          </KVRow>
          <KVRow term="Payment tokens">
            USDC on Base, USDT on BSC. Every pool is denominated in one of
            these; the pool's payment token is fixed at creation.
          </KVRow>
        </KV>
      </Section>

      <Section n="02" id="roles" title="The four roles">
        <P>
          Every action in the protocol is one of these four parties doing
          one of a small number of things.
        </P>
        <KV>
          <KVRow term="Creator">
            Opens a hedge event, sets its strike and cap, seeds the pool
            with initial liquidity. Earns a loyalty share of every fee the
            protocol takes from that pool.
          </KVRow>
          <KVRow term="LP (underwriter)">
            Adds USDC/USDT to the pool. Collects premiums proportionally.
            Backs payouts if the event settles in the money.
          </KVRow>
          <KVRow term="Hedger">
            Buys protection. Pays a premium plus a small platform fee. If
            the event settles in the money at expiry, claims a payout.
          </KVRow>
          <KVRow term="Oracle">
            One or more independent signers registered with the protocol.
            After expiry they post the settlement rate; consensus triggers
            settlement automatically.
          </KVRow>
        </KV>
      </Section>

      <Section n="03" id="lifecycle" title="Lifecycle of a pool">
        <Steps>
          <Step title="Create">
            The creator calls <em>createEvent</em> with a currency pair,
            strike, cap, expiry, direction, and initial liquidity. The
            fee rates in force at that moment are snapshotted onto the
            event — future changes to the global config don't touch it.
          </Step>
          <Step title="Underwrite">
            LPs call <em>deposit</em>. Each deposit issues a proportional
            share of the pool. Deposits are open until the event expires,
            provided the creator hasn't paused new LP inflows.
          </Step>
          <Step title="Buy protection">
            Hedgers call <em>buyProtection</em> with a notional. The
            pricing engine quotes a premium; the hedger pays it (plus a
            platform fee); the pool reserves the worst-case payout from
            unencumbered liquidity so the pool stays solvent.
          </Step>
          <Step title="Wait for expiry">
            Nothing pays out mid-life, even if the rate briefly crosses
            the strike. Both settlement paths enforce this on-chain.
          </Step>
          <Step title="Settle">
            At or after expiry, either the single-key admin (in the current
            deployment) or a quorum of oracle signers posts the settlement
            rate. If it's in the money, payouts are computed; if not, all
            reserved capital is released back to the pool.
          </Step>
          <Step title="Claim & withdraw">
            Winning hedgers call <em>claimPayout</em>. LPs call
            <em> claimPremiums</em> for accrued income and
            <em> withdrawCapital</em> for principal. Unclaimed payouts sweep
            to platform fees only after a 90-day grace.
          </Step>
        </Steps>
      </Section>

      <Section n="04" id="solvency" title="Why pools are always solvent">
        <P>
          The single most important design choice in the protocol is this:
          the pool's solvency is checked at the moment of every
          <em> buyProtection</em>, not at expiry. If the pool can't reserve
          the buyer's worst-case payout from unencumbered liquidity, the
          purchase reverts.
        </P>
        <P>
          Consequences worth internalising:
        </P>
        <UL>
          <li>
            LPs cannot lose more than the pool holds. There is no
            outstanding claim without matching on-chain reserves.
          </li>
          <li>
            Pools have real capacity limits. A small pool cannot underwrite
            a large notional even if the LP would like the premium. This
            is a feature.
          </li>
          <li>
            Utilisation — the fraction of the pool that is reserved — is
            a first-class metric for LPs. Lesson 09 turns it into a sizing
            rule.
          </li>
        </UL>
        <Callout label="A guarantee">
          At any block between event creation and expiry, the pool's
          on-chain balance is ≥ the sum of all reserved payouts across
          every active hedger position on that event.
        </Callout>
      </Section>

      <Section n="05" id="not-position" title="Why the protocol takes no position">
        <P>
          The protocol earns fees on every event: a flat fee at creation,
          a percentage of hedger premiums, a percentage of payouts, and a
          percentage of LPs' realised premium income. All five streams are
          detailed in lesson 08.
        </P>
        <Pull>
          <em>The protocol never bets against you. Every dollar it earns comes from a fee, and every fee is bounded.</em>
        </Pull>
        <P>
          The consequence is that the protocol is neutral about the
          outcome. It doesn't want the tail to hit; it doesn't want the
          tail to miss. It wants events to keep being created and volume
          to keep flowing. That neutrality is what lets it be honest about
          risk.
        </P>
      </Section>
    </>
  );
}
