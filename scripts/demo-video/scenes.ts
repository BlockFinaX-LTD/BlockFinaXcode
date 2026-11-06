/**
 * The designed story scenes of the demo video (problem, risk, why, solution, closing), drawn
 * full screen over the app. Plain HTML and CSS with entrance animations; the recorder shows
 * one at a time.
 */

export const SCENE_CSS = `
#bfx-scene{position:fixed;inset:0;z-index:2147483644;opacity:0;pointer-events:none;transition:opacity .55s ease;
  font-family:Inter,system-ui,sans-serif;color:#0b1830;overflow:hidden;
  background:radial-gradient(1200px 700px at 85% -10%,rgba(36,87,214,.16),transparent 60%),radial-gradient(900px 600px at -10% 110%,rgba(16,163,127,.10),transparent 60%),#f6f8fc}
#bfx-scene.on{opacity:1}
#bfx-scene.dark{color:#fff;background:radial-gradient(1100px 700px at 80% 0%,rgba(80,130,255,.35),transparent 60%),radial-gradient(900px 700px at 0% 100%,rgba(16,163,127,.22),transparent 60%),#0b1830}
#bfx-scene .wrap{position:absolute;inset:0;padding:70px 96px;display:flex;flex-direction:column}
#bfx-scene .brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:20px;letter-spacing:-.01em}
#bfx-scene .brand img{width:34px;height:34px}
#bfx-scene .kicker{margin-top:46px;font-size:15px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#2457d6}
#bfx-scene.dark .kicker{color:#8fb3ff}
#bfx-scene h1{font-size:60px;line-height:1.05;letter-spacing:-.03em;margin:14px 0 0;font-weight:700;max-width:1100px}
#bfx-scene .lede{font-size:22px;line-height:1.5;color:#4a5872;margin-top:16px;max-width:900px}
#bfx-scene.dark .lede{color:#c8d4ee}
#bfx-scene .stage{flex:1;display:flex;align-items:center;gap:40px;margin-top:30px}
#bfx-scene .in{opacity:0;animation:bfxIn .7s cubic-bezier(.2,.8,.2,1) forwards}
#bfx-scene .pop{opacity:0;animation:bfxPop .6s cubic-bezier(.2,.9,.3,1.3) forwards}
@keyframes bfxIn{from{opacity:0;transform:translateY(26px)}to{opacity:1;transform:none}}
@keyframes bfxPop{from{opacity:0;transform:scale(.85)}to{opacity:1;transform:none}}
#bfx-scene .card{background:#fff;border-radius:22px;box-shadow:0 30px 70px rgba(16,36,64,.14),0 2px 6px rgba(16,36,64,.06);padding:30px 34px}
#bfx-scene .muted{color:#68778d}
#bfx-scene .num{font-family:'Geist Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums}

/* problem */
#bfx-scene .invoice{width:580px}
#bfx-scene .invoice .top{display:flex;justify-content:space-between;align-items:center;font-size:14px;letter-spacing:.14em;font-weight:700;color:#68778d}
#bfx-scene .invoice .tag{background:#e8efff;color:#2457d6;border-radius:999px;padding:6px 12px;letter-spacing:.06em}
#bfx-scene .invoice .amt{font-size:58px;font-weight:700;letter-spacing:-.02em;margin:18px 0 6px}
#bfx-scene .invoice .row{display:flex;justify-content:space-between;border-top:1px solid #edf0f5;padding:13px 0;font-size:17px}
#bfx-scene .invoice .due{color:#c2410c;font-weight:600}
#bfx-scene .vs{font-size:40px;padding:0 6px;color:#9aa6ba;font-weight:300}
#bfx-scene .earn{width:560px}
#bfx-scene .earn .big{font-size:46px;font-weight:700;margin:14px 0 4px}
#bfx-scene .earn .bars{display:flex;align-items:flex-end;gap:10px;height:110px;margin-top:18px}
#bfx-scene .earn .bars i{flex:1;background:linear-gradient(#10a37f,#5fd3b0);border-radius:8px 8px 3px 3px}
#bfx-scene .question{margin-top:26px;font-size:24px;font-weight:600}
#bfx-scene .question b{color:#2457d6}

/* risk */
#bfx-scene .chart{width:900px;padding:28px 30px 18px}
#bfx-scene .chart svg{display:block;width:100%;height:auto}
#bfx-scene .chart .line{fill:none;stroke:#e5484d;stroke-width:5;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1400;stroke-dashoffset:1400;animation:bfxDraw 2.6s .5s ease-in-out forwards}
#bfx-scene .chart .area{fill:url(#bfxArea);opacity:0;animation:bfxFade 1s 2.6s forwards}
@keyframes bfxDraw{to{stroke-dashoffset:0}}
@keyframes bfxFade{to{opacity:1}}
#bfx-scene .chart .foot{font-size:13px;margin-top:6px}
#bfx-scene .facts{display:flex;flex-direction:column;gap:20px;width:440px}
#bfx-scene .fact .k{font-size:15px;font-weight:600;color:#68778d}
#bfx-scene .fact .v{font-size:46px;font-weight:700;letter-spacing:-.02em;margin-top:4px}
#bfx-scene .fact .v.red{color:#e5484d}

/* why */
#bfx-scene .cols{display:grid;grid-template-columns:1fr 1fr;gap:32px;width:100%}
#bfx-scene .col h3{font-size:26px;margin:14px 0 18px;letter-spacing:-.01em}
#bfx-scene .col .ico{width:58px;height:58px;border-radius:16px;display:grid;place-items:center}
#bfx-scene .col li{list-style:none;display:flex;gap:14px;align-items:center;font-size:20px;padding:12px 0;border-top:1px solid #edf0f5}
#bfx-scene .col ul{margin:0;padding:0}
#bfx-scene .ok{color:#10a37f;font-weight:800}
#bfx-scene .no{color:#e5484d;font-weight:800}
#bfx-scene .col.small{outline:3px solid rgba(229,72,77,.25)}

/* solution */
#bfx-scene .steps{display:grid;grid-template-columns:repeat(3,1fr);gap:26px;width:100%}
#bfx-scene .step{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);border-radius:22px;padding:30px;backdrop-filter:blur(6px)}
#bfx-scene .step .n{width:46px;height:46px;border-radius:50%;background:#2457d6;display:grid;place-items:center;font-weight:700;font-size:20px}
#bfx-scene .step h3{font-size:26px;margin:20px 0 10px;letter-spacing:-.01em}
#bfx-scene .step p{font-size:18px;line-height:1.5;color:#c8d4ee;margin:0}
#bfx-scene .chips{display:flex;gap:12px;margin-top:30px}
#bfx-scene .chip{border:1px solid rgba(255,255,255,.25);border-radius:999px;padding:10px 18px;font-size:16px;font-weight:600}

/* closing */
#bfx-scene .center{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
#bfx-scene .center img.logo{width:132px;height:132px;padding:14px;border-radius:34px;background:#fff;box-shadow:0 24px 60px rgba(0,0,0,.35)}
#bfx-scene.dark .brand img{background:#fff;border-radius:10px;padding:3px}
#bfx-scene .center h1{font-size:64px;max-width:1000px}
#bfx-scene .cta{margin-top:34px;background:#fff;color:#0b1830;border-radius:999px;padding:18px 34px;font-size:24px;font-weight:700}
`;

const brand = (logo: string) => `<div class="brand in"><img src="${logo}" alt="">BlockFinaX</div>`;
const d = (s: number) => `style="animation-delay:${s}s"`;

export function problemScene(logo: string) {
  return `<div class="wrap">${brand(logo)}
    <div class="kicker in" ${d(0.1)}>The problem</div>
    <h1 class="in" ${d(0.2)}>A dollar invoice, paid with Naira</h1>
    <div class="stage">
      <div class="card invoice in" ${d(0.7)}>
        <div class="top"><span>INVOICE · SUPPLIER ABROAD</span><span class="tag">USD</span></div>
        <div class="amt num">$25,000.00</div>
        <div class="row"><span class="muted">Billed to</span><b>Okafor Imports Ltd, Lagos</b></div>
        <div class="row"><span class="muted">Due</span><span class="due">In 30 days</span></div>
      </div>
      <div class="vs in" ${d(1.3)}>vs</div>
      <div class="card earn in" ${d(1.6)}>
        <div class="muted" style="font-size:15px;font-weight:600">What Okafor Imports earns</div>
        <div class="big">Naira</div>
        <div class="muted" style="font-size:17px">Sales in Lagos, paid in ₦</div>
        <div class="bars"><i style="height:45%"></i><i style="height:60%"></i><i style="height:52%"></i><i style="height:75%"></i><i style="height:68%"></i><i style="height:88%"></i></div>
      </div>
    </div>
    <div class="question in" ${d(2.4)}>How many Naira will <b>$25,000</b> cost in 30 days?</div>
  </div>`;
}

/** Approximate official NGN per USD, early 2023 to late 2024 (illustrative shape; labelled points are the ones quoted). */
const RATES: [string, number][] = [["Jan 2023", 461], ["Jun 2023", 770], ["Dec 2023", 900], ["Feb 2024", 1550], ["Apr 2024", 1250], ["Oct 2024", 1650]];
function chartSvg() {
  const W = 820, H = 330, pad = { l: 56, r: 40, t: 20, b: 40 }, max = 1800;
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / (RATES.length - 1);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const pts = RATES.map(([, v], i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const grid = [0, 500, 1000, 1500].map((v) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="#edf0f5"/><text x="${pad.l - 10}" y="${y(v) + 5}" text-anchor="end" font-size="13" fill="#9aa6ba">₦${v.toLocaleString("en")}</text>`).join("");
  const labels = RATES.map(([l], i) => `<text x="${x(i)}" y="${H - 12}" text-anchor="middle" font-size="13" fill="#9aa6ba">${l}</text>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}"><defs><linearGradient id="bfxArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#e5484d" stop-opacity=".22"/><stop offset="1" stop-color="#e5484d" stop-opacity="0"/></linearGradient></defs>
    ${grid}${labels}
    <polygon class="area" points="${pts.join(" ")} ${x(RATES.length - 1)},${y(0)} ${x(0)},${y(0)}"/>
    <polyline class="line" points="${pts.join(" ")}"/>
    <circle cx="${x(0)}" cy="${y(461)}" r="7" fill="#0b1830"/>
    <circle cx="${x(RATES.length - 1)}" cy="${y(1650)}" r="8" fill="#e5484d" opacity="0" style="animation:bfxFade .4s 3s forwards"/>
  </svg>`;
}
export function riskScene(logo: string) {
  return `<div class="wrap">${brand(logo)}
    <div class="kicker in" ${d(0.1)}>The risk</div>
    <h1 class="in" ${d(0.2)}>The Naira can fall fast</h1>
    <div class="stage">
      <div class="card chart in" ${d(0.4)}>${chartSvg()}<div class="foot muted">Naira per US dollar, official rate, approximate</div></div>
      <div class="facts">
        <div class="fact in" ${d(1.0)}><div class="k">Start of 2023</div><div class="v num">₦460 per $1</div></div>
        <div class="fact in" ${d(2.6)}><div class="k">During 2024</div><div class="v num red">₦1,500+ per $1</div></div>
        <div class="fact card pop" ${d(3.6)} style="padding:22px 26px"><div class="k">The same $25,000 invoice</div><div class="v num" style="font-size:30px">₦11.5m → <span style="color:#e5484d">₦37.5m+</span></div></div>
      </div>
    </div>
  </div>`;
}

const bank = `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#2457d6" stroke-width="2"><path d="M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/></svg>`;
const shop = `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#e5484d" stroke-width="2"><path d="M4 9l1.5-5h13L20 9M4 9h16v11H4zM9 20v-6h6v6"/></svg>`;
export function whyScene(logo: string) {
  const li = (ok: boolean, t: string, s: number) => `<li class="in" ${d(s)}><span class="${ok ? "ok" : "no"}">${ok ? "✓" : "✕"}</span>${t}</li>`;
  return `<div class="wrap">${brand(logo)}
    <div class="kicker in" ${d(0.1)}>Why it keeps happening</div>
    <h1 class="in" ${d(0.2)}>Hedging is built for big companies</h1>
    <div class="stage"><div class="cols">
      <div class="card col in" ${d(0.6)}>
        <div class="ico" style="background:#e8efff">${bank}</div><h3>Large corporates</h3>
        <ul>${li(true, "Currency hedges from their bank", 1.0)}${li(true, "Credit lines to back them", 1.3)}${li(true, "Treasury teams to manage them", 1.6)}</ul>
      </div>
      <div class="card col small in" ${d(2.0)}>
        <div class="ico" style="background:#fde8e8">${shop}</div><h3>Small and mid-sized businesses</h3>
        <ul>${li(false, "Minimum sizes they cannot reach", 2.4)}${li(false, "Collateral and heavy paperwork", 2.7)}${li(false, "Often no offer at all", 3.0)}</ul>
      </div>
    </div></div>
  </div>`;
}

export function solutionScene(logo: string) {
  const step = (n: number, t: string, p: string, s: number) => `<div class="step in" ${d(s)}><div class="n">${n}</div><h3>${t}</h3><p>${p}</p></div>`;
  return `<div class="wrap">${brand(logo)}
    <div class="kicker in" ${d(0.1)}>The solution</div>
    <h1 class="in" ${d(0.2)}>Protect a payment in minutes</h1>
    <div class="lede in" ${d(0.4)}>BlockFinaX lets any business buy protection against the local currency weakening.</div>
    <div class="stage" style="flex-direction:column;align-items:stretch;justify-content:center">
      <div class="steps">
        ${step(1, "Choose your cover", "The amount, the end date and the rate where protection starts.", 0.9)}
        ${step(2, "Pay once in USDC", "One premium covers the whole period. Network fees are covered.", 1.5)}
        ${step(3, "Get paid if it moves", "If the rate passes your level at the end date, you receive the difference in USDC.", 2.1)}
      </div>
      <div class="chips in" ${d(2.8)}><span class="chip">No credit line needed</span><span class="chip">Your own wallet</span><span class="chip">Settled on Stellar</span></div>
    </div>
  </div>`;
}

export function closingScene(logo: string) {
  return `<div class="wrap"><div class="center">
    <img class="logo pop" src="${logo}" alt="">
    <h1 class="in" ${d(0.4)}>Currency protection for African businesses</h1>
    <div class="lede in" ${d(0.8)} style="text-align:center">Claim free test USDC and protect your first payment in minutes.</div>
    <div class="cta pop" ${d(1.3)}>Try it free at blockfinax.com</div>
  </div></div>`;
}
