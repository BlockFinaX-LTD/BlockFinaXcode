import { isWalletSandbox, sandboxSigningMessage } from "@/lib/wallet-environment";
/**
 * app-transfer-sheets — Send / Receive bottom sheets for the redesigned Home,
 * styled with the design's `.sheet` / `.picker` classes.
 *
 * The Crypto tab is fully wired to the real Rift rails (sendCrypto / sendOtp /
 * getAuthMethod, balances from useRiftBalances, receive address + QR). Bank and
 * Mobile money tabs render as designed with a "Coming soon" state — those rails
 * aren't connected yet.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { biometricName } from '@/lib/rift-v3';
import { useWallet } from '@/hooks/use-wallet';
import { useRiftBalances } from '@/hooks/use-rift-balances';
import { maxSendable, checkAmount } from '@/lib/send-amount';

/** Probing needs a recipient. Burn address, never sent to, only simulated against. */
const ZERO_PROBE = '0x000000000000000000000000000000000000dEaD';
import {
  sendCrypto, sendOtp, getAuthMethod,
  type ChainName, type TokenSymbol,
} from '@/lib/rift-client';
import { QRCodeComponent } from '@/components/wallet/qr-code';
import {
  X, ArrowLeft, CheckCircle2, ChevronDown, ChevronRight, Loader2,
  Landmark, Smartphone, Info, Copy, Check, ArrowUp, ArrowDown,
} from 'lucide-react';
import { CoinSvg, NetSvg, coinKeyForSymbol, netKeyForChain } from '@/components/app-glyphs';
import { explainTxError } from '@/lib/tx-errors';

const CHAIN_LABELS: Record<string, string> = {
  BASE_SEPOLIA: 'Base Sepolia', BASE: 'Base', POLYGON: 'Polygon', ARBITRUM: 'Arbitrum', ETHEREUM: 'Ethereum',
  BNB: 'BNB Chain', BSC: 'BNB Chain', OPTIMISM: 'Optimism', CELO: 'Celo',
  AVAX: 'Avalanche',
};
const CHAIN_ID_TO_NAME: Record<string, ChainName> = {
  '1': 'ETHEREUM', '10': 'OPTIMISM', '56': 'BNB', '137': 'POLYGON',
  '84532': 'BASE_SEPOLIA' as ChainName, '8453': 'BASE', '42161': 'ARBITRUM', '42220': 'CELO', '43114': 'AVAX',
};
function normalizeChain(raw: string | number | undefined): string {
  if (raw == null) return '';
  const s = String(raw).trim();
  if (/^\d+$/.test(s)) return CHAIN_ID_TO_NAME[s] || s;
  return s.toUpperCase();
}
// Rift sometimes returns a full explorer URL as the "transactionHash". If so,
// link to it directly and show just the 0x hash — never prepend a base URL.
function txDisplay(chain: string, rawHash: string): { href: string; short: string } {
  if (/^https?:\/\//i.test(rawHash)) {
    const m = rawHash.match(/0x[a-fA-F0-9]{6,}/);
    const h = m ? m[0] : rawHash.split('/').pop() || rawHash;
    return { href: rawHash, short: h.length > 16 ? `${h.slice(0, 10)}…${h.slice(-6)}` : h };
  }
  return { href: explorerTx(chain, rawHash), short: `${rawHash.slice(0, 12)}…${rawHash.slice(-8)}` };
}
function explorerTx(chain: string, hash: string): string {
  const c = normalizeChain(chain);
  if (c === 'BASE_SEPOLIA') return `https://sepolia.basescan.org/tx/${hash}`;
  if (c === 'BASE') return `https://basescan.org/tx/${hash}`;
  if (c === 'BNB' || c === 'BSC') return `https://bscscan.com/tx/${hash}`;
  if (c === 'POLYGON') return `https://polygonscan.com/tx/${hash}`;
  if (c === 'ARBITRUM') return `https://arbiscan.io/tx/${hash}`;
  if (c === 'OPTIMISM') return `https://optimistic.etherscan.io/tx/${hash}`;
  if (c === 'CELO') return `https://celoscan.io/tx/${hash}`;
  if (c === 'AVAX') return `https://snowtrace.io/tx/${hash}`;
  return `https://etherscan.io/tx/${hash}`;
}

type DestTab = 'crypto' | 'bank' | 'momo';
type Step = 'form' | 'authorize' | 'done';

function ComingSoon({ label }: { label: string }) {
  return (
    <p className="send-note">
      <Info /> {label} transfers are coming soon. Use the Crypto tab to move funds today.
    </p>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SEND
// ─────────────────────────────────────────────────────────────────────────
export function AppSendSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  useEffect(() => { if (open && isWalletSandbox) toast({ title: 'Testnet transfers pending', description: sandboxSigningMessage }); }, [open]);
  const { balances, refreshAll, isLoading: balLoading } = useRiftBalances();

  const [tab, setTab] = useState<DestTab>('crypto');
  const [step, setStep] = useState<Step>('form');
  const [chain, setChain] = useState<ChainName>(isWalletSandbox ? 'BASE_SEPOLIA' as ChainName : 'BASE');
  const [token, setToken] = useState<TokenSymbol>('USDC');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [picker, setPicker] = useState<null | 'token' | 'chain'>(null);

  const [otpCode, setOtpCode] = useState('');
  // Null until known. A migrated wallet is approved with a fingerprint, so the
  // credential fields below are not just unnecessary — showing them says the
  // upgrade did not take, which is how this has looked.
  const [deviceSigning, setDeviceSigning] = useState<boolean | null>(null);
  const bioName = biometricName();
  const [password, setPassword] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [sending, setSending] = useState(false);
  const [hash, setHash] = useState<string | null>(null);

  const authMethod = getAuthMethod();

  useEffect(() => {
    if (open) { refreshAll(); }
    else {
      setTab('crypto'); setStep('form'); setChain('BASE'); setToken('USDC');
      setTo(''); setAmount(''); setOtpCode(''); setPassword('');
      setOtpSent(false); setHash(null); setPicker(null);
    }
  }, [open, refreshAll]);

  const SENDABLE = new Set(['USDC', 'USDT']);
  const owned = useMemo(
    () => balances.filter((b) => Number(b.amount) > 0 && SENDABLE.has(String(b.token || '').toUpperCase())),
    [balances],
  );

  const chainNames = new Map<string, string>();
  for (const b of owned) {
    const k = normalizeChain(b.chain);
    if (!k) continue;
    const raw = (b as any).chainName?.toString().trim() || CHAIN_LABELS[k] || k;
    const pretty = /[a-z]/.test(raw) ? raw : raw.charAt(0) + raw.slice(1).toLowerCase();
    if (!chainNames.has(k)) chainNames.set(k, pretty);
  }
  const availableChains = Array.from(chainNames.keys());
  const tokensForChain = Array.from(new Set(
    owned.filter((b) => normalizeChain(b.chain) === normalizeChain(chain))
      .map((b) => String(b.token || '').toUpperCase()),
  ));
  const matched = owned.find(
    (b) => normalizeChain(b.chain) === normalizeChain(chain) &&
      String(b.token || '').toUpperCase() === String(token).toUpperCase(),
  );
  const available = Number(matched?.amount || 0);

  const autoPicked = useRef(false);
  useEffect(() => {
    if (!open) { autoPicked.current = false; return; }
    if (autoPicked.current || balances.length === 0) return;
    const first = balances.find((b) => Number(b.amount) > 0 && SENDABLE.has(String(b.token || '').toUpperCase()));
    if (first) {
      setChain(normalizeChain(first.chain) as ChainName);
      setToken(String(first.token).toUpperCase() as TokenSymbol);
    }
    autoPicked.current = true;
  }, [open, balances]);

  useEffect(() => {
    if (tokensForChain.length && !tokensForChain.includes(String(token).toUpperCase())) {
      setToken(tokensForChain[0] as TokenSymbol);
    }
  }, [chain, tokensForChain.join(',')]);

  // Compared in base units rather than as floats. A balance and an amount that
  // are the same money can differ in the last bits of a double, which is how a
  // MAX that filled in the whole balance still failed validation.
  // MAX asks the provider what it will actually take.
  //
  // The transfer is built as a batch with a fee transfer inside it, and the fee
  // is not reported anywhere, so it cannot be subtracted. Asking costs one call
  // when there is no fee and a handful when there is, which is worth it for a
  // button whose whole promise is that it sends everything.
  const [findingMax, setFindingMax] = useState(false);
  const fillMax = async () => {
    if (findingMax || available <= 0) return;
    setFindingMax(true);
    // Show the floored balance immediately so the field is never empty while
    // this runs. It is replaced if the provider wants less.
    setAmount(maxSendable(available, token));
    try {
      const { findSendableMax } = await import('@/lib/v3-sign');
      const best = await findSendableMax({ token, chain, recipient: to || ZERO_PROBE }, available);
      if (!best) {
        toast({
          title: 'Too small to send',
          description: `The fee on this transfer is more than the ${token} in this wallet.`,
          variant: 'destructive',
        });
        return;
      }
      setAmount(best.amount);
    } catch {
      /* the floored balance is already in the field, which is the old behaviour */
    } finally {
      setFindingMax(false);
    }
  };

  const valid = /^0x[a-fA-F0-9]{40}$/.test(to) && checkAmount(amount, available, token).ok;

  const review = () => {
    if (!/^0x[a-fA-F0-9]{40}$/.test(to)) { toast({ title: 'Invalid address', description: 'Recipient must be a 0x… address', variant: 'destructive' }); return; }
    const n = parseFloat(amount);
    if (isNaN(n) || n <= 0) { toast({ title: 'Invalid amount', variant: 'destructive' }); return; }
    const check = checkAmount(amount, available, token);
    if (!check.ok) { toast({ title: 'Check the amount', description: check.reason, variant: 'destructive' }); return; }
    setStep('authorize');
    void (async () => {
      let onDevice = false;
      try {
        const { walletUsesDeviceSigning } = await import('@/lib/v3-sign');
        onDevice = await walletUsesDeviceSigning();
      } catch {
        /* treat as unavailable */
      }
      setDeviceSigning(onDevice);
      if (onDevice) return; // No code to send, and no field to show.
      if (authMethod && authMethod.kind !== 'password' && !otpSent) sendFreshOtp();
    })();
  };

  const sendFreshOtp = async () => {
    if (!authMethod || authMethod.kind === 'password') return;
    setSendingOtp(true);
    try {
      if (authMethod.kind === 'email') await sendOtp({ email: authMethod.email });
      else if (authMethod.kind === 'phone') await sendOtp({ phone: authMethod.phoneNumber });
      setOtpSent(true);
      toast({
        title: 'Code sent',
        description:
          authMethod?.kind === 'phone'
            ? 'Check your phone for the code to authorize the transfer.'
            : 'Check your inbox to authorize the transfer. It may land in spam.',
      });
    } catch (err: any) {
      // err?.message here was frequently undefined, which renders an empty
      // toast — a red box that says nothing at all.
      const e = explainTxError(err);
      console.error('[transfer] send code:', e.detail, err);
      toast({ title: e.title, description: e.message, variant: 'destructive' });
    } finally { setSendingOtp(false); }
  };

  const submit = async () => {
    if (!authMethod) { toast({ title: 'Not signed in', variant: 'destructive' }); return; }
    setSending(true);
    try {
      // Device signing first. Returns null when the wallet hasn't migrated, in
      // which case the credential path below runs exactly as it always has.
      const { trySendTokenWithV3 } = await import('@/lib/v3-sign');
      const v3Hash = await trySendTokenWithV3({
        token,
        chain: normalizeChain(chain) as string,
        recipient: to,
        amount,
      });
      if (v3Hash) {
        setHash(v3Hash);
        setStep('done');
        refreshAll();
        setSending(false);
        return;
      }

      let credentials: any;
      if (authMethod.kind === 'password') {
        if (!password) throw new Error('Password is required');
        credentials = { externalId: authMethod.externalId, password };
      } else if (authMethod.kind === 'email') {
        if (!otpCode) throw new Error('OTP code is required');
        credentials = { email: authMethod.email, otpCode };
      } else {
        if (!otpCode) throw new Error('OTP code is required');
        credentials = { phoneNumber: authMethod.phoneNumber, otpCode };
      }
      const res = await sendCrypto({ to, value: amount, token, chain: normalizeChain(chain) as ChainName, type: 'gasless', ...credentials });
      setHash(res?.transactionHash || null);
      setStep('done');
      refreshAll();
    } catch (err: any) {
      // "Please verify your credentials" was the fallback for every failure,
      // including the ones that had nothing to do with credentials — an
      // expired session, a rate limit, an enclave that could not sign.
      const e = explainTxError(err);
      console.error('[transfer] send:', e.detail, err);
      toast({ title: e.title, description: e.message, variant: 'destructive' });
    } finally { setSending(false); }
  };

  const tokenKey = coinKeyForSymbol(token);
  const netKey = netKeyForChain(normalizeChain(chain));

  return (
    <>
      <div className={`sheet-scrim${open ? ' on' : ''}`} onClick={onClose} />
      <div className={`sheet${open ? ' on' : ''}`} role="dialog" aria-modal="true">
        <div className="grab" />
        <div className="sheet-h">
          <h3>{step === 'done' ? 'Transfer sent' : 'Send'}</h3>
          <button className="sheet-x" onClick={onClose}><X /></button>
        </div>

        {step === 'form' && (
          <>
            <div className="rtabs">
              <button className={tab === 'crypto' ? 'on' : ''} onClick={() => setTab('crypto')}>Crypto</button>
              <button className={tab === 'bank' ? 'on' : ''} onClick={() => setTab('bank')}>Bank</button>
              <button className={tab === 'momo' ? 'on' : ''} onClick={() => setTab('momo')}>Mobile money</button>
            </div>

            {tab === 'crypto' && (
              <>
                <div className="field">
                  <label>Asset</label>
                  <button className="select" onClick={() => setPicker('token')} disabled={tokensForChain.length === 0}>
                    <span className="coin">{tokenKey ? <CoinSvg token={tokenKey} label={token} /> : <CoinSvg token="" label={token} />}</span>
                    <span className="lab">{token}</span>
                    <span className="sub">{available.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                    <span className="chev"><ChevronDown /></span>
                  </button>
                </div>
                <div className="field">
                  <label>Amount</label>
                  <div className="amount">
                    <div className="arow">
                      <input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
                      <button className="max" disabled={findingMax} onClick={fillMax}>{findingMax ? '…' : 'MAX'}</button>
                    </div>
                    <div className="abot">
                      <span className="usd">≈ ${(parseFloat(amount) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      <span className="bal">Balance {available.toLocaleString(undefined, { maximumFractionDigits: 2 })} {token}</span>
                    </div>
                  </div>
                </div>
                <div className="field">
                  <label>Network</label>
                  <button className="select" onClick={() => setPicker('chain')} disabled={availableChains.length === 0}>
                    <span className="netic">{netKey ? <NetSvg net={netKey} /> : null}</span>
                    <span className="lab">{chainNames.get(normalizeChain(chain)) || CHAIN_LABELS[normalizeChain(chain)] || chain}</span>
                    <span className="sub">Gas sponsored</span>
                    <span className="chev"><ChevronDown /></span>
                  </button>
                </div>
                <div className="field">
                  <label>To</label>
                  <input className="input" placeholder="Recipient 0x… address" value={to} onChange={(e) => setTo(e.target.value.trim())} />
                </div>
                {!balLoading && owned.length === 0 && (
                  <p className="send-note"><Info /> No USDC/USDT to send yet. Fund your wallet to get started.</p>
                )}
                <button className="btn btn-primary" onClick={review} disabled={!valid}>Review transfer</button>
              </>
            )}

            {tab === 'bank' && (
              <>
                <div className="field">
                  <label>Bank</label>
                  <button className="select" disabled><span className="netic"><Landmark /></span><span className="lab">Select bank</span><span className="chev"><ChevronDown /></span></button>
                </div>
                <div className="field"><label>Account number</label><input className="input" inputMode="numeric" placeholder="0000000000" disabled /></div>
                <ComingSoon label="Bank" />
                <button className="btn btn-primary" disabled>Review transfer</button>
              </>
            )}

            {tab === 'momo' && (
              <>
                <div className="field">
                  <label>Provider</label>
                  <button className="select" disabled><span className="netic"><Smartphone /></span><span className="lab">M-Pesa · MTN · Airtel</span><span className="chev"><ChevronDown /></span></button>
                </div>
                <div className="field"><label>Phone number</label><input className="input" inputMode="tel" placeholder="+254 7XX XXX XXX" disabled /></div>
                <ComingSoon label="Mobile money" />
                <button className="btn btn-primary" disabled>Review transfer</button>
              </>
            )}
          </>
        )}

        {step === 'authorize' && (
          <>
            <div className="brk" style={{ marginTop: 0 }}>
              <div className="brk-line"><span className="l">To</span><span className="v">{to.slice(0, 10)}…{to.slice(-6)}</span></div>
              <div className="brk-line"><span className="l">Amount</span><span className="v">{amount} {token}</span></div>
              <div className="brk-line"><span className="l">Network</span><span className="v">{chainNames.get(normalizeChain(chain)) || chain}</span></div>
              <div className="brk-line total"><span className="l">Gas</span><span className="v" style={{ color: 'var(--green)' }}>Sponsored</span></div>
            </div>
            {!authMethod && <p className="send-note"><Info /> Auth method unknown — please sign in again.</p>}
            {deviceSigning !== true && authMethod?.kind === 'password' && (
              <div className="field">
                <label>Password</label>
                <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
              </div>
            )}
            {deviceSigning === true && (
              <div className="field">
                <label>Approval</label>
                <p style={{ fontSize: 13, lineHeight: 1.5, opacity: 0.75, margin: 0 }}>
                  You'll approve this with {bioName}. No code needed.
                </p>
              </div>
            )}
            {deviceSigning !== true && (authMethod?.kind === 'email' || authMethod?.kind === 'phone') && (
              <div className="field">
                <label>
                  {authMethod.kind === 'email' ? 'Email code' : 'SMS code'}{' '}
                  <button type="button" style={{ color: 'var(--blue)', textTransform: 'none', letterSpacing: 0 }} onClick={sendFreshOtp} disabled={sendingOtp}>
                    {sendingOtp ? 'Sending…' : '— send code'}
                  </button>
                </label>
                <input
                  className="input" style={{ textAlign: 'center', letterSpacing: '0.4em' }} maxLength={6}
                  placeholder={otpSent ? 'ABCD' : 'Code will arrive shortly…'}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6))}
                  autoFocus
                />
                {/* The code is sent by Rift, our wallet provider, not by us —
                    their domain publishes no SPF or DMARC, so it frequently
                    lands in spam. We cannot send this one ourselves: Rift
                    validates the code against its own store, so a code we
                    generated would authorise nothing. Naming the sender is the
                    part we can do, and it is most of what stops someone
                    concluding the code never arrived. */}
                {authMethod.kind === 'email' && (
                  <p style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--tx-3)', marginTop: 8 }}>
                    Sent by <strong style={{ color: 'var(--tx-2)' }}>Rift</strong>, our wallet
                    provider — not from a BlockFinaX address. <strong style={{ color: 'var(--tx-2)' }}>Check
                    your spam folder</strong> if it isn't in your inbox within a minute.
                  </p>
                )}
              </div>
            )}
            <div className="ctapair" style={{ marginTop: 8 }}>
              <button className="btn btn-ghost" onClick={() => setStep('form')} disabled={sending}><ArrowLeft /> Back</button>
              <button className="btn btn-primary" onClick={submit} disabled={sending}>
                {sending ? <Loader2 className="spin" /> : <ArrowUp />} Send {amount} {token}
              </button>
            </div>
          </>
        )}

        {step === 'done' && (
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', margin: '0 auto 14px', display: 'grid', placeItems: 'center', background: 'color-mix(in oklab,var(--green) 15%,transparent)', color: 'var(--green)' }}>
              <CheckCircle2 />
            </div>
            <h3 style={{ fontSize: 17, fontWeight: 600 }}>Sent!</h3>
            <p style={{ fontSize: 12.5, color: 'var(--tx-3)', marginTop: 4 }}>{amount} {token} sent on {chainNames.get(normalizeChain(chain)) || chain}</p>
            {hash && (() => {
              const { href, short } = txDisplay(chain, hash);
              return (
                <a href={href} target="_blank" rel="noopener noreferrer"
                   style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 12, fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--blue)' }}>
                  {short} <ChevronRight />
                </a>
              );
            })()}
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={onClose}>Done</button>
          </div>
        )}
      </div>

      {/* token / chain picker */}
      <div className={`picker${picker ? ' on' : ''}`}>
        <div className="grab" />
        <div className="sheet-h">
          <h3>{picker === 'chain' ? 'Select network' : 'Select asset'}</h3>
          <button className="sheet-x" onClick={() => setPicker(null)}><X /></button>
        </div>
        <div>
          {picker === 'token' && tokensForChain.map((t) => {
            const k = coinKeyForSymbol(t);
            const bal = owned.find((b) => normalizeChain(b.chain) === normalizeChain(chain) && String(b.token).toUpperCase() === t);
            return (
              <button key={t} className="pick-row" onClick={() => { setToken(t as TokenSymbol); setPicker(null); }}>
                <span className="coin"><CoinSvg token={k} label={t} /></span>
                <div className="pm"><div className="a">{t}</div><div className="b">{Number(bal?.amount || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</div></div>
                <div className="pv"><ChevronRight /></div>
              </button>
            );
          })}
          {picker === 'chain' && availableChains.map((c) => {
            const nk = netKeyForChain(c);
            return (
              <button key={c} className="pick-row" onClick={() => { setChain(c as ChainName); setPicker(null); }}>
                <span className="netic">{nk ? <NetSvg net={nk} /> : null}</span>
                <div className="pm"><div className="a">{chainNames.get(c) || c}</div><div className="b">Gas sponsored</div></div>
                <div className="pv"><ChevronRight /></div>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// RECEIVE
// ─────────────────────────────────────────────────────────────────────────
export function AppReceiveSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { address } = useWallet();
  const { toast } = useToast();
  const [tab, setTab] = useState<DestTab>('crypto');
  const [copied, setCopied] = useState(false);

  useEffect(() => { if (!open) { setTab('crypto'); setCopied(false); } }, [open]);

  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      toast({ title: 'Address copied', description: 'Wallet address copied to clipboard.' });
      setTimeout(() => setCopied(false), 1500);
    } catch { toast({ title: 'Copy failed', variant: 'destructive' }); }
  };

  return (
    <>
      <div className={`sheet-scrim${open ? ' on' : ''}`} onClick={onClose} />
      <div className={`sheet${open ? ' on' : ''}`} role="dialog" aria-modal="true">
        <div className="grab" />
        <div className="sheet-h">
          <h3>Receive</h3>
          <button className="sheet-x" onClick={onClose}><X /></button>
        </div>
        <div className="rtabs">
          <button className={tab === 'crypto' ? 'on' : ''} onClick={() => setTab('crypto')}>Crypto</button>
          <button className={tab === 'bank' ? 'on' : ''} onClick={() => setTab('bank')}>Bank</button>
          <button className={tab === 'momo' ? 'on' : ''} onClick={() => setTab('momo')}>Mobile money</button>
        </div>

        {tab === 'crypto' && (
          <div className="qr-wrap">
            <div className="qr">{address ? <QRCodeComponent value={address} size={160} /> : null}</div>
            <div className="addr-box">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="ab-k">Your address</div>
                <div className="ab-v">{address || '—'}</div>
              </div>
              <button className="copy" onClick={copy} aria-label="Copy address">{copied ? <Check /> : <Copy />}</button>
            </div>
            <p className="send-note"><Info /> {isWalletSandbox ? 'Only send test tokens on Base Sepolia to this address.' : 'Only send tokens on supported networks (Base, BNB Chain) to this address.'}</p>
          </div>
        )}

        {tab === 'bank' && (
          <>
            <button className="payway" disabled><span className="pwic"><Landmark /></span><span className="pwc"><span className="t">Bank transfer</span><span className="s">Deposit NGN, GHS, KES → auto-convert to USDC</span></span><span className="chev"><ChevronRight /></span></button>
            <ComingSoon label="Bank" />
          </>
        )}

        {tab === 'momo' && (
          <>
            <button className="payway" disabled><span className="pwic"><Smartphone /></span><span className="pwc"><span className="t">M-Pesa · MTN MoMo</span><span className="s">Receive to your mobile wallet</span></span><span className="chev"><ChevronRight /></span></button>
            <ComingSoon label="Mobile money" />
          </>
        )}
      </div>
    </>
  );
}
