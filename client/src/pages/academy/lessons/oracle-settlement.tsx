import { Callout, CodeInline, H1, KV, KVRow, Lead, LessonTag, OL, P, Section, UL } from '../lesson-blocks';

export default function OracleSettlement() {
  return (
    <>
      <LessonTag>Lesson 04 · How BlockFinaX works</LessonTag>
      <H1>Oracle and settlement</H1>
      <Lead>
        Settlement is the moment a pool answers the question: did the
        tail hit? On BlockFinaX that answer is one number, posted
        on-chain at or after expiry, by a party the protocol has
        explicitly agreed to trust. This lesson is how that number gets
        there.
      </Lead>

      <Section n="01" id="question" title="What settlement has to answer">
        <P>
          For every pool, at expiry, the protocol needs a single fact.
          The settlement rate for the underlying currency pair. From
          that fact the on-chain contract can compute the payoff for
          every hedger and the loss share for every LP mechanically.
        </P>
        <P>
          The design question is not &quot;how do we settle,&quot; but &quot;how do we
          get that rate on-chain in a way both sides trust.&quot;
        </P>
      </Section>

      <Section n="02" id="european" title="Why settlement is European">
        <P>
          BlockFinaX only settles at or after an event&apos;s expiry. Both
          settlement paths, <CodeInline>HedgeFacet.settleEvent</CodeInline> and
          <CodeInline>OracleFacet.submitRate</CodeInline>, check the expiry
          timestamp before applying any payout. A strike that was
          breached mid-life but retraced does not fire.
        </P>
        <P>Two consequences worth keeping in your head.</P>
        <UL>
          <li>
            LPs know that mid-life volatility, however dramatic, doesn&apos;t
            move any capital until the event ends. Their reserves can be
            treated as static for the duration of the pool.
          </li>
          <li>
            Hedgers cannot game the oracle by racing to submit at an
            intra-day spike. The protocol simply ignores any submission
            whose timestamp is before the event&apos;s expiry.
          </li>
        </UL>
      </Section>

      <Section n="03" id="consensus" title="Multi-signer consensus">
        <P>
          The oracle facet supports up to ten registered signers, each
          of whom can call <CodeInline>submitRate(eventId, price)</CodeInline>.
          Settlement runs when three conditions align in the same
          transaction.
        </P>
        <OL>
          <li>
            The number of matching submissions meets the configured
            quorum (<CodeInline>requiredSigners</CodeInline>, at least 2).
          </li>
          <li>
            All submitted rates fall within a tolerance band
            (<CodeInline>toleranceBps</CodeInline>, up to 10%) of each other.
            No wild outlier counts.
          </li>
          <li>
            No submission is stale relative to the current block. An
            oracle that stopped talking a week ago doesn&apos;t count.
          </li>
        </OL>
        <P>
          When the quorum is met in tolerance, <CodeInline>submitRate</CodeInline>
          settles the event in the same transaction. There&apos;s no
          separate &quot;finalise&quot; step to be griefed.
        </P>
      </Section>

      <Section n="04" id="single-key" title="The single-key path (and its retirement)">
        <P>
          The Hedge facet contains a
          <CodeInline>settleEvent</CodeInline> path and the Oracle facet
          contains a consensus path. Which path is accepted depends on
          the on-chain <CodeInline>oracleV2Active</CodeInline> setting;
          this lesson does not assume which mode is currently active.
        </P>
        <P>
          The contract includes a one-way owner function,
          <CodeInline>activateOracleV2()</CodeInline>, that permanently
          disables the single-key path. Once called, only the consensus
          route settles. Its current value should be checked through the
          live governance read in the Data Room.
        </P>
        <Callout kind="warn" label="Where we are today">
          Current settlement mode is not inferred from source code or
          registered oracle addresses. Check the live governance read in
          the Data Room.
        </Callout>
      </Section>

      <Section n="05" id="stale" title="Stale submissions and tolerance">
        <P>The oracle facet keeps house on its own submissions. Two admin controls matter.</P>
        <KV>
          <KVRow term="setToleranceBps(x)">
            The band inside which rate submissions are considered
            &quot;agreeing.&quot; Capped at 10%. Wider tolerance is more
            permissive but risks smuggling a bad price through consensus.
            Tighter is safer but harder to actually reach quorum on.
          </KVRow>
          <KVRow term="clearStaleSubmissions(id)">
            Removes any submission for an event that has aged out of the
            freshness window. A defensive cleanup. Makes it impossible
            for a long-lived signature to be replayed later.
          </KVRow>
        </KV>
      </Section>
    </>
  );
}
