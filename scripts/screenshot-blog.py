"""Capture the blog listing + the new research article."""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    ctx.route("**/replit.com/**", lambda r: r.abort())
    page = ctx.new_page()
    page.goto("http://localhost:5000/blog", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(2500)
    page.screenshot(path="C:/Users/ADMIN/BlockFinaxcode-merge/scripts/blog-listing.png", full_page=True)
    print("captured blog listing")

    page.goto(
        "http://localhost:5000/blog/same-primitive-two-problems",
        wait_until="domcontentloaded",
        timeout=60000,
    )
    page.wait_for_timeout(2500)
    page.screenshot(path="C:/Users/ADMIN/BlockFinaxcode-merge/scripts/blog-article-top.png", full_page=False)
    page.screenshot(path="C:/Users/ADMIN/BlockFinaxcode-merge/scripts/blog-article-full.png", full_page=True)
    print("captured article")
    browser.close()
