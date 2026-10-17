import { test, expect, Browser, Page, CDPSession } from "@playwright/test";
import { spawn, ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
let server: ChildProcess;
let logs = "";
const authenticators = new Map<Page, { cdp: CDPSession; authenticatorId: string }>();
test.beforeAll(async () => {
  server = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    env: {
      ...process.env,
      APP_ORIGIN: "http://localhost:5178",
      PORT: "4180",
      DATABASE_PATH: join(
        mkdtempSync(join(tmpdir(), "bfx-wallet-")),
        "wallet.db",
      ),
      RESEND_API_KEY: "",
      EMAIL_DELIVERY: "console",
      SESSION_SECRET: "test-session-key-".repeat(4),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout!.on("data", (chunk) => {
    logs += chunk;
  });
  server.stderr!.on("data", (chunk) => {
    logs += chunk;
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch("http://localhost:4180/api/health")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error(logs);
});
test.afterAll(() => {
  server?.kill("SIGTERM");
});
async function signIn(browser: Browser, email: string, existingPage?: Page) {
  const context = existingPage?.context() || await browser.newContext();
  const page = existingPage || await context.newPage();
  page.on("pageerror", (error) =>
    console.info("Browser error:", error.message),
  );
  page.on("response", async (response) => {
    if (response.url().includes("/api/wallet/") && response.status() >= 400)
      console.info("Wallet API error:", await response.text());
  });
  if (!existingPage) {
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    authenticators.set(page, { cdp, authenticatorId });
  }
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send verification code" }).click();
  await expect(page.getByRole("status")).toContainText("Check your email");
  const entry = logs
    .split("\n")
    .filter((line) => line.startsWith(`[local email code] ${email}: `)).at(-1);
  expect(
    entry,
    "Local test delivery contains a verification code",
  ).toBeTruthy();
  const code = entry!.split(": ").at(-1)!;
  await page.getByLabel("Verification code", { exact: true }).fill(code);
  await page.getByRole("button", { name: "Verify code", exact: true }).click();
  if (!existingPage) {
    await expect(
      page.getByRole("button", { name: "Create wallet with a passkey" }),
    ).toBeVisible();
  } else {
    await expect(page.getByTestId("wallet-address")).toBeVisible();
  }
  return page;
}
async function create(page: Page) {
  await page
    .getByRole("button", { name: "Create wallet with a passkey" })
    .click();
  await expect
    .poll(
      async () => {
        if (await page.getByRole("alert").count())
          throw Error(await page.getByRole("alert").innerText());
        return (await page.getByRole("status").count())
          ? await page.getByRole("status").innerText()
          : "";
      },
      { timeout: 90000 },
    )
    .toContain("wallet is ready");
  return (await page.getByTestId("wallet-address").textContent())!;
}
test("create, sign a payment, sign back in, reject a missing passkey and reconnect after credential restore", async ({
  browser,
}) => {
  test.setTimeout(300000);
  const firstEmail = `alice-${Date.now()}@example.com`;
  const first = await signIn(browser, firstEmail);
  const firstAddress = await create(first);
  const second = await signIn(browser, `bob-${Date.now()}@example.com`);
  const secondAddress = await create(second);
  await first.getByRole("button", { name: "Receive", exact: true }).click();
  await first.getByRole("button", { name: "Receive test funds" }).click();
  await expect(first.getByRole("status")).toContainText(
    "100 test XLM received",
    { timeout: 90000 },
  );
  await first.getByRole("button", { name: "Close", exact: true }).click();
  await first.getByRole("button", { name: "Send", exact: true }).click();
  await first.getByLabel("Asset").selectOption("XLM");
  await first.getByLabel("Recipient Stellar address").fill(secondAddress);
  await first.getByLabel("Amount · test XLM").fill("5");
  await first
    .getByRole("button", { name: "Approve with passkey and send" })
    .click();
  await expect
    .poll(
      async () => {
        if (await first.getByRole("alert").count())
          throw Error(await first.getByRole("alert").innerText());
        return (await first.getByRole("status").count())
          ? await first.getByRole("status").innerText()
          : "";
      },
      { timeout: 90000 },
    )
    .toContain("Payment confirmed");
  await first.getByRole("button", { name: "Close", exact: true }).click();
  await second
    .getByRole("button", { name: "Refresh balance", exact: true })
    .click();
  await expect(second.getByTestId("wallet-balance")).toContainText("5");
  await first.reload();
  await first.getByRole("button", { name: "Unlock with passkey" }).click();
  await expect(first.getByRole("status")).toContainText("Wallet unlocked", { timeout: 30000 });
  expect(await first.getByTestId("wallet-address").textContent()).toBe(
    firstAddress,
  );
  const duplicate = await first.request.post("/api/wallet/faucet", {
    headers: { Origin: "http://localhost:5178" },
    data: {},
  });
  expect(duplicate.status()).toBe(400);
  expect((await duplicate.json()).error).toContain("24 hours");
  await first.evaluate(() => window.scrollTo(0, 0));
  await first.evaluate(() => document.fonts.ready);
  await first.screenshot({
    path: "test-results/wallet-desktop.png",
    fullPage: true,
  });
  await first.getByRole("button", { name: "Toggle theme" }).click();
  await expect(first.locator(".bfx-app")).toHaveAttribute(
    "data-theme",
    "light",
  );
  await first.getByRole("button", { name: "Toggle theme" }).click();
  await first.setViewportSize({ width: 390, height: 844 });
  await first.evaluate(() => window.scrollTo(0, 0));
  await first.screenshot({
    path: "test-results/wallet-mobile.png",
    fullPage: true,
  });
  await first.getByRole("button", { name: "Receive", exact: true }).click();
  await expect(
    first.getByRole("dialog", { name: "Receive", exact: true }),
  ).toBeVisible();
  await first.screenshot({ path: "test-results/wallet-receive-mobile.png" });
  await first.getByRole("button", { name: "Close", exact: true }).click();
  await first
    .locator(".tabbar")
    .getByRole("button", { name: "Profile", exact: true })
    .click();
  await expect(
    first.getByRole("heading", { name: "Your account" }),
  ).toBeVisible();
  expect(
    await first.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  // Re-authenticating the application must reconnect to the original wallet;
  // it must never create a replacement wallet or replace its signing key.
  await first.getByRole("button", { name: "Sign out", exact: true }).click();
  await signIn(browser, firstEmail, first);
  expect(await first.getByTestId("wallet-address").textContent()).toBe(firstAddress);
  const replacement = await first.request.post("/api/wallet/registration/options", {
    headers: { Origin: "http://localhost:5178" }, data: {},
  });
  expect(replacement.status()).toBe(400);

  // Temporarily remove the authenticator's credential to model an unavailable
  // device. Email login is deliberately insufficient to unlock the wallet.
  const { cdp, authenticatorId } = authenticators.get(first)!;
  const { credentials } = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
  expect(credentials).toHaveLength(1);
  await cdp.send("WebAuthn.clearCredentials", { authenticatorId });
  await first.route("**/api/wallet/unlock/options", async (route) => {
    const response = await route.fetch();
    const options = await response.json();
    await route.fulfill({ response, json: { ...options, timeout: 1000 } });
  });
  await first.getByRole("button", { name: "Unlock with passkey", exact: true }).first().click();
  await expect(first.getByRole("alert")).toBeVisible({ timeout: 30000 });
  expect(await first.getByTestId("wallet-address").textContent()).toBe(firstAddress);
  await first.unroute("**/api/wallet/unlock/options");
  // Restoring the SAME credential models a password-manager restore. This is
  // not a test of iCloud/Google sync or recovery with a new signing key.
  await first.reload();
  for (const credential of credentials)
    await cdp.send("WebAuthn.addCredential", { authenticatorId, credential });
  await cdp.send("WebAuthn.setAutomaticPresenceSimulation", {
    authenticatorId, enabled: true,
  });
  await first.getByRole("button", { name: "Unlock with passkey", exact: true }).first().click();
  await expect(first.getByRole("status")).toContainText("Wallet unlocked", { timeout: 30000 });
  expect(await first.getByTestId("wallet-address").textContent()).toBe(firstAddress);
  console.info(
    JSON.stringify({
      firstAddress,
      secondAddress,
      test: "real Stellar testnet passkey payment",
    }),
  );
});
