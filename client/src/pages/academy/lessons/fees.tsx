import { Callout, CodeInline, Fig, H1, KV, KVRow, Lead, LessonTag, OL, P, Pull, Section, UL } from '../lesson-blocks';

export default function Fees() {
  return (
    <>
      <LessonTag>Lesson 08 · How BlockFinaX works</LessonTag>
      <H1>Fees <em>&amp; incentives.</em></H1>
      <Lead>
        Five fee streams, one loyalty share for creators, and one design
        choice — snapshotting at creation — that removes an entire class
        of governance risk. This lesson walks through where every fee
        comes from and where it goes.
      </Lead>

      <Section n="01" id="streams" title="The five streams">
        <P>
          Everything the protocol earns is a percentage of a value that's
          already flowing between two other parties. It never takes a
          position; it takes a slice.
        </P>
        <KV>
          <KVRow term="Creation fee">
            A flat fee, in the pool's payment token, charged when
            <CodeInline>createEvent</CodeInline> is called. Sized to discourage
            spam pools without gating serious ones. Defaults: <em>$25 on
            Base</em>, <em>$2 on BSC</em>.
          </KVRow>
          <KVRow term="Hedger fee (% notional)">
            A percentage of the hedger's notional charged at purchase.
            Default: <em>0.5%</em>.
          </KVRow>
          <KVRow term="Hedger payout fee (% payout)">
            A percentage of the gross payout, charged when a winning hedger
            claims. Default: <em>1.0%</em>.
          </KVRow>
          <KVRow term="LP profit fee (% premium claim)">
            A percentage of the premium income an LP claims. Only levied
            on realised income. Default: <em>1.0%</em>.
          </KVRow>
          <KVRow term="Creator loyalty (% of every platform fee)">
            The event creator earns a share of every platform fee levied
            on their pool. Encourages good pool design. Default:
            <em> 5%</em>.
          </KVRow>
        </KV>
        <P>
          All rates use a fixed-point precision of <CodeInline>1e6</CodeInline> on-chain
          (so <CodeInline>5000</CodeInline> means 0.5%). The rate caps enforced by the
          contract are strict: no single rate above 10%, loyalty share
          not above 50%.
        </P>
      </Section>

      <Section n="02" id="snapshot" title="Snapshot at creation">
        <P>
          When an event is created, the fee rates in force at that
          transaction are copied onto the event's storage. Every fee levied
          against the pool for the rest of its life uses those snapshotted
          rates.
        </P>
        <Pull>
          <em>Changing the global fee config never touches a pool that already exists. LPs and hedgers know exactly what they signed up for.</em>
        </Pull>
        <P>
          The reason is simple: LPs and hedgers evaluate the pool's economics
          at the moment they commit capital or pay premium. If governance
          could retroactively raise the fee on an outstanding pool, the
          contract would be structurally untrustworthy. The snapshot removes
          that failure mode entirely.
        </P>
      </Section>

      <Section n="03" id="creator" title="Creator loyalty">
        <P>
          Every platform fee — hedger fee, payout fee, LP profit fee — is
          split at collection. A configurable percentage of it goes to the
          event creator, deducted from the platform's take, not from the
          user's payment. From the user's perspective the sticker fee
          hasn't changed; internally, the protocol is sharing revenue.
        </P>
        <Fig label="Fig. 08·1" caption="Fee decomposition for a $1,000 hedger payment at 0.5% hedger fee, 5% creator loyalty. Numbers illustrative.">
          <svg viewBox="0 0 600 190">
            <line x1="60" y1="140" x2="560" y2="140" className="stroke-2" />
            {/* premium */}
            <rect x="60" y="60" width="440" height="60" fill="var(--ac-mint)" opacity="0.16" stroke="var(--ac-mint)" />
            <text x="70" y="82" style={{ fill: 'var(--ac-mint)' }}>Premium → pool ($995.00)</text>
            <text x="70" y="100">Distributed to LPs proportionally</text>
            {/* fee */}
            <rect x="500" y="60" width="60" height="60" className="accent-fill" stroke="var(--ac-accent)" />
            <text x="510" y="82" style={{ fill: 'var(--ac-accent-2)' }}>Fee</text>
            <text x="510" y="98">$5.00</text>
            {/* fee split */}
            <line x1="530" y1="120" x2="510" y2="160" className="stroke" />
            <line x1="530" y1="120" x2="550" y2="160" className="stroke" />
            <text x="474" y="176">Platform · $4.75</text>
            <text x="546" y="176" style={{ fill: 'var(--ac-amber)' }}>Creator · $0.25</text>
            <text x="60" y="30" className="lbl-major">$1,000 hedger payment</text>
          </svg>
        </Fig>
      </Section>

      <Section n="04" id="take" title="What the protocol keeps">
        <P>
          Fees accrue inside the diamond, tracked per payment token.
          Owner-only functions read the current balance and withdraw up
          to it:
        </P>
        <UL>
          <li>
            <CodeInline>getPlatformFeesByToken(token)</CodeInline> reads the
            withdrawable balance in any allowed payment token.
          </li>
          <li>
            <CodeInline>withdrawPlatformFeesByToken(token, amount)</CodeInline> pulls
            up to that balance. Bounded by the fee counters — the owner
            cannot touch LP capital, premiums, or reserved payouts through
            this path.
          </li>
        </UL>
        <Callout label="A guarantee at the application layer">
          Fee withdrawal is upper-bounded on-chain by an internal counter
          that only increments when fees are levied. The owner can't
          "accidentally" drain a pool via this function — it will revert.
        </Callout>
        <Callout kind="warn" label="A caveat at the governance layer">
          Whoever owns the diamond can also upgrade it. The application-
          layer bound holds until the code changes. Lesson 11 covers the
          upgrade story and what stands between an upgrade and a
          malicious drain.
        </Callout>
      </Section>
    </>
  );
}
