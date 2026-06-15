"""Debug what's rendering at /."""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    msgs = []
    page.on("pageerror", lambda e: msgs.append(f"PAGEERR: {e}"))
    page.on("console", lambda m: msgs.append(f"[{m.type}] {m.text}"))
    page.on("requestfailed", lambda r: msgs.append(f"REQFAIL: {r.url} {r.failure}"))
    page.goto("http://localhost:5000/", wait_until="load", timeout=90000)
    page.wait_for_timeout(8000)

    final_url = page.url
    root_html = page.evaluate("() => document.getElementById('root')?.innerHTML?.substring(0, 2000) || '(no #root)'")
    print(f"final URL: {final_url}")
    print("=== #root innerHTML (first 2000 chars) ===")
    safe = (root_html or "(EMPTY)").encode("ascii", "replace").decode("ascii")
    print(safe)
    print()
    print(f"=== {len(msgs)} console / error events ===")
    for m in msgs[:80]:
        print(m)
    browser.close()
