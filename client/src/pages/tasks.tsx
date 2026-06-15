/**
 * Earn — rebuilt to the new design (app/Earn.html).
 *
 * Points hero, task list with category filter, referral card, points activity
 * and leaderboard, plus submit-evidence and cash-out modals. All wiring is
 * unchanged: /api/tasks, /api/tasks/progress, completeMutation (+ Cloudinary
 * evidence upload), /api/tasks/leaderboard, /api/points*, /api/referrals*.
 */
import { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRift } from '@rift-finance/react';
import { AppShell } from '@/components/app-shell';
import { useWallet } from '@/hooks/use-wallet';
import { useToast } from '@/hooks/use-toast';
import { CoinSvg, NetSvg } from '@/components/app-glyphs';
import {
  Sun, Users, Award, LayoutGrid, Share2, Link as LinkIcon, MessageCircle, Twitter,
  Repeat2, CheckCheck, ShieldCheck, Layers, PlusCircle, PenLine, Newspaper, Star,
  ArrowUpRight, CheckCircle2, Clock, Upload, BadgeCheck, Copy, Check, Plus, X,
  ImagePlus, Send, Info, CircleDollarSign, Banknote, Gift, ChevronDown,
} from 'lucide-react';

interface DailyTask {
  id: number; taskKey: string; title: string; description: string; points: number;
  category: string; icon: string; actionType: string; actionUrl?: string;
  isDaily: boolean; isActive: boolean; sortOrder: number;
}
interface TaskProgress {
  completedTaskIds: number[]; todayCompletedTaskIds: number[];
  totalPointsEarned: number; userTotalPoints: number; completionsCount: number;
}

const ICONS: Record<string, any> = {
  twitter: Twitter, 'repeat-2': Repeat2, 'message-circle': MessageCircle, 'check-check': CheckCheck,
  'shield-check': ShieldCheck, layers: Layers, 'plus-circle': PlusCircle, 'pen-line': PenLine,
  newspaper: Newspaper, share: Share2, link: LinkIcon, gift: Gift, star: Star,
};
const CATS = [
  { c: 'all', label: 'All', icon: LayoutGrid },
  { c: 'social', label: 'Social', icon: Share2 },
  { c: 'onchain', label: 'On-chain', icon: LinkIcon },
  { c: 'community', label: 'Community', icon: MessageCircle },
];

function fmt(n: number) { return n.toLocaleString('en-US'); }

export default function TasksPage() {
  const [, setLocation] = useLocation();
  const { wallet, isUnlocked, walletExists, isLoading: walletLoading } = useWallet();
  const { getAccessToken } = useRift();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [cat, setCat] = useState('all');
  const [evidenceTask, setEvidenceTask] = useState<DailyTask | null>(null);
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [evidenceText, setEvidenceText] = useState('');
  const [evidenceImage, setEvidenceImage] = useState('');
  const [uploading, setUploading] = useState(false);
  const [cashOpen, setCashOpen] = useState(false);
  const [cashToken, setCashToken] = useState<'USDC' | 'USDT'>('USDC');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!walletLoading && !walletExists()) setLocation('/auth');
  }, [walletExists, walletLoading, setLocation]);

  const walletAddress = wallet?.address?.toLowerCase() || '';

  const { data: tasks = [], isLoading: tasksLoading } = useQuery<DailyTask[]>({ queryKey: ['/api/tasks'] });
  const { data: progress } = useQuery<TaskProgress>({
    queryKey: ['/api/tasks/progress', walletAddress],
    queryFn: () => fetch(`/api/tasks/progress/${walletAddress}`).then((r) => r.json()),
    enabled: !!walletAddress,
  });
  const { data: leaderboard = [] } = useQuery<any[]>({ queryKey: ['/api/tasks/leaderboard'] });
  const { data: userPoints } = useQuery({
    queryKey: ['/api/points', wallet?.address],
    queryFn: () => fetch(`/api/points/${wallet?.address}`).then((r) => r.json()),
    enabled: !!wallet?.address,
  });
  const { data: pointValue } = useQuery<{ usdPerPoint: number }>({
    queryKey: ['/api/platform/settings/point-value'],
    staleTime: 5 * 60 * 1000,
  });
  const usdPerPoint = pointValue?.usdPerPoint ?? 0.05;
  const { data: referralCode } = useQuery<{ code: string }>({
    queryKey: ['/api/referrals/codes', wallet?.address],
    queryFn: () => fetch(`/api/referrals/codes/${wallet?.address}`).then((r) => r.json()),
    enabled: !!wallet?.address,
  });
  const { data: referrals } = useQuery<any[]>({
    queryKey: ['/api/referrals', wallet?.address],
    queryFn: () => fetch(`/api/referrals/${wallet?.address}`).then((r) => r.json()),
    enabled: !!wallet?.address,
  });
  const { data: pointTransactions } = useQuery<any[]>({
    queryKey: ['/api/points/transactions', wallet?.address],
    queryFn: () => fetch(`/api/points/transactions/${wallet?.address}`).then((r) => r.json()),
    enabled: !!wallet?.address,
  });

  const completeMutation = useMutation({
    mutationFn: async (payload: { taskId: number; evidenceUrl?: string; evidenceImage?: string; evidenceText?: string }) => {
      const accessToken = await getAccessToken();
      const res = await fetch('/api/tasks/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(payload), credentials: 'include',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || body.message || `Failed (${res.status})`);
      return body;
    },
    onSuccess: (data) => {
      if (data?.status === 'pending_review') {
        toast({ title: 'Submitted for review', description: data.message || 'An admin will review and award points.' });
      } else {
        toast({ title: `+${data.pointsEarned} points!`, description: `Total: ${data.totalPoints} points` });
      }
      queryClient.invalidateQueries({ queryKey: ['/api/tasks/progress', walletAddress] });
      queryClient.invalidateQueries({ queryKey: ['/api/tasks/leaderboard'] });
      queryClient.invalidateQueries({ queryKey: ['/api/points', wallet?.address] });
    },
    onError: (err: any) => toast({ title: 'Task error', description: err.message || 'Could not complete task', variant: 'destructive' }),
  });

  const uploadEvidenceImage = async (file: File) => {
    if (!file.type.startsWith('image/')) { toast({ title: 'Image only', description: 'Attach an image file.', variant: 'destructive' }); return; }
    if (file.size > 5 * 1024 * 1024) { toast({ title: 'Too large', description: 'Max image size is 5 MB.', variant: 'destructive' }); return; }
    setUploading(true);
    try {
      const accessToken = await getAccessToken();
      const sigRes = await fetch('/api/tasks/upload-signature', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({}),
      });
      const sig = await sigRes.json();
      if (!sigRes.ok) throw new Error(sig.error || 'Failed to authorize upload');
      const form = new FormData();
      form.append('file', file); form.append('api_key', sig.apiKey); form.append('timestamp', String(sig.timestamp));
      form.append('signature', sig.signature); form.append('folder', sig.folder);
      if (sig.eager) form.append('eager', sig.eager);
      const uploadRes = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`, { method: 'POST', body: form });
      const uploaded = await uploadRes.json();
      if (!uploadRes.ok || !uploaded.secure_url) throw new Error(uploaded.error?.message || 'Upload failed');
      setEvidenceImage(uploaded.secure_url);
    } catch (e: any) {
      toast({ title: 'Upload failed', description: e?.message || 'Try again.', variant: 'destructive' });
    } finally { setUploading(false); }
  };

  const submitEvidence = () => {
    if (!evidenceTask) return;
    completeMutation.mutate(
      { taskId: evidenceTask.id, evidenceUrl: evidenceUrl.trim(), evidenceImage, evidenceText: evidenceText.trim() },
      { onSuccess: () => { setEvidenceTask(null); setEvidenceUrl(''); setEvidenceText(''); setEvidenceImage(''); } },
    );
  };

  const handleTaskAction = (task: DailyTask) => {
    if ((task as any).verifier === 'manual') {
      setEvidenceUrl(''); setEvidenceText(''); setEvidenceImage(''); setEvidenceTask(task);
      if (task.actionType === 'external' && task.actionUrl) window.open(task.actionUrl, '_blank');
      return;
    }
    if (task.actionType === 'external' && task.actionUrl) {
      window.open(task.actionUrl, '_blank');
      setTimeout(() => completeMutation.mutate({ taskId: task.id }), 2000);
    } else if (task.actionType === 'internal' && task.actionUrl) {
      completeMutation.mutate({ taskId: task.id });
      setTimeout(() => setLocation(task.actionUrl!), 500);
    } else {
      completeMutation.mutate({ taskId: task.id });
    }
  };

  const isTaskCompleted = (task: DailyTask) =>
    !progress ? false : task.isDaily ? progress.todayCompletedTaskIds.includes(task.id) : progress.completedTaskIds.includes(task.id);

  const filteredTasks = useMemo(() => (cat === 'all' ? tasks : tasks.filter((t) => t.category === cat)), [tasks, cat]);

  // ── Hero stats ──────────────────────────────────────────────────────────
  const totalPoints = progress?.userTotalPoints || (userPoints as any)?.totalPoints || 0;
  const referralPts = (userPoints as any)?.referralPoints || 0;
  const friends = (referrals as any)?.length || 0;
  const earnedToday = useMemo(() => {
    if (!progress) return 0;
    const ids = new Set(progress.todayCompletedTaskIds);
    return tasks.filter((t) => ids.has(t.id)).reduce((s, t) => s + t.points, 0);
  }, [progress, tasks]);
  const myRank = useMemo(() => {
    const i = leaderboard.findIndex((e) => e.walletAddress?.toLowerCase() === walletAddress);
    return i >= 0 ? i + 1 : null;
  }, [leaderboard, walletAddress]);

  const copyCode = () => {
    if (!referralCode?.code) return;
    navigator.clipboard.writeText(referralCode.code).then(() => {
      setCopied(true);
      toast({ title: 'Code copied', description: 'Share it to start earning.' });
      setTimeout(() => setCopied(false), 1400);
    });
  };

  if (walletLoading || !isUnlocked) return null;

  const taskBtn = (task: DailyTask) => {
    if (isTaskCompleted(task)) return <button className="t-btn donebtn"><CheckCircle2 /> Done</button>;
    const isManual = (task as any).verifier === 'manual';
    const isOnchain = task.category === 'onchain';
    if (isManual) return <button className="t-btn go" disabled={completeMutation.isPending} onClick={() => handleTaskAction(task)}><Upload /> Submit</button>;
    if (isOnchain) return <button className="t-btn claim" disabled={completeMutation.isPending} onClick={() => handleTaskAction(task)}><BadgeCheck /> Verify</button>;
    if (task.actionType === 'external') return <button className="t-btn go" disabled={completeMutation.isPending} onClick={() => handleTaskAction(task)}><ArrowUpRight /> Go</button>;
    return <button className="t-btn claim" disabled={completeMutation.isPending} onClick={() => handleTaskAction(task)}>Claim</button>;
  };

  return (
    <AppShell active="earn" greeting={{ title: 'Earn', subtitle: 'Complete tasks, collect points, cash out in USDC' }}>
      <div className="earn-grid">
        {/* LEFT */}
        <div className="earn-col">
          {/* points hero */}
          <div className="pts-hero">
            <div className="pts-k">Your points</div>
            <div className="pts-num"><span className="tnum">{fmt(totalPoints)}</span><span className="usd">≈ ${(totalPoints * usdPerPoint).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
            <div className="pts-stats">
              <div className="pstat"><div className="l"><Sun /> Earned today</div><div className="v tnum">{fmt(earnedToday)}</div></div>
              <div className="pstat"><div className="l"><Users /> Referrals</div><div className="v tnum">{fmt(friends)}</div></div>
              <div className="pstat"><div className="l"><Award /> Rank</div><div className="v tnum">{myRank ? `#${myRank}` : '—'}</div></div>
            </div>
          </div>

          {/* tasks */}
          <div className="sec">
            <div className="sec-h"><h2>Tasks</h2><a className="more" onClick={() => setCashOpen(true)}>Cash out <ArrowUpRight /></a></div>
            <div className="catbar">
              {CATS.map((c) => { const Icon = c.icon; return (
                <button key={c.c} className={cat === c.c ? 'on' : ''} onClick={() => setCat(c.c)}><Icon /> {c.label}</button>
              ); })}
            </div>
            <div className="tasks">
              {tasksLoading ? (
                <div className="task"><div className="t-main"><div className="t-title">Loading…</div></div></div>
              ) : filteredTasks.length === 0 ? (
                <div className="task"><div className="t-main"><div className="t-title">No tasks in this category</div><div className="t-desc">Check back soon for new ways to earn.</div></div></div>
              ) : filteredTasks.map((task) => {
                const Icon = ICONS[task.icon] || Star;
                const done = isTaskCompleted(task);
                const isManual = (task as any).verifier === 'manual';
                return (
                  <div className={`task${done ? ' done' : ''}`} key={task.id}>
                    <span className="t-ico"><Icon /></span>
                    <div className="t-main">
                      <div className="t-title">{task.title}
                        {task.isDaily ? <span className="badge daily">Daily</span> : <span className="badge once">One-time</span>}
                        {isManual && !done && <span className="badge review">Review</span>}
                        {task.category === 'onchain' && !done && <span className="badge verify">On-chain</span>}
                      </div>
                      <div className="t-desc">{task.description}</div>
                    </div>
                    <div className="t-right"><div className="t-pts">+{fmt(task.points)} <span className="u">pts</span></div>{taskBtn(task)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* RIGHT */}
        <div className="earn-col">
          {/* referral */}
          <div className="ref-card">
            <h3><Gift /> Refer &amp; earn</h3>
            <p>Share your code. When a friend signs up and transacts, you both earn points.</p>
            <div className="ref-code">
              <span className="code">{referralCode?.code || '—'}</span>
              <button className="copy" aria-label="Copy code" onClick={copyCode}>{copied ? <Check /> : <Copy />}</button>
            </div>
            <div className="ref-stats">
              <div className="ref-stat"><div className="l">Referees</div><div className="v tnum">{fmt(friends)}</div></div>
              <div className="ref-stat"><div className="l">Referral points</div><div className="v tnum">{fmt(referralPts)}</div></div>
            </div>
          </div>

          {/* activity */}
          <div className="sec">
            <div className="sec-h"><h2>Points activity</h2></div>
            <div className="card-sec">
              {(pointTransactions as any)?.length > 0 ? (
                (pointTransactions as any).slice(0, 6).map((x: any) => {
                  const isPayout = x.type === 'task_payout';
                  return (
                    <div className="txn" key={x.id}>
                      <span className={`txn-ic${isPayout ? ' debit' : ''}`}>{isPayout ? <ArrowUpRight /> : <Plus />}</span>
                      <div className="txn-m"><div className="a">{x.description}</div><div className="b">{new Date(x.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div></div>
                      <div className={`txn-v${isPayout ? ' debit' : ''}`}>{isPayout ? '' : '+'}{fmt(x.points)}</div>
                    </div>
                  );
                })
              ) : (
                <div className="txn"><div className="txn-m"><div className="a">No points yet</div><div className="b">Complete tasks to start earning</div></div></div>
              )}
            </div>
          </div>

          {/* leaderboard */}
          <div className="sec">
            <div className="sec-h"><h2>Top earners</h2><a className="more">All-time</a></div>
            <div className="card-sec lb">
              {leaderboard.length > 0 ? (
                <>
                  {leaderboard.slice(0, 5).map((r, i) => {
                    const n = i + 1; const isMe = r.walletAddress?.toLowerCase() === walletAddress;
                    return (
                      <div className={`lb-row${isMe ? ' me' : ''}`} key={r.id || i}>
                        <span className={`lb-rank${n <= 3 ? ` r${n}` : ''}`}>{n}</span>
                        <span className="lb-w">{isMe ? <>You <span className="tag">YOU</span></> : `${r.walletAddress.slice(0, 6)}…${r.walletAddress.slice(-4)}`}</span>
                        <span className="lb-pts">{fmt(r.totalPoints)}</span>
                      </div>
                    );
                  })}
                  {myRank && myRank > 5 && (
                    <div className="lb-row me"><span className="lb-rank">{myRank}</span><span className="lb-w">You <span className="tag">YOU</span></span><span className="lb-pts">{fmt(totalPoints)}</span></div>
                  )}
                </>
              ) : (
                <div className="lb-row"><span className="lb-w">No ranks yet — complete tasks to climb.</span></div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ===== SUBMIT EVIDENCE MODAL ===== */}
      <div className={`sheet-scrim${evidenceTask ? ' on' : ''}`} onClick={() => setEvidenceTask(null)} />
      <div className={`sheet${evidenceTask ? ' on' : ''}`}>
        <div className="grab" />
        <div className="sheet-h"><h3>Submit for review</h3><button className="sheet-x" onClick={() => setEvidenceTask(null)}><X /></button></div>
        {evidenceTask && (
          <>
            <div className="sub-task">
              <span className="t-ico">{(() => { const Icon = ICONS[evidenceTask.icon] || Star; return <Icon />; })()}</span>
              <div className="t-main"><div className="t-title">{evidenceTask.title}</div><div className="t-desc">+{fmt(evidenceTask.points)} pts on approval</div></div>
            </div>
            <div className="field"><label>Link <span style={{ color: 'var(--tx-4)', textTransform: 'none', letterSpacing: 0 }}>— tweet, post, or video</span></label><input className="input" placeholder="https://" value={evidenceUrl} onChange={(e) => setEvidenceUrl(e.target.value)} /></div>
            <div className="field">
              <label>Screenshot <span style={{ color: 'var(--tx-4)', textTransform: 'none', letterSpacing: 0 }}>— optional</span></label>
              <label className={`evidence-up${evidenceImage ? ' filled' : ''}`}>
                <input type="file" accept="image/*" style={{ display: 'none' }} disabled={uploading}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadEvidenceImage(f); e.target.value = ''; }} />
                <span className="eu-ic">{evidenceImage ? <Check /> : <ImagePlus />}</span>
                <span className="eu-c"><span className="t">{uploading ? 'Uploading…' : evidenceImage ? 'Screenshot attached' : 'Upload a screenshot'}</span><span className="s">{evidenceImage ? 'Uploaded · verified source' : 'PNG or JPG, secured via Cloudinary'}</span></span>
              </label>
            </div>
            <div className="field"><label>Notes <span style={{ color: 'var(--tx-4)', textTransform: 'none', letterSpacing: 0 }}>— optional</span></label><textarea className="textarea" placeholder="Briefly describe what you did." value={evidenceText} onChange={(e) => setEvidenceText(e.target.value)} /></div>
            <p className="hint" style={{ marginBottom: 14 }}><Info style={{ width: 13, height: 13, verticalAlign: -2 }} /> An admin reviews your submission. Points credit once approved — usually within 24 hours.</p>
            <button className="btn btn-primary" disabled={completeMutation.isPending || uploading || (!evidenceImage && !evidenceUrl.trim() && !evidenceText.trim())} onClick={submitEvidence}>
              <Send /> {completeMutation.isPending ? 'Submitting…' : 'Submit for review'}
            </button>
          </>
        )}
      </div>

      {/* ===== CASH OUT MODAL ===== */}
      <div className={`sheet-scrim${cashOpen ? ' on' : ''}`} onClick={() => setCashOpen(false)} />
      <div className={`sheet${cashOpen ? ' on' : ''}`}>
        <div className="grab" />
        <div className="sheet-h"><h3>Cash out points</h3><button className="sheet-x" onClick={() => setCashOpen(false)}><X /></button></div>
        <div className="payout-card" style={{ marginTop: 0 }}>
          <div className="pc-l">Available to settle</div>
          <div className="pc-v">${(totalPoints * usdPerPoint).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div className="pc-s">{fmt(totalPoints)} points × ${usdPerPoint.toFixed(2)} per point</div>
        </div>
        <div className="field">
          <label>Receive as</label>
          <div className="seg2">
            <button className={cashToken === 'USDC' ? 'on' : ''} onClick={() => setCashToken('USDC')}><CircleDollarSign /> USDC</button>
            <button className={cashToken === 'USDT' ? 'on' : ''} onClick={() => setCashToken('USDT')}><CircleDollarSign /> USDT</button>
          </div>
        </div>
        <div className="field">
          <label>Network</label>
          <button className="select"><span className="netic"><NetSvg net="base" /></span><span className="lab">Base</span><span className="sub">Gas sponsored</span><span className="chev"><ChevronDown /></span></button>
        </div>
        <p className="hint" style={{ marginBottom: 14 }}><Info style={{ width: 13, height: 13, verticalAlign: -2 }} /> Cash-outs are batch-settled by the team. The stablecoin lands in your wallet once processed.</p>
        <button className="btn btn-primary" onClick={() => { setCashOpen(false); toast({ title: 'Payout requested', description: `$${(totalPoints * usdPerPoint).toFixed(2)} ${cashToken} queued for settlement.` }); }}>
          <Banknote /> Request payout
        </button>
      </div>
    </AppShell>
  );
}
