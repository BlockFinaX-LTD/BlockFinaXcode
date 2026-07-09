import { Callout, Fig, H1, KV, KVRow, Lead, LessonTag, OL, P, Section, UL } from '../lesson-blocks';

export default function Hedging101() {
  return (
    <>
      <LessonTag>Lesson 06 · Fundamentals</LessonTag>
      <H1>Hedging, from first principles</H1>
      <Lead>
        A hedge is not a bet. It&apos;s a purchase of certainty. Once you see
        it that way, every hedging decision reduces to a single question.
        What is a small amount of certainty worth to you right now?
      </Lead>

      <Section n="01" id="the-question" title="The question every FX-exposed business asks">
        <P>
          Any business whose costs or revenue crosses a currency border
          eventually asks the same question. What happens if the rate
          moves against me? Three concrete versions of that question.
        </P>
        <KV>
          <KVRow term="A Kenyan coffee exporter">
            Ships to Germany. Gets paid in dollars 60 days after
            shipping. Pays local labour, transport, and packaging in
            shillings today. If the shilling strengthens in those 60
            days, that dollar payment turns into fewer shillings than
            the exporter budgeted for.
          </KVRow>
          <KVRow term="A Nigerian electronics importer">
            Orders equipment from Shenzhen. The supplier invoices in
            dollars, due 90 days later. Local customers pay in naira, at
            a price already quoted. If the naira weakens over those 90
            days, the dollar bill takes more naira to settle than the
            resale ever brought in.
          </KVRow>
          <KVRow term="A Ghanaian remittance company">
            Holds customer float in cedi between corridor legs. Their
            treasury holds dollars against future payouts. If the cedi
            devalues sharply overnight, their treasury is fine, but
            their local liabilities just cost more to settle.
          </KVRow>
          <KVRow term="A DAO treasury with USDC">
            Runs grants in local currency across three markets. Their
            reserves are dollar stablecoins. When a grantee&apos;s local
            currency weakens between commitment and disbursement, the
            same USDC now goes further than promised. When it
            strengthens, less.
          </KVRow>
        </KV>
        <P>
          A hedge doesn&apos;t tell any of them which way the rate will go.
          It doesn&apos;t lock the rate either, in most cases. It answers a
          different question. If the rate moves against me by more than
          X, how much of the damage do I refuse to absorb?
        </P>
        <Callout label="The insight">
          Everything else about hedging (instruments, strikes, expiries,
          premiums) is a way of writing that answer down in a form a
          counterparty can price.
        </Callout>
      </Section>

      <Section n="02" id="the-tools" title="The three instruments">
        <P>
          There are only three shapes of hedge in common use. Every
          product you&apos;ll see in the wild is a variant, combination, or
          wrapper on one of them.
        </P>
        <KV>
          <KVRow term="Forward or future">
            You agree today to exchange at a fixed rate on a future
            date. No optionality. You&apos;re committed either way. Cheapest
            to enter. Harshest if the market goes your way afterwards.
          </KVRow>
          <KVRow term="Option (call or put)">
            You pay a premium for the right, but not the obligation, to
            exchange at a fixed rate. If the market goes your way, you
            walk away. If it goes against you, you exercise. Expensive
            up front. Kinder on the tail.
          </KVRow>
          <KVRow term="Parametric cover">
            A payout tied to a measured value: an exchange rate, a
            rainfall total, an index. No claims process. When the
            reading crosses a threshold, the payout fires. This is what
            BlockFinaX sells.
          </KVRow>
        </KV>
        <P>
          A parametric cover is the option&apos;s newer cousin. Same
          optionality, but the payout is settled by observation, not by
          tendering the underlying asset. That matters when the
          underlying is illiquid, impossible to hold, or (as with an FX
          rate) not really an &quot;asset&quot; at all.
        </P>
      </Section>

      <Section n="03" id="the-cost" title="Why hedging always costs something">
        <P>
          Every hedge is priced by someone who has to be willing to
          absorb the risk you&apos;re offloading. The premium is the
          counterparty&apos;s expected loss plus their required return on the
          capital they&apos;re reserving to pay you if the tail actually
          hits.
        </P>
        <P>
          Cheap hedges are usually cheap because they don&apos;t pay in the
          scenarios you actually fear. Think of &quot;protection&quot; that stops
          paying out at exactly the moves that would ruin you. A well-
          shaped hedge is the one whose payoff mirrors your exposure,
          not the one with the lowest sticker price.
        </P>
      </Section>

      <Section n="04" id="basis-risk" title="The gap between hedge and exposure">
        <P>
          The rate your hedge pays out on is almost never the rate you
          actually convert at. That gap, called basis risk, is the
          quiet source of most hedging disappointment.
        </P>
        <UL>
          <li>
            Your bank quotes a retail rate. The hedge references a
            wholesale mid-market rate. Basis: the retail spread.
          </li>
          <li>
            The hedge settles at 4pm London. You convert at 9am Accra
            the next day. Basis: the overnight move.
          </li>
          <li>
            The hedge pays USDC. You spend cedi. Basis: the stablecoin&apos;s
            local premium or discount.
          </li>
        </UL>
        <P>
          A good hedge sizes for basis explicitly. Buy a little more
          cover than your notional so that after the frictions the net
          position still lands where you wanted it.
        </P>
      </Section>

      <Section n="05" id="when-not" title="When not to hedge">
        <P>Not every exposure deserves a hedge. Three tests, in order.</P>
        <OL>
          <li>
            <strong>Would a small move ruin you?</strong> If a 5%
            adverse move is inconvenient but survivable, the premium is
            probably money better spent elsewhere.
          </li>
          <li>
            <strong>Is your exposure natural or accidental?</strong> An
            importer&apos;s dollar exposure is a cost of doing business, and
            worth hedging. A speculator&apos;s long dollar position is an
            active bet, and hedging it just closes the bet.
          </li>
          <li>
            <strong>Can you pass the cost through?</strong> If you can
            raise prices to absorb the move, do that. It&apos;s cheaper than
            the premium and it doesn&apos;t leave any tail unhedged.
          </li>
        </OL>
        <Callout kind="warn" label="A working rule">
          Hedge the exposure you cannot survive and cannot pass through.
          Live with the rest.
        </Callout>
      </Section>

      <Fig label="Fig. 06·1" caption="Three canonical hedge shapes overlaid. The forward locks you in. The option lets you walk. The parametric cover pays out when a reading is breached.">
        <svg viewBox="0 0 600 240" preserveAspectRatio="xMidYMid meet">
          <line x1="60" y1="180" x2="580" y2="180" className="stroke-2" />
          <line x1="60" y1="30" x2="60" y2="180" className="stroke-2" />

          <line x1="60" y1="120" x2="580" y2="120" className="mint" strokeWidth="1.4" strokeDasharray="4 3" />
          <path d="M 60 180 L 320 180 L 320 90 L 580 90" className="stroke" strokeWidth="1.4" strokeDasharray="2 3" />
          <path d="M 60 180 L 320 180 L 580 40" className="accent" strokeWidth="1.8" />

          <line x1="320" y1="30" x2="320" y2="180" className="stroke" strokeDasharray="2 4" />

          <circle cx="70" cy="55" r="3" fill="var(--ac-accent)" />
          <text x="80" y="59">Option</text>
          <circle cx="70" cy="80" r="3" fill="var(--ac-tx-3)" />
          <text x="80" y="84">Parametric</text>
          <circle cx="70" cy="105" r="3" fill="var(--ac-tx-3)" />
          <text x="80" y="109">Forward</text>

          <text x="320" y="200" textAnchor="middle">Trigger</text>
          <text x="320" y="222" className="lbl-major" textAnchor="middle">Underlying reading</text>
        </svg>
      </Fig>
    </>
  );
}
