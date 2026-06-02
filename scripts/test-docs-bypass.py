"""End-to-end test of the docs-gate bypass flow."""
import json
import sys
from playwright.sync_api import sync_playwright

URL_WITH_KEY = "http://localhost:5000/data-room?key=johngreenismyfavoritewriter"
URL_BARE = "http://localhost:5000/data-room"

failures = []

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context()
    page = ctx.new_page()

    console_logs = []
    page.on("console", lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))

    # ── Step 1: visit with the bypass key ────────────────────────────────
    print("STEP 1: visit /data-room?key=… and let the gate work")
    page.goto(URL_WITH_KEY)
    page.wait_for_load_state("networkidle", timeout=15000)
    page.wait_for_timeout(1500)  # give DocsGate time to verify

    final_url = page.url
    print(f"  final URL after gate: {final_url}")
    if "?key=" in final_url:
        failures.append(f"URL still contains ?key= after gate: {final_url}")
    if not final_url.endswith("/data-room"):
        failures.append(f"URL did not land on /data-room: {final_url}")

    # Screenshot for visual confirmation
    page.screenshot(path="C:/Users/ADMIN/BlockFinaxcode-merge/scripts/test-step1.png", full_page=True)

    # Check the page does NOT show the access-code form
    page_text = page.content()
    if "Enter access code" in page_text or "Investor Data Room" in page_text and "Enter your access code" in page_text:
        failures.append("Data-room page still showing access-code form — gate did not auto-mint investor session")
        # Look for the input field specifically
    has_password_input = page.locator('input[type="password"][placeholder="Enter access code"]').count()
    print(f"  password input count on page: {has_password_input}")
    if has_password_input > 0:
        failures.append(f"Found {has_password_input} access-code password input(s) on page — investor session bypass failed")

    # Check localStorage for both tokens
    docs_token = page.evaluate("() => localStorage.getItem('bfx_docs_token')")
    investor_token = page.evaluate("() => localStorage.getItem('bfx_investor_token')")
    print(f"  bfx_docs_token in localStorage: {'YES' if docs_token else 'NO'} ({len(docs_token) if docs_token else 0} chars)")
    print(f"  bfx_investor_token in localStorage: {'YES' if investor_token else 'NO'} ({len(investor_token) if investor_token else 0} chars)")
    if not docs_token:
        failures.append("bfx_docs_token missing from localStorage after gate")
    if not investor_token:
        failures.append("bfx_investor_token missing from localStorage after gate")

    # ── Step 2: reload the bare URL — should still work ──────────────────
    print("\nSTEP 2: reload /data-room (no ?key=) and confirm we're still in")
    page.goto(URL_BARE)
    page.wait_for_load_state("networkidle", timeout=15000)
    page.wait_for_timeout(1500)

    final_url_2 = page.url
    print(f"  URL: {final_url_2}")

    page.screenshot(path="C:/Users/ADMIN/BlockFinaxcode-merge/scripts/test-step2.png", full_page=True)

    has_password_input_2 = page.locator('input[type="password"][placeholder="Enter access code"]').count()
    print(f"  password input count on page after reload: {has_password_input_2}")
    if has_password_input_2 > 0:
        failures.append(f"Found {has_password_input_2} access-code input on RELOAD — stored tokens not persisting")

    # Also confirm we're not on the docs-gate deny screen
    if "Access the docs" in page.content() and "Request access" in page.content():
        # Could be a false positive if the data-room page also contains those words, so be careful
        if has_password_input_2 == 0:  # the access-code form is gone, so this is the docs deny
            failures.append("Docs-gate deny screen showed on reload — stored docs token did not validate")

    browser.close()

# Final report
print("\n" + "=" * 60)
if failures:
    print(f"FAIL — {len(failures)} issue(s):")
    for f in failures:
        print(f"  • {f}")
    if console_logs:
        print("\nConsole logs from page:")
        for c in console_logs[-20:]:
            print(f"  {c}")
    sys.exit(1)
else:
    print("PASS — flow works end-to-end")
    sys.exit(0)
