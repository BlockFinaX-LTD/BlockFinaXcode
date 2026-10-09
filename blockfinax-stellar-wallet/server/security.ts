import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const randomToken = () => randomBytes(32).toString("base64url");
export async function issueSession(id: string, secret: string) {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(id)
    .setIssuer("blockfinax-wallet")
    .setAudience("wallet-session")
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(new TextEncoder().encode(secret));
}
export async function readSession(token: string, secret: string) {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
    issuer: "blockfinax-wallet",
    audience: "wallet-session",
    algorithms: ["HS256"],
  });
  if (!payload.sub) throw Error("Invalid session");
  return payload.sub;
}
export class Challenges {
  private values = new Map<string, { challenge: string; expires: number }>();
  put(key: string, challenge: string) {
    this.values.set(key, { challenge, expires: Date.now() + 300_000 });
  }
  take(key: string) {
    const item = this.values.get(key);
    this.values.delete(key);
    if (!item || item.expires < Date.now())
      throw Error("Challenge expired. Try again.");
    return item.challenge;
  }
}
