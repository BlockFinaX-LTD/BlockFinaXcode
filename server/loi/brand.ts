/**
 * The company signature, uploaded once through the admin UI.
 *
 * Stored in platform_settings rather than on disk because Railway containers
 * have ephemeral filesystems: a redeploy would silently lose the file, and
 * letters that used to carry a signature would quietly stop carrying one.
 *
 * The logo lives in logo.ts, which has no database dependency — see the note
 * there on why the two are kept apart.
 */

import { db } from "../db";
import { platformSettings } from "@shared/schema";
import { eq } from "drizzle-orm";
import { APP_URL } from "../email";

const SIGNATURE_KEY = "brand_signature_png";
const SIGNATURE_NAME_KEY = "brand_signature_name";

// ── Signature ────────────────────────────────────────────────────────────

export interface StoredSignature {
  /** Full data URL, e.g. "data:image/png;base64,…". */
  dataUrl: string;
  /** Name printed beneath the signature. */
  name: string;
}

/** Reads the stored signature, or null when none has been uploaded. */
export async function getSignature(): Promise<StoredSignature | null> {
  try {
    const rows = await db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.key, SIGNATURE_KEY))
      .limit(1);
    if (!rows.length || !rows[0].value) return null;

    const nameRows = await db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.key, SIGNATURE_NAME_KEY))
      .limit(1);

    return { dataUrl: rows[0].value, name: nameRows[0]?.value || "" };
  } catch {
    // The signature is decorative — never let a settings read break a send.
    return null;
  }
}

/** Stores (or replaces) the signature. `dataUrl` must be a PNG or JPEG data URL. */
export async function setSignature(dataUrl: string, name: string, updatedBy?: string): Promise<void> {
  const now = new Date();
  for (const [key, value] of [
    [SIGNATURE_KEY, dataUrl],
    [SIGNATURE_NAME_KEY, name],
  ] as const) {
    await db
      .insert(platformSettings)
      .values({ key, value, updatedAt: now, updatedBy })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { value, updatedAt: now, updatedBy },
      });
  }
}

export async function clearSignature(): Promise<void> {
  await db.delete(platformSettings).where(eq(platformSettings.key, SIGNATURE_KEY));
  await db.delete(platformSettings).where(eq(platformSettings.key, SIGNATURE_NAME_KEY));
}

/**
 * Splits a data URL into the pieces an image response needs. Returns null if
 * the string isn't a data URL of an image type we're willing to serve.
 */
export function decodeDataUrl(dataUrl: string): { mime: string; buffer: Buffer } | null {
  const m = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!m) return null;
  return { mime: m[1], buffer: Buffer.from(m[2], "base64") };
}

/** URL the email uses for the signature image. */
export function signatureUrl(origin?: string): string {
  const base = (origin || APP_URL).replace(/\/$/, "");
  return `${base}/api/brand/signature.png`;
}
