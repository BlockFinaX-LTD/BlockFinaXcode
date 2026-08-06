/**
 * The BlockFinaX mark, for documents and mail.
 *
 * Deliberately separate from brand.ts: the signature lives in the database,
 * the logo ships with the repo. Keeping them apart means the PDF renderer —
 * which only needs the logo — has no database dependency at all, so a
 * document can be rendered anywhere, including in tests and scripts.
 *
 * Email can't use the SVG (Gmail and Outlook strip it) or a data: URI
 * (blocked), so mail references the hosted PNG by URL while the PDF embeds
 * the bytes directly and never touches the network.
 */

import fs from "fs";
import path from "path";
import { APP_URL } from "../email";

/**
 * Candidate locations, in resolution order.
 *
 * The source tree comes first deliberately: dist/ is build output that can be
 * stale, and a stale copy silently shadowing the real asset is exactly the
 * kind of bug that only shows up in a shipped document. Both paths exist in
 * the deployed container, so neither environment needs special-casing.
 */
const LOGO_PATHS = [
  path.join(process.cwd(), "client", "public", "assets", "logo-mark.png"),
  path.join(process.cwd(), "dist", "public", "assets", "logo-mark.png"),
  path.join(process.cwd(), "client", "src", "assets", "logo-transparent.png"),
];

let logoCache: string | null | undefined;

/** Base64 PNG of the logo, or null if it can't be found. Cached after first read. */
export function logoBase64(): string | null {
  if (logoCache !== undefined) return logoCache;
  for (const p of LOGO_PATHS) {
    try {
      if (fs.existsSync(p)) {
        logoCache = fs.readFileSync(p).toString("base64");
        return logoCache;
      }
    } catch {
      // Unreadable path — try the next candidate rather than failing the render.
    }
  }
  console.warn("[brand] logo not found; documents will render without it");
  logoCache = null;
  return logoCache;
}

/** Absolute URL of the logo, for email. Must be publicly reachable. */
export function logoUrl(origin?: string): string {
  const base = (origin || APP_URL).replace(/\/$/, "");
  return `${base}/assets/logo-mark.png`;
}
