/**
 * Six-digit email sign-in codes (ported from the Stellar wallet's otp.ts).
 *
 * Codes are stored only as an HMAC, expire after five minutes, allow five attempts and
 * are single use; a new code for the same email needs a 60-second wait. Delivery uses
 * Resend. In-memory storage suits the single-process testnet service.
 */
import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

interface Entry {
  requestId: string;
  digest: string;
  expires: number;
  attempts: number;
  sent: number;
}

export class EmailOtp {
  private readonly codes = new Map<string, Entry>();
  constructor(private readonly secret: string, private readonly now: () => number = Date.now) {}

  private hash(email: string, id: string, code: string) {
    return createHmac("sha256", this.secret).update(`${email}:${id}:${code}`).digest("hex");
  }

  issue(email: string) {
    const prior = this.codes.get(email);
    if (prior && this.now() - prior.sent < 60_000) throw new Error("Wait 60 seconds before requesting another code.");
    const requestId = randomBytes(16).toString("hex");
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    this.codes.set(email, { requestId, digest: this.hash(email, requestId, code), expires: this.now() + 300_000, attempts: 0, sent: this.now() });
    return { requestId, code };
  }

  cancel(email: string) {
    this.codes.delete(email);
  }

  verify(email: string, requestId: string, code: string) {
    const row = this.codes.get(email);
    if (!row || row.requestId !== requestId || row.expires <= this.now() || row.attempts >= 5) {
      if (row && row.requestId === requestId) this.codes.delete(email);
      throw new Error("Code expired or unavailable. Request a new code.");
    }
    row.attempts += 1;
    const valid = /^\d{6}$/.test(code) && timingSafeEqual(Buffer.from(row.digest, "hex"), Buffer.from(this.hash(email, requestId, code), "hex"));
    if (!valid) {
      if (row.attempts >= 5) this.codes.delete(email);
      throw new Error(row.attempts >= 5 ? "Too many attempts. Request a new code." : "Incorrect code. Please try again.");
    }
    this.codes.delete(email);
  }
}

export async function sendCode(email: string, code: string, requestId: string) {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) throw new Error("Email sign-in is not configured on this deployment");
  const result = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `bfx-otp-${requestId}` },
    body: JSON.stringify({
      from: process.env.SMTP_FROM?.trim() || "BlockFinaX <hello@blockfinax.com>",
      to: [email],
      subject: "Your BlockFinaX sign-in code",
      text: `Your BlockFinaX sign-in code is ${code}.\n\nIt expires in 5 minutes and can be used once. If you did not request it, ignore this email.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;color:#102440"><h2 style="color:#2457d6">BlockFinaX</h2><p>Enter this code to sign in to BlockFinaX testnet.</p><div style="font-size:36px;letter-spacing:8px;font-weight:700;padding:24px;background:#f3f6fc;border-radius:12px">${code}</div><p style="font-size:13px;color:#68778d">This code expires in 5 minutes and can be used once. If you did not request it, ignore this email.</p></div>`,
    }),
  });
  if (!result.ok) {
    console.error("[wallet] Resend delivery failed:", result.status);
    throw new Error("Email delivery failed. Please try again later.");
  }
}
