"""Verify the Rift widget iframe loads from widget.blockfinax.com and not the old host."""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    ctx.route("**/replit.com/**", lambda r: r.abort())
    page = ctx.new_page()

    console_msgs = []
    page.on("console", lambda m: console_msgs.append(f"[{m.type}] {m.text}"))
    page.on("pageerror", lambda e: console_msgs.append(f"PAGEERR: {e}"))

    # Visit /auth — that's where the RiftAuth widget mounts. AuthGate will
    # show the deny screen for unauthenticated visitors, so we'll inspect
    # the parent /auth page DOM for any RiftAuth iframe + any console
    # violations from the widget trying to render.
    page.goto("http://localhost:5000/auth", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(4000)

    # Look for iframe(s) on the page
    iframes = page.locator("iframe").all()
    print(f"iframes on /auth page: {len(iframes)}")
    for i, frame in enumerate(iframes):
        src = frame.get_attribute("src") or "(no src)"
        print(f"  [{i}] {src[:120]}")

    # Direct check: does the RIFT_WIDGET_URL value flow through to the
    # bundled JS? Grep the served main bundle for the new host.
    import urllib.request
    main_js = ""
    try:
        with urllib.request.urlopen("http://localhost:5000/src/App.tsx") as r:
            main_js = r.read().decode("utf-8", errors="ignore")
    except Exception as e:
        print(f"could not fetch App.tsx via vite: {e}")

    contains_new = "widget.blockfinax.com" in main_js
    contains_provider_widgeturl = "widgetUrl" in main_js
    print(f"App.tsx bundle contains widget.blockfinax.com: {contains_new}")
    print(f"App.tsx bundle contains widgetUrl prop: {contains_provider_widgeturl}")

    csp_errors = [m for m in console_msgs if "Content Security Policy" in m or "Refused" in m or "blocked by CORS" in m]
    print(f"\nCSP / network violations: {len(csp_errors)}")
    for m in csp_errors[:5]:
        safe = m.encode("ascii", "replace").decode("ascii")
        print(f"  {safe}")

    page_errors = [m for m in console_msgs if m.startswith("PAGEERR") or m.startswith("[error]")]
    print(f"page errors: {len(page_errors)}")
    for m in page_errors[:5]:
        safe = m.encode("ascii", "replace").decode("ascii")
        print(f"  {safe[:200]}")

    browser.close()
