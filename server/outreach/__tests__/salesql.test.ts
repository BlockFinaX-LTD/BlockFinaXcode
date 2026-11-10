import { test } from "node:test";
import assert from "node:assert/strict";
import { bestEmail } from "../salesql";

test("a valid work email is chosen first, in either response shape", () => {
  const emails = [
    { email: "jane@gmail.com", type: "Direct", status: "Valid" },
    { email: "jane@acme.com", type: "Work", status: "Unverifiable" },
    { email: "j.doe@acme.com", type: "Work", status: "Valid" },
  ];
  assert.equal(bestEmail({ emails })?.email, "j.doe@acme.com");
  assert.equal(bestEmail({ person: { emails } })?.email, "j.doe@acme.com");
});

test("no usable email gives nothing", () => {
  assert.equal(bestEmail({ emails: [] }), null);
  assert.equal(bestEmail({}), null);
  assert.equal(bestEmail({ emails: [{ email: "not-an-email" }] }), null);
});
