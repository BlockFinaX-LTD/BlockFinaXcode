import { test } from "node:test";
import assert from "node:assert/strict";
import { jobBusinesses } from "../sources";

/**
 * Job posts become one business each, with the post as the reason.
 *
 * Recruiters are dropped because the agency is not the one paying suppliers
 * abroad, and a LinkedIn page is not a website anyone can find a contact on.
 */
test("job posts become businesses, one per company, recruiters dropped", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify([
    { companyName: "Tema Foods Ltd", title: "Import Manager", location: "Lagos, Nigeria",
      companyWebsite: "https://temafoods.com", link: "https://linkedin.com/jobs/view/1", postedAt: "2026-11-02" },
    { companyName: "Tema Foods Ltd", title: "Procurement Officer", companyWebsite: "https://temafoods.com" },
    { companyName: "Prime Recruitment Partners", title: "Import Manager" },
    { companyName: "Okoro Motors", title: "Import Manager", companyWebsite: "https://www.linkedin.com/company/okoro" },
  ]), { status: 200 })) as typeof fetch;
  try {
    const list = await jobBusinesses("t", "import manager", "Lagos, Nigeria", 10);
    assert.deepEqual(list.map(b => b.company), ["Tema Foods Ltd", "Okoro Motors"]);
    assert.equal(list[0].website, "https://temafoods.com");
    assert.equal(list[0].country, "NG");
    assert.match(list[0].evidence || "", /Hiring a Import Manager in Lagos, Nigeria \(posted 2026-11-02\)/);
    assert.equal(list[0].sourceUrl, "https://linkedin.com/jobs/view/1");
    assert.equal(list[1].website, null);
  } finally {
    globalThis.fetch = real;
  }
});
