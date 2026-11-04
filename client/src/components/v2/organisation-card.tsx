/**
 * Business accounts, on the Account page.
 *
 * A person signs up for themselves. A business is a separate account they create here,
 * with its own address on Stellar. Its members are people with their own sign-in and
 * passkey; their role decides what their passkey can approve for the business:
 *   admin     everything, including withdrawals and members
 *   operator  buy cover and manage liquidity, never send money out
 *   viewer    see balances, cover and statements, approve nothing
 */
import { useEffect, useState } from 'react';
import { Building2, Check, Copy, Plus, ShieldCheck, TriangleAlert } from 'lucide-react';
import { Redirect } from 'wouter';
import { useToast } from '@/hooks/use-toast';
import { actingOrganisation, onActingOrganisationChange, pendingInviteToken, setPendingInviteToken } from '@/lib/acting-organisation';
import {
  acceptInvitation, actAs, checkOrganisationAccount, createOrganisation, getOrganisation, inviteMember, listOrganisations,
  organisationsConfig, retryDeploy, revokeInvitation, runMemberChange,
  type MemberView, type OrganisationCheck, type OrganisationSummary, type OrganisationView, type OrganisationsConfig,
} from '@/lib/organisations';
import type { OrganisationRole } from '@shared/organisations';
import { Note, Spin, Tag } from './ui';

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

export function OrganisationCard() {
  const { toast } = useToast();
  const [config, setConfig] = useState<OrganisationsConfig | null>(null);
  const [orgs, setOrgs] = useState<OrganisationSummary[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [acting, setActing] = useState(actingOrganisation());
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [invite, setInvite] = useState(pendingInviteToken());

  const refresh = async () => setOrgs(await listOrganisations().catch(() => []));
  useEffect(() => { organisationsConfig().then(setConfig).catch(() => setConfig(null)); void refresh(); }, []);
  useEffect(() => onActingOrganisationChange(() => setActing(actingOrganisation())), []);

  if (!config?.available) return null;

  async function create() {
    setBusy('Creating the business account. This takes about half a minute...');
    try {
      const org = await createOrganisation(name.trim());
      toast({ title: `${org.name} is ready`, description: 'Its account is on Stellar and you are its admin.' });
      setCreating(false); setName(''); setOpen(org.id);
    } catch (e) {
      toast({ title: 'Business account not created', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setBusy(null); await refresh();
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
      setPendingInviteToken(null); setInvite(null); setOpen(r.organisationId);
    } catch (e) {
      toast({ title: 'Invitation not accepted', description: (e as Error).message, variant: 'destructive' });
      if (['BAD_INVITE', 'INVITE_EXPIRED'].includes((e as { code?: string }).code ?? '')) { setPendingInviteToken(null); setInvite(null); }
    } finally {
      setBusy(null); await refresh();
    }
  }

  const ready = orgs.filter((o) => o.status === 'active' && o.myStatus === 'active');
  return (
    <div className="bx-card">
      <div className="bx-card-h">
        <div><h2>Business accounts</h2><div className="sub">A business account belongs to the business, not to one person. Invite your team and choose what each person can approve.</div></div>
        {acting ? <Tag tone="green">Acting for {acting.name}</Tag> : null}
      </div>

      {invite && (
        <div className="bx-mini" style={{ marginBottom: 12 }}>
          <span className="bx-ic"><Building2 aria-hidden="true" /></span>
          <div className="grow"><div className="t">You have an invitation to a business account</div><div className="d">Accept it with the email it was sent to.</div></div>
          <button className="bx-btn small" disabled={!!busy} onClick={accept}>Accept</button>
        </div>
      )}

      {ready.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div className="sub" style={{ marginBottom: 6 }}>Act for</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className={`bx-btn small${acting ? ' ghost' : ''}`} onClick={() => actAs(null)}>{!acting && <Check />} My personal account</button>
            {ready.map((o) => (
              <button key={o.id} className={`bx-btn small${acting?.id === o.id ? '' : ' ghost'}`} onClick={() => actAs(o)}>
                {acting?.id === o.id && <Check />} {o.name} · {ROLE_LABEL[o.myRole]}
              </button>
            ))}
          </div>
        </div>
      )}

      {orgs.length === 0 && !creating ? <div className="bx-empty">No business accounts yet.</div> : orgs.map((o) => (
        <div key={o.id}>
          <div className="bx-mini" style={{ cursor: 'pointer' }} onClick={() => setOpen(open === o.id ? null : o.id)}>
            <span className="bx-ic"><Building2 aria-hidden="true" /></span>
            <div className="grow">
              <div className="t">{o.name}</div>
              <div className="d">{ROLE_LABEL[o.myRole]}{o.account ? ` · ${o.account.slice(0, 6)}...${o.account.slice(-4)}` : ''}</div>
            </div>
            {o.status === 'active' ? <Tag tone={o.myStatus === 'active' ? 'green' : 'amber'}>{o.myStatus === 'active' ? 'Active' : STATUS_LABEL[o.myStatus as MemberView['status']] ?? o.myStatus}</Tag>
              : <Tag tone="amber">{o.status === 'deploying' ? 'Setting up' : 'Setup failed'}</Tag>}
          </div>
          {open === o.id && o.myStatus === 'active' && <OrganisationDetail id={o.id} config={config} onChanged={refresh} />}
        </div>
      ))}

      {!creating ? (
        <button className="bx-btn" style={{ marginTop: 16 }} onClick={() => setCreating(true)}><Plus /> Create a business account</button>
      ) : (
        <div style={{ marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 16 }}>
          <label className="bx-field"><span>Business name</span>
            <input className="bx-input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="For example, Acme Imports Ltd" /></label>
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

function OrganisationDetail({ id, config, onChanged }: { id: number; config: OrganisationsConfig; onChanged: () => Promise<void> }) {
  const { toast } = useToast();
  const [view, setView] = useState<OrganisationView | null>(null);
  const [check, setCheck] = useState<OrganisationCheck | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrganisationRole>('viewer');
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    const v = await getOrganisation(id);
    setView(v);
    if (v.status === 'active') checkOrganisationAccount(v).then(setCheck).catch(() => setCheck({ ok: false, problems: ['The account could not be checked'] }));
  };
  useEffect(() => { void load(); }, [id]);

  if (!view) return <div className="bx-empty"><Spin /> Loading...</div>;
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
      setBusy(null); await load(); await onChanged();
    }
  };

  const change = (m: MemberView, c: { kind: 'activate' | 'remove' | 'role'; role?: OrganisationRole } | 'resume', done: string) =>
    run('Starting...', () => runMemberChange(id, m.id, c, setBusy), done);

  return (
    <div style={{ padding: '8px 0 16px 12px', borderLeft: '2px solid var(--line)', marginLeft: 14 }}>
      {view.status !== 'active' ? (
        <>
          <Note>The business account is not set up yet.</Note>
          {admin && <button className="bx-btn small" disabled={!!busy} onClick={() => run('Setting up...', () => retryDeploy(id), 'Business account ready')}>{busy ? <><Spin /> {busy}</> : 'Try again'}</button>}
        </>
      ) : (
        <div className="bx-mini" style={{ marginBottom: 8 }}>
          <span className="bx-ic">{check?.ok ? <ShieldCheck aria-hidden="true" /> : <TriangleAlert aria-hidden="true" />}</span>
          <div className="grow">
            <div className="t">{check === null ? 'Checking the account on the network...' : check.ok ? 'Checked on the network' : 'Check needed'}</div>
            <div className="d">{check?.ok ? 'Runs the standard OpenZeppelin account, and your passkey is on it.' : check?.problems.join('. ')}</div>
          </div>
        </div>
      )}

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
                  <select className="bx-input" style={{ width: 'auto', padding: '4px 8px' }} disabled={!!busy || !!busyChange} value={m.role}
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
      {admin && !config.operatorsAvailable && <Note>Operators are coming soon on this network. For now, invite admins and viewers.</Note>}

      {admin && view.status === 'active' && (
        <div style={{ marginTop: 12 }}>
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
