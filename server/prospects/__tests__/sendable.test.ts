import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyAddress, assessSendable } from "@shared/prospect-schema";

/**
 * This function decides whether a real email goes to a real stranger, so it is
 * tested harder than anything else in the pipeline. The cost of being wrong
 * runs one way: emailing a named individual without consent is the problem,
 * and declining a role address by mistake costs one lead.
 */

test("published business inboxes are recognised", () => {
  for (const e of [
    "info@acmefoods.com", "contact@acme.com", "sales@acme.com",
    "treasury@bank.com", "imports@trader.com", "hello@fintech.io",
    "finance@group.co.ke", "partnerships@psp.com", "ops@logistics.ng",
  ]) {
    assert.equal(classifyAddress(e), "role", e);
  }
});

test("a person's address is not mistaken for an inbox", () => {
  for (const e of [
    "ada.boateng@acmefoods.com", "tunde@lagosmills.ng",
    "k.asante@ecobank.com", "grace.wanjiru@logistics.co.ke",
  ]) {
    assert.equal(classifyAddress(e), "individual", e);
  }
});

/** Suffixed role inboxes are still role inboxes. */
test("regional variants of a role inbox still count as one", () => {
  assert.equal(classifyAddress("sales.africa@acme.com"), "role");
  assert.equal(classifyAddress("info-gh@acme.com"), "role");
  // But a long tail after the prefix is a person, not an inbox.
  assert.equal(classifyAddress("infatuationsdepartmenthead@acme.com"), "individual");
});

test("a role inbox is sendable anywhere", () => {
  for (const cc of ["GH", "NG", "GB", "DE", "US", null]) {
    const r = assessSendable({ email: "info@acme.com", country: cc as any });
    assert.equal(r.sendable, true, `${cc}`);
    assert.match(r.reason, /business inbox/i);
  }
});

/**
 * The rule that matters. Ghana, Nigeria, the EU and the UK all require prior
 * consent before commercial email reaches a named individual, and BlockFinaX
 * sells into exactly those markets.
 */
test("a person's address in a consent country is refused", () => {
  for (const cc of ["GH", "NG", "KE", "ZA", "GB", "DE", "IE"]) {
    const r = assessSendable({ email: "ada.boateng@acme.com", country: cc });
    assert.equal(r.sendable, false, cc);
    assert.match(r.reason, /consent/i);
  }
});

test("an unknown country falls to the stricter rule", () => {
  const r = assessSendable({ email: "ada@acme.com", country: null });
  assert.equal(r.sendable, false);
  assert.match(r.reason, /unknown/i);
});

test("a person's address in the US is allowed, since CAN-SPAM permits it", () => {
  const r = assessSendable({ email: "ada@acme.com", country: "US" });
  assert.equal(r.sendable, true);
  assert.match(r.reason, /unsubscribe/i);
});

test("a malformed address is never sendable", () => {
  for (const e of ["not-an-email", "@acme.com", "ada@", "", "ada@acme"]) {
    assert.equal(assessSendable({ email: e, country: "US" }).sendable, false, e);
  }
});

/** Every decision carries its reason, because a boolean cannot be audited. */
test("a reason is always recorded", () => {
  for (const e of ["info@acme.com", "ada@acme.com", "broken"]) {
    const r = assessSendable({ email: e, country: "GH" });
    assert.ok(r.reason.length > 20, `thin reason for ${e}: ${r.reason}`);
  }
});
