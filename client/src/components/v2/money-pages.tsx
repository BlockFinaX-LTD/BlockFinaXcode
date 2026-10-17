/**
 * Money in and out, and the account. This is the only place a user picks a network,
 * because it is where USDC enters or leaves BlockFinaX.
 */
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Copy, LogOut } from 'lucide-react';
import { useLocation } from 'wouter';
import { useToast } from '@/hooks/use-toast';
import { QRCodeComponent } from '@/components/wallet/qr-code';
import { usePasskeySession } from '@/lib/identity';
import { api, passkeySend, signOutPasskey, toScreenChain } from '@/lib/wallets/passkey-wallet';
import { fmt, useChains, useUsdcBalances, usdcOn } from './shared';
import { Note, Spin, Sum } from './ui';

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
      <h2 style={{ marginBottom: 4 }}>Balances</h2>
      <div className="bx-sums" style={{ borderTop: 0 }}>
        {accounts.map((a) => <Sum key={a.chain} l={a.name} v={<span className="num">${fmt(usdcOn(balances.data?.rows, a.chain))}</span>} />)}
        <Sum l="Total" v={<span className="num">${fmt(balances.data?.total)} USDC</span>} total />
      </div>
    </div>
  );
}

export function AddFunds() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const accounts = useAccounts();
  const chains = useChains();
  const hub = chains.data?.activeLiquidityHub;
  const [chain, setChain] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [claiming, setClaiming] = useState(false);
  useEffect(() => { if (!chain && accounts[0]) setChain(accounts.some((a) => a.chain === hub) ? hub! : accounts[0].chain); }, [accounts, chain, hub]);
  const acct = accounts.find((a) => a.chain === chain) ?? null;

  return (
    <main className="bx-main">
      <section className="bx-col">
        <div className="bx-card">
          <h2 style={{ marginBottom: 6 }}>Add funds</h2>
          <div className="sub" style={{ marginBottom: 18 }}>Send USDC to your BlockFinaX account from an exchange or another wallet.</div>
          <div className="bx-seg" style={{ marginBottom: 20 }}>
            {accounts.map((a) => <button key={a.chain} className={chain === a.chain ? 'on' : ''} onClick={() => { setChain(a.chain); setCopied(false); }}>{a.name}</button>)}
          </div>
          {acct && (
            <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ background: '#fff', padding: 12, borderRadius: 14, border: '1px solid var(--line)' }}><QRCodeComponent value={acct.address} size={168} /></div>
              <div style={{ flex: 1, minWidth: 240 }}>
                <div className="muted" style={{ fontSize: 13 }}>Your {acct.name} address</div>
                <div className="num" style={{ fontSize: 14, wordBreak: 'break-all', margin: '6px 0 14px' }}>{acct.address}</div>
                <button className="bx-btn ghost" onClick={async () => { await navigator.clipboard.writeText(acct.address); setCopied(true); }}>{copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy address'}</button>
              </div>
            </div>
          )}
          <div style={{ marginTop: 20 }}><Note>Send only USDC on {acct?.name ?? 'this network'} to this address. Network fees are covered by BlockFinaX.</Note></div>
        </div>
      </section>
      <aside className="bx-aside">
        <Balances />
        {acct?.stellar && (
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
        )}
      </aside>
    </main>
  );
}

export function SendFunds() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const accounts = useAccounts();
  const balances = useUsdcBalances();
  const [chain, setChain] = useState<string | null>(null);
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  useEffect(() => { if (!chain && accounts[0]) setChain(accounts[0].chain); }, [accounts, chain]);
  const acct = accounts.find((a) => a.chain === chain);
  const have = usdcOn(balances.data?.rows, chain ?? undefined);
  const validTo = acct?.stellar ? /^[GC][A-Z2-7]{55}$/.test(to) : /^0x[a-fA-F0-9]{40}$/.test(to);

  async function send() {
    if (!chain) return;
    setBusy('Preparing...');
    try {
      setHash(await passkeySend({ chain: toScreenChain(chain), symbol: 'USDC', to, amount }, (m) => setBusy(m)));
      setAmount('');
      void qc.invalidateQueries({ queryKey: ['v2-usdc-all'] });
    } catch (e) {
      toast({ title: 'Not sent', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(null); }
  }

  return (
    <main className="bx-main">
      <section className="bx-col">
        <div className="bx-card">
          <h2 style={{ marginBottom: 6 }}>Withdraw USDC</h2>
          <div className="sub">Send USDC to an exchange or another wallet. Transfers cannot be reversed, so check the address and network.</div>
        </div>
        <Balances />
      </section>
      <aside className="bx-aside">
        <div className="bx-panel">
          <div>
            <span className="bx-label">Network</span>
            <div className="bx-seg">{accounts.map((a) => <button key={a.chain} className={chain === a.chain ? 'on' : ''} onClick={() => { setChain(a.chain); setTo(''); }}>{a.name}</button>)}</div>
          </div>
          <div className="bx-big">
            <label htmlFor="bx-send">Amount (USDC)</label>
            <input id="bx-send" inputMode="decimal" value={`$${amount}`} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
            <div className="muted" style={{ fontSize: 12 }}>Available ${fmt(have)}</div>
          </div>
          <label className="bx-field" style={{ margin: 0 }}>
            <span>Recipient address</span>
            <input className="bx-input num" placeholder={acct?.stellar ? 'G... or C...' : '0x...'} value={to} onChange={(e) => setTo(e.target.value.trim())} />
          </label>
          {to && !validTo && <div className="bx-error">Enter a valid {acct?.name} address.</div>}
          <div className="bx-sums"><Sum l="Network fees" v="Covered" good /><Sum l="Recipient gets" v={<span className="num">${fmt(amount || 0)}</span>} total /></div>
          <button className="bx-btn block" disabled={!!busy || !validTo || !(Number(amount) > 0) || Number(amount) > have} onClick={send}>{busy ? <><Spin /> {busy}</> : 'Send USDC'}</button>
          {hash && <div className="bx-hint">Sent · reference {hash.slice(0, 10)}...{hash.slice(-6)}</div>}
        </div>
      </aside>
    </main>
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
            <Sum l="Transaction approval" v="Passkey on this device" />
          </div>
          <button className="bx-btn ghost" style={{ marginTop: 12 }} onClick={async () => { await signOutPasskey(); setSession(null); setLocation('/auth'); }}><LogOut /> Sign out</button>
        </div>
      </section>
      <aside className="bx-aside">
        <div className="bx-card tight">
          <h2 style={{ marginBottom: 4 }}>Your accounts</h2>
          <div className="bx-sums" style={{ borderTop: 0 }}>
            {accounts.map((a) => <Sum key={a.chain} l={a.name} v={<span className="num" style={{ fontSize: 12 }}>{a.address.slice(0, 8)}...{a.address.slice(-6)}</span>} />)}
          </div>
          <div className="sub">Your passkey controls every account. BlockFinaX never holds your keys.</div>
        </div>
      </aside>
    </main>
  );
}
