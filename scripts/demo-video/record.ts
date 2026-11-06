/**
 * Records the BlockFinaX demo video: the problem and the solution as designed scenes, then
 * the real app on this computer, start to finish (sign up, passkey wallet, account, free test
 * USDC, buy a USD/NGN Cap, My protections). Everything in the app runs on Stellar testnet
 * for real; only the emailed sign-in code is skipped (the demo account is signed in directly).
 *
 * Run the app first (npm run dev:testnet), then in a second terminal:
 *   npm run demo:video                   captions and voice-over
 *   npm run demo:video -- --no-captions  voice-over only
 *   npm run demo:video -- --no-voice     no voice-over
 *   npm run demo:video -- --voices       list the voices on your ElevenLabs account
 *
 * The MP4 (2560 x 1440) lands in ~/Movies/BlockFinaX demos. Blockchain waits play faster.
 *
 * Voice-over uses ElevenLabs. The key is read from ELEVENLABS_API_KEY or from the file
 * ~/.blockfinax-demo.env (outside the repository), as ELEVENLABS_API_KEY=... and optionally
 * ELEVENLABS_VOICE_ID=... Spoken lines are cached, so re-recording unchanged words is free.
 */
import { chromium, type Locator, type Page } from "playwright";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import ffmpeg from "ffmpeg-static";
import { SCENE_CSS, closingScene, problemScene, riskScene, solutionScene, whyScene } from "./scenes";

const BASE = process.env.DEMO_BASE_URL || "http://localhost:5173";
const DATABASE_URL = process.env.DEMO_DATABASE_URL || "postgresql://localhost:5432/blockfinax_testnet";
const CAPTIONS = !process.argv.includes("--no-captions");
const VIEW = { width: 1600, height: 900 };
const SCALE = 2; // frames are captured at 3200 x 1800 and written at 2560 x 1440
const OUTPUT = { width: 2560, height: 1440 };
const OUT_DIR = join(homedir(), "Movies", "BlockFinaX demos");
const FAST = 6; // how much faster blockchain waits play
const LOGO = `data:image/png;base64,${readFileSync(join(import.meta.dirname, "../../client/src/assets/logo.png")).toString("base64")}`;

// ── Voice-over settings ────────────────────────────────────────────────────
function demoEnv(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  const file = join(homedir(), ".blockfinax-demo.env");
  if (!existsSync(file)) return undefined;
  const line = readFileSync(file, "utf8").split("\n").find((l) => l.trim().startsWith(`${name}=`));
  return line?.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "") || undefined;
}
const VOICE_KEY = process.argv.includes("--no-voice") ? undefined : demoEnv("ELEVENLABS_API_KEY");
const VOICE_ID = demoEnv("ELEVENLABS_VOICE_ID") || "U7wWSnxIJwCjioxt86mk"; // Olaniyi Victor: warm, rich Nigerian narrator (ElevenLabs library)
const VOICE_MODEL = "eleven_multilingual_v2";
const VOICE_SETTINGS = { stability: 0.45, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true, speed: 1.08 };
const VOICE_CACHE = join(homedir(), "Library", "Caches", "blockfinax-demo-voice");

const EMAIL = `amara.${Date.now().toString(36).slice(-4)}@okaforimports.com`;

// ── What is said and shown ──────────────────────────────────────────────────
/** A caption on screen (`show`) and the words spoken with it (`say`). Edit the words here. */
const LINE = {
  signup: { show: "Sign up with email or Google. No seed phrase, nothing to install.", say: "Sign up with just an email. No seed phrase, and nothing to install." },
  passkey: { show: "A passkey on this device becomes the wallet.", say: "A passkey on your device becomes your wallet." },
  account: { show: "Who is the account for?", say: "Tell us who the account is for," },
  details: { show: "A few company details. No documents to start.", say: "add a few company details, and you're in." },
  workspace: { show: "Live rates for the Naira, Cedi, Shilling and more.", say: "Live rates for the Naira, the Cedi, the Shilling and more." },
  fund: { show: "Try it free: claim test USDC here.", say: "To try it free, claim test USDC here. With real money, you deposit USDC from an exchange or a wallet." },
  funded: { show: "10,000 test USDC, ready. Network fees are covered.", say: "Ten thousand test USDC. And the network fees are on us." },
  exposure: { show: "Protect the $25,000 invoice for 30 days.", say: "Now, protect the twenty five thousand dollar invoice for thirty days." },
  price: { show: "One premium, paid once, covers the whole period.", say: "The price appears instantly. One premium covers the whole period." },
  review: { show: "Review, then approve with the passkey.", say: "Review, and approve with the passkey." },
  done: { show: "Protected. A contract on Stellar, backed by USDC.", say: "Done. The cover lives on Stellar, backed by USDC from underwriters." },
  payout: { show: "If the Naira weakens past the strike, the payout lands in the wallet.", say: "If the Naira weakens past the strike, the payout lands right in the wallet." },
};
type Line = (typeof LINE)[keyof typeof LINE];

/** The story before the product, each a designed scene with its narration. */
const STORY = [
  { html: problemScene(LOGO), say: "Meet Okafor Imports in Lagos. They owe a supplier twenty five thousand dollars in thirty days. But everything they earn is in Naira." },
  { html: riskScene(LOGO), say: "And the Naira can fall fast. A dollar cost about four hundred and sixty Naira in early twenty twenty three, and over fifteen hundred in twenty twenty four. That same invoice more than tripled in Naira." },
  { html: whyScene(LOGO), say: "Big companies hedge this with their banks. Smaller businesses face high minimums, heavy paperwork, or no offer at all." },
  { html: solutionScene(LOGO), dark: true, say: "BlockFinaX changes that. Protect a payment in minutes. Pay one premium in USDC, and if the rate moves past your level, you're paid the difference. Here's how." },
];
const CLOSING = { html: closingScene(LOGO), dark: true, say: "BlockFinaX. Currency protection for African businesses. Try it free, at blockfinax dot com." };

// ── Screen capture: every frame the browser paints, with its time ──────────
type Frame = { file: string; t: number };
const frames: Frame[] = [];
const fastSpans: { from: number; to: number; speed: number }[] = [];
const now = () => Date.now() / 1000;
let endedAt = 0; // when recording stopped: the last frame lasts until then

async function startCapture(page: Page, dir: string) {
  const cdp = await page.context().newCDPSession(page);
  cdp.on("Page.screencastFrame", async (f: any) => {
    const file = join(dir, `f${String(frames.length).padStart(6, "0")}.jpg`);
    writeFileSync(file, Buffer.from(f.data, "base64"));
    frames.push({ file, t: f.metadata?.timestamp ?? now() });
    await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: VIEW.width * SCALE, maxHeight: VIEW.height * SCALE, everyNthFrame: 1 });
  return async () => { endedAt = now(); await cdp.send("Page.stopScreencast").catch(() => {}); };
}

/** Run a slow step (a blockchain wait, a long form) and play it `speed` times quicker in the video. */
async function fast<T>(step: () => Promise<T>, speed = FAST): Promise<T> {
  const from = now();
  try { return await step(); } finally { fastSpans.push({ from, to: now(), speed }); }
}
const speedAt = (t: number) => fastSpans.find((s) => t >= s.from && t < s.to)?.speed ?? 1;

/**
 * Where a moment of the recording lands in the finished video, in seconds. A frame lasts
 * until the next one (the screen sends none while nothing changes), shortened inside fast
 * spans. The encoder uses exactly the same rule, so voice and picture stay together.
 */
function videoTime(t: number): number {
  let out = 0;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]!;
    if (f.t >= t) break;
    const end = Math.min(frames[i + 1]?.t ?? t, t);
    out += (end - f.t) / speedAt(f.t);
  }
  return out;
}

function encode(dir: string, out: string) {
  if (!frames.length) throw new Error("No frames were captured");
  const lines: string[] = [];
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]!;
    const next = frames[i + 1]?.t ?? Math.max(endedAt, f.t + 0.5);
    lines.push(`file '${f.file}'`, `duration ${Math.max(0.001, (next - f.t) / speedAt(f.t)).toFixed(4)}`);
  }
  lines.push(`file '${frames[frames.length - 1]!.file}'`);
  let lastEnd = 0;
  for (const v of [...spoken].sort((a, b) => a.at - b.at)) {
    const start = videoTime(v.at);
    if (start < lastEnd - 0.05) console.warn(`Warning: a voice line at ${start.toFixed(1)}s starts before the previous one ends (${lastEnd.toFixed(1)}s).`);
    lastEnd = start + v.seconds;
  }
  const list = join(dir, "frames.txt");
  writeFileSync(list, lines.join("\n"));
  const inputs = ["-f", "concat", "-safe", "0", "-i", list];
  const audio: string[] = [];
  if (spoken.length) {
    const parts = spoken.map((v, i) => {
      inputs.push("-i", v.file);
      const ms = Math.round(videoTime(v.at) * 1000);
      return `[${i + 1}:a]adelay=${ms}|${ms}[a${i}]`;
    });
    audio.push("-filter_complex", `${parts.join(";")};${spoken.map((_, i) => `[a${i}]`).join("")}amix=inputs=${spoken.length}:normalize=0:dropout_transition=0[aout]`,
      "-map", "0:v", "-map", "[aout]", "-c:a", "aac", "-b:a", "192k");
  }
  execFileSync(ffmpeg as unknown as string, [
    "-y", "-hide_banner", "-loglevel", "error", ...inputs, ...audio,
    "-vf", `scale=${OUTPUT.width}:${OUTPUT.height}:flags=lanczos,fps=30,format=yuv420p`,
    "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-tune", "animation", "-movflags", "+faststart", out,
  ], { stdio: "inherit" });
}

// ── Voice-over ──────────────────────────────────────────────────────────────
const spoken: { at: number; file: string; seconds: number }[] = [];
const voiceFiles = new Map<string, { file: string; seconds: number }>();
let speakingUntil = 0; // video time when the last sentence ends

function audioSeconds(file: string): number {
  let text = "";
  try { execFileSync(ffmpeg as unknown as string, ["-hide_banner", "-i", file], { stdio: "pipe" }); }
  catch (e: any) { text = String(e.stderr ?? ""); }
  const m = text.match(/Duration: (\d+):(\d+):([\d.]+)/);
  if (!m) throw new Error(`Could not read the length of ${file}`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** Make (or reuse) the spoken version of a line. */
async function voice(text: string) {
  if (!VOICE_KEY || voiceFiles.has(text)) return;
  mkdirSync(VOICE_CACHE, { recursive: true });
  const id = createHash("sha256").update(JSON.stringify([VOICE_ID, VOICE_MODEL, VOICE_SETTINGS, text])).digest("hex").slice(0, 24);
  const file = join(VOICE_CACHE, `${id}.mp3`);
  if (!existsSync(file)) {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": VOICE_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: VOICE_MODEL, voice_settings: VOICE_SETTINGS }),
    });
    if (!res.ok) throw new Error(`ElevenLabs refused the voice-over (${res.status}): ${(await res.text()).slice(0, 300)}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  voiceFiles.set(text, { file, seconds: audioSeconds(file) });
}

/** Wait until the previous sentence has finished, as it will play in the video. */
async function waitForVoice(page: Page) {
  for (;;) {
    const gap = speakingUntil + 0.4 - videoTime(now());
    if (gap <= 0.02) return;
    await page.waitForTimeout(gap * 1000);
  }
}

/** Start speaking a line now, after the previous one has finished. */
async function say(page: Page, text: string) {
  const v = voiceFiles.get(text);
  if (!v) return;
  await waitForVoice(page);
  const at = now();
  spoken.push({ at, ...v });
  speakingUntil = videoTime(at) + v.seconds;
}

// ── On-screen pointer, captions and scenes ──────────────────────────────────
const OVERLAY = `(() => {
  const css = ${JSON.stringify(`
    #bfx-demo-cursor{position:fixed;left:0;top:0;width:24px;height:24px;z-index:2147483647;pointer-events:none;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}
    .bfx-demo-ring{position:fixed;width:38px;height:38px;margin:-19px 0 0 -19px;border-radius:50%;border:3px solid #2457d6;z-index:2147483646;pointer-events:none;animation:bfxring .55s ease-out forwards}
    @keyframes bfxring{from{transform:scale(.3);opacity:.9}to{transform:scale(1.5);opacity:0}}
    #bfx-demo-caption{position:fixed;left:50%;bottom:34px;transform:translate(-50%,12px);max-width:72%;z-index:2147483645;pointer-events:none;
      display:flex;align-items:center;gap:14px;background:rgba(11,24,48,.94);color:#fff;font:600 21px/1.35 Inter,system-ui,sans-serif;
      padding:14px 24px 14px 16px;border-radius:16px;box-shadow:0 18px 40px rgba(11,24,48,.28);opacity:0;transition:opacity .35s,transform .35s}
    #bfx-demo-caption::before{content:'';width:5px;align-self:stretch;border-radius:4px;background:linear-gradient(#5b8cff,#10a37f)}
    #bfx-demo-caption.on{opacity:1;transform:translate(-50%,0)}
  ` + SCENE_CSS)};
  const mount = () => {
    if (document.getElementById('bfx-demo-cursor')) return;
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    const c = document.createElement('div'); c.id = 'bfx-demo-cursor';
    c.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M3 2l7.5 19 2.6-7.9L21 10.5z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.appendChild(c);
    const cap = document.createElement('div'); cap.id = 'bfx-demo-caption'; document.body.appendChild(cap);
    const scene = document.createElement('div'); scene.id = 'bfx-scene'; document.body.appendChild(scene);
    const pos = JSON.parse(sessionStorage.getItem('bfx-demo-pos') || '[800,450]');
    c.style.transform = 'translate(' + pos[0] + 'px,' + pos[1] + 'px)';
  };
  document.addEventListener('mousemove', (e) => {
    const c = document.getElementById('bfx-demo-cursor'); if (!c) return;
    c.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)';
    try { sessionStorage.setItem('bfx-demo-pos', JSON.stringify([e.clientX, e.clientY])); } catch {}
  }, true);
  document.addEventListener('mousedown', (e) => {
    const r = document.createElement('div'); r.className = 'bfx-demo-ring';
    r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
    document.body.appendChild(r); setTimeout(() => r.remove(), 650);
  }, true);
  window.__bfxCaption = (text) => { mount(); const el = document.getElementById('bfx-demo-caption'); if (!text) { el.classList.remove('on'); return; } el.textContent = text; el.classList.add('on'); };
  window.__bfxScene = (html, dark) => {
    mount(); const el = document.getElementById('bfx-scene'); const cur = document.getElementById('bfx-demo-cursor');
    cur.style.visibility = html ? 'hidden' : 'visible';
    if (!html) { el.classList.remove('on'); return; }
    el.classList.toggle('dark', !!dark); el.innerHTML = html; el.classList.add('on');
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();`;

let mouse = { x: VIEW.width / 2, y: VIEW.height / 2 };
const pause = (page: Page, ms: number) => page.waitForTimeout(ms);

async function moveTo(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error("Element is not visible");
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const steps = Math.max(14, Math.round(Math.hypot(x - mouse.x, y - mouse.y) / 16));
  await page.mouse.move(x, y, { steps });
  mouse = { x, y };
  await pause(page, 220);
}
async function click(page: Page, target: Locator) {
  await moveTo(page, target);
  await target.click();
  await pause(page, 500);
}
async function type(page: Page, target: Locator, text: string) {
  await click(page, target);
  await target.pressSequentially(text, { delay: 65 });
  await pause(page, 300);
}
async function choose(page: Page, target: Locator, value: string) {
  await moveTo(page, target);
  await target.selectOption(value);
  await pause(page, 400);
}
/** Show a caption and speak its line. `null` clears the caption once the voice has finished. */
async function caption(page: Page, line: Line | null) {
  if (line) await say(page, line.say);
  else await waitForVoice(page);
  if (CAPTIONS || !line) await page.evaluate((t) => (window as any).__bfxCaption(t), line?.show ?? null);
}
/** Show a designed scene, speak it, and hold it until the sentence ends (or a few seconds with no voice). */
async function scene(page: Page, s: { html: string; say: string; dark?: boolean }, hold = 7000) {
  await waitForVoice(page);
  await page.evaluate(([h, dark]) => (window as any).__bfxScene(h, dark), [s.html, !!s.dark] as const);
  await pause(page, 700); // let the scene fade in before the voice starts
  await say(page, s.say);
  await pause(page, VOICE_KEY ? 600 : hold);
  await waitForVoice(page);
  await pause(page, 500);
}

// ── The demo ────────────────────────────────────────────────────────────────
async function demo(page: Page) {
  const nav = (name: string) => page.locator("nav, aside").getByRole("button", { name, exact: true }).or(page.locator("nav, aside").getByRole("link", { name, exact: true })).first();

  await page.goto(`${BASE}/auth`);
  await page.waitForLoadState("networkidle");
  for (const s of STORY) await scene(page, s);
  await page.evaluate(() => (window as any).__bfxScene(null));
  await pause(page, 700);

  await caption(page, LINE.signup);
  await type(page, page.getByPlaceholder("you@company.com"), EMAIL);
  await click(page, page.getByRole("button", { name: "Email me a code" }));
  await type(page, page.getByPlaceholder("123456"), "482913");
  await click(page, page.getByRole("button", { name: "Sign in", exact: true }));
  await page.getByRole("button", { name: /Create wallet passkey/ }).waitFor();

  await caption(page, LINE.passkey);
  await pause(page, 800);
  await click(page, page.getByRole("button", { name: /Create wallet passkey/ }));
  await fast(() => page.getByRole("button", { name: /For an organisation/ }).waitFor({ timeout: 120_000 }));

  await caption(page, LINE.account);
  await click(page, page.getByRole("button", { name: /For an organisation/ }));
  await caption(page, LINE.details);
  await fast(async () => {
    await type(page, page.locator("label:has-text('Your full name') input"), "Amara Okafor");
    await type(page, page.locator("label:has-text('Your job title') input"), "Finance Director");
    await choose(page, page.locator("label:has-text('Your country of residence') select"), "NG");
    await type(page, page.locator("label:has-text('legal name') input"), "Okafor Imports Ltd");
    await choose(page, page.locator("label:has-text('Country of registration') select"), "NG");
    await type(page, page.locator("label:has-text('Registration number') input"), "RC 1482736");
    await choose(page, page.locator("label:has-text('Industry') select"), "Import and distribution");
    await choose(page, page.locator("label:has-text('Expected monthly amount') select"), "$100,000 to $1 million");
    await click(page, page.getByRole("button", { name: /Protect payments we make/ }));
  }, 3);
  await click(page, page.getByRole("button", { name: "Continue" }));

  await page.getByRole("button", { name: "Skip tour" }).waitFor({ timeout: 30_000 });
  await click(page, page.getByRole("button", { name: "Skip tour" }));
  await caption(page, LINE.workspace);
  await pause(page, 1500);

  await caption(page, LINE.fund);
  await click(page, page.getByRole("button", { name: "Deposit", exact: true }).first());
  await pause(page, 1000);
  await click(page, page.getByRole("button", { name: /test USDC/ }));
  await fast(() => page.getByText("$10,000.00", { exact: false }).first().waitFor({ timeout: 90_000 }));
  await caption(page, LINE.funded);
  await pause(page, 1200);

  await caption(page, LINE.exposure);
  await click(page, page.getByRole("button", { name: "Protect an exposure" }).first());
  await page.locator("#bx-amount").waitFor();
  await pause(page, 800);
  await type(page, page.locator("#bx-amount"), "25000");
  await click(page, page.getByRole("button", { name: "30 days" }));
  await page.getByRole("button", { name: /Review protection/ }).and(page.locator(":enabled")).waitFor({ timeout: 30_000 });
  await caption(page, LINE.price);
  await moveTo(page, page.locator(".bx-quote"));
  await pause(page, 1500);

  await caption(page, LINE.review);
  await click(page, page.getByRole("button", { name: /Review protection/ }));
  await page.getByRole("button", { name: /Confirm protection/ }).waitFor({ timeout: 30_000 });
  await pause(page, 1500);
  await waitForVoice(page);
  await click(page, page.getByRole("button", { name: /Confirm protection/ }));
  await fast(() => page.getByText("Your exposure is protected").waitFor({ timeout: 120_000 }));
  await caption(page, LINE.done);
  await pause(page, 1500);

  await click(page, nav("My protections"));
  await caption(page, LINE.payout);
  await pause(page, 1500);
  await caption(page, null);

  await scene(page, CLOSING);
  await pause(page, 1200);
}

async function listVoices() {
  if (!VOICE_KEY) throw new Error("Add ELEVENLABS_API_KEY to ~/.blockfinax-demo.env first.");
  const res = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": VOICE_KEY } });
  if (!res.ok) throw new Error(`ElevenLabs refused (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const { voices } = await res.json() as { voices: { voice_id: string; name: string; labels?: Record<string, string> }[] };
  for (const v of voices) console.log(`${v.voice_id}  ${v.name}  ${Object.values(v.labels ?? {}).join(", ")}`);
  console.log(`\nTo use one, add a line to ~/.blockfinax-demo.env:  ELEVENLABS_VOICE_ID=<the id>`);
}

async function main() {
  if (process.argv.includes("--voices")) return listVoices();
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error("The demo runs against the app on this computer only (http://localhost:...)");
  if (!(await fetch(BASE).catch(() => null))) throw new Error(`The app is not running at ${BASE}. Start it with: npm run dev:testnet`);

  if (VOICE_KEY) {
    console.log("Making the voice-over...");
    for (const text of [...STORY.map((s) => s.say), ...Object.values(LINE).map((l) => l.say), CLOSING.say]) await voice(text);
  } else if (!process.argv.includes("--no-voice")) {
    console.log("No ElevenLabs key found, so this video has no voice-over. See the top of scripts/demo-video/record.ts.");
  }

  console.log(`Demo account: ${EMAIL}`);
  const made = execFileSync("npx", ["tsx", "scripts/demo-video/session.ts", EMAIL], { env: { ...process.env, DATABASE_URL } }).toString().trim().split("\n").pop()!;
  const { token } = JSON.parse(made);

  const work = mkdtempSync(join(tmpdir(), "bfx-demo-"));
  // The flag makes the capture itself high resolution; deviceScaleFactor alone does not.
  const browser = await chromium.launch({ args: [`--force-device-scale-factor=${SCALE}`] });
  try {
    const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: SCALE, colorScheme: "light", locale: "en-GB" });
    await ctx.addInitScript(OVERLAY);
    const page = await ctx.newPage();
    // A virtual passkey stands in for Touch ID, so no system prompt interrupts the recording.
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    // The emailed code is skipped: the demo account is signed in directly.
    await page.route("**/api/wallet/auth/email/start", (r) => r.fulfill({ json: { requestId: "demo" } }));
    await page.route("**/api/wallet/auth/email/verify", (r) => r.fulfill({ json: { sessionToken: token } }));

    const stop = await startCapture(page, work);
    try {
      await demo(page);
    } catch (e) {
      await page.screenshot({ path: join(work, "failed.png") }).catch(() => {});
      console.error(`The demo stopped: ${(e as Error).message}\nScreenshot of where it stopped: ${join(work, "failed.png")}`);
      process.exitCode = 1;
    }
    await stop();
    if (process.exitCode) return;

    mkdirSync(OUT_DIR, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", ".");
    const out = join(OUT_DIR, `BlockFinaX demo ${stamp}${CAPTIONS ? "" : " (no captions)"}.mp4`);
    console.log(`Encoding ${frames.length} frames...`);
    encode(work, out);
    console.log(`Saved: ${out}`);
    rmSync(work, { recursive: true, force: true });
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
