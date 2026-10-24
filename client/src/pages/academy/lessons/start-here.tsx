import { Link } from 'wouter';
import { CATALOG, groupedCatalog } from '../catalog';
import { Callout, P, Pull, Section, UL } from '../lesson-blocks';

/**
 * Landing page for /learn: who BlockFinaX is, then who the Academy is for,
 * then the curriculum.
 *
 * The company introduction lives here rather than in a lesson of its own.
 * It was briefly separate, which meant a visitor arriving from the website
 * read two consecutive pages of introduction before reaching anything about
 * the product. One page answers "who are you" and "what will I learn" together,
 * which is the order a first-time reader actually asks them in.
 */
export default function StartHere() {
  const groups = groupedCatalog();
  const beginner = CATALOG.find((l) => l.slug === 'how-blockfinax-works')!;
  const intermediate = CATALOG.find((l) => l.slug === 'hedging-101')!;
  const advanced = CATALOG.find((l) => l.slug === 'lp-risk')!;
  const total = CATALOG.reduce((n, l) => n + l.readMin, 0);

  return (
    <>
      <div className="ac-hero">
        <div className="super">The Academy · Twelve lessons</div>
        <h1>Protect what you&apos;ve earned. Or earn from protecting others.</h1>
        <p>
          BlockFinaX is an app where two groups of people meet. People
          whose local currency is losing value against the dollar, and
          people with idle dollars who want to earn from helping them.
          This course explains how it works in plain English.
        </p>
      </div>

      <Section n="01" id="about" title="About BlockFinaX">
        <P>
          BlockFinaX Ltd is a Ghana-incorporated company building a new market
          for programmable FX protection. We bring together businesses that need
          protection from currency swings and underwriters willing to price and
          carry that risk.
        </P>
        <P>
          We build the market itself: the pricing, the distribution and the
          settlement that let protection be bought and sold. We do not carry the
          risk ourselves. Underwriters price it and stand behind it, and that
          separation is deliberate.
        </P>
      </Section>

      <Section n="02" id="gap" title="Why hedging has been out of reach">
        <P>
          For many small businesses, hedging has been out of reach. Not because
          the risk is unusual or hard to understand, but because of how the
          market is built.
        </P>
        <UL>
          <li>The products are too complex for a business with no treasury
            function.</li>
          <li>The ticket sizes are too small to interest the institutions that
            quote them.</li>
          <li>The market is built for larger institutions, and the paperwork
            assumes you are one.</li>
        </UL>
        <P>
          So the exposure does not disappear. It stays where it lands, with the
          business least able to absorb it. Most price a guess into their goods
          and carry the difference themselves.
        </P>
        <Callout label="The point">
          Nothing about this risk makes it uninsurable. What made it unreachable
          was distribution and cost, and those are engineering problems.
        </Callout>
      </Section>

      <Section n="03" id="goal" title="Protection as accessible as payment">
        <P>
          BlockFinaX is designed to change that. We give smaller businesses
          access to hedging solutions they have traditionally been excluded
          from, while giving underwriters a way to participate in
          short-duration, structured FX exposure.
        </P>
        <P>
          Our goal is to make protection as accessible as payment. As payments
          become more programmable, protection should move closer to the trade
          itself. That means businesses can protect what they earn before value
          is lost to currency movement, and underwriters can participate in a
          market that is transparent, controlled, and built for scale.
        </P>
        <Pull>
          The future of trade should not be just about moving money faster. It
          should also be about preserving value as it moves.
        </Pull>
      </Section>

      <section id="paths">
        <div className="ac-cards">
          <Link href={`/learn/${beginner.slug}`} className="ac-card">
            <div className="lvl">Beginner</div>
            <BeginnerGlyph />
            <h3>Start with the product</h3>
            <p>What BlockFinaX does, who uses it, and the lifecycle of a pool.</p>
            <span className="arrow">Open lesson →</span>
          </Link>
          <Link href={`/learn/${intermediate.slug}`} className="ac-card">
            <div className="lvl">Intermediate</div>
            <IntermediateGlyph />
            <h3>Understand the theory</h3>
            <p>What hedging really is, and how options price the risk of a currency move.</p>
            <span className="arrow">Open lesson →</span>
          </Link>
          <Link href={`/learn/${advanced.slug}`} className="ac-card">
            <div className="lvl">Advanced</div>
            <AdvancedGlyph />
            <h3>Sizing for LPs</h3>
            <p>Worst-case reservation, loss share, and how to think about capital across pools.</p>
            <span className="arrow">Open lesson →</span>
          </Link>
        </div>
      </section>

      <section id="why">
        <h2 className="ac-h2" id="who">
          <span className="num">04</span>
          <span>Who shows up here</span>
        </h2>
        <P>
          In practice that means two kinds of people. The first are the ones
          getting squeezed by their currency. A Ghanaian importer whose suppliers
          invoice in dollars but who gets paid in cedi. A Nigerian
          freelancer earning in naira with school fees creeping up every
          term. A Kenyan family repaying a dollar loan in shillings. When
          the dollar gets more expensive, their lives get more expensive
          with it, and they usually can&apos;t do much about it.
        </P>
        <P>
          They may use the app to buy bounded cover. A confirmed purchase
          transaction is required. At expiry, an oracle settlement
          transaction determines whether the contract records a payout;
          a winning hedger must then claim it. Oracle, network and contract
          failures can delay or prevent payment.
        </P>
        <P>
          The second group are people with dollars sitting still, in a
          wallet, an exchange, a lending app earning a few percent. They
          come here to put those dollars to work. They add them to a pool
          that backs the cover the first group buys, and they earn a share
          of every fee that flows in. In exchange, if a currency actually
          falls hard, they help pay the covered users back.
        </P>
        <P>
          The contracts connect liquidity providers and hedgers, record
          fees and reserve payouts according to their code. This does not
          remove smart contract, oracle, liquidity or governance risk.
          The current settlement mode and governance controls should be
          checked on chain before relying on a market or payout.
        </P>
        <P>
          The lessons that follow show, in order, how the pieces fit
          together, how the fees work, and for readers who want the
          foundations, the classical hedging and options theory the whole
          thing is built on.
        </P>
      </section>

      <div id="map" className="ac-curriculum">
        {groups.map((g) => (
          <div key={g.name}>
            <h4>{g.name}</h4>
            <ul className="ac-curriculum-list">
              {g.items.map((l) => {
                const idx = CATALOG.indexOf(l);
                if (!l.slug) return null;
                return (
                  <li key={l.slug}>
                    <Link href={`/learn/${l.slug}`}>
                      <span className="n">{String(idx + 1).padStart(2, '0')}</span>
                      <span className="t">
                        {l.title}
                        <small>{l.blurb}</small>
                      </span>
                      <span className="m">{l.readMin} min</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="ac-cta">
        <div className="k">Full read</div>
        <h3>The whole course, cover to cover</h3>
        <p>About {Math.round(total / 5) * 5} minutes end to end. You can stop anywhere and pick up later. Your position is preserved by URL.</p>
        <div className="actions">
          <Link href={`/learn/${CATALOG[1].slug}`} className="ac-btn primary">Open lesson 02</Link>
          <Link href="/learn/cheatsheet" className="ac-btn ghost">Jump to the cheatsheet</Link>
        </div>
      </div>
    </>
  );
}

/* Small track glyphs. Monochrome, hairline. */

function BeginnerGlyph() {
  return (
    <svg viewBox="0 0 220 80" aria-hidden="true">
      <line x1="10" y1="60" x2="210" y2="60" stroke="var(--ac-hair-3)" strokeWidth="1" />
      <path d="M 10 60 Q 60 58 110 44 T 210 12" stroke="var(--ac-accent)" strokeWidth="1.5" fill="none" />
      <circle cx="10" cy="60" r="3" fill="var(--ac-accent)" />
      <circle cx="210" cy="12" r="3" fill="var(--ac-accent)" />
    </svg>
  );
}
function IntermediateGlyph() {
  return (
    <svg viewBox="0 0 220 80" aria-hidden="true">
      <circle cx="50" cy="40" r="18" stroke="var(--ac-hair-3)" fill="none" />
      <circle cx="110" cy="40" r="18" stroke="var(--ac-hair-3)" fill="none" />
      <circle cx="170" cy="40" r="18" stroke="var(--ac-accent)" fill="none" />
    </svg>
  );
}
function AdvancedGlyph() {
  return (
    <svg viewBox="0 0 220 80" aria-hidden="true">
      <line x1="20" y1="60" x2="200" y2="60" stroke="var(--ac-hair-3)" />
      <line x1="20" y1="12" x2="20" y2="60" stroke="var(--ac-hair-3)" />
      <polyline points="20,54 45,44 70,50 95,30 120,40 145,22 170,34 200,14" stroke="var(--ac-accent)" strokeWidth="1.5" fill="none" />
      <circle cx="200" cy="14" r="2.5" fill="var(--ac-accent)" />
    </svg>
  );
}
