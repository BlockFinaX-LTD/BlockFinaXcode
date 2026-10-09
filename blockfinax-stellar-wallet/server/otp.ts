import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { randomToken } from "./security.js";
import { Store } from "./store.js";
export class EmailOtp {
  constructor(
    private store: Store,
    private secret: string,
    private now = Date.now,
  ) {}
  private hash(email: string, id: string, code: string) {
    return createHmac("sha256", this.secret)
      .update(`${email}:${id}:${code}`)
      .digest("hex");
  }
  issue(email: string) {
    const prior = this.store.db
      .prepare("SELECT sent FROM email_codes WHERE email=?")
      .get(email) as { sent: number } | undefined;
    if (prior && this.now() - prior.sent < 60_000)
      throw Error("Wait 60 seconds before requesting another code.");
    const requestId = randomToken();
    const code = randomInt(0, 1000000).toString().padStart(6, "0");
    this.store.db
      .prepare(
        "INSERT INTO email_codes(email,request_id,digest,expires,attempts,sent) VALUES(?,?,?,?,0,?) ON CONFLICT(email) DO UPDATE SET request_id=excluded.request_id,digest=excluded.digest,expires=excluded.expires,attempts=0,sent=excluded.sent",
      )
      .run(
        email,
        requestId,
        this.hash(email, requestId, code),
        this.now() + 300000,
        this.now(),
      );
    return { requestId, code };
  }
  cancel(requestId: string) {
    this.store.db
      .prepare("DELETE FROM email_codes WHERE request_id=?")
      .run(requestId);
  }
  verify(email: string, requestId: string, code: string) {
    const row = this.store.db
      .prepare(
        "SELECT digest,expires,attempts FROM email_codes WHERE email=? AND request_id=?",
      )
      .get(email, requestId) as
      { digest: string; expires: number; attempts: number } | undefined;
    if (!row || row.expires <= this.now() || row.attempts >= 5) {
      if (row) this.cancel(requestId);
      throw Error("Code expired or unavailable. Request a new code.");
    }
    this.store.db
      .prepare("UPDATE email_codes SET attempts=attempts+1 WHERE request_id=?")
      .run(requestId);
    const valid = timingSafeEqual(
      Buffer.from(row.digest, "hex"),
      Buffer.from(this.hash(email, requestId, code), "hex"),
    );
    if (!valid) {
      if (row.attempts + 1 >= 5) this.cancel(requestId);
      throw Error(
        row.attempts + 1 >= 5
          ? "Too many attempts. Request a new code."
          : "Incorrect code. Please try again.",
      );
    }
    this.cancel(requestId);
  }
}
export async function sendCode(email: string, code: string, requestId: string) {
  const key = process.env.RESEND_API_KEY;
  if (process.env.EMAIL_DELIVERY === "console" || !key) {
    if (process.env.NODE_ENV === "production")
      throw Error("Resend email delivery is not configured");
    console.info(`[local email code] ${email}: ${code}`);
    return;
  }
  const result = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(10000),
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `wallet-otp-${requestId}`,
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || "BlockFinaX <hello@blockfinax.com>",
      to: [email],
      subject: "Your BlockFinaX sign-in code",
      text: `Your BlockFinaX sign-in code is ${code}.\n\nEnter it in the Stellar test wallet. It expires in 5 minutes and can be used once.\n\nIf you did not request this code, ignore this email.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;color:#102440"><h2 style="color:#2457d6">BlockFinaX</h2><p>Enter this code to sign in to your Stellar test wallet.</p><div style="font-size:36px;letter-spacing:8px;font-weight:700;padding:24px;background:#f3f6fc;border-radius:12px">${code}</div><p style="font-size:13px;color:#68778d">This code expires in 5 minutes and can be used once. If you did not request it, ignore this email.</p></div>`,
    }),
  });
  if (!result.ok) {
    console.error("Resend email delivery failed:", result.status);
    throw Error("Email delivery failed. Please try again later.");
  }
  const data = (await result.json()) as { id?: string };
  if (!data.id)
    throw Error("Email delivery was not confirmed. Please try again.");
}
