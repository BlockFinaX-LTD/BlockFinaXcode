/**
 * The grouped settings list — a row, and the group it lives in.
 *
 * Modelled on the pattern iOS made standard and Rift's own wallet uses: a
 * tinted glyph, a label, a line of state underneath, a chevron. It works
 * because the state is on the row. "Withdrawal Account — Not configured" is
 * answerable at a glance; a row that only says "Withdrawal Account" makes you
 * open it to learn nothing.
 *
 * So `sub` is not decoration. Every row that has a state should say what it
 * is, and rows that genuinely have none can leave it out.
 */

import { Link } from "wouter";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "default" | "success" | "warning" | "danger";

const TONES: Record<Tone, { icon: string; text?: string }> = {
  default: { icon: "bg-primary/10 text-primary" },
  success: { icon: "bg-emerald-500/10 text-emerald-600", text: "text-emerald-600" },
  warning: { icon: "bg-amber-500/10 text-amber-600", text: "text-amber-600" },
  danger: { icon: "bg-destructive/10 text-destructive", text: "text-destructive" },
};

export interface RowProps {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  sub?: string;
  href?: string;
  onClick?: () => void;
  tone?: Tone;
  /** Right-hand content in place of the chevron — a switch, a badge. */
  trailing?: React.ReactNode;
  /** Terminal actions like signing out have nowhere to chevron to. */
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
  const t = TONES[tone];

  const inner = (
    <>
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
          t.icon,
        )}
      >
        <Icon className="h-4 w-4" strokeWidth={1.9} />
      </span>

      <span className="min-w-0 flex-1 text-left">
        <span className={cn("block truncate text-[14px] font-medium", tone === "danger" && t.text)}>
          {label}
        </span>
        {sub && (
          <span className={cn("mt-0.5 block truncate text-[12px] text-muted-foreground", t.text)}>
            {sub}
          </span>
        )}
      </span>

      {trailing ?? (!noChevron && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" />)}
    </>
  );

  const shell = "flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/50 active:bg-muted";

  if (href) {
    return (
      <Link href={href} className={shell}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={shell}>
      {inner}
    </button>
  );
}

/**
 * A titled group of rows.
 *
 * The divider is inset past the glyph so the rule starts where the text does —
 * the detail that stops a list of rows reading as a stack of separate cards.
 */
export function SettingsGroup({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      {title && (
        <h2 className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
      )}
      <div className="overflow-hidden rounded-2xl border border-border bg-card [&>*+*]:border-t [&>*+*]:border-border/60">
        {children}
      </div>
    </section>
  );
}
