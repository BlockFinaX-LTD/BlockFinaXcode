/**
 * lesson-blocks.tsx. Small content atoms used by every lesson so the
 * reading grammar stays consistent.
 */
import { ReactNode } from 'react';

export function LessonTag({ children }: { children: ReactNode }) {
  return <div className="ac-lesson-tag">{children}</div>;
}

export function H1({ children }: { children: ReactNode }) {
  return <h1 className="ac-h1">{children}</h1>;
}

export function Lead({ children }: { children: ReactNode }) {
  return <p className="ac-lead">{children}</p>;
}

export function Section({ n, title, id, children }: { n: string; title: string; id: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="ac-h2" id={id}>
        <span className="num">{n}</span>
        <span>{title}</span>
      </h2>
      {children}
    </section>
  );
}

export function H3({ children }: { children: ReactNode }) {
  return <h3 className="ac-h3">{children}</h3>;
}

export function P({ children }: { children: ReactNode }) {
  return <p className="ac-p">{children}</p>;
}

export function UL({ children }: { children: ReactNode }) {
  return <ul className="ac-ul">{children}</ul>;
}

export function OL({ children }: { children: ReactNode }) {
  return <ol className="ac-ol">{children}</ol>;
}

export function Callout({
  kind = 'note',
  label,
  children,
}: {
  kind?: 'note' | 'warn' | 'risk';
  label: string;
  children: ReactNode;
}) {
  return (
    <div className={`ac-callout${kind === 'note' ? '' : ' ' + kind}`}>
      <div className="k">{label}</div>
      <p>{children}</p>
    </div>
  );
}

export function Pull({ children }: { children: ReactNode }) {
  return <div className="ac-pull">{children}</div>;
}

export function KV({ children }: { children: ReactNode }) {
  return <dl className="ac-kv">{children}</dl>;
}
export function KVRow({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="ac-kv-row">
      <dt>{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function Steps({ children }: { children: ReactNode }) {
  return <ol className="ac-steps">{children}</ol>;
}
export function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li>
      <h4>{title}</h4>
      <p>{children}</p>
    </li>
  );
}

export function Fig({ label, caption, children }: { label: string; caption: string; children: ReactNode }) {
  return (
    <figure className="ac-fig">
      {children}
      <figcaption className="ac-fig-cap">
        <b>{label}.</b>
        {caption}
      </figcaption>
    </figure>
  );
}

export function CodeInline({ children }: { children: ReactNode }) {
  return <code className="ac-code">{children}</code>;
}

/**
 * Range-payoff SVG reused across lessons. Monochrome accent, no rainbow.
 */
export function RangePayoffSVG({
  strikeLabel = 'Strike',
  capLabel = 'Cap',
  underlyingLabel = 'Spot rate at expiry',
  payoutLabel = 'Payout',
}: {
  strikeLabel?: string;
  capLabel?: string;
  underlyingLabel?: string;
  payoutLabel?: string;
}) {
  return (
    <svg viewBox="0 0 600 260" role="img" aria-label="Range payoff curve" preserveAspectRatio="xMidYMid meet">
      <text x="14" y="128" className="lbl-major" transform="rotate(-90 14 128)">{payoutLabel}</text>

      <line x1="60" y1="210" x2="580" y2="210" className="stroke-2" />
      <line x1="60" y1="40" x2="60" y2="210" className="stroke-2" />
      <line x1="60" y1="90" x2="580" y2="90" className="stroke-2" strokeDasharray="2 4" />
      <line x1="60" y1="150" x2="580" y2="150" className="stroke-2" strokeDasharray="2 4" />

      <path d="M 60 210 L 250 210 L 410 70 L 580 70 L 580 210 Z" className="accent-fill" />
      <path d="M 60 210 L 250 210 L 410 70 L 580 70" className="accent" strokeWidth="2" />

      <line x1="250" y1="70" x2="250" y2="210" className="stroke" strokeDasharray="2 4" />
      <circle cx="250" cy="210" r="4" fill="var(--ac-accent)" />
      <text x="250" y="230" textAnchor="middle">{strikeLabel}</text>

      <line x1="410" y1="70" x2="410" y2="210" className="stroke" strokeDasharray="2 4" />
      <circle cx="410" cy="70" r="4" fill="var(--ac-accent)" />
      <text x="410" y="230" textAnchor="middle">{capLabel}</text>

      <text x="155" y="206" textAnchor="middle" style={{ fill: 'var(--ac-tx-3)' }}>No payout</text>
      <text x="495" y="62" textAnchor="middle" style={{ fill: 'var(--ac-tx-3)' }}>Capped</text>

      <text x="320" y="254" className="lbl-major" textAnchor="middle">{underlyingLabel}</text>
    </svg>
  );
}

/** The two-line answer at the top of every lesson. */
export function InShort({ children }: { children: ReactNode }) {
  return (
    <div className="ac-inshort">
      <div className="k">In short</div>
      <p>{children}</p>
    </div>
  );
}

/** A worked example with real numbers: a few labelled rows and a sentence on what it means. */
export function Example({ title, rows, children }: { title: string; rows: Array<[string, ReactNode]>; children?: ReactNode }) {
  return (
    <div className="ac-example">
      <div className="ac-example-h">Worked example · {title}</div>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>
      {children && <p>{children}</p>}
    </div>
  );
}

/** A link from the idea to the product. */
export function TryIt({ label = 'Try it in the app', href = '/hedge', children }: { label?: string; href?: string; children: ReactNode }) {
  return (
    <div className="ac-tryit">
      <p>{children}</p>
      <a href={href} className="ac-btn primary">{label} <span aria-hidden="true">→</span></a>
    </div>
  );
}

/** Where the figures in a lesson come from. */
export function Sources({ items }: { items: string[] }) {
  return (
    <div className="ac-sources">
      <div className="k">Sources</div>
      <ol>{items.map((s) => <li key={s}>{s}</li>)}</ol>
    </div>
  );
}
