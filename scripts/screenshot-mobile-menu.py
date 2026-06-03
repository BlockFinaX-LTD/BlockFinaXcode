"""Open the mobile menu and screenshot the overlay state."""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 390, "height": 800})
    ctx.route("**/replit.com/**", lambda r: r.abort())
    page = ctx.new_page()
    page.goto("http://localhost:5000/", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_selector(".bfx-landing .hero", timeout=15000)
    page.wait_for_timeout(1200)
    # tap the hamburger
    page.locator(".nav-hamburger").click()
    page.wait_for_timeout(500)
    page.screenshot(
        path="C:/Users/ADMIN/BlockFinaxcode-merge/scripts/nav-mobile-menu.png",
        full_page=False,
    )
    print("captured mobile menu overlay (closed resources)")

    # expand resources
    page.locator(".nav-mobile-link", has_text="Resources").click()
    page.wait_for_timeout(400)
    page.screenshot(
        path="C:/Users/ADMIN/BlockFinaxcode-merge/scripts/nav-mobile-menu-expanded.png",
        full_page=False,
    )
    print("captured mobile menu overlay (resources expanded)")
    browser.close()
