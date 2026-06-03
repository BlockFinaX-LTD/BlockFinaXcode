"""
End-to-end test of the invited-user flow.

Verifies:
1. Sliding-window renewal — server pushes expiry from 10d → 90d on verify
2. /api/docs/verify also returns a fresh investor token
3. AuthGate stores the signin token in localStorage after ?t=
4. Reloading /auth (bare URL) still passes the gate — no magic link needed
5. DocsGate stores the docs token in localStorage after ?t=
6. Reloading /whitepaper (bare URL) still renders — no request again
"""
import json
import subprocess
import sys
import time
import urllib.request
import urllib.parse
from playwright.sync_api import sync_playwright

ORIGIN = "http://localhost:5000"
NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000
THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

failures = []

# ── Step A: mint fresh test tokens with short (10-day) expiry ──────────
print("STEP A: mint test tokens with 10-day expiry (inside the renewal window)")
out = subprocess.run(
    ["npx", "tsx", "scripts/mint-test-tokens.ts"],
    capture_output=True, text=True, shell=True,
)
if out.returncode != 0:
    print(out.stderr)
    sys.exit(2)
data = json.loads(out.stdout.strip().splitlines()[-1])
signin_token = data["signin"]
docs_token = data["docs"]
expires_before_ms = int(time.mktime(time.strptime(data["expiresAtBefore"][:19], "%Y-%m-%dT%H:%M:%S")) * 1000)
print(f"  signin token: {signin_token[:12]}…")
print(f"  docs token:   {docs_token[:12]}…")
print(f"  expires (before verify): {data['expiresAtBefore']}")

# ── Step B: test sliding-window renewal on signin-verify ───────────────
print("\nSTEP B: hit /api/access/signin-verify — expect expiry pushed to ~90 days")
req = urllib.request.Request(
    f"{ORIGIN}/api/access/signin-verify?t={urllib.parse.quote(signin_token)}",
)
with urllib.request.urlopen(req) as r:
    body = json.loads(r.read())
print(f"  response: {body}")
if not body.get("valid"):
    failures.append(f"signin-verify returned invalid for a fresh token: {body}")
else:
    new_expiry = body["expiresAt"]
    new_ms = int(time.mktime(time.strptime(new_expiry[:19], "%Y-%m-%dT%H:%M:%S")) * 1000)
    days_out = (new_ms - time.time() * 1000) / (24 * 60 * 60 * 1000)
    print(f"  new expiresAt = {new_expiry}  ({days_out:.1f} days from now)")
    if days_out < 60:
        failures.append(f"signin-verify did NOT renew — only {days_out:.1f} days out (expected ~90)")
    else:
        print("  [OK] sliding window pushed expiry forward")

# ── Step C: test sliding-window renewal + investor mint on docs-verify ──
print("\nSTEP C: hit /api/docs/verify — expect renewed expiry + investorToken")
req = urllib.request.Request(
    f"{ORIGIN}/api/docs/verify?t={urllib.parse.quote(docs_token)}",
)
with urllib.request.urlopen(req) as r:
    body = json.loads(r.read())
print(f"  response keys: {list(body.keys())}")
print(f"  valid: {body.get('valid')}")
if not body.get("valid"):
    failures.append(f"docs-verify returned invalid: {body}")
else:
    new_expiry = body["expiresAt"]
    new_ms = int(time.mktime(time.strptime(new_expiry[:19], "%Y-%m-%dT%H:%M:%S")) * 1000)
    days_out = (new_ms - time.time() * 1000) / (24 * 60 * 60 * 1000)
    print(f"  new expiresAt = {new_expiry}  ({days_out:.1f} days from now)")
    if days_out < 60:
        failures.append(f"docs-verify did NOT renew — only {days_out:.1f} days out")
    else:
        print("  [OK] sliding window pushed expiry forward")
    if not body.get("investorToken"):
        failures.append("docs-verify did NOT return investorToken")
    else:
        print(f"  [OK] investor session auto-minted ({len(body['investorToken'])} chars)")

# Re-mint fresh tokens (the previous ones were just verified above but we want
# to test the UI gate independently from a clean state)
print("\nSTEP D: re-mint fresh tokens for the UI test")
out = subprocess.run(
    ["npx", "tsx", "scripts/mint-test-tokens.ts"],
    capture_output=True, text=True, shell=True,
)
data = json.loads(out.stdout.strip().splitlines()[-1])
signin_token = data["signin"]
docs_token = data["docs"]

# ── Step E: Playwright — magic-link click → /auth ──────────────────────
print(f"\nSTEP E: drive browser to /auth?t=<signin> and check localStorage persists")
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context()
    ctx.route("**/replit.com/**", lambda r: r.abort())
    page = ctx.new_page()

    page.goto(f"{ORIGIN}/auth?t={signin_token}", wait_until="domcontentloaded", timeout=60000)
    # Wait for AuthGate to leave its "Checking access..." state
    page.wait_for_function(
        "() => !document.body.innerText.includes('Checking access')",
        timeout=20000,
    )
    page.wait_for_timeout(1500)

    url = page.url
    print(f"  URL after gate: {url}")
    if "?t=" in url:
        failures.append(f"/auth still has ?t= in URL — token not consumed")

    bfx_signin = page.evaluate("() => localStorage.getItem('bfx_signin_token')")
    rift_id = page.evaluate("() => localStorage.getItem('rift:identity')")
    print(f"  bfx_signin_token in localStorage: {'YES' if bfx_signin else 'NO'}")
    print(f"  rift:identity in localStorage: {'YES' if rift_id else 'NO'} (none expected until they sign in via widget)")
    if not bfx_signin:
        failures.append("bfx_signin_token NOT in localStorage after /auth?t= — gate didn't store it")

    page.screenshot(path="C:/Users/ADMIN/BlockFinaxcode-merge/scripts/test-invited-step-e.png", full_page=True)

    # Reload bare /auth — should still pass AuthGate
    print("\nSTEP F: reload bare /auth (no ?t=) — AuthGate should accept stored token")
    page.goto(f"{ORIGIN}/auth", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_function(
        "() => !document.body.innerText.includes('Checking access')",
        timeout=20000,
    )
    page.wait_for_timeout(1500)

    # AuthGate's deny screen shows "Sign-in is by invitation only" or
    # "Submit a short application". If we land on either, the stored token failed.
    page_text = page.content()
    has_deny = ("Sign-in is by invitation only" in page_text or
                "Submit a short application" in page_text or
                "sign-in link has expired" in page_text)
    print(f"  AuthGate deny screen visible: {has_deny}")
    if has_deny:
        failures.append("AuthGate showed deny screen on bare /auth reload — stored signin token rejected")

    page.screenshot(path="C:/Users/ADMIN/BlockFinaxcode-merge/scripts/test-invited-step-f.png", full_page=True)

    # ── Step G: docs magic link click → /whitepaper ──────────────────
    print(f"\nSTEP G: drive browser to /whitepaper?t=<docs> and check storage + render")
    ctx2 = browser.new_context()
    ctx2.route("**/replit.com/**", lambda r: r.abort())
    page2 = ctx2.new_page()
    page2.goto(f"{ORIGIN}/whitepaper?t={docs_token}", wait_until="domcontentloaded", timeout=60000)
    page2.wait_for_function(
        "() => !document.body.innerText.includes('Verifying access')",
        timeout=20000,
    )
    page2.wait_for_timeout(1500)

    url2 = page2.url
    print(f"  URL after gate: {url2}")
    if "?t=" in url2:
        failures.append(f"/whitepaper still has ?t= in URL — token not consumed")

    bfx_docs = page2.evaluate("() => localStorage.getItem('bfx_docs_token')")
    bfx_investor = page2.evaluate("() => localStorage.getItem('bfx_investor_token')")
    print(f"  bfx_docs_token in localStorage: {'YES' if bfx_docs else 'NO'}")
    print(f"  bfx_investor_token in localStorage: {'YES' if bfx_investor else 'NO'}")
    if not bfx_docs:
        failures.append("bfx_docs_token NOT in localStorage after /whitepaper?t= — gate didn't store it")
    if not bfx_investor:
        failures.append("bfx_investor_token NOT in localStorage — verify did not return investor token")

    # ── Step H: reload bare /whitepaper — should still render ────────
    print(f"\nSTEP H: reload bare /whitepaper — DocsGate should accept stored token")
    page2.goto(f"{ORIGIN}/whitepaper", wait_until="domcontentloaded", timeout=60000)
    page2.wait_for_function(
        "() => !document.body.innerText.includes('Verifying access')",
        timeout=20000,
    )
    page2.wait_for_timeout(1500)

    page_text2 = page2.content()
    # DocsGate deny shows "Access the docs" + a "Request access" button
    has_deny2 = "Access the docs" in page_text2 and "behind a 7-day" in page_text2.lower() or "request access" in page_text2.lower() and "magic-link gate" in page_text2.lower()
    # Looser check: is the request-access CTA the primary thing on screen?
    request_btn = page2.locator('button:has-text("Request access")').count()
    print(f"  'Request access' button count: {request_btn}")
    if request_btn > 0:
        failures.append(f"DocsGate showed deny on bare /whitepaper reload — stored docs token rejected")

    page2.screenshot(path="C:/Users/ADMIN/BlockFinaxcode-merge/scripts/test-invited-step-h.png", full_page=True)

    browser.close()

# Report
print("\n" + "=" * 60)
if failures:
    print(f"FAIL — {len(failures)} issue(s):")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
else:
    print("PASS — invited-user flow works end-to-end")
    print("  - Server sliding-window renewal: tokens 10d->90d on verify")
    print("  - Docs verify auto-mints fresh investor session")
    print("  - Signin token persists in localStorage; /auth reload still passes")
    print("  - Docs token persists in localStorage; /whitepaper reload still renders")
    sys.exit(0)
