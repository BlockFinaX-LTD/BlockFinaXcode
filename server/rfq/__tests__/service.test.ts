import { test } from "node:test";
import assert from "node:assert/strict";
import { isApprovedUnderwriter, MIN_REQUEST_USD, offerValiditySeconds } from "../service";

test("offers last 1 hour for cover under 30 days and 24 hours otherwise", () => {
  assert.equal(offerValiditySeconds(1), 3_600);
  assert.equal(offerValiditySeconds(29), 3_600);
  assert.equal(offerValiditySeconds(30), 86_400);
  assert.equal(offerValiditySeconds(90), 86_400);
});

test("every underwriter is approved unless listed in RFQ_BLOCKED_USERS", () => {
  assert.equal(isApprovedUnderwriter(7, {}), true);
  assert.equal(isApprovedUnderwriter(7, { RFQ_BLOCKED_USERS: "3, 7" }), false);
  assert.equal(isApprovedUnderwriter(8, { RFQ_BLOCKED_USERS: "3,7" }), true);
});

test("requests start at 5,000 protected", () => {
  assert.equal(MIN_REQUEST_USD, 5_000);
});
