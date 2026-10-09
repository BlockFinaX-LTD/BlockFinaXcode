import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store.js";
import { EmailOtp, sendCode } from "../server/otp.js";
function fixture() {
  const db = new Store(":memory:");
  let now = 1000000;
  const otp = new EmailOtp(db, "test-secret", () => now);
  return { db, otp, advance: (ms: number) => (now += ms) };
}
test("codes are email/request bound, HMAC stored and single use", () => {
  const { db, otp } = fixture();
  const issued = otp.issue("alice@example.com");
  assert.match(issued.code, /^\d{6}$/);
  const row = db.db.prepare("SELECT digest FROM email_codes").get() as {
    digest: string;
  };
  assert.notEqual(row.digest, issued.code);
  assert.throws(() =>
    otp.verify("bob@example.com", issued.requestId, issued.code),
  );
  assert.throws(() =>
    otp.verify("alice@example.com", "another-request", issued.code),
  );
  otp.verify("alice@example.com", issued.requestId, issued.code);
  assert.throws(() =>
    otp.verify("alice@example.com", issued.requestId, issued.code),
  );
  db.db.close();
});
test("codes expire and resends invalidate older codes with a cooldown", () => {
  const { db, otp, advance } = fixture();
  const first = otp.issue("alice@example.com");
  assert.throws(() => otp.issue("alice@example.com"), /60 seconds/);
  advance(60000);
  const second = otp.issue("alice@example.com");
  assert.throws(() =>
    otp.verify("alice@example.com", first.requestId, first.code),
  );
  advance(300000);
  assert.throws(
    () => otp.verify("alice@example.com", second.requestId, second.code),
    /expired/,
  );
  db.db.close();
});
test("five wrong guesses invalidate a code", () => {
  const { db, otp } = fixture();
  const issued = otp.issue("alice@example.com");
  const wrong = issued.code === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++)
    assert.throws(() =>
      otp.verify("alice@example.com", issued.requestId, wrong),
    );
  assert.throws(() =>
    otp.verify("alice@example.com", issued.requestId, issued.code),
  );
  db.db.close();
});
test("Resend errors surface as failed delivery and payload contains the code", async () => {
  const original = globalThis.fetch;
  const oldKey = process.env.RESEND_API_KEY;
  const oldMode = process.env.EMAIL_DELIVERY;
  process.env.RESEND_API_KEY = "test-key";
  process.env.EMAIL_DELIVERY = "resend";
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "https://api.resend.com/emails");
      const body = JSON.parse(String(options?.body));
      assert.equal(body.to[0], "delivered@resend.dev");
      assert.match(body.text, /123456/);
      return new Response(JSON.stringify({ id: "test-message" }), {
        status: 200,
      });
    };
    await sendCode("delivered@resend.dev", "123456", "request");
    globalThis.fetch = async () => new Response("{}", { status: 403 });
    await assert.rejects(
      () => sendCode("delivered@resend.dev", "123456", "request"),
      /delivery failed/,
    );
  } finally {
    globalThis.fetch = original;
    if (oldKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = oldKey;
    if (oldMode === undefined) delete process.env.EMAIL_DELIVERY;
    else process.env.EMAIL_DELIVERY = oldMode;
  }
});
