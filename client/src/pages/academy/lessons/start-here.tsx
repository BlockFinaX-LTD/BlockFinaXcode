import { Link } from 'wouter';
import { CATALOG, groupedCatalog } from '../catalog';
import { P } from '../lesson-blocks';

/**
 * Landing page for /learn. Deliberately different in shape from a lesson —
 * hero, three entry tracks (Beginner / Intermediate / Advanced), then the
 * full curriculum laid out as an editorial index.
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
        <h1>Protect what you've earned. <em>Or earn from protecting others.</em></h1>
        <p>
          BlockFinaX is an app where two groups of people meet: people whose
          local currency is losing value, and people with idle dollars who'd
          like to earn from helping them. This course explains how it works
          — in plain English, with no form to fill in.
        </p>
      </div>

      <section id="paths">
        <div className="ac-cards">
          <Link href={`/learn/${beginner.slug}`} className="ac-card">
            <div className="lvl">01 · Start</div>
            <BeginnerGlyph />
            <h3>Beginner</h3>
            <p>You want to know what BlockFinaX is and how it works. Start with the product overview.</p>
            <span className="arrow">Open lesson →</span>
          </Link>
          <Link href={`/learn/${intermediate.slug}`} className="ac-card">
            <div className="lvl">02 · Interior</div>
            <IntermediateGlyph />
            <h3>Intermediate</h3>
            <p>You've seen how the product works. Now understand the theory behind it — what hedging really is, and how options price it.</p>
            <span className="arrow">Open lesson →</span>
          </Link>
          <Link href={`/learn/${advanced.slug}`} className="ac-card">
            <div className="lvl">03 · Depth</div>
            <AdvancedGlyph />
            <h3>Advanced</h3>
            <p>You underwrite risk for a living. You want the numbers, the edge cases, and the ceilings.</p>
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
          with it — and they usually can't do much about it.
        </P>
        <P>
          They come here to <em>buy cover</em>. They pay a small fee up
          front, and if the dollar gets sharply more expensive by a date
          they choose, they get an automatic payout that offsets the damage.
          If nothing bad happens, the fee is what it cost. Like a mobile
          data bundle for currency risk.
        </P>
        <P>
          The second group are people with dollars sitting still — in a
          wallet, an exchange, a lending app earning a few percent. They
          come here to <em>put those dollars to work</em>. They add them to
          a pool that backs the cover the first group buys, and they earn a
          share of every fee that flows in. In exchange, if a currency
          actually falls hard, they help pay the covered users back.
        </P>
        <P>
          BlockFinaX matches these two groups up on-chain, keeps a small
          slice of the fees for running the system, and settles everything
          automatically when the cover expires. Nobody has to trust anyone
          personally — the pool always holds enough dollars to pay every
          buyer's worst case, and the rate that decides who gets paid is
          published publicly.
        </P>
        <P>
          The lessons that follow show, in order: how the pieces fit
          together, how the fees work, and — for readers who want the
          foundations — the classical hedging and options theory the whole
          thing is built on.
        </P>
      </section>

      <div id="map" className="ac-curriculum">
        {groups.map((g, gi) => (
          <div key={g.name}>
            <h4>{String(gi + 1).padStart(2, '0')} · {g.name}</h4>
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
        <h3>The whole course, cover to cover.</h3>
        <p>About {Math.round(total / 5) * 5} minutes end-to-end. You can stop anywhere and pick up later — your position is preserved by URL.</p>
        <div className="actions">
          <Link href={`/learn/${CATALOG[1].slug}`} className="ac-btn primary">Open lesson 02</Link>
          <Link href="/learn/cheatsheet" className="ac-btn ghost">Jump to the cheatsheet</Link>
        </div>
      </div>
    </>
  );
}

/* ─────────── Small track glyphs (hand-authored SVGs) ─────────── */

function BeginnerGlyph() {
  return (
    <svg viewBox="0 0 220 100" aria-hidden="true">
      <line x1="10" y1="80" x2="210" y2="80" stroke="var(--ac-hair-3)" strokeWidth="1" />
      <path d="M 10 80 Q 60 78 110 60 T 210 20" stroke="var(--ac-accent)" strokeWidth="1.5" fill="none" />
      <circle cx="10" cy="80" r="3" fill="var(--ac-accent)" />
      <circle cx="210" cy="20" r="3" fill="var(--ac-accent)" />
      <text x="10" y="96" fontFamily="var(--ac-mono)" fontSize="9" fill="var(--ac-tx-4)">FIRST STEP</text>
    </svg>
  );
}
function IntermediateGlyph() {
  return (
    <svg viewBox="0 0 220 100" aria-hidden="true">
      <circle cx="50" cy="50" r="22" stroke="var(--ac-hair-3)" fill="none" />
      <circle cx="110" cy="50" r="22" stroke="var(--ac-cyan)" fill="none" />
      <circle cx="170" cy="50" r="22" stroke="var(--ac-accent)" fill="none" />
      <line x1="72" y1="50" x2="88" y2="50" stroke="var(--ac-hair-3)" />
      <line x1="132" y1="50" x2="148" y2="50" stroke="var(--ac-hair-3)" />
    </svg>
  );
}
function AdvancedGlyph() {
  return (
    <svg viewBox="0 0 220 100" aria-hidden="true">
      <line x1="20" y1="80" x2="200" y2="80" stroke="var(--ac-hair-3)" />
      <line x1="20" y1="20" x2="20" y2="80" stroke="var(--ac-hair-3)" />
      <polyline points="20,70 45,58 70,66 95,40 120,52 145,28 170,44 200,18" stroke="var(--ac-accent)" strokeWidth="1.5" fill="none" />
      <circle cx="95" cy="40" r="2.5" fill="var(--ac-accent)" />
      <circle cx="145" cy="28" r="2.5" fill="var(--ac-accent)" />
      <circle cx="200" cy="18" r="2.5" fill="var(--ac-accent)" />
    </svg>
  );
}
