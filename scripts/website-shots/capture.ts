/**
 * Screenshots of the real app for the website's "How each product works" section.
 *
 * Signs up a fresh account in the LOCAL app, funds it with test USDC, then walks through
 * each product for real (buy cover, open a perps position, add liquidity, fill in a swap)
 * and saves three screens per product as WebP images in the website checkout.
 * Testnet labels are hidden before each screenshot, since the website does not mention them.
 *
 * Run (with the local app on port 5173, started with the perps keys):
 *   npx tsx scripts/website-shots/capture.ts [website folder]
 */
import { chromium, type Page } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";

const BASE = "http://localhost:5173";
const SITE = process.argv[2] ?? join(homedir(), "MYWORK", "bfx-website");
const OUT = join(SITE, "client", "public", "product");
const RAW = join(tmpdir(), "bfx-shots");
const EMAIL = `amara.${Date.now().toString(36).slice(-5)}@okaforimports.com`;

/** Hide testnet wording so the images match the website, which stays silent on it. */
const CLEAN = () => {
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const hide: HTMLElement[] = [];
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const t = n.nodeValue ?? "";
    if (/^\s*testnet\s*$/i.test(t) || /Testnet, test USDC only/.test(t)) hide.push(n.parentElement!);
    else if (/Stellar Testnet/.test(t)) n.nodeValue = t.replace(/Stellar Testnet/g, "Stellar");
    else if (/test USDC/i.test(t)) n.nodeValue = t.replace(/test USDC/gi, "USDC");
  }
  hide.forEach((el) => { el.style.visibility = "hidden"; });
  document.querySelectorAll<HTMLElement>("button").forEach((b) => { if (/^\s*Ask\s*$/.test(b.textContent ?? "")) b.style.display = "none"; });
};

async function main() {
  if (!(await fetch(BASE).catch(() => null))) throw new Error(`The app is not running at ${BASE}.`);
  rmSync(RAW, { recursive: true, force: true });
  mkdirSync(RAW, { recursive: true });
  mkdirSync(OUT, { recursive: true });

  const made = execFileSync("npx", ["tsx", "scripts/demo-video/session.ts", EMAIL], { env: { ...process.env, DATABASE_URL: "postgresql://localhost:5432/blockfinax_testnet" } }).toString().trim().split("\n").pop()!;
  const { token } = JSON.parse(made);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: "light", locale: "en-GB" });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await page.route("**/api/wallet/auth/email/start", (r) => r.fulfill({ json: { requestId: "demo" } }));
  await page.route("**/api/wallet/auth/email/verify", (r) => r.fulfill({ json: { sessionToken: token } }));

  const shot = async (name: string) => {
    await page.waitForTimeout(800);
    await page.evaluate(() => { window.scrollTo(0, 0); document.querySelectorAll<HTMLElement>("main, main *").forEach((el) => { if (el.scrollTop) el.scrollTop = 0; }); });
    await page.evaluate(CLEAN);
    await page.mouse.move(1430, 890);
    await page.screenshot({ path: join(RAW, `${name}.png`) });
    console.log(`  saved ${name}`);
  };
  const home = async () => { const h = page.locator("button:visible", { hasText: /Home$/ }).first(); if (await h.count()) await h.click(); await page.waitForTimeout(1200); };
  const menu = async (section: string, item?: string) => {
    await home();
    const b = page.locator(".bx-nm-btn", { hasText: section }).first();
    if (item) { await b.hover(); await page.waitForTimeout(400); await page.locator(".bx-nm-item", { hasText: item }).first().click(); }
    else await b.click();
    await page.waitForTimeout(2500);
  };
  // ONLY=hedge,otc retakes just those products (sign-up always runs).
  const only = process.env.ONLY?.split(",");
  const step = async (label: string, fn: () => Promise<void>) => {
    if (only && label !== "sign up" && !only.includes(label)) return;
    console.log(label);
    try { await fn(); } catch (e) { console.error(`  ${label} stopped: ${(e as Error).message.split("\n")[0]}`); await page.screenshot({ path: join(RAW, `failed-${label}.png`) }).catch(() => {}); }
  };

  try {
    await step("sign up", async () => {
      await page.goto(`${BASE}/auth`); await page.waitForTimeout(1500);
      await page.getByPlaceholder("you@company.com").fill(EMAIL);
      await page.getByRole("button", { name: "Email me a code" }).click();
      await page.getByPlaceholder("123456").fill("482913");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.getByPlaceholder("As on your ID").fill("Amara Okafor");
      await page.locator("label:has-text('Country of residence') select").selectOption("NG");
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.getByRole("button", { name: /Create wallet passkey/ }).click();
      await page.getByRole("button", { name: "Skip tour" }).click({ timeout: 120_000 });
      await page.getByRole("button", { name: "Deposit", exact: true }).first().click();
      await page.getByRole("button", { name: /test USDC/ }).click();
      await page.getByText("$10,000.00", { exact: false }).first().waitFor({ timeout: 90_000 });
    });

    await step("hedge", async () => {
      await menu("Hedge", "Buy cover");
      await page.locator("#bx-amount").fill("25000");
      await page.getByRole("button", { name: "30 days" }).first().click().catch(() => {});
      await page.getByRole("button", { name: /Review protection/ }).and(page.locator(":enabled")).waitFor({ timeout: 45_000 });
      await shot("hedge-1");
      await page.getByRole("button", { name: /Review protection/ }).click();
      await page.getByRole("button", { name: /Confirm protection/ }).waitFor();
      await shot("hedge-2");
      await page.getByRole("button", { name: /Confirm protection/ }).click();
      await page.getByText("Your exposure is protected").waitFor({ timeout: 150_000 });
      // "Protect another" returns to the form, with the new cover in the Active list below.
      await page.getByRole("button", { name: "Protect another" }).click();
      await page.waitForTimeout(4000);
      await shot("hedge-3");
    });

    await step("trade", async () => {
      await menu("Trade");
      await page.getByText("Loading perps").waitFor({ state: "detached", timeout: 90_000 }).catch(() => {});
      await page.getByRole("button", { name: "Enable trading" }).click();
      await page.getByRole("button", { name: "Enable trading" }).waitFor({ state: "detached", timeout: 120_000 });
      await page.locator("#px-deposit-btn").click();
      await page.locator("#px-move-amt").fill("2000");
      await page.locator(".px-move .px-cta").click();
      await page.locator("#px-size").waitFor();
      await page.waitForFunction(() => !document.body.innerText.includes("Deposit USDC to trade"), null, { timeout: 120_000 });
      await page.locator("#px-size").fill("5000");
      await page.waitForTimeout(1000);
      await shot("trade-1");
      await page.locator(".px-cta.buy").click();
      await page.getByText("No open positions.").waitFor({ state: "detached", timeout: 120_000 });
      await page.locator("#px-size").fill("");
      await page.waitForTimeout(9000); // let the "Deposited" and "Order filled" notices fade
      await shot("trade-2");
      await page.getByRole("button", { name: "Trade history" }).click();
      await page.waitForTimeout(2000);
      await shot("trade-3");
    });

    await step("underwrite", async () => {
      await menu("Hedge", "Underwrite");
      await page.waitForTimeout(2000);
      await shot("earn-1");
      const amount = page.locator(".uw-side input, aside input, input[inputmode='decimal']").first();
      await amount.fill("5000");
      await page.waitForTimeout(800);
      await page.getByRole("button", { name: "Add liquidity", exact: true }).last().click();
      await page.waitForTimeout(25_000);
      await shot("earn-2");
      await page.getByRole("button", { name: /Cover bought/ }).click();
      await page.waitForTimeout(2000);
      await shot("earn-3");
    });

    await step("otc", async () => {
      await menu("OTC");
      await page.locator("#ox-amount").fill("11800");
      await shot("otc-1");
      await page.locator(".ox-coin.pick").first().click();
      await page.waitForTimeout(600);
      await shot("otc-2");
      await page.getByRole("option", { name: /NGN/ }).first().click();
      await page.getByRole("button", { name: "Sell USDC" }).click();
      await page.locator("#ox-amount").fill("1000");
      await shot("otc-3");
    });
  } finally {
    await browser.close();
  }

  // Compress for the web: WebP, 1440 wide.
  for (const f of ["hedge-1", "hedge-2", "hedge-3", "trade-1", "trade-2", "trade-3", "earn-1", "earn-2", "earn-3", "otc-1", "otc-2", "otc-3"]) {
    const src = join(RAW, `${f}.png`);
    if (!existsSync(src)) { console.log(`missing ${f}`); continue; }
    execFileSync("cwebp", ["-quiet", "-q", "82", src, "-o", join(OUT, `${f}.webp`)]);
  }
  console.log(`Done. Images in ${OUT}; raw screenshots in ${RAW}`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
