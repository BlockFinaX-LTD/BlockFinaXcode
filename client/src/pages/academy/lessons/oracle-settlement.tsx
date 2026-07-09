import { Callout, CodeInline, Fig, H1, KV, KVRow, Lead, LessonTag, OL, P, Pull, Section, UL } from '../lesson-blocks';

export default function OracleSettlement() {
  return (
    <>
      <LessonTag>Lesson 07 · How BlockFinaX works</LessonTag>
      <H1>Oracle <em>&amp; settlement.</em></H1>
      <Lead>
        Settlement is the moment a pool answers the question "did the tail
        hit?" On BlockFinaX that answer is one number, posted on-chain at
        or after expiry, by a party the protocol has explicitly agreed to
        trust. This lesson is how that number gets there.
      </Lead>

      <Section n="01" id="question" title="What settlement has to answer">
        <P>
          For every pool, at expiry, the protocol needs a single fact: the
          settlement rate for the underlying currency pair. From that fact,
          the on-chain contract can compute the payoff for every hedger
          and the loss share for every LP mechanically.
        </P>
        <P>
          The design question, then, is not "how do we settle?" but "how do
          we get that rate on-chain in a way both sides trust?"
        </P>
      </Section>

      <Section n="02" id="european" title="Why settlement is European">
        <P>
          BlockFinaX only settles at or after an event's expiry. Both
          settlement paths — <CodeInline>HedgeFacet.settleEvent</CodeInline> and
          <CodeInline>OracleFacet.submitRate</CodeInline> — check the expiry
          timestamp before applying any payout. A strike that was breached
          mid-life but retraced does not fire.
        </P>
        <Pull>
          <em>European settlement isn't a limitation — it's the guarantee that lets a pool underwrite a whole term at once.</em>
        </Pull>
        <P>
          Two consequences worth keeping in your head:
        </P>
        <UL>
          <li>
            LPs know that mid-life volatility, however dramatic, doesn't
            move any capital until the event ends. Their reserves can be
            treated as static for the duration of the pool.
          </li>
          <li>
            Hedgers cannot game the oracle by racing to submit at an
            intra-day spike. The protocol simply ignores any submission
            whose timestamp is before the event's expiry.
          </li>
        </UL>
      </Section>

      <Section n="03" id="consensus" title="Multi-signer consensus">
        <P>
          The oracle facet supports up to ten registered signers, each of
          whom can call <CodeInline>submitRate(eventId, price)</CodeInline>. Settlement
          runs when three conditions align in the same transaction:
        </P>
        <OL>
          <li>
            The number of matching submissions meets the configured
            quorum (<CodeInline>requiredSigners</CodeInline>, ≥ 2).
          </li>
          <li>
            All submitted rates fall within a tolerance band
            (<CodeInline>toleranceBps</CodeInline>, ≤ 10%) of each other — no wild outlier
            counts.
          </li>
          <li>
            No submission is stale relative to the current block — an
            oracle that stopped talking a week ago doesn't count.
          </li>
        </OL>
        <P>
          When the quorum is met in-tolerance, <CodeInline>submitRate</CodeInline> settles the
          event <em>in the same transaction</em>. There's no separate
          "finalise" step to be griefed.
        </P>
        <Fig label="Fig. 07·1" caption="Oracle consensus. Three signers post rates; the median (or in-tolerance mean) settles the pool. Outliers are ignored — they don't sink the process.">
          <svg viewBox="0 0 600 200">
            <line x1="60" y1="150" x2="560" y2="150" className="stroke-2" />
            {/* rate submissions */}
            <circle cx="180" cy="90" r="5" fill="var(--ac-cyan)" />
            <text x="150" y="76" style={{ fill: 'var(--ac-cyan)' }}>7.21</text>
            <circle cx="240" cy="88" r="5" fill="var(--ac-cyan)" />
            <text x="215" y="74" style={{ fill: 'var(--ac-cyan)' }}>7.22</text>
            <circle cx="300" cy="92" r="5" fill="var(--ac-cyan)" />
            <text x="272" y="78" style={{ fill: 'var(--ac-cyan)' }}>7.20</text>
            <circle cx="460" cy="130" r="5" fill="var(--ac-red)" />
            <text x="440" y="116" style={{ fill: 'var(--ac-red)' }}>5.90</text>
            {/* consensus band */}
            <rect x="120" y="82" width="220" height="20" fill="var(--ac-accent-soft)" />
            <text x="120" y="70">Consensus band</text>
            <text x="410" y="118">Outlier · ignored</text>
            <text x="70" y="184" className="lbl-major">Time —— submissions ——▶ settlement</text>
          </svg>
        </Fig>
      </Section>

      <Section n="04" id="single-key" title="The single-key path (and its retirement)">
        <P>
          The Hedge facet still exposes a <CodeInline>settleEvent</CodeInline>
          entrypoint the admin can call directly. Same expiry check, same
          rate parameter, single signature. It exists because the multi-
          signer oracle wasn't live at day one.
        </P>
        <P>
          There's a one-way owner function, <CodeInline>activateOracleV2()</CodeInline>,
          that permanently disables the single-key path. Once called, only
          the consensus route settles. The intention is to call it as soon
          as the oracle roster is stable in production.
        </P>
        <Callout kind="warn" label="Where we are today">
          The single-key path is currently active. That's noted transparently
          on the governance lesson (11) too. It's a starting posture, not
          the target end state.
        </Callout>
      </Section>

      <Section n="05" id="stale" title="Stale submissions & tolerance">
        <P>
          The oracle facet keeps house on its own submissions. Two admin
          controls matter:
        </P>
        <KV>
          <KVRow term="setToleranceBps(x)">
            The band inside which rate submissions are considered
            "agreeing." Capped at 10%. Wider tolerance is more permissive
            but risks smuggling a bad price through consensus; tighter is
            safer but harder to actually reach quorum on.
          </KVRow>
          <KVRow term="clearStaleSubmissions(id)">
            Removes any submission for an event that has aged out of the
            freshness window. A defensive cleanup — makes it impossible for
            a long-lived signature to be replayed post-hoc.
          </KVRow>
        </KV>
      </Section>
    </>
  );
}
