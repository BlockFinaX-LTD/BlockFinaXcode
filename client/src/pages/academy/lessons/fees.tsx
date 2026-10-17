import { Callout, CodeInline, Fig, H1, KV, KVRow, Lead, LessonTag, P, Section, UL } from '../lesson-blocks';

export default function Fees() {
  return (
    <>
      <LessonTag>Lesson 05 · How BlockFinaX works</LessonTag>
      <H1>Fees and incentives</H1>
      <Lead>
        Four fee streams, one loyalty share for creators, and one
        design choice (snapshotting at creation) that removes an entire
        class of governance risk. This lesson walks through where every
        fee comes from and where it goes.
      </Lead>

      <Section n="01" id="streams" title="The four streams">
        <P>
          Everything the protocol earns is a percentage of a value
          that&apos;s already flowing between two other parties. It never
          takes a position. It takes a slice.
        </P>
        <KV>
          <KVRow term="Creation fee">
            A flat fee in the pool&apos;s payment token, charged when
            <CodeInline>createEvent</CodeInline> is called. Sized to
            discourage spam pools without gating serious ones.
            <strong> $25 on Base</strong>, set per chain rather than
            uniformly.
          </KVRow>
          <KVRow term="Platform fee on premium">
            The primary revenue stream. When a hedger buys cover, the
            protocol takes <strong>5% of the premium paid</strong>. The
            remainder flows into the pool as LP income.
          </KVRow>
          <KVRow term="Payout fee">
            When a winning hedger claims, the protocol takes a
            percentage of the gross payout. Default: <strong>2.0%</strong>.
          </KVRow>
          <KVRow term="LP profit fee">
            When an LP claims accumulated premium income, the protocol
            takes a percentage of that claim. Default:
            <strong> 2.0%</strong>. Only levied on realised income.
          </KVRow>
        </KV>
        <P>
          A fifth line worth naming separately, because it doesn&apos;t
          come out of any user&apos;s pocket. It redistributes what the
          platform already keeps.
        </P>
        <KV>
          <KVRow term="Creator loyalty">
            The event creator earns a share of every platform fee levied
            on their pool. Default: <strong>5%</strong>. Deducted from
            the platform&apos;s take, not from the user&apos;s payment. The user&apos;s
            sticker fee is unchanged. The protocol shares revenue back to
            whoever seeded the pool.
          </KVRow>
        </KV>
        <P>
          All rates use a fixed-point precision of
          <CodeInline>1e6</CodeInline> on-chain (so
          <CodeInline>50000</CodeInline> means 5%). The rate caps
          enforced by the contract are strict. No single rate above 10%.
          Loyalty share not above 50%.
        </P>
      </Section>

      <Section n="02" id="worked" title="A worked example">
        <P>
          Say a hedger buys $100,000 of notional cover on a pool whose
          pricing engine quotes a 1% premium. Their premium is $1,000.
          The protocol takes 5% of that, which is $50, as its platform
          fee. The remaining $950 lands in the pool as LP income and is
          distributed proportionally to underwriters.
        </P>
        <Fig label="Fig. 05·1" caption="A $1,000 premium at 5%. LPs receive $950. The platform keeps $50, from which the creator earns $2.50 loyalty.">
          <svg viewBox="0 0 600 200" preserveAspectRatio="xMidYMid meet">
            <text x="20" y="24" className="lbl-major">$1,000 premium on a $100,000 notional at 1%</text>

            <text x="20" y="60">$950 to LPs</text>
            <text x="580" y="60" textAnchor="end" style={{ fill: 'var(--ac-accent)' }}>$50 platform</text>

            <rect x="20" y="72" width="551" height="28" fill="var(--ac-accent-soft)" stroke="var(--ac-accent)" />
            <rect x="571" y="72" width="29" height="28" fill="var(--ac-accent)" opacity="0.55" stroke="var(--ac-accent)" />

            <text x="20" y="128" style={{ fill: 'var(--ac-tx-3)' }}>Of the $50 platform take</text>
            <text x="20" y="156">$47.50 protocol</text>
            <text x="580" y="156" textAnchor="end">$2.50 creator loyalty (5%)</text>

            <line x1="20" y1="168" x2="580" y2="168" className="stroke-2" />
            <line x1="20" y1="168" x2="551" y2="168" className="accent" strokeWidth="4" />
          </svg>
        </Fig>
      </Section>

      <Section n="03" id="snapshot" title="Snapshot at creation">
        <P>
          When an event is created, the fee rates in force at that
          transaction are copied onto the event&apos;s storage. Every fee
          levied against the pool for the rest of its life uses those
          snapshotted rates.
        </P>
        <P>
          The reason is simple. LPs and hedgers evaluate the pool&apos;s
          economics at the moment they commit capital or pay premium.
          If governance could retroactively raise the fee on an
          outstanding pool, the contract would be structurally
          untrustworthy. The snapshot removes that failure mode
          entirely.
        </P>
      </Section>

      <Section n="04" id="creator" title="Creator loyalty">
        <P>
          Every platform fee (the platform fee on premium, the payout
          fee, the LP profit fee) is split at collection. A configurable
          percentage goes to the event creator, deducted from the
          platform&apos;s take, not from the user&apos;s payment.
        </P>
        <P>
          The intent is to reward pools that get built well. A creator
          who chooses a strike range that matches real demand, runs a
          healthy utilisation and attracts LPs will be earning loyalty
          on every fee event for the life of the pool.
        </P>
      </Section>

      <Section n="05" id="take" title="What the protocol keeps">
        <P>
          Fee balance views and withdrawal functions depend on the live
          selector routing and token-specific accounting. Confirm the
          current ABI, active implementation, balance and accrued fee
          counter before creating a withdrawal transaction.
        </P>
        <Callout kind="warn" label="No withdrawal guarantee">
          A method name, ABI entry or internal counter is not proof that a
          withdrawal is safe or that LP capital and liabilities are protected.
          Verify the deployed code and reconcile balances and liabilities; an
          upgrade can change behavior.
        </Callout>
      </Section>
    </>
  );
}
