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
    <svg viewBox="0 0 600 240" role="img" aria-label="Range payoff curve" preserveAspectRatio="xMidYMid meet">
      <line x1="60" y1="200" x2="560" y2="200" className="stroke-2" />
      <line x1="60" y1="30" x2="60" y2="200" className="stroke-2" />
      <line x1="60" y1="80" x2="560" y2="80" className="stroke-2" strokeDasharray="2 4" />
      <line x1="60" y1="140" x2="560" y2="140" className="stroke-2" strokeDasharray="2 4" />

      <path d="M 60 200 L 240 200 L 400 60 L 560 60 L 560 200 Z" className="accent-fill" />
      <path d="M 60 200 L 240 200 L 400 60 L 560 60" className="accent" strokeWidth="2" />

      <line x1="240" y1="60" x2="240" y2="200" className="stroke" strokeDasharray="2 4" />
      <circle cx="240" cy="200" r="4" fill="var(--ac-accent)" />
      <text x="248" y="216">{strikeLabel}</text>

      <line x1="400" y1="60" x2="400" y2="200" className="stroke" strokeDasharray="2 4" />
      <circle cx="400" cy="60" r="4" fill="var(--ac-accent)" />
      <text x="408" y="216">{capLabel}</text>

      <text x="290" y="234" className="lbl-major">{underlyingLabel}</text>
      <text x="14" y="118" className="lbl-major" transform="rotate(-90 14 118)">{payoutLabel}</text>

      <text x="90" y="196">No payout</text>
      <text x="425" y="52">Capped</text>
    </svg>
  );
}
