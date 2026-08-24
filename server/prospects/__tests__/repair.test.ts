import { test } from "node:test";
import assert from "node:assert/strict";
import { repairEmail } from "../discover";

/**
 * One mangled address reached a real recipient before this existed.
 *
 * The crawl glued page text onto an address and the result still looked valid:
 * sales@booze.ngliquorstore passes any pattern check, because "ngliquorstore"
 * is just letters after a dot. Only knowing which endings actually exist, or
 * comparing against the business's own website, catches it.
 *
 * This matters beyond one bad send. Bounces are what mark a sender as working
 * from a scraped list, and the domain carrying these emails also carries the
 * customer magic links.
 */

test("repairs the address that was actually sent", () => {
  assert.equal(
    repairEmail("sales@booze.ngliquorstore", "https://booze.ng"),
    "sales@booze.ng",
  );
});

test("repairs rather than discards, because a real lead is behind it", () => {
  assert.equal(repairEmail("info@acme.comabout", "https://www.acme.com"), "info@acme.com");
  assert.equal(repairEmail("hello@shop.co.ukcontact", "https://shop.co.uk"), "hello@shop.co.uk");
});

test("leaves a good address alone", () => {
  for (const [e, site] of [
    ["info@acme.com", "https://acme.com"],
    ["sales@thing.co.ke", "https://www.thing.co.ke"],
    ["info@acme.com", null],
  ] as Array<[string, string | null]>) {
    assert.equal(repairEmail(e, site), e);
  }
});

/** Uncommon but real endings must survive, or genuine leads are thrown away. */
test("accepts real but unusual top level domains", () => {
  for (const e of [
    "info@blackstargroup.ai", "sales@network.global", "info@loomox.digital",
    "info@ghana.travel", "info@wilmar.com.sg", "x@place.africa",
  ]) {
    assert.equal(repairEmail(e, null), e, e);
  }
});

/**
 * With no website to repair against, an unrecognised ending is refused. A
 * bounce costs more than a lead.
 */
test("refuses an ending that does not exist", () => {
  assert.equal(repairEmail("hi@thing.notatldatall", null), null);
  assert.equal(repairEmail("sales@booze.ngliquorstore", null), null);
});

test("refuses anything that is not an address at all", () => {
  for (const e of ["a@b", "no-at-sign", "@nolocal.com", ""]) {
    assert.equal(repairEmail(e, null), null, e);
  }
});

/** A domain long enough to be page text rather than a domain. */
test("refuses an absurdly long domain", () => {
  assert.equal(repairEmail(`x@${"a".repeat(70)}.com`, null), null);
});
