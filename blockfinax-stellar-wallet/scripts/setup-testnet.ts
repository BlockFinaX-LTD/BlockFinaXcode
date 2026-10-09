import "dotenv/config";
import { Keypair } from "@stellar/stellar-sdk";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
const file = ".env";
let content = existsSync(file)
  ? readFileSync(file, "utf8")
  : readFileSync(".env.example", "utf8");
const key = process.env.STELLAR_FEE_PAYER_SECRET
  ? Keypair.fromSecret(process.env.STELLAR_FEE_PAYER_SECRET)
  : Keypair.random();
const response = await fetch(
  `https://friendbot.stellar.org/?addr=${key.publicKey()}`,
);
if (!response.ok) {
  const text = await response.text();
  if (!text.includes("createAccountAlreadyExist"))
    throw Error(`Friendbot failed: ${text}`);
}
content = content.replace(
  /^STELLAR_FEE_PAYER_SECRET=.*$/m,
  `STELLAR_FEE_PAYER_SECRET=${key.secret()}`,
);
if (
  !process.env.SESSION_SECRET ||
  process.env.SESSION_SECRET.startsWith("replace-")
)
  content = content.replace(
    /^SESSION_SECRET=.*$/m,
    `SESSION_SECRET=${randomBytes(32).toString("hex")}`,
  );
writeFileSync(file, content, { mode: 0o600 });
console.info(
  `Testnet fee payer funded: ${key.publicKey()}\nConfiguration saved to ignored .env. No signing secrets are sent to the browser.`,
);
