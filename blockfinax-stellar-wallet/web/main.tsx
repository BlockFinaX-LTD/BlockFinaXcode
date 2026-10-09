import "./polyfills";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  startRegistration,
  startAuthentication,
} from "@simplewebauthn/browser";
import { PasskeyKit, SACClient } from "passkey-kit";
import {
  LayoutDashboard,
  Shield,
  TrendingUp,
  User,
  Search,
  Bell,
  Moon,
  Sun,
  Eye,
  EyeOff,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  ArrowRight,
  Gift,
  Plus,
  Copy,
  X,
  Lock,
  LogOut,
  Check,
  Wallet as WalletIcon,
} from "lucide-react";
import "./app-ui.css";
import "./app-extra.css";
import "./style.css";
type Config = {
  networkPassphrase: string;
  rpcUrl: string;
  walletWasmHash: string;
  tokenContract: string;
  rpId: string;
  googleEnabled: boolean;
  sponsorshipConfigured: boolean;
};
type Wallet = { contract: string; credential: string };
type Profile = {
  email: string;
  wallet: Wallet | null;
  events: { kind: string; hash: string; created: number }[];
};
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw Error(value.error || "Request failed");
  return value;
}
function amount(value: string) {
  if (!/^\d+(\.\d{1,7})?$/.test(value))
    throw Error("Enter an amount with up to seven decimal places");
  const [whole, fraction = ""] = value.split(".");
  const result = BigInt(whole) * 10000000n + BigInt(fraction.padEnd(7, "0"));
  if (result <= 0n || result > 1000_0000000n)
    throw Error("Send between 0 and 1,000 test XLM");
  return result;
}
function App() {
  const [config, setConfig] = useState<Config>();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [kit, setKit] = useState<PasskeyKit>();
  const [unlocked, setUnlocked] = useState(false);
  const [email, setEmail] = useState("");
  const [emailRequest, setEmailRequest] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [balance, setBalance] = useState("0");
  const [recipient, setRecipient] = useState("");
  const [quantity, setQuantity] = useState("");
  const [tab, setTab] = useState("Home");
  const [sheet, setSheet] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [theme, setTheme] = useState(() =>
    localStorage.getItem("bfx-theme") === "light" ? "light" : "dark",
  );
  const [search, setSearch] = useState("");
  useEffect(() => {
    localStorage.setItem("bfx-theme", theme);
  }, [theme]);
  async function refresh() {
    const me = await api<Profile>("/me");
    setProfile(me);
    if (me.wallet) {
      const result = await api<{ stroops: string }>("/wallet/balance");
      setBalance(
        (Number(result.stroops) / 1e7).toLocaleString("en-US", {
          maximumFractionDigits: 7,
        }),
      );
    }
  }
  async function run(label: string, work: () => Promise<void>) {
    setBusy(label);
    setError("");
    setMessage("");
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  useEffect(() => {
    void (async () => {
      try {
        const cfg = await api<Config>("/config");
        setConfig(cfg);
        setKit(new PasskeyKit(cfg));
        try {
          await refresh();
        } catch {
          /* Signed-out visitor. */
        }
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);
  async function connect(wallet: Wallet) {
    await kit!.connectWallet({
      keyId: wallet.credential,
      getContractId: async () => wallet.contract,
      verifyWasmHash: true,
    });
    if (kit!.contractId !== wallet.contract) {
      kit!.disconnect();
      throw Error("Wallet address mismatch");
    }
    setUnlocked(true);
  }
  async function create() {
    const options = await api<
      Parameters<typeof startRegistration>[0]["optionsJSON"]
    >("/wallet/registration/options", {});
    const response = await startRegistration({ optionsJSON: options });
    const wallet = await api<Wallet>("/wallet/registration/verify", response);
    await connect(wallet);
    await refresh();
    setMessage("Your Stellar testnet wallet is ready.");
  }
  async function unlock() {
    const options = await api<
      Parameters<typeof startAuthentication>[0]["optionsJSON"]
    >("/wallet/unlock/options", {});
    const response = await startAuthentication({ optionsJSON: options });
    const wallet = await api<Wallet>("/wallet/unlock/verify", response);
    await connect(wallet);
    setMessage("Wallet unlocked. Each payment needs your passkey approval.");
  }
  async function send() {
    if (!unlocked || !profile?.wallet || !config || !kit)
      throw Error("Unlock your wallet first");
    const token = new SACClient(config).getSACClient(config.tokenContract);
    const tx = await token.transfer({
      from: profile.wallet.contract,
      to: recipient.trim(),
      amount: amount(quantity),
    });
    await kit.sign(tx);
    if (!tx.built) throw Error("Payment was not built");
    const result = await api<{ hash: string }>("/wallet/payments", {
      xdr: tx.built.toXDR(),
    });
    setQuantity("");
    setMessage(`Payment confirmed on testnet. Transaction: ${result.hash}`);
    try {
      await refresh();
    } catch {
      setMessage(
        `Payment confirmed on testnet. Transaction: ${result.hash}. Balance refresh is temporarily unavailable.`,
      );
    }
  }
  const notice = (
    <>
      <div className="testnet-label">
        <span className="testnet-dot" /> STELLAR TESTNET{" "}
        <span>Test tokens only</span>
      </div>
      {error && (
        <div role="alert" className="feedback error">
          {error}
        </div>
      )}
      {message && (
        <div role="status" className="feedback success">
          {message}
        </div>
      )}
    </>
  );
  const nav = [
    { name: "Home", icon: LayoutDashboard },
    { name: "Cover", icon: Shield },
    { name: "Earn", icon: TrendingUp },
    { name: "Profile", icon: User },
  ];
  const fullAddress = profile?.wallet?.contract || "";
  const shortAddress = fullAddress
    ? `${fullAddress.slice(0, 6)}…${fullAddress.slice(-4)}`
    : "Create your wallet";
  const balanceParts = balance.split(".");
  const copy = () =>
    void run("Copying", async () => {
      await navigator.clipboard.writeText(fullAddress);
      setMessage("Address copied.");
    });
  const activity = (
    <div className="sec">
      <div className="sec-h">
        <h2>Recent activity</h2>
        <button className="more" onClick={() => setSheet("History")}>
          History <ArrowRight />
        </button>
      </div>
      <div className="list act">
        {profile?.events.length ? (
          profile.events.slice(0, 6).map((event, i) => (
            <a
              className="row"
              key={i}
              href={`https://stellar.expert/explorer/testnet/tx/${event.hash}`}
              target="_blank"
              rel="noreferrer"
            >
              <span className="actico">
                {event.kind.startsWith("Sent") ? <ArrowUp /> : <ArrowDown />}
              </span>
              <div className="r-main">
                <div className="r1">{event.kind}</div>
                <div className="r2">
                  Stellar testnet · {event.hash.slice(0, 6)}…
                  {event.hash.slice(-4)}
                </div>
              </div>
              <div className="r-side">
                <div className="v2">
                  {new Date(event.created).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
            </a>
          ))
        ) : (
          <div className="row">
            <span className="actico">
              <TrendingUp />
            </span>
            <div className="r-main">
              <div className="r1">No activity yet</div>
              <div className="r2">Your test payments show here</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
  const balances = (
    <div className="topgrid reveal in">
      <div className={`balance${hidden ? " hidden" : ""}`}>
        <div className="bal-top">
          <span className="bal-k">Total balance</span>
          <button
            className="eye"
            aria-label={hidden ? "Show balance" : "Hide balance"}
            onClick={() => setHidden(!hidden)}
          >
            {hidden ? <EyeOff /> : <Eye />}
          </button>
          <button
            className="eye"
            aria-label="Refresh balance"
            disabled={!!busy}
            onClick={() => void run("Refreshing", refresh)}
          >
            <RefreshCw className={busy === "Refreshing" ? "spin" : ""} />
          </button>
        </div>
        <div className="bal-num" data-testid="wallet-balance">
          <span className="int">{hidden ? "••••••" : balanceParts[0]}</span>
          <span className="cents">
            {!hidden && balanceParts[1] ? `.${balanceParts[1]}` : ""}
          </span>
          <span className="xlm-unit">test XLM</span>
        </div>
        <div className="quick">
          <button className="qa" onClick={() => setSheet("Send")}>
            <span className="qi">
              <ArrowUp />
            </span>
            <span className="ql">Send</span>
          </button>
          <button className="qa" onClick={() => setSheet("Receive")}>
            <span className="qi">
              <ArrowDown />
            </span>
            <span className="ql">Receive</span>
          </button>
          <button className="qa" onClick={() => setTab("Cover")}>
            <span className="qi">
              <Shield />
            </span>
            <span className="ql">Cover</span>
          </button>
        </div>
      </div>
      <div className="side-stack">
        <div className="split-card wallet">
          <div className="sk">Wallet</div>
          <div className="sv tnum">
            {hidden ? "•••••" : balance} <small>XLM</small>
          </div>
          <div className="ss">1 test asset</div>
        </div>
        <div className="split-card pool">
          <div className="sk">Pools</div>
          <div className="sv tnum">—</div>
          <div className="ss">Stellar pools coming soon</div>
        </div>
      </div>
    </div>
  );
  return (
    <div className="bfx-app" data-theme={theme}>
      {!profile ? (
        <div className="auth-page" aria-hidden={sheet ? true : undefined}>
          <div className="auth-panel">
            <img src="/logo.png" alt="BlockFinaX" />
            <h1>BlockFinaX</h1>
            <p>Cross-border payments &amp; cover</p>
            <span className="auth-network">
              STELLAR TESTNET · Test tokens only
            </span>
            <div className="auth-actions">
              <button
                className="btn btn-primary"
                onClick={() => setSheet("Sign in")}
              >
                Sign in
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => setSheet("Create account")}
              >
                Create account
              </button>
            </div>
            {error && (
              <div role="alert" className="feedback error">
                {error}
              </div>
            )}
            {message && (
              <div role="status" className="feedback success">
                {message}
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="shell" aria-hidden={sheet ? true : undefined}>
            <aside className="sidebar">
              <a href="/" className="sb-logo">
                <img src="/logo.png" alt="BlockFinaX" />
                <span className="wm">BlockFinaX</span>
              </a>
              <nav className="sb-nav">
                {nav.map(({ name, icon: Icon }) => (
                  <button
                    key={name}
                    className={`sb-link${tab === name ? " on" : ""}`}
                    onClick={() => setTab(name)}
                  >
                    <Icon />
                    {name}
                  </button>
                ))}
              </nav>
            </aside>
            <main className="main">
              <header className="appbar">
                <div className="greeting">
                  <div className="g1">
                    {tab === "Home"
                      ? new Date().getHours() < 12
                        ? "Good morning"
                        : new Date().getHours() < 17
                          ? "Good afternoon"
                          : "Good evening"
                      : tab}
                  </div>
                  <div className="g2">
                    {tab === "Home"
                      ? "Here's your portfolio today"
                      : "Your BlockFinaX account"}
                  </div>
                </div>
                <button className="ab-acct" onClick={() => setTab("Profile")}>
                  <span className="ava" />
                  <span className="meta">
                    <span className="n">{profile.email.split("@")[0]}</span>
                    <span className="a">{shortAddress}</span>
                  </span>
                </button>
                <div className="ab-r">
                  <div className={`hsearch${search ? " open" : ""}`}>
                    <Search />
                    <input
                      aria-label="Search markets"
                      placeholder="Search markets"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    <kbd>⌘K</kbd>
                    {search && (
                      <div className="hsearch-dd">
                        <div className="hs-empty">
                          Stellar cover markets are coming soon.
                        </div>
                      </div>
                    )}
                  </div>
                  <a
                    className="ab-learn"
                    href="https://www.blockfinax.com/learn"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Academy
                  </a>
                  <button
                    className="iconbtn"
                    aria-label="Toggle theme"
                    onClick={() =>
                      setTheme(theme === "dark" ? "light" : "dark")
                    }
                  >
                    {theme === "dark" ? <Sun /> : <Moon />}
                  </button>
                  <button
                    className="iconbtn"
                    aria-label="Notifications"
                    onClick={() => setSheet("Notifications")}
                  >
                    <Bell />
                  </button>
                </div>
              </header>
              <div className="content">
                {notice}
                {!profile.wallet ? (
                  <div className="sec setup">
                    <h2>Create your Stellar wallet</h2>
                    <p>
                      Create a passkey to control your wallet. Your email or
                      Google account signs you in; your passkey approves
                      payments.
                    </p>
                    <button
                      className="btn btn-primary"
                      disabled={!!busy || !config?.sponsorshipConfigured}
                      onClick={() => void run("Creating wallet", create)}
                    >
                      {busy || "Create wallet with a passkey"}
                    </button>
                    <p className="hint">
                      Keep access to your passkey. Email sign-in cannot recover
                      a lost signing key.
                    </p>
                  </div>
                ) : tab === "Home" ? (
                  <>
                    {balances}
                    <div className="refer reveal in">
                      <span className="ri">
                        <Gift />
                      </span>
                      <div className="rc">
                        <div className="rt">Refer &amp; earn</div>
                        <div className="rs">
                          Referral rewards are not enabled on Stellar testnet.
                        </div>
                      </div>
                      <button
                        className="rx"
                        onClick={() =>
                          void run("Copying invitation", async () => {
                            await navigator.clipboard.writeText(
                              location.origin,
                            );
                            setMessage("Test wallet link copied.");
                          })
                        }
                      >
                        Invite <ArrowRight />
                      </button>
                    </div>
                    <div className="maingrid reveal in">
                      <div className="col">
                        <div className="sec">
                          <div className="sec-h">
                            <h2>Live rates</h2>
                            <div className="seg">
                              <button className="on">FX</button>
                              <button
                                onClick={() =>
                                  setMessage(
                                    "Commodity feeds are not available in this Stellar wallet yet.",
                                  )
                                }
                              >
                                Commodities
                              </button>
                            </div>
                          </div>
                          <div className="rates">
                            <div className="rate">
                              <div className="rk">
                                <div className="p">
                                  Oracle integration pending
                                </div>
                                <div className="s">
                                  Emerging-market FX feeds will appear here
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="sec">
                          <div className="sec-h">
                            <h2>Liquidity positions</h2>
                            <button
                              className="more"
                              onClick={() => setTab("Cover")}
                            >
                              Manage <ArrowRight />
                            </button>
                          </div>
                          <div className="list">
                            <div className="row">
                              <span className="actico">
                                <Plus />
                              </span>
                              <div className="r-main">
                                <div className="r1">No positions yet</div>
                                <div className="r2">
                                  Stellar cover pools are coming soon
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="sec">
                          <div className="sec-h">
                            <h2>Assets</h2>
                            <span className="more">Stellar testnet</span>
                          </div>
                          <div className="list">
                            <div className="row">
                              <span className="asset-glyph">✦</span>
                              <div className="r-main">
                                <div className="r1">Stellar</div>
                                <div className="r2">Test XLM</div>
                              </div>
                              <div className="r-side">
                                <div className="v1 tnum">
                                  {hidden ? "••••" : balance} XLM
                                </div>
                                <div className="v2">Test asset</div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="col">
                        {activity}
                        <div className="sec">
                          <div className="sec-h">
                            <h2>Wallet</h2>
                            <span className="wallet-state">
                              {unlocked ? "Unlocked" : "Locked"}
                            </span>
                          </div>
                          <div className="address">
                            <code data-testid="wallet-address">
                              {fullAddress}
                            </code>
                            <button className="more" onClick={copy}>
                              <Copy /> Copy address
                            </button>
                          </div>
                          <button
                            className="btn btn-ghost"
                            disabled={!!busy}
                            onClick={() => void run("Unlocking", unlock)}
                          >
                            <Lock />
                            {busy || "Unlock with passkey"}
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="ctapair reveal in">
                      <button
                        className="btn btn-ghost"
                        onClick={() => setTab("Cover")}
                      >
                        <Shield /> Buy cover
                      </button>
                      <button
                        className="btn btn-primary"
                        onClick={() => setTab("Earn")}
                      >
                        <TrendingUp /> Start earning
                      </button>
                    </div>
                  </>
                ) : tab === "Profile" ? (
                  <div className="profile-grid">
                    <div className="sec">
                      <div className="sec-h">
                        <h2>Your account</h2>
                        <User />
                      </div>
                      <div className="profile-item">
                        <span>Email</span>
                        <strong>{profile.email}</strong>
                      </div>
                      <div className="profile-item">
                        <span>Network</span>
                        <strong>Stellar testnet</strong>
                      </div>
                      <div className="address">
                        <code data-testid="wallet-address">{fullAddress}</code>
                        <button className="more" onClick={copy}>
                          <Copy /> Copy address
                        </button>
                      </div>
                      <button
                        className="btn btn-ghost"
                        onClick={() =>
                          void run("Signing out", async () => {
                            await api("/auth/logout", {});
                            kit?.disconnect();
                            setUnlocked(false);
                            setProfile(null);
                          })
                        }
                      >
                        <LogOut /> Sign out
                      </button>
                    </div>
                    <div className="sec">
                      <div className="sec-h">
                        <h2>Account security</h2>
                        <span className="wallet-state">
                          {unlocked ? "Unlocked" : "Locked"}
                        </span>
                      </div>
                      <p className="hint">
                        Your passkey controls the Stellar smart account. Each
                        payment needs device approval.
                      </p>
                      <button
                        className="btn btn-primary"
                        disabled={!!busy}
                        onClick={() => void run("Unlocking", unlock)}
                      >
                        <Lock />
                        {busy || "Unlock with passkey"}
                      </button>
                      <p className="hint">
                        Recovery and additional signers are planned.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="sec pending-page">
                    <div className="pending-icon">
                      {tab === "Cover" ? <Shield /> : <TrendingUp />}
                    </div>
                    <h2>
                      {tab === "Cover" ? "Cover on Stellar" : "Earn on Stellar"}
                    </h2>
                    <p>
                      {tab === "Cover"
                        ? "FX protection and Soroban settlement are the next stage of the Stellar integration."
                        : "Stellar liquidity pools and premium earnings are the next stage of the integration."}
                    </p>
                    <span className="wallet-state">Coming soon</span>
                    <button
                      className="btn btn-ghost"
                      onClick={() => setTab("Home")}
                    >
                      Back to Home <ArrowRight />
                    </button>
                  </div>
                )}
              </div>
            </main>
          </div>
          <nav className="tabbar" aria-hidden={sheet ? true : undefined}>
            {nav
              .filter((x) => x.name !== "Earn")
              .map(({ name, icon: Icon }) => (
                <button
                  className={`tab${tab === name ? " on" : ""}`}
                  onClick={() => setTab(name)}
                  key={name}
                >
                  <Icon />
                  <span className="tl">{name}</span>
                </button>
              ))}
          </nav>
        </>
      )}
      {sheet && (
        <Sheet
          title={
            sheet === "Send"
              ? "Send payment"
              : sheet === "Receive"
                ? "Receive"
                : sheet
          }
          close={() => setSheet(null)}
        >
          {sheet === "Sign in" || sheet === "Create account" ? (
            <>
              {config?.googleEnabled && (
                <a className="btn btn-ghost google" href="/api/auth/google">
                  <span className="google-g">G</span>Continue with Google
                </a>
              )}
              <div className="auth-divider">or continue with email</div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(
                    emailRequest ? "Verifying code" : "Sending code",
                    async () => {
                      if (emailRequest) {
                        await api("/auth/email/verify", {
                          email,
                          requestId: emailRequest,
                          code,
                        });
                        setSheet(null);
                        setEmailRequest(null);
                        setCode("");
                        await refresh();
                        setMessage("Signed in successfully.");
                      } else {
                        const result = await api<{
                          message: string;
                          requestId: string;
                        }>("/auth/email", { email });
                        setEmailRequest(result.requestId);
                        setCode("");
                        setMessage(result.message);
                      }
                    },
                  );
                }}
              >
                <div className="field">
                  <label htmlFor="email">Email address</label>
                  <input
                    id="email"
                    className="input"
                    type="email"
                    required
                    readOnly={!!emailRequest}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                  />
                </div>
                {emailRequest && (
                  <div className="field">
                    <label htmlFor="email-code">Verification code</label>
                    <input
                      id="email-code"
                      className="input otp-input"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      minLength={6}
                      maxLength={6}
                      required
                      value={code}
                      onChange={(e) =>
                        setCode(e.target.value.replace(/\D/g, ""))
                      }
                      placeholder="000000"
                    />
                    <p className="hint">
                      Enter the six-digit code sent to {email}. It expires in 5
                      minutes.
                    </p>
                  </div>
                )}
                <button
                  className="btn btn-primary"
                  disabled={!!busy || !config}
                >
                  {busy ||
                    (emailRequest ? "Verify code" : "Send verification code")}
                </button>
                {emailRequest && (
                  <>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={!!busy}
                      onClick={() =>
                        void run("Resending code", async () => {
                          const result = await api<{
                            message: string;
                            requestId: string;
                          }>("/auth/email", { email });
                          setEmailRequest(result.requestId);
                          setCode("");
                          setMessage(result.message);
                        })
                      }
                    >
                      Resend code
                    </button>
                    <button
                      type="button"
                      className="more"
                      onClick={() => {
                        setEmailRequest(null);
                        setCode("");
                        setMessage("");
                        setError("");
                      }}
                    >
                      Use another email
                    </button>
                  </>
                )}
              </form>
              <p className="hint">
                Your passkey approves transactions after sign-in.
              </p>
              {message && (
                <div role="status" className="feedback success">
                  {message}
                </div>
              )}
              {error && (
                <div role="alert" className="feedback error">
                  {error}
                </div>
              )}
            </>
          ) : sheet === "Send" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run("Approving payment", send);
              }}
            >
              <div className="field">
                <label htmlFor="recipient">Recipient Stellar address</label>
                <input
                  id="recipient"
                  className="input"
                  required
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="G… or C…"
                />
              </div>
              <div className="field">
                <label htmlFor="quantity">Amount · test XLM</label>
                <input
                  id="quantity"
                  className="input"
                  required
                  inputMode="decimal"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <p className="hint">
                Available: {balance} test XLM · Stellar testnet
              </p>
              {!unlocked && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={!!busy}
                  onClick={() => void run("Unlocking", unlock)}
                >
                  <Lock />
                  Unlock with passkey
                </button>
              )}
              <button
                className="btn btn-primary"
                disabled={!!busy || !unlocked}
              >
                {busy || "Approve with passkey and send"}
              </button>
              {error && (
                <div role="alert" className="feedback error">
                  {error}
                </div>
              )}
              {message && (
                <div role="status" className="feedback success">
                  {message}
                </div>
              )}
            </form>
          ) : sheet === "Receive" ? (
            <>
              <div className="receive-mark">
                <WalletIcon />
              </div>
              <div className="field address">
                <label>Your Stellar address</label>
                <code>{fullAddress}</code>
              </div>
              <button className="btn btn-ghost" onClick={copy}>
                <Copy /> Copy address
              </button>
              <p className="hint">
                Only send Stellar testnet assets to this address.
              </p>
              <button
                className="btn btn-primary"
                disabled={!!busy}
                onClick={() =>
                  void run("Receiving test funds", async () => {
                    await api("/wallet/faucet", {});
                    await refresh();
                    setMessage("100 test XLM received.");
                  })
                }
              >
                {busy || "Receive test funds"}
              </button>
              <p className="hint">100 test XLM, once every 24 hours.</p>
              {message && (
                <div role="status" className="feedback success">
                  {message}
                </div>
              )}
              {error && (
                <div role="alert" className="feedback error">
                  {error}
                </div>
              )}
            </>
          ) : sheet === "History" ? (
            <div className="list act">
              {profile?.events.map((event, i) => (
                <a
                  className="row"
                  key={i}
                  href={`https://stellar.expert/explorer/testnet/tx/${event.hash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span className="actico">
                    <Check />
                  </span>
                  <div className="r-main">
                    <div className="r1">{event.kind}</div>
                    <div className="r2">
                      {new Date(event.created).toLocaleString()}
                    </div>
                  </div>
                  <ArrowRight />
                </a>
              ))}
            </div>
          ) : (
            <p className="hint">You're up to date. No new notifications.</p>
          )}
        </Sheet>
      )}
    </div>
  );
}
function Sheet({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>(".sheet.on");
    const focusables = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),a[href],input:not(:disabled)",
        ) || [],
      );
    focusables()[0]?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key === "Tab") {
        const elements = focusables();
        const first = elements[0],
          last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return (
    <>
      <div className="sheet-scrim on" onClick={close} />
      <section
        className="sheet on"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="grab" />
        <div className="sheet-h">
          <h3>{title}</h3>
          <button className="sheet-x" aria-label="Close" onClick={close}>
            <X />
          </button>
        </div>
        <div className="wallet-sheet-body">{children}</div>
      </section>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
