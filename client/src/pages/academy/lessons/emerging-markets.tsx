import { Callout, Fig, H1, KV, KVRow, Lead, LessonTag, P, Pull, Section, UL } from '../lesson-blocks';

export default function EmergingMarkets() {
  return (
    <>
      <LessonTag>Lesson 10 · Deep dives</LessonTag>
      <H1>Why <em>emerging-market FX.</em></H1>
      <Lead>
        A protocol is a tool. This lesson steps back from the tool to the
        problem — why a Ghanaian importer or Kenyan freelancer or Nigerian
        SME might want an on-chain parametric hedge in the first place,
        and why the existing tools mostly haven't served them.
      </Lead>

      <Section n="01" id="cost" title="What devaluation costs">
        <P>
          Between 2020 and 2024, the Ghanaian cedi lost more than half its
          value against the dollar. The Nigerian naira lost more, in
          discontinuous jumps. The Kenyan shilling drifted, then broke.
          These are three of the currencies BlockFinaX supports; the
          pattern is not unusual, it is the emerging-market baseline.
        </P>
        <P>
          The people who bear the cost are the ones with dollar-denominated
          bills and local-currency income:
        </P>
        <KV>
          <KVRow term="Importers">
            Pay in USD for shipments arriving in 30–90 days, sell in local
            currency to local buyers. A 20% devaluation in that window
            eats their gross margin.
          </KVRow>
          <KVRow term="Local employees of remote-first companies">
            Paid in USDC or USD, spend in local currency. A stable dollar
            income looks worse and worse against local rent and school fees
            when the exchange rate compresses their real budget.
          </KVRow>
          <KVRow term="Small businesses with USD-denominated debt">
            Fine at 6 cedi. Broken at 15.
          </KVRow>
        </KV>
      </Section>

      <Section n="02" id="existing" title="What tools already exist (and don't)">
        <P>
          Formal FX hedges are technically available in these markets. In
          practice they are:
        </P>
        <UL>
          <li>
            <strong>Restricted.</strong> Currency controls limit who can
            trade a forward and for how much.
          </li>
          <li>
            <strong>Expensive.</strong> Bid–ask on OTC forwards for
            African crosses can eat the whole point of the hedge.
          </li>
          <li>
            <strong>Slow.</strong> Retail flow through a bank branch is
            weekly at best, not real-time.
          </li>
          <li>
            <strong>Opaque.</strong> The rate you settle at can be several
            percent off the mid-market rate you saw quoted.
          </li>
        </UL>
        <Pull>
          <em>The hedges you can actually buy are shaped for the institutions who wrote them, not for the exposures people actually have.</em>
        </Pull>
      </Section>

      <Section n="03" id="gap" title="The gap the protocol fills">
        <P>
          A parametric, on-chain hedge is not a like-for-like replacement
          for an OTC forward. It settles on an oracle-reported reference
          rate, not on delivered currency. It has a bounded payout range,
          not unlimited coverage. It uses a stablecoin as the settlement
          medium, not local-currency delivery.
        </P>
        <P>
          But in the specific shape it takes, it does several things the
          existing options don't:
        </P>
        <UL>
          <li>
            <strong>Permissionless.</strong> Anyone with a stablecoin
            wallet can buy cover on a supported pair.
          </li>
          <li>
            <strong>Small-notional friendly.</strong> A pool underwrites
            $50 of cover as easily as $50,000. There is no minimum ticket.
          </li>
          <li>
            <strong>Transparent price.</strong> The pricing engine's quote
            is on-chain, and the rate the settlement uses is on-chain.
          </li>
          <li>
            <strong>Same-day.</strong> Buy, settle, and claim in the same
            block. No branch queues, no wire delays.
          </li>
        </UL>
      </Section>

      <Section n="04" id="assumptions" title="Assumptions we're making">
        <P>
          Being honest about what the protocol assumes:
        </P>
        <KV>
          <KVRow term="Users have stablecoin access">
            Buying protection requires USDC or USDT. In most of our target
            markets that's a solved problem (P2P onramps, local exchanges),
            but it isn't zero-friction.
          </KVRow>
          <KVRow term="An oracle can be trusted">
            Parametric settlement is only as good as the rate the oracle
            publishes. Multi-signer consensus with a tolerance band is
            our answer; it is not a perfect answer.
          </KVRow>
          <KVRow term="Basis risk is acceptable">
            The rate you get quoted at the bureau isn't the rate the
            oracle uses. Hedgers should size their cover slightly larger
            than their raw exposure to absorb basis.
          </KVRow>
          <KVRow term="Local law permits it">
            Some jurisdictions restrict derivative-shaped payoffs; some
            restrict crypto instruments; some restrict both. Local
            regulatory reality varies. The protocol is a tool, not a
            legal opinion.
          </KVRow>
        </KV>
        <Callout label="Framing" kind="warn">
          The claim isn't "this is the best hedge for everyone in every
          emerging market." It's "for a large class of small-to-mid
          exposures that couldn't previously access any hedge at all, this
          is the first serviceable one."
        </Callout>
      </Section>
    </>
  );
}
