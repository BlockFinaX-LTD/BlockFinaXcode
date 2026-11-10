import { test } from "node:test";
import assert from "node:assert/strict";
import { bestEmail, personDetails, asDomain } from "../salesql";

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

test("person details keep emails, phones, company and location", () => {
  const d = personDetails({
    full_name: "Jane Doe", title: "CFO", linkedin_url: "https://www.linkedin.com/in/janedoe",
    location: { city: "Lagos", country: "Nigeria" },
    organization: { name: "Acme", website: "https://acme.com" },
    emails: [{ email: "jane@acme.com", type: "Work", status: "Valid" }, { email: "nope" }],
    phones: [{ phone: "+234 800 000 0000", type: "Work", is_valid: true }, { phone: "" }],
  });
  assert.equal(d.name, "Jane Doe");
  assert.equal(d.company, "Acme");
  assert.equal(d.location, "Lagos, Nigeria");
  assert.deepEqual(d.emails, [{ email: "jane@acme.com", type: "Work", status: "Valid" }]);
  assert.deepEqual(d.phones, [{ phone: "+234 800 000 0000", type: "Work", valid: true }]);
});

test("a company website becomes a bare domain, a company name does not", () => {
  assert.equal(asDomain("https://www.acme.com/about"), "acme.com");
  assert.equal(asDomain("acme.co.uk"), "acme.co.uk");
  assert.equal(asDomain("Acme Ltd"), null);
});
