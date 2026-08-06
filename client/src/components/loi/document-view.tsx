/**
 * Document renderer.
 *
 * Renders the template engine's Markdown subset as a page that reads like a
 * printed legal document. Shared by the admin review screen and the recipient
 * portal so both sides see byte-identical text — a counterparty noticing a
 * discrepancy between what they read and what they signed would be fatal to
 * the whole product.
 *
 * Clause blocks are individually addressable so comments and suggestions can
 * anchor to a specific clause rather than floating free.
 */

import { useMemo } from "react";
import { cn } from "@/lib/utils";

export interface Block {
  key: string;
  kind: "h1" | "h2" | "h3" | "p" | "li";
  text: string;
  /** Heading text this block sits under. Used as the comment anchor. */
  section: string;
}

/** Splits the document into addressable blocks. */
export function parseBlocks(markdown: string): Block[] {
  const out: Block[] = [];
  let section = "Preamble";
  markdown.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const key = `b${i}`;
    if (line.startsWith("# ")) {
      out.push({ key, kind: "h1", text: line.slice(2).trim(), section });
    } else if (line.startsWith("## ")) {
      section = line.slice(3).trim();
      out.push({ key, kind: "h2", text: section, section });
    } else if (line.startsWith("### ")) {
      out.push({ key, kind: "h3", text: line.slice(4).trim(), section });
    } else if (/^[-*]\s+/.test(line)) {
      out.push({ key, kind: "li", text: line.replace(/^[-*]\s+/, ""), section });
    } else {
      out.push({ key, kind: "p", text: line, section });
    }
  });
  return out;
}

/** Renders **bold** spans. The template emits no other inline markup. */
function Rich({ text }: { text: string }) {
  const parts = useMemo(() => text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean), [text]);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? (
          <strong key={i} className="font-semibold text-foreground">{p.slice(2, -2)}</strong>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

interface Props {
  markdown: string;
  /** Renders a comment affordance beside each clause. */
  onSelectClause?: (section: string, text: string) => void;
  /** Sections with unresolved comments, highlighted in the margin. */
  commentedSections?: Set<string>;
  className?: string;
}

export function DocumentView({ markdown, onSelectClause, commentedSections, className }: Props) {
  const blocks = useMemo(() => parseBlocks(markdown), [markdown]);

  return (
    <article
      className={cn(
        "mx-auto max-w-[46rem] bg-card text-card-foreground",
        "px-6 py-10 sm:px-12 sm:py-14",
        "font-serif leading-relaxed",
        className,
      )}
      style={{ fontFamily: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif' }}
    >
      {blocks.map((b) => {
        const flagged = commentedSections?.has(b.section);
        const interactive = !!onSelectClause && (b.kind === "p" || b.kind === "li");

        const inner =
          b.kind === "h1" ? (
            <div className="mb-8 text-center">
              <h1 className="text-[1.75rem] font-bold tracking-tight text-[hsl(var(--navy))] dark:text-primary">
                {b.text}
              </h1>
              <div className="mx-auto mt-3 h-px w-16 bg-[hsl(var(--navy))] dark:bg-primary" />
            </div>
          ) : b.kind === "h2" ? (
            <h2 className="mb-2 mt-7 text-[1.0625rem] font-bold tracking-tight text-[hsl(var(--navy))] dark:text-primary">
              {b.text}
            </h2>
          ) : b.kind === "h3" ? (
            <h3 className="mb-1.5 mt-5 text-[0.9375rem] font-semibold">{b.text}</h3>
          ) : b.kind === "li" ? (
            <li className="ml-5 list-disc text-[0.9375rem] text-foreground/90">
              <Rich text={b.text} />
            </li>
          ) : (
            <p className="mb-3 text-[0.9375rem] text-foreground/90">
              <Rich text={b.text} />
            </p>
          );

        if (!interactive) {
          return (
            <div key={b.key} className={cn(flagged && b.kind === "h2" && "relative")}>
              {flagged && b.kind === "h2" && (
                <span className="absolute -left-4 top-8 h-4 w-1 rounded-full bg-amber-400" aria-hidden />
              )}
              {inner}
            </div>
          );
        }

        return (
          <div key={b.key} className="group relative -mx-2 rounded-md px-2 transition-colors hover:bg-muted/50">
            {inner}
            <button
              type="button"
              onClick={() => onSelectClause!(b.section, b.text)}
              className={cn(
                "absolute -right-1 top-1 hidden rounded-md border border-border bg-background px-2 py-0.5",
                "font-sans text-[11px] font-medium text-muted-foreground shadow-sm",
                "group-hover:block hover:text-foreground",
              )}
            >
              Comment
            </button>
          </div>
        );
      })}
    </article>
  );
}
