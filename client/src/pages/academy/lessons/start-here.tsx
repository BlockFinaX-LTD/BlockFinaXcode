import { Link } from 'wouter';
import { CATALOG, groupedCatalog } from '../catalog';
import { InShort, P, Section, UL } from '../lesson-blocks';

/** Landing page for /learn: what BlockFinaX is, who it is for, and the two parts. */
export default function StartHere() {
  const groups = groupedCatalog();
  const minutes = (name: string) => CATALOG.filter((l) => l.group === name).reduce((n, l) => n + l.readMin, 0);
  const path = (slug: string) => (slug ? `/learn/${slug}` : '/learn');
  return (
    <>
      <div className="ac-hero">
        <div className="super">The BlockFinaX Academy · Twelve lessons</div>
        <h1>Understand currency risk, and how to protect against it.</h1>
        <p>
          Short lessons in plain language. Part 1 explains how BlockFinaX works. Part 2 explains currency risk itself,
          and is useful whether or not you ever use BlockFinaX.
        </p>
      </div>

      <InShort>
        BlockFinaX is a protocol where businesses buy protection against currency moves, and underwriters earn premiums
        for backing it. Everything is paid in USDC, and the rules are enforced in code.
      </InShort>

      <Section n="01" id="what" title="What BlockFinaX is">
        <P>
          When a business pays or earns in another currency, a move in the exchange rate can erase its profit. BlockFinaX lets
          that business set the worst case in advance, for a known cost paid once.
        </P>
        <P>
          BlockFinaX does not take the other side itself. Underwriters do: they put USDC into currency pools, earn the premiums
          businesses pay, and cover the payouts. BlockFinaX provides the infrastructure that prices, records and settles each
          contract.
        </P>
      </Section>

      <Section n="02" id="who" title="Who it is for">
        <UL>
          <li><strong>Importers and exporters</strong> with supplier invoices or customer payments in dollars.</li>
          <li><strong>Finance and treasury teams</strong> holding money in one currency and owing it in another.</li>
          <li><strong>Underwriters</strong>: funds, treasuries and individuals with USDC who want returns tied to real economic risk.</li>
        </UL>
      </Section>

      <Section n="03" id="parts" title="The two parts">
        <div className="ac-parts">
          {groups.map((g, gi) => (
            <Link key={g.name} href={path(g.items[0].slug === '' && g.items[1] ? g.items[1].slug : g.items[0].slug)} className="ac-part">
              <span className="n">PART {gi + 1} · {minutes(g.name)} MIN</span>
              <h3>{g.name.replace(/^Part \d: /, '')}</h3>
              <p>{gi === 0 ? 'How protection is bought, priced, settled and paid, and how underwriting works.' : 'What currency risk is, the instruments used to manage it, and why it is hard to hedge in emerging markets.'}</p>
              <ol>{g.items.filter((l) => l.slug !== '').map((l) => <li key={l.slug}>{l.title}</li>)}</ol>
            </Link>
          ))}
        </div>
      </Section>

      <Section n="04" id="how" title="How to use the Academy">
        <P>
          Each lesson opens with a short answer, explains it with one worked example, and ends with a next step. If you run a
          business, read Part 1 in order. If you are new to currency risk, start with Part 2 and come back. Every term is in the
          glossary.
        </P>
      </Section>
    </>
  );
}
