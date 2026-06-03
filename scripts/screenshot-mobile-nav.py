"""Take nav screenshots at 3 widths so we can eyeball the mobile crammage."""
from playwright.sync_api import sync_playwright

WIDTHS = [
    (1440, "desktop"),
    (768,  "tablet"),
    (390,  "mobile"),
    (360,  "mobile-small"),
]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for w, label in WIDTHS:
        ctx = browser.new_context(viewport={"width": w, "height": 240})
        ctx.route("**/replit.com/**", lambda r: r.abort())
        page = ctx.new_page()
        page.goto("http://localhost:5000/", wait_until="domcontentloaded", timeout=60000)
        page.wait_for_selector(".bfx-landing .hero", timeout=15000)
        page.wait_for_timeout(1200)
        page.screenshot(
            path=f"C:/Users/ADMIN/BlockFinaxcode-merge/scripts/nav-{label}.png",
            full_page=False,
        )
        ctx.close()
        print(f"  captured nav-{label}.png at {w}px")
    browser.close()
