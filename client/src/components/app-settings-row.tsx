/**
 * Settings tiles.
 *
 * Deliberately not the app's .list/.row pattern. That is a bordered container
 * with hairline dividers, which reads as a table — correct for a rates feed or
 * an activity log, where every row is the same kind of thing and the eye scans
 * a column. A settings screen is a set of unrelated destinations, and ruling
 * them together implies a relationship between them that does not exist.
 *
 * Separate tiles with air between them say what is true: these are separate
 * places. Styling lives in app-ui.css against the app's own tokens rather than
 * Tailwind's, so it inherits the same near-black surfaces and blue accent as
 * the rest of the product instead of approximating them.
 */

import { Link } from "wouter";
import { ChevronRight, type LucideIcon } from "lucide-react";

type Tone = "default" | "ok" | "warn" | "bad";

export interface RowProps {
  /**
   * lucide's own type. A narrower hand-written signature looks tidier and
   * rejects every real icon — they are ForwardRefExoticComponent, carrying a
   * ref that signature does not admit.
   */
  icon: LucideIcon;
  label: string;
  sub?: string;
  href?: string;
  onClick?: () => void;
  tone?: Tone;
  trailing?: React.ReactNode;
  /** Terminal actions like signing out have nowhere to point to. */
  noChevron?: boolean;
}

export function SettingsRow({
  icon: Icon,
  label,
  sub,
  href,
  onClick,
  tone = "default",
  trailing,
  noChevron,
}: RowProps) {
  const t = tone === "default" ? "" : ` ${tone}`;

  const inner = (
    <>
      <span className={`st-ico${t}`}>
        <Icon strokeWidth={1.9} />
      </span>
      {/* display:block is also set in app-ui.css. Repeated inline because a
          span is inline by default, and if that stylesheet is stale or slow
          the label and its subtitle render on the same line and run together
          — which is a broken-looking screen caused by a cache, and not worth
          risking twice. */}
      <span className="st-body" style={{ display: "block" }}>
        <span className={`st-t${tone === "bad" ? " bad" : ""}`} style={{ display: "block" }}>
          {label}
        </span>
        {sub && (
          <span
            className={`st-s${tone === "ok" ? " ok" : tone === "warn" ? " warn" : ""}`}
            style={{ display: "block" }}
          >
            {sub}
          </span>
        )}
      </span>
      {trailing ?? (!noChevron && (
        <span className="st-go">
          <ChevronRight />
        </span>
      ))}
    </>
  );

  if (href) {
    return (
      <Link href={href} className="st-tile">
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className="st-tile">
      {inner}
    </button>
  );
}

export function SettingsGroup({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="st-group">
      {title && <h2 className="st-label">{title}</h2>}
      {children}
    </section>
  );
}
