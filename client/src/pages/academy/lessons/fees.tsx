import { Callout, CodeInline, Fig, H1, KV, KVRow, Lead, LessonTag, OL, P, Pull, Section, UL } from '../lesson-blocks';

export default function Fees() {
  return (
    <>
      <LessonTag>Lesson 05 · How BlockFinaX works</LessonTag>
      <H1>Fees <em>&amp; incentives.</em></H1>
      <Lead>
        Four fee streams, one loyalty share for creators, and one design
        choice — snapshotting at creation — that removes an entire class
        of governance risk. This lesson walks through where every fee
        comes from and where it goes.
      </Lead>

      <Section n="01" id="streams" title="The four streams">
        <P>
          Everything the protocol earns is a percentage of a value that's
          already flowing between two other parties. It never takes a
          position; it takes a slice.
        </P>
        <KV>
          <KVRow term="Creation fee">
            A flat fee, in the pool's payment token, charged when
            <CodeInline>createEvent</CodeInline> is called. Sized to discourage
            spam pools without gating serious ones. <em>Flat $25</em>,
            applied uniformly on every supported chain.
          </KVRow>
          <KVRow term="Platform fee on premium">
            The primary revenue stream. When a hedger buys protection, the
            protocol takes <em>2.5% of the premium paid</em>. The remainder
            flows into the pool as LP income.
          </KVRow>
          <KVRow term="Payout fee">
            When a winning hedger claims, the protocol takes a percentage
            of the gross payout. Default: <em>1.0%</em>.
          </KVRow>
          <KVRow term="LP profit fee">
            When an LP claims accumulated premium income, the protocol
            takes a percentage of that claim. Default: <em>1.0%</em>. Only
            levied on realised income — LPs never pay a fee on premium
            that hasn't been claimed.
          </KVRow>
        </KV>
        <P>
          A fifth line worth naming separately, because it doesn't come
          out of any user's pocket — it redistributes what the platform
          already keeps:
        </P>
        <KV>
          <KVRow term="Creator loyalty">
            The event creator earns a share of every platform fee levied
            on their pool. Default: <em>5%</em>. Deducted from the
            platform's take, not from the user's payment. The user's
            sticker fee is unchanged; the protocol shares revenue back to
            whoever seeded the pool.
          </KVRow>
        </KV>
        <P>
          All rates use a fixed-point precision of <CodeInline>1e6</CodeInline> on-chain
          (so <CodeInline>25000</CodeInline> means 2.5%). The rate caps enforced by
          the contract are strict: no single rate above 10%, loyalty share
          not above 50%.
        </P>
      </Section>

      <Section n="02" id="worked" title="A worked example">
        <P>
          Say a hedger buys $100,000 of notional cover on a pool whose
          pricing engine quotes a 1% premium. Their premium is $1,000. The
          protocol takes 2.5% of that — $25 — as its platform fee. The
          remaining $975 lands in the pool as LP income and is distributed
          proportionally to underwriters.
        </P>
        <Fig label="Fig. 05·1" caption="Platform fee on a $1,000 premium at 2.5%. LPs receive $975 as premium income; the platform keeps $25, of which the creator earns 5% loyalty ($1.25).">
          <svg viewBox="0 0 600 210">
            {/* premium flow bar */}
            <rect x="60" y="60" width="500" height="60" fill="none" stroke="var(--ac-hair-3)" strokeWidth="1" />
            {/* LP portion (97.5%) */}
            <rect x="60" y="60" width="487.5" height="60" fill="var(--ac-mint)" opacity="0.16" />
            <rect x="60" y="60" width="487.5" height="60" fill="none" stroke="var(--ac-mint)" />
            <text x="72" y="82" style={{ fill: 'var(--ac-mint)' }}>Pool · $975 (97.5%)</text>
            <text x="72" y="100">Distributed to LPs proportionally</text>
            {/* platform portion (2.5%) */}
            <rect x="547.5" y="60" width="12.5" height="60" className="accent-fill" />
            <rect x="547.5" y="60" width="12.5" height="60" fill="none" stroke="var(--ac-accent)" />
            <text x="540" y="52" style={{ fill: 'var(--ac-accent)' }}>Fee</text>
            <text x="475" y="140" style={{ fill: 'var(--ac-accent)' }}>Platform · $25 (2.5%)</text>
            {/* fee split */}
            <line x1="553" y1="120" x2="530" y2="160" className="stroke" />
            <line x1="553" y1="120" x2="576" y2="160" className="stroke" />
            <text x="472" y="176">Protocol · $23.75</text>
            <text x="546" y="176" style={{ fill: 'var(--ac-amber)' }}>Creator · $1.25</text>
            {/* header */}
            <text x="60" y="36" className="lbl-major">$1,000 premium · from a $100,000 notional at 1%</text>
          </svg>
        </Fig>
      </Section>

      <Section n="03" id="snapshot" title="Snapshot at creation">
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

      <Section n="04" id="creator" title="Creator loyalty">
        <P>
          Every platform fee — the platform fee on premium, the payout
          fee, the LP profit fee — is split at collection. A configurable
          percentage of it goes to the event creator, deducted from the
          platform's take, not from the user's payment.
        </P>
        <P>
          The intent is to reward pools that get built well. A creator
          who chooses a strike range that actually matches real demand,
          runs a healthy utilisation, and attracts LPs will be earning
          loyalty on every fee event for the life of the pool.
        </P>
      </Section>

      <Section n="05" id="take" title="What the protocol keeps">
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
