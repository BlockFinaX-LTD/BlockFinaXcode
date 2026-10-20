/**
 * Money in and out, and the account. This is the only place a user picks a network,
 * because it is where USDC enters or leaves BlockFinaX.
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Check, Copy, KeyRound, LogOut, Plus, X } from 'lucide-react';
import { useLocation } from 'wouter';
import { useToast } from '@/hooks/use-toast';
import { QRCodeComponent } from '@/components/wallet/qr-code';
import { usePasskeySession } from '@/lib/identity';
import { addBackupPasskey, api, cancelBackupPasskey, currentPasskeySession, finalizeBackupPasskey, passkeySend, signOutPasskey, toScreenChain } from '@/lib/wallets/passkey-wallet';
import { fmt, runTransfer, transferStatus, useChains, useTransferQuote, useTransfers, useUsdcBalances, usdcOn } from './shared';
import { Loading, Note, Spin, Sum, Tag } from './ui';

function useAccounts() {
  const { session } = usePasskeySession();
  const chains = useChains();
  const name = (key: string) => chains.data?.chains.find((c) => c.key === key)?.name ?? key;
  return (session?.accounts ?? []).map((a) => ({ chain: a.chain, name: name(a.chain), address: a.address, stellar: a.chain.startsWith('stellar') }));
}

function Balances() {
  const accounts = useAccounts();
  const balances = useUsdcBalances();
  return (
    <div className="bx-card tight">
      <h2 style={{ marginBottom: 4 }}>By network</h2>
      <div className="bx-sums" style={{ borderTop: 0 }}>
        {accounts.map((a) => <Sum key={a.chain} l={a.name} v={<span className="num">${fmt(usdcOn(balances.data?.rows, a.chain))}</span>} />)}
        <Sum l="Total" v={<span className="num">${fmt(balances.data?.total)} USDC</span>} total />
      </div>
    </div>
  );
}

function CardHead({ title, sub, onCancel }: { title: string; sub: string; onCancel: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 18 }}>
      <div><h2 style={{ marginBottom: 6 }}>{title}</h2><div className="sub">{sub}</div></div>
      <button className="bx-btn ghost small" onClick={onCancel} aria-label={`Cancel ${title.toLowerCase()}`}><X /> Cancel</button>
    </div>
  );
}

interface DepositAddresses {
  hub: { chain: string; name: string; address: string };
  deposits: { chain: string; name: string; address: string; assets: string[]; minimum: string }[];
}

function DepositCard({ onCancel }: { onCancel: () => void }) {
  const accounts = useAccounts();
  const chains = useChains();
  const balances = useUsdcBalances();
  const hub = chains.data?.activeLiquidityHub;
  const deposits = useQuery({ queryKey: ['v2-deposit-addresses'], queryFn: () => api<DepositAddresses>('/api/v2/deposit-addresses'), staleTime: 300_000, retry: false });
  const [chain, setChain] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!chain && hub) setChain(hub); }, [chain, hub]);
  // Networks: the hub (direct) and every network with a personal deposit address.
  const options = [
    ...(deposits.data ? [{ chain: deposits.data.hub.chain, name: deposits.data.hub.name }] : accounts.filter((a) => a.chain === hub)),
    ...(deposits.data?.deposits ?? []).map((d) => ({ chain: d.chain, name: d.name })),
  ];
  const routed = deposits.data?.deposits.find((d) => d.chain === chain) ?? null;
  const address = routed?.address ?? (chain === hub ? deposits.data?.hub.address ?? accounts.find((a) => a.chain === hub)?.address : undefined);
  const name = options.find((o) => o.chain === chain)?.name ?? 'this network';
  const hubName = deposits.data?.hub.name ?? 'your BlockFinaX account';
  const leftover = routed ? usdcOn(balances.data?.rows, routed.chain) : 0;
  return (
    <div className="bx-card">
      <CardHead title="Deposit USDC" sub="Send USDC to your BlockFinaX account from an exchange or another wallet." onCancel={onCancel} />
      <span className="bx-label">Where are you sending from?</span>
      <div className="bx-seg" style={{ marginBottom: 6 }}>
        {options.map((o) => <button key={o.chain} className={chain === o.chain ? 'on' : ''} onClick={() => { setChain(o.chain); setCopied(false); }}>{o.name}</button>)}
      </div>
      <div className="bx-hint" style={{ marginBottom: 20 }}>Sending from an exchange? Choose the network the exchange uses.</div>
      {deposits.isLoading ? <Loading /> : address && (
        <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ background: '#fff', padding: 12, borderRadius: 14, border: '1px solid var(--line)' }}><QRCodeComponent value={address} size={168} /></div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="muted" style={{ fontSize: 13 }}>Your {name} deposit address</div>
            <div className="num" style={{ fontSize: 14, wordBreak: 'break-all', margin: '6px 0 14px' }}>{address}</div>
            <button className="bx-btn ghost" onClick={async () => { await navigator.clipboard.writeText(address); setCopied(true); }}>{copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy address'}</button>
          </div>
        </div>
      )}
      <div style={{ marginTop: 20 }}><Note warn={Boolean(routed)}>Send only USDC on {name} to this address. Other tokens and other networks are not credited.</Note></div>
      {routed && (<>
        <div style={{ marginTop: 18 }}>
          <h3 style={{ margin: '0 0 4px 0' }}>What happens next</h3>
          <div className="sub">Nothing to approve. Your USDC is moved automatically.</div>
        </div>
        <div className="bx-sums" style={{ marginTop: 8 }}>
          <Sum l="1. We detect your USDC on" v={name} />
          <Sum l="2. Circle moves it to" v={hubName} />
          <Sum l="Arrives in" v="About a minute" />
          <Sum l="Circle fee" v="About 0.01%" />
          <Sum l="Network fees" v="Covered" good />
          <Sum l="Minimum" v={<span className="num">${routed.minimum}</span>} />
        </div>
      </>)}
      {routed && leftover > 0 && <MoveToHub network={routed.chain} networkName={`your ${routed.name} wallet`} />}
    </div>
  );
}

/** USDC that arrived on a funding network moves to the hub through Circle CCTP. */
function MoveToHub({ network, networkName }: { network: string; networkName: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const balances = useUsdcBalances();
  const chains = useChains();
  const hubName = chains.data?.chains.find((c) => c.key === chains.data?.activeLiquidityHub)?.name ?? 'your main wallet';
  const have = usdcOn(balances.data?.rows, network);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const quote = useTransferQuote({ kind: 'fund', network, amount });
  async function move() {
    setBusy('Preparing...');
    try {
      await runTransfer({ kind: 'fund', network, amount }, (m) => setBusy(m));
      toast({ title: 'Transfer started', description: `Your USDC is on its way to ${hubName}. It usually arrives within a minute.` });
      setAmount('');
      void qc.invalidateQueries({ queryKey: ['v2-routes'] });
      void qc.invalidateQueries({ queryKey: ['v2-usdc-all'] });
    } catch (e) {
      toast({ title: 'Not moved', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(null); }
  }
  return (
    <div style={{ marginTop: 22, paddingTop: 20, borderTop: '1px solid var(--line)' }}>
      <h3 style={{ margin: '0 0 6px 0' }}>Move to {hubName}</h3>
      <div className="sub" style={{ marginBottom: 14 }}>Protection and liquidity use USDC on {hubName}. USDC you send to {networkName} is moved there through Circle's Cross-Chain Transfer Protocol (CCTP).</div>
      <div className="bx-big">
        <label htmlFor="bx-move">Amount (USDC)</label>
        <input id="bx-move" inputMode="decimal" value={`$${amount}`} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
        <div className="muted" style={{ fontSize: 12 }}>On {networkName}: ${fmt(have)} · <button className="bx-link" style={{ fontSize: 12 }} onClick={() => setAmount(String(have))}>Max</button></div>
      </div>
      <div className="bx-sums">
        <Sum l="Circle transfer fee (at most)" v={quote.data ? <span className="num">${quote.data.totalFees}</span> : '...'} />
        <Sum l="Network fees" v="Covered" good />
        <Sum l={`You receive on ${hubName}`} v={<span className="num">{quote.data ? `$${fmt(quote.data.amountOut)}` : '...'}</span>} total />
      </div>
      {quote.isError && Number(amount) > 0 && <div className="bx-error">{(quote.error as Error).message}</div>}
      <button className="bx-btn block" style={{ marginTop: 14 }} disabled={!!busy || !(Number(amount) > 0) || Number(amount) > have || !quote.data} onClick={move}>{busy ? <><Spin /> {busy}</> : `Move to ${hubName}`}</button>
    </div>
  );
}

/** Transfers between networks, newest first, with their live state. */
function TransfersCard() {
  const routes = useTransfers();
  const chains = useChains();
  const name = (k: string) => chains.data?.chains.find((c) => c.key === k)?.name ?? k;
  const list = (routes.data ?? []).filter((r) => r.sourceTxHash).slice(0, 8);
  if (!list.length) return null;
  return (
    <div className="bx-card tight">
      <h2 style={{ marginBottom: 4 }}>Transfers between networks</h2>
      <div className="bx-sums" style={{ borderTop: 0 }}>
        {list.map((r) => {
          const st = transferStatus(r);
          return <Sum key={r.id} l={<span><span className="num">${fmt(r.amount)}</span> {name(r.sourceChain)} to {name(r.destinationChain)}</span>} v={<Tag tone={st.tone}>{st.label}</Tag>} />;
        })}
      </div>
    </div>
  );
}

function FaucetCard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const accounts = useAccounts();
  const [claiming, setClaiming] = useState(false);
  if (!accounts.some((a) => a.stellar)) return null;
  return (
    <div className="bx-cta">
      <h3>Need test USDC?</h3>
      <p>Get 10 test USDC on Stellar testnet, once a day.</p>
      <button disabled={claiming} onClick={async () => {
        setClaiming(true);
        try {
          await api('/api/wallet/faucet/usdc', {});
          toast({ title: 'Test USDC sent', description: '10 test USDC is on its way.' });
          void qc.invalidateQueries({ queryKey: ['v2-usdc-all'] });
        } catch (e) {
          toast({ title: 'Faucet unavailable', description: (e as Error).message, variant: 'destructive' });
        } finally { setClaiming(false); }
      }}>{claiming ? 'Sending...' : 'Get 10 test USDC'}</button>
    </div>
  );
}

function WithdrawPanel({ onCancel }: { onCancel: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const accounts = useAccounts();
  const balances = useUsdcBalances();
  const [chain, setChain] = useState<string | null>(null);
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const chains = useChains();
  const hub = chains.data?.activeLiquidityHub;
  const hubName = chains.data?.chains.find((c) => c.key === hub)?.name ?? 'your main wallet';
  useEffect(() => { if (!chain && accounts[0]) setChain(accounts.some((a) => a.chain === hub) ? hub! : accounts[0].chain); }, [accounts, chain, hub]);
  const acct = accounts.find((a) => a.chain === chain);
  // Withdrawing to another network comes from the hub balance, through Circle CCTP.
  const viaCctp = Boolean(acct && hub && acct.chain !== hub && chains.data?.chains.find((c) => c.key === acct.chain)?.cctp);
  const have = usdcOn(balances.data?.rows, (viaCctp ? hub : chain) ?? undefined);
  const validTo = acct?.stellar ? /^[GC][A-Z2-7]{55}$/.test(to) : /^0x[a-fA-F0-9]{40}$/.test(to);
  const quote = useTransferQuote({ kind: 'withdraw', network: viaCctp ? chain : null, amount });

  async function send() {
    if (!chain) return;
    setBusy('Preparing...');
    try {
      if (viaCctp) {
        const route = await runTransfer({ kind: 'withdraw', network: chain, amount, recipient: to }, (m) => setBusy(m));
        setHash(route.sourceTxHash);
        void qc.invalidateQueries({ queryKey: ['v2-routes'] });
      } else {
        setHash(await passkeySend({ chain: toScreenChain(chain), symbol: 'USDC', to, amount }, (m) => setBusy(m)));
      }
      setAmount('');
      void qc.invalidateQueries({ queryKey: ['v2-usdc-all'] });
    } catch (e) {
      toast({ title: 'Not sent', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(null); }
  }

  return (
    <div className="bx-card">
      <CardHead title="Withdraw USDC" sub="Send USDC to an exchange or another wallet. Transfers cannot be reversed, so check the address and network." onCancel={onCancel} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div>
          <span className="bx-label">Network</span>
          <div className="bx-seg">{accounts.map((a) => <button key={a.chain} className={chain === a.chain ? 'on' : ''} onClick={() => { setChain(a.chain); setTo(a.chain !== hub ? a.address : ''); }}>{a.name}</button>)}</div>
          {viaCctp && <div className="bx-hint" style={{ marginTop: 8 }}>Sent from your {hubName} balance through Circle CCTP. It usually arrives within two minutes.</div>}
        </div>
        <div className="bx-big">
          <label htmlFor="bx-send">Amount (USDC)</label>
          <input id="bx-send" inputMode="decimal" value={`$${amount}`} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
          <div className="muted" style={{ fontSize: 12 }}>Available ${fmt(have)} · <button className="bx-link" style={{ fontSize: 12 }} onClick={() => setAmount(String(have))}>Max</button></div>
        </div>
        <label className="bx-field" style={{ margin: 0 }}>
          <span>Recipient address</span>
          <input className="bx-input num" placeholder={acct?.stellar ? 'G... or C...' : '0x...'} value={to} onChange={(e) => setTo(e.target.value.trim())} />
        </label>
        {to && !validTo && <div className="bx-error">Enter a valid {acct?.name} address.</div>}
        {viaCctp ? (
          <div className="bx-sums">
            <Sum l="Circle transfer fee (at most)" v={quote.data ? <span className="num">${quote.data.totalFees}</span> : '...'} />
            <Sum l="Network fees" v="Covered" good />
            <Sum l="Recipient gets at least" v={<span className="num">{quote.data ? `$${fmt(quote.data.amountOut)}` : '...'}</span>} total />
          </div>
        ) : (
          <div className="bx-sums"><Sum l="Network fees" v="Covered" good /><Sum l="Recipient gets" v={<span className="num">${fmt(amount || 0)}</span>} total /></div>
        )}
        {viaCctp && quote.isError && Number(amount) > 0 && <div className="bx-error">{(quote.error as Error).message}</div>}
        <button className="bx-btn block" disabled={!!busy || !validTo || !(Number(amount) > 0) || Number(amount) > have || (viaCctp && !quote.data)} onClick={send}>{busy ? <><Spin /> {busy}</> : 'Send USDC'}</button>
        {hash && <div className="bx-hint">Sent · reference {hash.slice(0, 10)}...{hash.slice(-6)}</div>}
      </div>
    </div>
  );
}

export type WalletMode = 'none' | 'deposit' | 'withdraw';

/** One place for money: the balance first; deposit or withdraw opens only when asked for. */
export function WalletPage({ mode: initial = 'none' }: { mode?: WalletMode }) {
  const balances = useUsdcBalances();
  const [mode, setMode] = useState<WalletMode>(initial);
  useEffect(() => setMode(initial), [initial]);
  const close = () => setMode('none');
  return (
    <main className="bx-main">
      <section className="bx-col">
        <div className="bx-card">
          <div className="bx-hero-k">Wallet balance</div>
          <div className="bx-hero-v num">${fmt(balances.data?.total)}</div>
          <div className="sub">USDC · network fees covered by BlockFinaX</div>
          <div className="bx-wallet-actions">
            <button className={`bx-btn${mode === 'deposit' ? '' : mode === 'none' ? '' : ' ghost'}`} onClick={() => setMode('deposit')} aria-pressed={mode === 'deposit'}><ArrowDown /> Deposit</button>
            <button className={`bx-btn${mode === 'withdraw' ? '' : ' ghost'}`} onClick={() => setMode('withdraw')} aria-pressed={mode === 'withdraw'}><ArrowUp /> Withdraw</button>
          </div>
        </div>
        {mode === 'deposit' && <DepositCard onCancel={close} />}
        {mode === 'withdraw' && <WithdrawPanel onCancel={close} />}
        {mode === 'none' && <Balances />}
      </section>
      <aside className="bx-aside">
        {mode !== 'none' && <Balances />}
        <TransfersCard />
        <FaucetCard />
      </aside>
    </main>
  );
}

// ── Account: profile, verification, passkeys and recovery ──────────────────

interface Standing {
  tier: number; tierDef: { name: string; description: string; cashMovedUsd: number; payoutExposureUsd: number };
  kycStatus: string; cashMovedUsd: number; payoutExposureUsd: number; cashRemainingUsd: number; exposureRemainingUsd: number; windowDays: number;
  tiers: { tier: number; name: string; cashMovedUsd: number; requires: string[]; description: string }[];
  prefill: Record<string, string>;
  submission: { id: number; status: string; requestedTier: number; submittedAt: string; reviewedAt: string | null; notes: string | null } | null;
}

const STATUS_TEXT: Record<string, [string, 'green' | 'amber' | 'grey' | 'blue']> = {
  submitted: ['Submitted, waiting for review', 'blue'], in_review: ['In review', 'amber'], approved: ['Approved', 'green'], rejected: ['Not approved', 'grey'],
};

function VerificationCard() {
  const q = useQuery({ queryKey: ['compliance-me'], queryFn: () => api<Standing>('/api/compliance/me'), retry: false });
  const [open, setOpen] = useState(false);
  const d = q.data;
  const pending = d?.submission && ['submitted', 'in_review'].includes(d.submission.status);
  const nextTier = d ? Math.min(3, d.tier + 1) : 1;
  return (
    <div className="bx-card">
      <div className="bx-card-h">
        <div><h2>Verification</h2><div className="sub">Your verification level sets how much you can move and protect in any {d?.windowDays ?? 30} days.</div></div>
        {d && <Tag tone={d.tier >= 2 ? 'green' : d.tier === 1 ? 'blue' : 'amber'}>{d.tierDef.name}</Tag>}
      </div>
      {q.isLoading ? <Loading /> : q.isError ? <div className="bx-empty">Verification is unavailable right now.</div> : d && (
        <>
          {d.tier > 0 && (
            <div className="bx-sums" style={{ borderTop: 0 }}>
              <Sum l="Moved (30 days)" v={<span className="num">${fmt(d.cashMovedUsd)} of ${fmt(d.tierDef.cashMovedUsd, 0)}</span>} />
              <Sum l="Protection exposure" v={<span className="num">${fmt(d.payoutExposureUsd)} of ${fmt(d.tierDef.payoutExposureUsd, 0)}</span>} />
            </div>
          )}
          {d.tier === 0 && !pending && <Note warn>You need to verify before you can buy protection or provide liquidity.</Note>}
          {d.submission && (
            <div style={{ marginTop: 12 }}>
              <Sum l={`Request for ${d.tiers.find((t) => t.tier === d.submission!.requestedTier)?.name ?? 'a higher level'}`} v={<Tag tone={STATUS_TEXT[d.submission.status]?.[1] ?? 'grey'}>{STATUS_TEXT[d.submission.status]?.[0] ?? d.submission.status}</Tag>} />
              {d.submission.notes && <Note warn>{d.submission.notes}</Note>}
            </div>
          )}
          {!pending && d.tier < 3 && !open && (
            <button className="bx-btn" style={{ marginTop: 16 }} onClick={() => setOpen(true)}>{d.tier === 0 ? 'Verify now' : 'Raise my limits'}</button>
          )}
          {open && <VerificationForm standing={d} initialTier={nextTier} onDone={() => { setOpen(false); void q.refetch(); }} onCancel={() => setOpen(false)} />}
        </>
      )}
    </div>
  );
}

const ID_TYPES = ['Ghana Card', 'Passport', 'National ID', "Driver's licence"];
const MAX_FILE = 4 * 1024 * 1024;

function VerificationForm({ standing, initialTier, onDone, onCancel }: { standing: Standing; initialTier: number; onDone: () => void; onCancel: () => void }) {
  const { toast } = useToast();
  const { session } = usePasskeySession();
  const p = standing.prefill;
  const [tier, setTier] = useState(initialTier);
  const [entity, setEntity] = useState<'individual' | 'business'>(p.companyName ? 'business' : 'individual');
  const [f, setF] = useState<Record<string, string>>({
    fullName: p.fullName ?? session?.user.name ?? '', email: p.email ?? session?.user.email ?? '', phone: p.phone ?? '', country: p.country ?? '',
    nationality: p.nationality ?? '', dateOfBirth: p.dateOfBirth ?? '', address: p.address ?? '', idType: p.idType ?? ID_TYPES[0], idNumber: p.idNumber ?? '',
    companyName: p.companyName ?? '', registrationNumber: '', beneficialOwners: '', sourceOfFunds: '', sourceOfWealth: '', expectedMonthlyVolume: '',
  });
  const [pep, setPep] = useState(false);
  const [docs, setDocs] = useState<{ label: string; filename: string; mime: string; dataUrl: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const field = (k: string, label: string, props: Record<string, unknown> = {}) => (
    <label className="bx-field"><span>{label}</span><input className="bx-input" value={f[k]} onChange={set(k)} {...props} /></label>
  );
  const addDoc = (label: string) => (e: { target: HTMLInputElement }) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE) { toast({ title: 'File too large', description: 'Upload a file under 4 MB.', variant: 'destructive' }); return; }
    const reader = new FileReader();
    reader.onload = () => setDocs((d) => [...d.filter((x) => x.label !== label), { label, filename: file.name, mime: file.type || 'application/octet-stream', dataUrl: String(reader.result) }]);
    reader.readAsDataURL(file);
  };
  const docInput = (label: string) => (
    <label className="bx-field"><span>{label}{docs.some((d) => d.label === label) ? ' · added' : ''}</span>
      <input className="bx-input" type="file" accept="image/*,application/pdf" onChange={addDoc(label)} /></label>
  );

  async function submit() {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { requestedTier: tier, entityType: entity, isPep: pep, documents: docs };
      for (const [k, v] of Object.entries(f)) if (v.trim()) body[k] = v.trim();
      await api('/api/compliance/submit', body);
      toast({ title: 'Verification submitted', description: 'We will review it and email you.' });
      onDone();
    } catch (e) {
      toast({ title: 'Not submitted', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(false); }
  }

  const needs = standing.tiers.find((t) => t.tier === tier)?.requires ?? [];
  return (
    <div style={{ marginTop: 18, borderTop: '1px solid var(--line)', paddingTop: 18 }}>
      <div className="bx-card-h" style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: 16 }}>Verification details</h2>
        <button className="bx-btn ghost small" onClick={onCancel}><X /> Cancel</button>
      </div>
      <span className="bx-label">Who is this account for?</span>
      <div className="bx-seg" style={{ marginBottom: 16 }}>
        <button className={entity === 'individual' ? 'on' : ''} onClick={() => setEntity('individual')}>An individual</button>
        <button className={entity === 'business' ? 'on' : ''} onClick={() => setEntity('business')}>A business</button>
      </div>
      <span className="bx-label">Level</span>
      <div className="bx-seg" style={{ marginBottom: 8 }}>
        {standing.tiers.filter((t) => t.tier > standing.tier).map((t) => (
          <button key={t.tier} className={tier === t.tier ? 'on' : ''} onClick={() => setTier(t.tier)}>{t.name} · ${fmt(t.cashMovedUsd, 0)}</button>
        ))}
      </div>
      {needs.length > 0 && <div className="sub" style={{ marginBottom: 16 }}>Needs: {needs.join(', ')}.</div>}

      {entity === 'business' && (
        <>
          <h3 style={{ fontSize: 14, margin: '8px 0 10px' }}>Business details</h3>
          {field('companyName', 'Registered company name')}
          {field('registrationNumber', 'Registration number')}
          {tier >= 3 && (
            <label className="bx-field"><span>Beneficial owners (10% or more): name, share, nationality</span>
              <textarea className="bx-input" rows={3} value={f.beneficialOwners} onChange={set('beneficialOwners')} /></label>
          )}
          <h3 style={{ fontSize: 14, margin: '8px 0 10px' }}>The person applying</h3>
        </>
      )}
      {field('fullName', 'Full legal name')}
      {field('email', 'Email', { type: 'email' })}
      {field('phone', 'Phone number', { type: 'tel' })}
      {field('country', 'Country of residence')}
      <label className="bx-field"><span>ID type</span>
        <select className="bx-select" value={f.idType} onChange={set('idType')}>{ID_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
      {field('idNumber', 'ID number')}
      {tier >= 2 && (
        <>
          {field('dateOfBirth', 'Date of birth', { type: 'date' })}
          {field('nationality', 'Nationality')}
          {field('address', 'Residential address')}
          {field('sourceOfFunds', 'Source of funds (for example: business revenue, salary)')}
          {field('expectedMonthlyVolume', 'Expected monthly volume (USD)')}
          {docInput('Photo ID document')}
          {docInput('Proof of address')}
        </>
      )}
      {tier >= 3 && (
        <>
          {field('sourceOfWealth', 'Source of wealth')}
          {entity === 'business' && docInput('Certificate of incorporation')}
          {entity === 'business' && docInput('Directors and shareholders register')}
        </>
      )}
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '4px 0 16px', fontSize: 14 }}>
        <input type="checkbox" checked={pep} onChange={(e) => setPep(e.target.checked)} />
        I am, or am closely related to, a politically exposed person
      </label>
      <button className="bx-btn block" disabled={busy || f.fullName.trim().length < 2} onClick={submit}>{busy ? <><Spin /> Submitting...</> : 'Submit for review'}</button>
    </div>
  );
}

function PasskeysCard() {
  const { toast } = useToast();
  const { session, setSession } = usePasskeySession();
  const [label, setLabel] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const passkeys = session?.passkeys ?? [];
  const refresh = async () => { const s = await currentPasskeySession(); if (s) setSession(s); };
  const backups = passkeys.filter((p) => p.role === 'backup' && p.status === 'active').length;

  async function add() {
    setBusy('Starting...');
    try {
      await addBackupPasskey(label.trim() || 'Backup passkey', (m) => setBusy(m));
      toast({ title: 'Backup passkey added', description: 'It can now sign in and approve transactions.' });
      setAdding(false);
      setLabel('');
    } catch (e) {
      toast({ title: 'Backup passkey not added', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setBusy(null);
      await refresh();
    }
  }

  return (
    <div className="bx-card">
      <div className="bx-card-h">
        <div><h2>Passkeys and recovery</h2><div className="sub">Passkeys approve every transaction and own your wallet. Add a backup on another phone or a security key, so losing one device never locks you out.</div></div>
        <Tag tone={backups > 0 ? 'green' : 'amber'}>{backups > 0 ? 'Recovery on' : 'No backup'}</Tag>
      </div>
      {passkeys.length === 0 ? <div className="bx-empty">No passkey yet.</div> : passkeys.map((p) => (
        <div key={p.credentialId} className="bx-mini">
          <span className="bx-ic"><KeyRound aria-hidden="true" /></span>
          <div className="grow">
            <div className="t">{p.label}{p.credentialId === session?.credentialId ? ' · this device' : ''}</div>
            <div className="d">{p.role === 'primary' ? 'First passkey' : 'Backup'} · added {new Date(p.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
              {p.status === 'pending' ? ` · Base ${p.onBase ? 'done' : 'pending'}, Stellar ${p.onStellar ? 'done' : 'pending'}` : ''}</div>
          </div>
          {p.status === 'active' ? <Tag tone="green">Active</Tag> : (
            <span style={{ display: 'flex', gap: 6 }}>
              <button className="bx-btn ghost small" disabled={!!busy} onClick={async () => { try { await finalizeBackupPasskey(p.credentialId); } finally { await refresh(); } }}>Check</button>
              {!p.onBase && !p.onStellar && <button className="bx-btn ghost small" disabled={!!busy} onClick={async () => { await cancelBackupPasskey(p.credentialId); await refresh(); }}>Remove</button>}
            </span>
          )}
        </div>
      ))}
      {!adding ? (
        <button className="bx-btn" style={{ marginTop: 16 }} onClick={() => setAdding(true)}><Plus /> Add backup passkey</button>
      ) : (
        <div style={{ marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 16 }}>
          <label className="bx-field"><span>Name it (for example "Work phone" or "YubiKey")</span>
            <input className="bx-input" maxLength={40} value={label} onChange={(e) => setLabel(e.target.value)} /></label>
          <Note>Your browser will offer to save it on this device, on another phone by scanning a QR code, or on a security key. You then approve twice with your current passkey: once for Base and once for Stellar. Network fees are covered.</Note>
          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <button className="bx-btn" disabled={!!busy} onClick={add}>{busy ? <><Spin /> {busy}</> : 'Create backup passkey'}</button>
            <button className="bx-btn ghost" disabled={!!busy} onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function AccountPage() {
  const { session, setSession } = usePasskeySession();
  const accounts = useAccounts();
  const [, setLocation] = useLocation();
  return (
    <main className="bx-main">
      <section className="bx-col">
        <div className="bx-card">
          <h2 style={{ marginBottom: 6 }}>Profile</h2>
          <div className="bx-sums" style={{ borderTop: 0 }}>
            <Sum l="Name" v={session?.user.name || '-'} />
            <Sum l="Email" v={session?.user.email || '-'} />
          </div>
          <button className="bx-btn ghost" style={{ marginTop: 12 }} onClick={async () => { await signOutPasskey(); setSession(null); setLocation('/auth'); }}><LogOut /> Sign out</button>
        </div>
        <VerificationCard />
        <PasskeysCard />
      </section>
      <aside className="bx-aside">
        <div className="bx-card tight">
          <h2 style={{ marginBottom: 4 }}>Your accounts</h2>
          <div className="bx-sums" style={{ borderTop: 0 }}>
            {accounts.map((a) => <Sum key={a.chain} l={a.name} v={<span className="num" style={{ fontSize: 12 }}>{a.address.slice(0, 8)}...{a.address.slice(-6)}</span>} />)}
          </div>
          <div className="sub">Your passkeys control every account. BlockFinaX never holds your keys.</div>
        </div>
      </aside>
    </main>
  );
}
