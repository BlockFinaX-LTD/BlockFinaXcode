import { Callout, Fig, H1, H3, KV, KVRow, Lead, LessonTag, OL, P, Pull, Section, UL } from '../lesson-blocks';

export default function Hedging101() {
  return (
    <>
      <LessonTag>Lesson 02 · Fundamentals</LessonTag>
      <H1>Hedging, <em>from first principles.</em></H1>
      <Lead>
        A hedge is not a bet, and it's not free. It's a purchase of certainty.
        Once you see it that way, every hedging decision reduces to a single
        question — what is a small amount of certainty worth to you right now?
      </Lead>

      <Section n="01" id="the-question" title="The question a hedge answers">
        <P>
          Suppose you sell fruit in Accra and pay your suppliers in dollars.
          You take orders today in Ghanaian cedi; the shipment arrives in 60
          days; you settle the invoice then. What you actually don't know
          about this trade isn't the price of fruit — it's the exchange rate
          on day 60.
        </P>
        <P>
          A hedge doesn't tell you what that rate will be. It doesn't lock
          the rate either, in most cases. It answers a different question:
          <em> if the rate moves against me by more than X, how much of the
          damage do I refuse to absorb?</em>
        </P>
        <Callout label="The insight">
          Everything else about hedging — instruments, strikes, expiries,
          premiums — is a way of writing down the answer to that one
          question in a form a counterparty can price.
        </Callout>
      </Section>

      <Section n="02" id="the-tools" title="The three instruments">
        <P>
          There are only three shapes of hedge in common use. Every product
          you'll see in the wild is a variant, combination, or wrapper on
          one of them.
        </P>
        <KV>
          <KVRow term="Forward / Future">
            You agree today to exchange at a fixed rate on a future date.
            No optionality — you're committed either way. Cheapest to enter,
            harshest if the market goes your way afterwards.
          </KVRow>
          <KVRow term="Option (call / put)">
            You pay a premium for the <em>right, but not the obligation</em>
            to exchange at a fixed rate. If the market goes your way, you
            walk away; if it goes against you, you exercise. Expensive up
            front, kinder on the tail.
          </KVRow>
          <KVRow term="Parametric cover">
            A payout tied to a measured value — an exchange rate, a rainfall
            total, an index. No claims process. When the reading crosses a
            threshold, the payout fires. This is what BlockFinaX sells.
          </KVRow>
        </KV>
        <P>
          A parametric cover is the option's newer cousin: same optionality,
          but the payout is settled by <em>observation</em>, not by tendering
          the underlying asset. That matters when the underlying is illiquid,
          impossible to hold, or — as with an FX rate — not really an "asset"
          at all.
        </P>
      </Section>

      <Section n="03" id="the-cost" title="Why hedging always costs something">
        <P>
          Every hedge is priced by someone who has to be willing to absorb
          the risk you're offloading. That premium is the counterparty's
          expected loss plus their required return on the capital they're
          reserving to pay you if the tail actually hits.
        </P>
        <Pull>
          <em>A hedge that costs nothing has a hidden clause. Find it before you sign.</em>
        </Pull>
        <P>
          Cheap hedges are usually cheap because they don't pay in the
          scenarios you actually fear — think of "protection" that stops
          paying out at exactly the moves that would ruin you. A well-shaped
          hedge is the one whose payoff mirrors your exposure, not the one
          with the lowest sticker price.
        </P>
      </Section>

      <Section n="04" id="basis-risk" title="The gap between hedge and exposure">
        <P>
          The rate your hedge pays out on is almost never the rate you
          actually convert at. That gap — <em>basis risk</em> — is the
          quiet source of most hedging disappointment.
        </P>
        <UL>
          <li>
            Your bank quotes you a retail rate; the hedge references
            a wholesale mid-market rate. Basis: the retail spread.
          </li>
          <li>
            The hedge settles at 4pm London; you convert at 9am Accra
            the next day. Basis: the overnight move.
          </li>
          <li>
            The hedge pays USDC; you spend cedi. Basis: the stablecoin's
            local premium or discount.
          </li>
        </UL>
        <P>
          A good hedge sizes for basis explicitly — buy a little more cover
          than your notional, so that after the frictions the net position
          still lands where you wanted it.
        </P>
      </Section>

      <Section n="05" id="when-not" title="When not to hedge">
        <P>
          Not every exposure deserves a hedge. Three tests, in order:
        </P>
        <OL>
          <li>
            <strong>Would a small move ruin you?</strong> If a 5% adverse
            move is inconvenient but survivable, the premium is probably
            money better spent elsewhere.
          </li>
          <li>
            <strong>Is your exposure natural or accidental?</strong> An
            importer's dollar exposure is a cost of doing business — worth
            hedging. A speculator's long dollar position is an active bet,
            and hedging it just closes the bet.
          </li>
          <li>
            <strong>Can you pass the cost through?</strong> If you can raise
            prices to absorb the move, do that. It's cheaper than the
            premium and it doesn't leave any tail unhedged.
          </li>
        </OL>
        <Callout label="A working rule" kind="warn">
          Hedge the exposure you cannot survive and cannot pass through.
          Live with the rest.
        </Callout>
      </Section>

      <Fig label="Fig. 02·1" caption="Three canonical hedge shapes overlaid. The forward locks you in; the option lets you walk; the parametric cover pays out when a reading is breached.">
        <svg viewBox="0 0 600 220" role="img" aria-label="Three hedge shapes">
          <line x1="60" y1="150" x2="560" y2="150" className="stroke-2" />
          <line x1="60" y1="30" x2="60" y2="150" className="stroke-2" />
          {/* Forward — flat line */}
          <line x1="60" y1="90" x2="560" y2="90" className="mint" strokeWidth="1.5" />
          <text x="480" y="82" style={{ fill: 'var(--ac-mint)' }}>Forward</text>
          {/* Option — hockey stick */}
          <path d="M 60 150 L 300 150 L 560 30" className="accent" strokeWidth="1.5" />
          <text x="470" y="45" style={{ fill: 'var(--ac-accent)' }}>Option</text>
          {/* Parametric — step */}
          <path d="M 60 150 L 300 150 L 300 60 L 560 60" className="cyan" strokeWidth="1.5" strokeDasharray="4 3" />
          <text x="440" y="55" style={{ fill: 'var(--ac-cyan)' }}>Parametric</text>
          <line x1="300" y1="60" x2="300" y2="150" className="stroke" strokeDasharray="2 3" />
          <text x="290" y="170">Trigger</text>
          <text x="270" y="200" className="lbl-major">Underlying reading</text>
        </svg>
      </Fig>

      <Callout label="Where this leaves us">
        A hedge is a purchase of a specific shape — a payoff curve — sized
        against a specific exposure. Every remaining lesson in this section
        makes that shape more concrete.
      </Callout>
    </>
  );
}
