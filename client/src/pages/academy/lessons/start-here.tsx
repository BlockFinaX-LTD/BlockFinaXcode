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
  const beginner = CATALOG.find((l) => l.slug === 'hedging-101')!;
  const intermediate = CATALOG.find((l) => l.slug === 'how-blockfinax-works')!;
  const advanced = CATALOG.find((l) => l.slug === 'lp-risk')!;
  const total = CATALOG.reduce((n, l) => n + l.readMin, 0);

  return (
    <>
      <div className="ac-hero">
        <div className="super">The Academy · Twelve lessons</div>
        <h1>An honest handbook <em>for a novel kind of market.</em></h1>
        <p>
          A course on parametric hedging, on-chain underwriting, and the
          protocol behind BlockFinaX. No jargon smuggled past you. No form
          to fill in.
        </p>
      </div>

      <section id="paths">
        <div className="ac-cards">
          <Link href={`/learn/${beginner.slug}`} className="ac-card">
            <div className="lvl">01 · Start</div>
            <BeginnerGlyph />
            <h3>Beginner</h3>
            <p>You've heard the word "hedge" but couldn't say what one is. Begin here.</p>
            <span className="arrow">Open lesson →</span>
          </Link>
          <Link href={`/learn/${intermediate.slug}`} className="ac-card">
            <div className="lvl">02 · Interior</div>
            <IntermediateGlyph />
            <h3>Intermediate</h3>
            <p>You know options exist. You want to see how our protocol actually stitches together.</p>
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
          <em>BlockFinaX</em> is an on-chain marketplace for parametric
          foreign-exchange protection in emerging markets. People exposed
          to a weakening local currency buy cover that pays out automatically
          when a rate is breached. Liquidity providers underwrite that risk
          in exchange for premium. The protocol itself takes no market
          position — it earns fees.
        </P>
        <P>
          The Academy is here because the shape is new. It borrows vocabulary
          from options, insurance, and DeFi liquidity pools, but it isn't
          quite any of them. If a lesson leaves you with a clean mental
          model, it's done its job.
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
          <Link href={`/learn/${CATALOG[1].slug}`} className="ac-btn primary">Begin at lesson 01</Link>
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
