/**
 * The traction panel on its own URL, for sharing outward.
 *
 * The data room is one password over everything: the cap table, the signed
 * LOIs, the financial model and the security audit all sit behind the same
 * code. Handing that to someone who asked for traction gives them the lot,
 * which is why this exists as a separate door that opens onto one room.
 *
 * The key lives in the path rather than behind a login because the recipient
 * is a stranger doing diligence, not a user with an account. A long random
 * string in a URL is the standard shape for that, and it is revoked by
 * changing TRACTION_SHARE_KEY, which kills every copy of the link at once.
 *
 * It renders the very same component the data room renders, so the two can
 * never drift into telling different stories about the same numbers.
 */

import { useEffect } from "react";
import { useRoute } from "wouter";
import { LiveTractionDoc } from "./data-room";

export default function TractionShare() {
  const [, params] = useRoute("/traction/:key");
  const key = params?.key || "";

  // A shared link must not end up in a search index. The recipient is meant to
  // have been given it, and a page carrying revenue figures should not be
  // findable by anyone who was not.
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow, noarchive";
    document.head.appendChild(meta);
    const previousTitle = document.title;
    document.title = "BlockFinaX, protocol traction";
    return () => {
      document.head.removeChild(meta);
      document.title = previousTitle;
    };
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", padding: "32px 20px 80px" }}>
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <header
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
            paddingBottom: 20,
            marginBottom: 24,
            borderBottom: "1px solid #e2e8f0",
          }}
        >
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: 26,
                fontWeight: 700,
                letterSpacing: "-0.02em",
                color: "#0f172a",
              }}
            >
              BlockFinaX protocol traction
            </h1>
            <p style={{ margin: "6px 0 0", fontSize: 14.5, color: "#64748b", maxWidth: "60ch" }}>
              Revenue, notional, liquidity and settlement activity read directly from the
              contracts on Base and BSC. Every transaction below links to a public block
              explorer so any figure here can be checked independently.
            </p>
          </div>
          <a
            href="https://blockfinax.com"
            style={{
              fontSize: 13,
              color: "#2563eb",
              textDecoration: "none",
              whiteSpace: "nowrap",
              paddingTop: 6,
            }}
          >
            blockfinax.com
          </a>
        </header>

        {/* The key is passed straight through. An absent or wrong one gets the
            same "Unauthorized" the component already renders for a dead
            session, so a bad link fails visibly rather than showing zeros
            that would read as a protocol with no activity. */}
        <LiveTractionDoc token="" shareKey={key} />

        <p
          style={{
            marginTop: 40,
            paddingTop: 18,
            borderTop: "1px solid #e2e8f0",
            fontSize: 12.5,
            color: "#94a3b8",
            lineHeight: 1.6,
          }}
        >
          Shared link. Shows protocol traction only, and no other BlockFinaX material.
          Counterparty names are withheld on this page: the letters of intent behind these
          figures bind both sides to confidentiality, so only aggregate counts appear.
        </p>
      </div>
    </div>
  );
}
