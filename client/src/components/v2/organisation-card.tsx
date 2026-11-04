/**
 * Business accounts in the app.
 *
 *   OrganisationCard          on Profile settings: invitations, your businesses, create one
 *   OrganisationSettingsPage  Business settings: details, the chain check, members, activity
 *   OrganisationInviteLanding the invitation link's landing route
 *
 * A person signs up for themselves. A business is a separate account they create, with its
 * own address on Stellar. Its members are people with their own sign-in and passkey; their
 * role decides what their passkey can approve for the business:
 *   admin     everything, including withdrawals and members
 *   operator  buy cover and manage liquidity, never send money out
 *   viewer    see balances, cover and statements, approve nothing
 * Which account you act as is chosen in the account menu.
 */
import { useEffect, useState } from 'react';
import { Building2, Check, Copy, ExternalLink, Plus, ShieldCheck, TriangleAlert } from 'lucide-react';
import { Redirect } from 'wouter';
import { useToast } from '@/hooks/use-toast';
import { pendingInviteToken, setPendingInviteToken } from '@/lib/acting-organisation';
import { useActingOrganisation } from '@/lib/use-acting-organisation';
import {
  acceptInvitation, actAs, checkOrganisationAccount, createOrganisation, getOrganisation, inviteMember, listOrganisations,
  organisationHistory, organisationsConfig, retryDeploy, revokeInvitation, runMemberChange,
  type MemberView, type OrganisationCheck, type OrganisationSummary, type OrganisationView, type OrganisationsConfig,
} from '@/lib/organisations';
import type { OrganisationRole } from '@shared/organisations';
import { CREATE_BUSINESS_FLAG } from './account-menu';
import { Note, Spin, Sum, Tag } from './ui';
import type { Go } from './workspace';

const ROLE_LABEL: Record<OrganisationRole, string> = { admin: 'Admin', operator: 'Operator', viewer: 'Viewer' };
const ROLE_HELP: Record<OrganisationRole, string> = {
  admin: 'Can do everything, including withdrawals and managing members.',
  operator: 'Can buy cover and manage liquidity. Cannot send money out.',
  viewer: 'Can see balances, cover and statements. Approves nothing.',
};
const STATUS_LABEL: Record<MemberView['status'], string> = {
  invited: 'Invited', accepted: 'Waiting for approval', active: 'Active', removing: 'Being removed', removed: 'Removed',
};

/** The invitation link lands here: keep the token for this tab, then open the app. */
export function OrganisationInviteLanding() {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
  if (token) setPendingInviteToken(token);
  return <Redirect to="/hedge" />;
}

// ── Profile settings: your businesses ────────────────────────────────────────

export function OrganisationCard({ go }: { go: Go }) {
  const { toast } = useToast();
  const [config, setConfig] = useState<OrganisationsConfig | null>(null);
  const [orgs, setOrgs] = useState<OrganisationSummary[]>([]);
  const [creating, setCreating] = useState(() => {
    try { const v = sessionStorage.getItem(CREATE_BUSINESS_FLAG) === '1'; sessionStorage.removeItem(CREATE_BUSINESS_FLAG); return v; } catch { return false; }
  });
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [invite, setInvite] = useState(pendingInviteToken());

  const refresh = async () => setOrgs(await listOrganisations().catch(() => []));
  useEffect(() => { organisationsConfig().then(setConfig).catch(() => setConfig(null)); void refresh(); }, []);

  if (!config?.available) return null;

  const open = (o: OrganisationSummary | OrganisationView) => { actAs(o); go('org-settings'); };

  async function create() {
    setBusy('Creating the business account. This takes about half a minute...');
    try {
      const org = await createOrganisation(name.trim());
      toast({ title: `${org.name} is ready`, description: 'Its account is on Stellar and you are its admin.' });
      setCreating(false); setName('');
      await refresh();
      open(org);
    } catch (e) {
      toast({ title: 'Business account not created', description: (e as Error).message, variant: 'destructive' });
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function accept() {
    if (!invite) return;
    setBusy('Accepting the invitation...');
    try {
      const r = await acceptInvitation(invite);
      toast({
        title: 'Invitation accepted',
        description: r.status === 'active' ? 'You can now see the business account.' : 'An admin will now add your passkey to the business account.',
      });
      setPendingInviteToken(null); setInvite(null);
    } catch (e) {
      toast({ title: 'Invitation not accepted', description: (e as Error).message, variant: 'destructive' });
      if (['BAD_INVITE', 'INVITE_EXPIRED'].includes((e as { code?: string }).code ?? '')) { setPendingInviteToken(null); setInvite(null); }
    } finally {
      setBusy(null); await refresh();
    }
  }

  return (
    <div className="bx-card">
      <div className="bx-card-h">
        <div><h2>Business accounts</h2><div className="sub">A business account belongs to the business, not to one person. Switch to one from the account menu.</div></div>
      </div>

      {invite && (
        <div className="bx-mini" style={{ marginBottom: 12 }}>
          <span className="bx-ic"><Building2 aria-hidden="true" /></span>
          <div className="grow"><div className="t">You have an invitation to a business account</div><div className="d">Accept it with the email it was sent to.</div></div>
          <button className="bx-btn small" disabled={!!busy} onClick={accept}>Accept</button>
        </div>
      )}

      {orgs.length === 0 && !creating ? <div className="bx-empty">No business accounts yet.</div> : orgs.map((o) => (
        <div key={o.id} className="bx-mini">
          <span className="bx-ic"><Building2 aria-hidden="true" /></span>
          <div className="grow">
            <div className="t">{o.name}</div>
            <div className="d">{ROLE_LABEL[o.myRole]}{o.account ? ` · ${o.account.slice(0, 6)}...${o.account.slice(-4)}` : ''}</div>
          </div>
          {o.status !== 'active' ? <Tag tone="amber">{o.status === 'deploying' ? 'Setting up' : 'Setup failed'}</Tag>
            : o.myStatus !== 'active' ? <Tag tone="amber">{STATUS_LABEL[o.myStatus as MemberView['status']] ?? o.myStatus}</Tag>
            : <button className="bx-btn ghost small" onClick={() => open(o)}>Open</button>}
        </div>
      ))}

      {!creating ? (
        <button className="bx-btn" style={{ marginTop: 16 }} onClick={() => setCreating(true)}><Plus /> Create a business account</button>
      ) : (
        <div style={{ marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 16 }}>
          <label className="bx-field"><span>Business name</span>
            <input className="bx-input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="For example, Acme Imports Ltd" autoFocus /></label>
          <Note>This creates a new account on Stellar that belongs to the business. You become its first admin and your passkey approves for it. Add a second admin soon, so the business never depends on one phone. Network fees are covered.</Note>
          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <button className="bx-btn" disabled={!!busy || name.trim().length < 2} onClick={create}>{busy ? <><Spin /> {busy}</> : 'Create business account'}</button>
            <button className="bx-btn ghost" disabled={!!busy} onClick={() => setCreating(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Business settings ────────────────────────────────────────────────────────

export function OrganisationSettingsPage({ go }: { go: Go }) {
  const acting = useActingOrganisation();
  const [config, setConfig] = useState<OrganisationsConfig | null>(null);
  const [view, setView] = useState<OrganisationView | null>(null);
  const [check, setCheck] = useState<OrganisationCheck | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const load = async (id: number) => {
    try {
      const v = await getOrganisation(id);
      setView(v); setFailed(null);
      if (v.status === 'active') checkOrganisationAccount(v).then(setCheck).catch(() => setCheck({ ok: false, problems: ['The account could not be checked'] }));
    } catch (e) {
      setFailed((e as Error).message);
    }
  };
  useEffect(() => { organisationsConfig().then(setConfig).catch(() => setConfig(null)); }, []);
  useEffect(() => { setView(null); setCheck(null); if (acting) void load(acting.id); }, [acting?.id]);

  if (!acting) {
    return (
      <main className="bx-main"><section className="bx-col"><div className="bx-card">
        <h2>Business settings</h2>
        <div className="sub" style={{ marginTop: 6 }}>Choose a business from the account menu to see its settings, or create one in Profile settings.</div>
        <button className="bx-btn" style={{ marginTop: 16 }} onClick={() => go('account')}>Go to Profile settings</button>
      </div></section></main>
    );
  }
  if (failed) return <main className="bx-main"><section className="bx-col"><div className="bx-card"><div className="bx-error">{failed}</div></div></section></main>;
  if (!view || !config) return <main className="bx-main"><section className="bx-col"><div className="bx-card"><Spin /> Loading...</div></section></main>;

  return (
    <main className="bx-main">
      <section className="bx-col">
        <DetailsCard view={view} check={check} onRetried={() => load(view.id)} />
        <MembersCard view={view} config={config} onChanged={() => load(view.id)} />
      </section>
      <aside className="bx-aside">
        <ActivityCard view={view} />
      </aside>
    </main>
  );
}

function DetailsCard({ view, check, onRetried }: { view: OrganisationView; check: OrganisationCheck | null; onRetried: () => void }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const network = view.networkKey.includes('testnet') ? 'Stellar Testnet' : 'Stellar';
  return (
    <div className="bx-card">
      <h2 style={{ marginBottom: 6 }}>Business settings</h2>
      <div className="sub">Details of {view.name}'s account. Members and their roles are below.</div>
      <div className="bx-sums">
        <Sum l="Business name" v={view.name} />
        <Sum l="Your role" v={ROLE_LABEL[view.myRole]} />
        <Sum l="Network" v={network} />
        <Sum l="Approvals needed from admins" v={String(view.adminApprovals)} />
      </div>
      <label className="bx-field" style={{ marginTop: 16 }}><span>Business account address</span>
        <span style={{ display: 'flex', gap: 8 }}>
          <input className="bx-input num" readOnly value={view.account ?? 'Not set up yet'} style={{ fontSize: 12 }} />
          {view.account && <button className="bx-btn ghost small" aria-label="Copy the business account address" onClick={() => { void navigator.clipboard?.writeText(view.account!); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? <Check /> : <Copy />}</button>}
        </span>
      </label>
      {view.status !== 'active' ? (
        <div style={{ marginTop: 12 }}>
          <Note>The business account is not set up yet.</Note>
          {view.myRole === 'admin' && <button className="bx-btn small" style={{ marginTop: 8 }} disabled={busy} onClick={async () => {
            setBusy(true);
            try { await retryDeploy(view.id); toast({ title: 'Business account ready' }); onRetried(); }
            catch (e) { toast({ title: 'Not set up', description: (e as Error).message, variant: 'destructive' }); }
            finally { setBusy(false); }
          }}>{busy ? <Spin /> : null} Try again</button>}
        </div>
      ) : (
        <div className="bx-mini" style={{ marginTop: 12 }}>
          <span className="bx-ic">{check?.ok ? <ShieldCheck aria-hidden="true" /> : <TriangleAlert aria-hidden="true" />}</span>
          <div className="grow">
            <div className="t">{check === null ? 'Checking the account on the network...' : check.ok ? 'Checked on the network' : 'Check needed'}</div>
            <div className="d">{check?.ok ? 'Runs the standard OpenZeppelin account, and your passkey is on it.' : check?.problems.join('. ')}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function MembersCard({ view, config, onChanged }: { view: OrganisationView; config: OrganisationsConfig; onChanged: () => Promise<void> }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrganisationRole>('viewer');
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const id = view.id;
  const admin = view.myRole === 'admin';
  const activeAdmins = view.members.filter((m) => m.role === 'admin' && m.status === 'active').length;
  const busyChange = view.members.find((m) => m.pending);

  const run = async (label: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(label);
    try {
      await fn();
      toast({ title: done });
    } catch (e) {
      toast({ title: 'Not done', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setBusy(null); await onChanged();
    }
  };
  const change = (m: MemberView, c: { kind: 'activate' | 'remove' | 'role'; role?: OrganisationRole } | 'resume', done: string) =>
    run('Starting...', () => runMemberChange(id, m.id, c, setBusy), done);

  return (
    <div className="bx-card">
      <div className="bx-card-h">
        <div><h2>Members</h2><div className="sub">People who can use {view.name}'s account, and what each can approve.</div></div>
        <Tag tone={activeAdmins >= 2 ? 'green' : 'amber'}>{activeAdmins} admin{activeAdmins === 1 ? '' : 's'}</Tag>
      </div>

      {view.members.map((m) => (
        <div key={m.id} className="bx-mini">
          <div className="grow">
            <div className="t">{m.email}{m.id === view.me.memberId ? ' · you' : ''}</div>
            <div className="d">{ROLE_LABEL[m.role]} · {STATUS_LABEL[m.status]}{m.pending ? ` · change in progress, ${m.pending.stepsLeft} step${m.pending.stepsLeft === 1 ? '' : 's'} left` : ''}</div>
          </div>
          {admin && (
            <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {m.pending && <button className="bx-btn small" disabled={!!busy} onClick={() => change(m, 'resume', 'Change finished')}>Continue</button>}
              {!m.pending && m.status === 'accepted' && (
                <button className="bx-btn small" disabled={!!busy || !!busyChange || (m.role === 'operator' && !config.operatorsAvailable)}
                  onClick={() => change(m, { kind: 'activate' }, `${m.email} can now approve as ${ROLE_LABEL[m.role].toLowerCase()}`)}>Add to account</button>
              )}
              {!m.pending && (m.status === 'invited' || m.status === 'accepted') && (
                <button className="bx-btn ghost small" disabled={!!busy} onClick={() => run('Withdrawing...', () => revokeInvitation(id, m.id), 'Invitation withdrawn')}>Withdraw</button>
              )}
              {!m.pending && m.status === 'active' && !(m.role === 'admin' && activeAdmins <= 1) && (
                <>
                  <select className="bx-input" aria-label={`Role for ${m.email}`} style={{ width: 'auto', padding: '4px 8px' }} disabled={!!busy || !!busyChange} value={m.role}
                    onChange={(e) => change(m, { kind: 'role', role: e.target.value as OrganisationRole }, 'Role changed')}>
                    {(['admin', 'operator', 'viewer'] as const).map((r) => <option key={r} value={r} disabled={r === 'operator' && !config.operatorsAvailable}>{ROLE_LABEL[r]}</option>)}
                  </select>
                  <button className="bx-btn ghost small" disabled={!!busy || !!busyChange} onClick={() => change(m, { kind: 'remove' }, `${m.email} removed`)}>Remove</button>
                </>
              )}
            </span>
          )}
        </div>
      ))}

      {busy && <Note><Spin /> {busy}</Note>}
      {admin && activeAdmins < 2 && <Note>Only one admin. If their phone is lost, nobody can manage this account. Invite a second admin.</Note>}

      {admin && view.status === 'active' && (
        <div style={{ marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 16 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="bx-field" style={{ flex: '1 1 200px', margin: 0 }}><span>Invite by email</span>
              <input className="bx-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@business.com" /></label>
            <label className="bx-field" style={{ margin: 0 }}><span>Role</span>
              <select className="bx-input" value={role} onChange={(e) => setRole(e.target.value as OrganisationRole)}>
                {(['admin', 'operator', 'viewer'] as const).map((r) => <option key={r} value={r} disabled={r === 'operator' && !config.operatorsAvailable}>{ROLE_LABEL[r]}</option>)}
              </select></label>
            <button className="bx-btn" disabled={!!busy || !email.includes('@')} onClick={() => run('Sending...', async () => {
              const r = await inviteMember(id, email.trim(), role);
              setLink(r.link); setEmail('');
              if (!r.emailed) throw new Error('The invitation was created but the email did not send. Share the link below instead.');
            }, 'Invitation sent')}>Invite</button>
          </div>
          <div className="sub" style={{ marginTop: 6 }}>{ROLE_HELP[role]}</div>
          {link && (
            <div className="bx-mini" style={{ marginTop: 8 }}>
              <div className="grow"><div className="t">Invitation link</div><div className="d" style={{ wordBreak: 'break-all' }}>{link}</div></div>
              <button className="bx-btn ghost small" onClick={() => { void navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const EVENT_TEXT: Record<string, (d: Record<string, unknown>) => string> = {
  created: () => 'Business account created',
  account_deployed: () => 'Account set up on Stellar',
  invited: (d) => `Invited ${d.email} as ${String(d.role)}`,
  accepted: (d) => `${d.email} accepted the invitation`,
  invite_withdrawn: (d) => `Invitation to ${d.email} withdrawn`,
  activate_started: (d) => `Adding ${d.email} to the account`,
  activated: (d) => `${d.email} added as ${String(d.role)}`,
  remove_started: (d) => `Removing ${d.email}`,
  removed: (d) => `${d.email} removed`,
  role_started: (d) => `Changing ${d.email} to ${String(d.role)}`,
  role_changed: (d) => `${d.email} is now ${String(d.role)}`,
  step_confirmed: () => 'Change confirmed on Stellar',
};

function ActivityCard({ view }: { view: OrganisationView }) {
  const [events, setEvents] = useState<Awaited<ReturnType<typeof organisationHistory>> | null>(null);
  useEffect(() => { organisationHistory(view.id).then(setEvents).catch(() => setEvents([])); }, [view.id, view.members.length]);
  const explorer = `https://stellar.expert/explorer/${view.networkKey.includes('testnet') ? 'testnet' : 'public'}/tx/`;
  return (
    <div className="bx-card tight">
      <h2 style={{ marginBottom: 4 }}>Activity</h2>
      <div className="sub" style={{ marginBottom: 8 }}>Who changed what, with each on-chain change linked.</div>
      {events === null ? <Spin /> : events.length === 0 ? <div className="bx-empty">Nothing yet.</div> : events.slice(0, 20).map((e) => (
        <div key={e.id} className="bx-mini">
          <div className="grow">
            <div className="t" style={{ fontSize: 13 }}>{(EVENT_TEXT[e.kind] ?? (() => e.kind))(e.detail)}</div>
            <div className="d">{new Date(e.createdAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
          </div>
          {e.txHash && <a className="bx-btn ghost small" href={explorer + e.txHash} target="_blank" rel="noreferrer" aria-label="View on Stellar"><ExternalLink /></a>}
        </div>
      ))}
    </div>
  );
}
