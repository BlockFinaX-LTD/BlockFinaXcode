/**
 * Renders what Finax writes.
 *
 * The model replies in markdown — bold, bullets, the occasional table — and
 * rendering that as plain text put literal `**` on screen. This is the shared
 * renderer for every surface that shows an agent message: the widget on the
 * site and in the app, and the operations chat in admin.
 *
 * Styling is tuned for a chat bubble rather than an article. Headings are
 * clamped to barely-larger-than-body, margins are tight, and the first and
 * last block lose their outer margin so text sits flush inside the bubble.
 * Anything that can overflow a narrow column — tables, code — scrolls inside
 * its own box so the bubble itself never stretches the layout.
 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

export function AgentMarkdown({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={cn(
        "text-sm leading-relaxed",
        // Collapse the outer margins so the bubble hugs the text.
        "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,

          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,

          ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1 last:mb-0">{children}</ul>,
          ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-1 last:mb-0">{children}</ol>,
          li: ({ children }) => <li className="pl-0.5 marker:text-muted-foreground">{children}</li>,

          // Barely larger than body text — a chat reply is not a document, and
          // a real h1 in a 23rem bubble looks like a mistake.
          h1: ({ children }) => <p className="mb-1.5 mt-3 text-[0.95rem] font-semibold first:mt-0">{children}</p>,
          h2: ({ children }) => <p className="mb-1.5 mt-3 text-[0.9rem] font-semibold first:mt-0">{children}</p>,
          h3: ({ children }) => <p className="mb-1 mt-2.5 text-sm font-semibold first:mt-0">{children}</p>,

          a: ({ href, children }) => (
            <a
              href={href}
              // Replies often cite block explorers and docs; opening in place
              // would lose the conversation.
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline underline-offset-2 hover:opacity-80"
            >
              {children}
            </a>
          ),

          code: ({ className: cls, children }) => {
            const isBlock = /language-/.test(cls || "");
            if (!isBlock) {
              return (
                <code className="rounded bg-black/10 px-1 py-0.5 font-mono text-[0.8em] dark:bg-white/15">
                  {children}
                </code>
              );
            }
            return (
              <code className="block overflow-x-auto rounded-lg bg-black/10 p-2.5 font-mono text-[0.78rem] leading-relaxed dark:bg-white/10">
                {children}
              </code>
            );
          },
          pre: ({ children }) => <pre className="mb-2 last:mb-0">{children}</pre>,

          blockquote: ({ children }) => (
            <blockquote className="mb-2 border-l-2 border-current/25 pl-3 opacity-90 last:mb-0">
              {children}
            </blockquote>
          ),

          // Finax reaches for tables when comparing pools or positions. They
          // scroll inside the bubble rather than widening it.
          table: ({ children }) => (
            <div className="mb-2 max-w-full overflow-x-auto last:mb-0">
              <table className="w-full border-collapse text-[0.8rem]">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-current/20 px-2 py-1 text-left font-semibold">{children}</th>
          ),
          td: ({ children }) => <td className="border-b border-current/10 px-2 py-1 align-top">{children}</td>,

          hr: () => <hr className="my-3 border-current/15" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
