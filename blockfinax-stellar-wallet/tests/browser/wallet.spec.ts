import { test, expect, Browser, Page } from "@playwright/test";
import { spawn, ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
let server: ChildProcess;
let logs = "";
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
async function signIn(browser: Browser, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (error) =>
    console.info("Browser error:", error.message),
  );
  page.on("response", async (response) => {
    if (response.url().includes("/api/wallet/") && response.status() >= 400)
      console.info("Wallet API error:", await response.text());
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send verification code" }).click();
  await expect(page.getByRole("status")).toContainText("Check your email");
  const entry = logs
    .split("\n")
    .find((line) => line.startsWith(`[local email code] ${email}: `));
  expect(
    entry,
    "Local test delivery contains a verification code",
  ).toBeTruthy();
  const code = entry!.split(": ").at(-1)!;
  await page.getByLabel("Verification code", { exact: true }).fill(code);
  await page.getByRole("button", { name: "Verify code", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Create wallet with a passkey" }),
  ).toBeVisible();
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
test("create two passkey wallets, receive funds, pay, and reconnect", async ({
  browser,
}) => {
  const first = await signIn(browser, `alice-${Date.now()}@example.com`);
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
  await expect(first.getByRole("status")).toContainText("Wallet unlocked");
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
  console.info(
    JSON.stringify({
      firstAddress,
      secondAddress,
      test: "real Stellar testnet passkey payment",
    }),
  );
});
