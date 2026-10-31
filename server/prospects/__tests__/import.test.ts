import { test } from "node:test";
import assert from "node:assert/strict";
import { parseImportRow } from "../import";

const row = { company: "Example Foods", email: " Ada@Example.com ", segment: "hedger", country: "gh", name: "Ada", website: "https://example.com", linkedin: "https://linkedin.com/in/ada" };

test("a complete row is cleaned and keeps its details", () => {
  const p = parseImportRow(row)!;
  assert.equal(p.email, "ada@example.com");
  assert.equal(p.country, "GH");
  assert.equal(p.segment, "hedger");
  assert.equal(p.source, "import");
  assert.equal(p.sourceUrl, "https://linkedin.com/in/ada");
});

test("a named person in a consent country stays unsendable through the app", () => {
  assert.equal(parseImportRow(row)!.sendable, false);
});

test("a row without an email or company is refused", () => {
  assert.equal(parseImportRow({ company: "Example Foods" }), null);
  assert.equal(parseImportRow({ email: "ada@example.com" }), null);
});

test("links must be web addresses and unknown segments are unsorted", () => {
  const p = parseImportRow({ ...row, website: "javascript:alert(1)", linkedin: "data:text/html,x", segment: "other" })!;
  assert.equal(p.website, null);
  assert.equal(p.sourceUrl, null);
  assert.equal(p.segment, "unknown");
});
