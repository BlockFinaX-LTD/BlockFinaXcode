/**
 * finder.tsx, the one search panel every Agent tab uses.
 *
 * Outreach, Email and Investors each grew their own search box with its own
 * buttons, chips and wording, so the same act (pick where to look, say what
 * for, press one button) looked different on every tab. This is that act once:
 *
 *   Where to look   [Source] [Source] [Source]
 *   one line saying what that source finds
 *   the inputs
 *   suggestion chips
 *   [ the one button ]   a status line
 */

import type { ReactNode } from "react";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface FinderSource<K extends string> {
  key: K;
  label: string;
  /** One sentence on what this source finds. */
  about: string;
}

export const finderInput =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] outline-none " +
  "focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50";

export function FinderPanel<K extends string>(props: {
  sources?: FinderSource<K>[];
  source?: K;
  onSource?: (k: K) => void;
  /** Shown when there is only one source, in place of the source buttons. */
  about?: string;
  children: ReactNode;
  suggestions?: string[];
  onSuggest?: (s: string) => void;
  action: { label: string; busyLabel?: string; busy?: boolean; disabled?: boolean; onClick: () => void };
  /** Status under the button: schedule, missing setup, cost. */
  note?: ReactNode;
  /** Anything else beside the button, like the reply style. */
  extra?: ReactNode;
}) {
  const { sources, source, onSource } = props;
  const current = sources?.find(s => s.key === source);
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4">
      {sources && sources.length > 1 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[12px] text-muted-foreground">Where to look</span>
          {sources.map(s => (
            <button
              key={s.key}
              onClick={() => onSource?.(s.key)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-[12.5px] transition-colors",
                s.key === source
                  ? "border-primary bg-primary/10 font-medium text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
      <p className="mb-2.5 text-[12.5px] text-muted-foreground">{current?.about ?? props.about}</p>

      {props.children}

      {props.suggestions && props.suggestions.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {props.suggestions.map(q => (
            <button
              key={q}
              onClick={() => props.onSuggest?.(q)}
              className="rounded-full border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground hover:text-foreground"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button size="sm" disabled={props.action.disabled || props.action.busy} onClick={props.action.onClick}>
          {props.action.busy
            ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> {props.action.busyLabel ?? "Searching…"}</>
            : <><Search className="mr-1.5 h-3.5 w-3.5" /> {props.action.label}</>}
        </Button>
        {props.extra}
      </div>
      {props.note && <p className="mt-2 text-[12px] text-muted-foreground">{props.note}</p>}
    </div>
  );
}
