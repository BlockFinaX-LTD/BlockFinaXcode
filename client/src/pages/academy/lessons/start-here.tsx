import { Link } from 'wouter';
import { CATALOG, groupedCatalog } from '../catalog';
import { P } from '../lesson-blocks';

/**
 * Landing page for /learn. Hero, three entry cards, then the full
 * curriculum laid out as a simple index.
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
        <P>
          Two kinds of people show up here. The first are the ones getting
          squeezed by their currency. A Ghanaian importer whose suppliers
          invoice in dollars but who gets paid in cedi. A Nigerian
          freelancer earning in naira with school fees creeping up every
          term. A Kenyan family repaying a dollar loan in shillings. When
          the dollar gets more expensive, their lives get more expensive
          with it, and they usually can&apos;t do much about it.
        </P>
        <P>
          They come here to buy cover. They pay a small fee up front, and
          if the dollar gets sharply more expensive by a date they choose,
          they get an automatic payout that offsets the damage. If nothing
          bad happens, the fee is what it cost. Like a mobile data bundle
          for currency risk.
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
          BlockFinaX matches these two groups up on-chain, keeps a small
          slice of the fees for running the system, and settles everything
          automatically when the cover expires. Nobody has to trust anyone
          personally. The pool always holds enough dollars to pay every
          buyer&apos;s worst case, and the rate that decides who gets paid is
          published publicly.
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
