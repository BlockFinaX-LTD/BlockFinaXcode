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
import { Card, Row, Spin } from './ui';

function useAccounts() {
  const { session } = usePasskeySession();
  const chains = useChains();
  const name = (key: string) => chains.data?.chains.find((c) => c.key === key)?.name ?? key;
  return (session?.accounts ?? []).map((a) => ({ chain: a.chain, name: name(a.chain), address: a.address, stellar: a.chain.startsWith('stellar') }));
}

export function AddFunds() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const accounts = useAccounts();
  const balances = useUsdcBalances();
  const chains = useChains();
  const [chain, setChain] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [claiming, setClaiming] = useState(false);
  useEffect(() => { if (!chain && accounts[0]) setChain(chains.data?.activeLiquidityHub && accounts.some((a) => a.chain === chains.data!.activeLiquidityHub) ? chains.data.activeLiquidityHub : accounts[0].chain); }, [accounts, chain, chains.data]);
  const acct = accounts.find((a) => a.chain === chain) ?? null;

  return (
    <div className="bx-grid bx-wide">
      <Card title="Receive USDC">
        <div className="bx-field">
          <label>Network you are sending from</label>
          <select className="bx-select" value={chain ?? ''} onChange={(e) => { setChain(e.target.value); setCopied(false); }}>
            {accounts.map((a) => <option key={a.chain} value={a.chain}>{a.name}{a.chain === chains.data?.activeLiquidityHub ? ' (Recommended)' : ''}</option>)}
          </select>
        </div>
        {acct && (
          <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ background: '#fff', padding: 10, borderRadius: 12, border: '1px solid var(--bx-line)' }}><QRCodeComponent value={acct.address} size={150} /></div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div className="bx-muted">Your {acct.name} address</div>
              <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, wordBreak: 'break-all', margin: '6px 0 10px' }}>{acct.address}</div>
              <button className="bx-btn ghost small" onClick={async () => { await navigator.clipboard.writeText(acct.address); setCopied(true); }}>{copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy address'}</button>
            </div>
          </div>
        )}
        <p className="bx-note" style={{ marginTop: 14 }}>Send only USDC on {acct?.name ?? 'this network'} to this address. Network fees are covered by BlockFinaX.</p>
        {acct?.stellar && (
          <div className="bx-actions" style={{ justifyContent: 'flex-start' }}>
            <button className="bx-btn primary small" disabled={claiming} onClick={async () => {
              setClaiming(true);
              try {
                await api('/api/wallet/faucet/usdc', {});
                toast({ title: 'Test USDC sent', description: '10 test USDC is on its way.' });
                void qc.invalidateQueries({ queryKey: ['v2-usdc-all'] });
              } catch (e) {
                toast({ title: 'Faucet unavailable', description: (e as Error).message, variant: 'destructive' });
              } finally { setClaiming(false); }
            }}>{claiming ? <Spin /> : null} Get 10 test USDC</button>
          </div>
        )}
      </Card>
      <Card title="Balances">
        <div className="bx-rows">
          {accounts.map((a) => <Row key={a.chain} l={a.name} v={`$${fmt(usdcOn(balances.data?.rows, a.chain))}`} />)}
          <Row l="Total" v={`$${fmt(balances.data?.total)} USDC`} total />
        </div>
      </Card>
    </div>
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
    <div className="bx-grid bx-wide">
      <Card title="Send USDC">
        <div className="bx-field">
          <label>Network</label>
          <select className="bx-select" value={chain ?? ''} onChange={(e) => { setChain(e.target.value); setTo(''); }}>
            {accounts.map((a) => <option key={a.chain} value={a.chain}>{a.name} · ${fmt(usdcOn(balances.data?.rows, a.chain))}</option>)}
          </select>
        </div>
        <div className="bx-field">
          <label>Recipient address</label>
          <input className="bx-input" placeholder={acct?.stellar ? 'G... or C...' : '0x...'} value={to} onChange={(e) => setTo(e.target.value.trim())} />
          {to && !validTo && <span className="bx-error">Enter a valid {acct?.name} address.</span>}
        </div>
        <div className="bx-field">
          <label>Amount (USDC)</label>
          <input className="bx-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
          <span className="bx-muted">Available: ${fmt(have)}</span>
        </div>
        <div className="bx-actions"><button className="bx-btn primary" disabled={!!busy || !validTo || !(Number(amount) > 0) || Number(amount) > have} onClick={send}>{busy ? <><Spin /> {busy}</> : 'Send USDC'}</button></div>
        {hash && <p className="bx-note" style={{ marginTop: 12 }}>Sent. Reference {hash.slice(0, 10)}...{hash.slice(-6)}</p>}
      </Card>
      <Card title="Before you send">
        <p className="bx-muted">Make sure the recipient can receive USDC on {acct?.name ?? 'this network'}. Transfers cannot be reversed. Network fees are covered by BlockFinaX.</p>
      </Card>
    </div>
  );
}

export function AccountPage() {
  const { session, setSession } = usePasskeySession();
  const accounts = useAccounts();
  const [, setLocation] = useLocation();
  return (
    <div className="bx-grid bx-two">
      <Card title="Profile">
        <div className="bx-rows">
          <Row l="Name" v={session?.user.name || '-'} />
          <Row l="Email" v={session?.user.email || '-'} />
          <Row l="Transaction approval" v="Passkey on this device" />
        </div>
        <div className="bx-actions" style={{ justifyContent: 'flex-start' }}>
          <button className="bx-btn ghost" onClick={async () => { await signOutPasskey(); setSession(null); setLocation('/auth'); }}><LogOut /> Sign out</button>
        </div>
      </Card>
      <Card title="Your accounts">
        <div className="bx-rows">
          {accounts.map((a) => <Row key={a.chain} l={a.name} v={<span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{a.address.slice(0, 8)}...{a.address.slice(-6)}</span>} />)}
        </div>
        <p className="bx-muted" style={{ marginTop: 10 }}>Your passkey controls every account. BlockFinaX never holds your keys.</p>
      </Card>
    </div>
  );
}
