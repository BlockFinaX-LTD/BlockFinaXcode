"""Capture the new landing page after its content has loaded."""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.goto("http://localhost:5000/", wait_until="commit", timeout=60000)
    page.wait_for_selector(".bfx-landing .hero", timeout=30000)
    page.wait_for_timeout(2500)  # let canvases paint a few frames
    page.screenshot(path="C:/Users/ADMIN/BlockFinaxcode-merge/scripts/landing-hero.png", full_page=False)
    page.screenshot(path="C:/Users/ADMIN/BlockFinaxcode-merge/scripts/landing-full.png", full_page=True)
    nav = page.locator(".bfx-landing nav.nav").count()
    hero_orb = page.locator(".bfx-landing #hero-orb").count()
    orbs = page.locator(".bfx-landing canvas.orb").count()
    print(f"nav: {nav}, hero-orb: {hero_orb}, product-orbs: {orbs}")
    print(f"screenshots saved")
    browser.close()
