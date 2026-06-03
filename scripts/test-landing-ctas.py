"""Verify every CTA on the new landing routes where it should."""
import sys
from playwright.sync_api import sync_playwright

EXPECTED = {
    # Nav
    "nav-brand":         "/",
    "nav-products":      "#use",
    "nav-hedgers":       "/hedger",
    "nav-underwriters":  "/liquidity-provider",
    "nav-documentation": "/docs/request",
    "nav-whitepaper":    "/whitepaper",
    "nav-pitch":         "/pitch",
    "nav-blog":          "/blog",
    "nav-cta-hedge":     "#use",
    "nav-cta-trade":     "/apply",
    # Hero
    "hero-hedge":        "/apply",
    "hero-trade":        "#use",
    # Feature card primaries
    "feat-hedge":        "/hedger",
    "feat-yield":        "/liquidity-provider",
    "feat-trade":        "/apply",
    # Markets cards
    "acard-buycover":    "/hedger",
    "acard-underwrite":  "/liquidity-provider",
    "acard-tradevol":    "/apply",
    # Tail CTA
    "tail-hedge":        "/hedger",
    "tail-trade":        "/apply",
    # Footer
    "foot-request":      "/apply",
    "foot-docs":         "/docs/request",
    "foot-buyers":       "/hedger",
    "foot-capital":      "/liquidity-provider",
    "foot-whitepaper":   "/whitepaper",
    "foot-pitch":        "/pitch",
    "foot-blog":         "/blog",
    "foot-x":            "x.com/blockfinax",
    "foot-linkedin":     "linkedin.com/company/blockfinax",
    "foot-telegram":     "t.me/",
    "foot-privacy":      "/privacy",
    "foot-terms":        "/terms",
}

failures = []

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context()
    ctx.route("**/replit.com/**", lambda r: r.abort())
    page = ctx.new_page()
    page.goto("http://localhost:5000/", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_selector(".bfx-landing .hero", timeout=20000)
    page.wait_for_timeout(1500)

    # Hover the resources dropdown so its items are in the DOM
    page.locator(".nav-dropdown-trigger").hover()
    page.wait_for_timeout(500)

    def hrefs_of(selector):
        return [el.get_attribute("href") or "" for el in page.locator(selector).all()]

    # Gather every internal link and external href on the page
    all_anchors = page.locator(".bfx-landing a").all()
    links = []
    for a in all_anchors:
        href = a.get_attribute("href") or ""
        text = (a.inner_text() or "").strip()
        aria = a.get_attribute("aria-label") or ""
        links.append((text or aria, href))

    print(f"Found {len(links)} anchors on the landing.")

    # Build a set of href values present
    present = [h for _, h in links]
    missing = []

    for label, expected in EXPECTED.items():
        # Match if any anchor's href contains the expected value
        if not any(expected == h or expected in h for h in present):
            missing.append((label, expected))

    if missing:
        print(f"\nFAIL - {len(missing)} expected route(s) missing:")
        for label, expected in missing:
            failures.append(f"{label} -> {expected}")
            print(f"  - {label}: expected href containing {expected!r}")
    else:
        print("\nPASS - every expected CTA href is present on the landing.")

    # Also print a few interesting ones for visual confirmation
    print("\nSample hrefs from the landing (text -> href):")
    seen = set()
    for text, href in links:
        key = (text[:30], href)
        if key in seen: continue
        seen.add(key)
        safe_text = text.encode("ascii", "replace").decode("ascii")
        print(f"  {safe_text[:30]:<32}  ->  {href}")

    browser.close()

print("\n" + "=" * 60)
if failures:
    print(f"FAIL - {len(failures)} CTA(s) wired incorrectly")
    sys.exit(1)
print("PASS - landing CTAs all wired correctly")
sys.exit(0)
