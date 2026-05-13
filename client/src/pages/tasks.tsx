import { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'wouter';
import { BottomNav } from '@/components/bottom-nav';
import { AppHeader } from '@/components/app-header';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRift } from '@rift-finance/react';
import { apiRequest } from '@/lib/api-client';
import { useWallet } from '@/hooks/use-wallet';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Home as HomeIcon,
  Wallet as WalletIcon,
  Shield,
  Star,
  CheckCircle2,
  ExternalLink,
  ArrowRight,
  ArrowLeft,
  Trophy,
  Zap,
  Users,
  Twitter,
  Heart,
  MessageCircle,
  MessageSquare,
  Youtube,
  Droplets,
  LogIn,
  UserPlus,
  Search,
  Flame,
  Gift,
  Clock,
  ListChecks,
  Crown,
  Share2,
  Copy,
  Link,
  Send,
  Image as ImageIcon,
  X,
  DollarSign,
} from 'lucide-react';
import logoPath from "@/assets/logo.png";

interface DailyTask {
  id: number;
  taskKey: string;
  title: string;
  description: string;
  points: number;
  category: string;
  icon: string;
  actionType: string;
  actionUrl?: string;
  isDaily: boolean;
  isActive: boolean;
  sortOrder: number;
}

const iconMap: Record<string, any> = {
  twitter: Twitter, heart: Heart, 'message-circle': MessageCircle,
  'message-square': MessageSquare, youtube: Youtube, droplets: Droplets,
  'log-in': LogIn, 'user-plus': UserPlus, search: Search,
  star: Star, zap: Zap, users: Users, gift: Gift, shield: Shield,
};

const categoryConfig: Record<string, { label: string; icon: any; color: string; bgColor: string }> = {
  social: { label: 'Social', icon: Twitter, color: 'text-blue-500', bgColor: 'bg-blue-500/10' },
  onchain: { label: 'On-Chain', icon: Zap, color: 'text-emerald-500', bgColor: 'bg-emerald-500/10' },
  community: { label: 'Community', icon: Users, color: 'text-amber-500', bgColor: 'bg-amber-500/10' },
};

interface TaskProgress {
  completedTaskIds: number[];
  todayCompletedTaskIds: number[];
  totalPointsEarned: number;
  userTotalPoints: number;
  completionsCount: number;
}

export default function TasksPage() {
  const [, setLocation] = useLocation();
  const { wallet, isUnlocked, walletExists, isLoading: walletLoading } = useWallet();
  const { getAccessToken } = useRift();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [activeTab, setActiveTab] = useState('tasks');
  // Manual-task evidence dialog state
  const [evidenceTask, setEvidenceTask] = useState<DailyTask | null>(null);
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [evidenceText, setEvidenceText] = useState('');
  const [evidenceImage, setEvidenceImage] = useState<string>(''); // Cloudinary secure_url after upload
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!walletLoading) {
      if (!walletExists()) {
        setLocation('/wallet');
      } else if (!isUnlocked) {
        setLocation('/unlock-wallet');
      }
    }
  }, [isUnlocked, walletExists, walletLoading, setLocation]);

  // Read ?tab= from URL once on mount so the home-page "Invite friends"
  // CTA can deep-link straight to the Referrals tab.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('tab');
    if (t && ['tasks', 'referrals', 'leaderboard', 'history'].includes(t)) {
      setActiveTab(t);
    }
  }, []);

  const walletAddress = wallet?.address?.toLowerCase() || '';

  const { data: tasks = [], isLoading: tasksLoading } = useQuery<DailyTask[]>({
    queryKey: ['/api/tasks'],
  });

  const { data: progress, isLoading: progressLoading } = useQuery<TaskProgress>({
    queryKey: ['/api/tasks/progress', walletAddress],
    queryFn: () => fetch(`/api/tasks/progress/${walletAddress}`).then(r => r.json()),
    enabled: !!walletAddress,
  });

  const { data: leaderboard = [] } = useQuery<any[]>({
    queryKey: ['/api/tasks/leaderboard'],
  });

  const { data: userPoints, isLoading: pointsLoading } = useQuery({
    queryKey: ['/api/points', wallet?.address],
    queryFn: () => fetch(`/api/points/${wallet?.address}`).then(res => res.json()),
    enabled: !!wallet?.address,
  });

  // Point→USD conversion (admin-configurable). Defaults to $0.05/point.
  const { data: pointValue } = useQuery<{ usdPerPoint: number }>({
    queryKey: ['/api/platform/settings/point-value'],
    staleTime: 5 * 60 * 1000,
  });
  const usdPerPoint = pointValue?.usdPerPoint ?? 0.05;

  const { data: referralCode } = useQuery({
    queryKey: ['/api/referrals/codes', wallet?.address],
    queryFn: () => fetch(`/api/referrals/codes/${wallet?.address}`).then(res => res.json()),
    enabled: !!wallet?.address,
  });

  const { data: referrals, isLoading: referralsLoading } = useQuery({
    queryKey: ['/api/referrals', wallet?.address],
    queryFn: () => fetch(`/api/referrals/${wallet?.address}`).then(res => res.json()),
    enabled: !!wallet?.address,
  });

  const { data: pointTransactions, isLoading: transactionsLoading } = useQuery({
    queryKey: ['/api/points/transactions', wallet?.address],
    queryFn: () => fetch(`/api/points/transactions/${wallet?.address}`).then(res => res.json()),
    enabled: !!wallet?.address,
  });

  // Claim flow: server now requires `Authorization: Bearer <rift access token>`
  // so the wallet identity is verified by Rift, not trusted from the body.
  // The optional `evidence` is sent for manual-review tasks.
  const completeMutation = useMutation({
    mutationFn: async (payload: { taskId: number; evidenceUrl?: string; evidenceImage?: string; evidenceText?: string }) => {
      const accessToken = await getAccessToken();
      const res = await fetch('/api/tasks/complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
        credentials: 'include',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || body.message || `Failed (${res.status})`);
      return body;
    },
    onSuccess: (data) => {
      if (data?.status === 'pending_review') {
        toast({
          title: 'Submitted for review',
          description: data.message || 'Admin will review your submission and award points.',
        });
      } else {
        toast({
          title: `+${data.pointsEarned} Points!`,
          description: `Total: ${data.totalPoints} points`,
        });
      }
      queryClient.invalidateQueries({ queryKey: ['/api/tasks/progress', walletAddress] });
      queryClient.invalidateQueries({ queryKey: ['/api/tasks/leaderboard'] });
      queryClient.invalidateQueries({ queryKey: ['/api/points', wallet?.address] });
    },
    onError: (err: any) => {
      toast({ title: 'Task Error', description: err.message || 'Could not complete task', variant: 'destructive' });
    },
  });

  // Upload a screenshot directly to Cloudinary using a server-signed payload.
  // The file never touches our backend; Cloudinary returns the secure URL we
  // stash in `evidenceImage` for submission. Caps at 5 MB / image-only.
  const uploadEvidenceImage = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Image only', description: 'Please attach an image file (JPG/PNG/HEIC/etc.).', variant: 'destructive' });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: 'Too large', description: 'Max image size is 5 MB. Try a smaller screenshot.', variant: 'destructive' });
      return;
    }
    setUploading(true);
    try {
      const accessToken = await getAccessToken();
      const sigRes = await fetch('/api/tasks/upload-signature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({}),
      });
      const sig = await sigRes.json();
      if (!sigRes.ok) throw new Error(sig.error || 'Failed to authorize upload');

      const form = new FormData();
      form.append('file', file);
      form.append('api_key', sig.apiKey);
      form.append('timestamp', String(sig.timestamp));
      form.append('signature', sig.signature);
      form.append('folder', sig.folder);
      if (sig.eager) form.append('eager', sig.eager);

      const uploadRes = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`, {
        method: 'POST',
        body: form,
      });
      const uploaded = await uploadRes.json();
      if (!uploadRes.ok || !uploaded.secure_url) {
        throw new Error(uploaded.error?.message || 'Upload failed');
      }
      setEvidenceImage(uploaded.secure_url);
    } catch (e: any) {
      toast({ title: 'Upload failed', description: e?.message || 'Try again.', variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  const submitEvidence = () => {
    if (!evidenceTask) return;
    completeMutation.mutate(
      {
        taskId: evidenceTask.id,
        evidenceUrl: evidenceUrl.trim(),
        evidenceImage,
        evidenceText: evidenceText.trim(),
      },
      {
        onSuccess: () => {
          setEvidenceTask(null);
          setEvidenceUrl('');
          setEvidenceText('');
          setEvidenceImage('');
        },
      },
    );
  };

  const handleTaskAction = (task: DailyTask) => {
    // Manual-review tasks need an evidence submission before points credit.
    if ((task as any).verifier === 'manual') {
      setEvidenceUrl('');
      setEvidenceText('');
      setEvidenceImage('');
      setEvidenceTask(task);
      if (task.actionType === 'external' && task.actionUrl) {
        window.open(task.actionUrl, '_blank');
      }
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

  const isTaskCompleted = (task: DailyTask) => {
    if (!progress) return false;
    if (task.isDaily) {
      return progress.todayCompletedTaskIds.includes(task.id);
    }
    return progress.completedTaskIds.includes(task.id);
  };

  const filteredTasks = useMemo(() => {
    if (selectedCategory === 'all') return tasks;
    return tasks.filter(t => t.category === selectedCategory);
  }, [tasks, selectedCategory]);

  const dailyTasks = filteredTasks.filter(t => t.isDaily);
  const oneTimeTasks = filteredTasks.filter(t => !t.isDaily);

  const completedToday = progress?.todayCompletedTaskIds.length || 0;
  const dailyTaskCount = tasks.filter(t => t.isDaily).length;
  const completionPercent = dailyTaskCount > 0 ? Math.round((completedToday / dailyTaskCount) * 100) : 0;

  const isLoading = tasksLoading || progressLoading;

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied!", description: `${label} copied to clipboard.` });
  };

  const referralLink = referralCode?.code
    ? `${window.location.origin}/create-wallet?ref=${referralCode.code}`
    : '';

  const totalPoints = progress?.userTotalPoints || (userPoints as any)?.totalPoints || 0;
  const referralPts = (userPoints as any)?.referralPoints || 0;
  const taskPts = progress?.totalPointsEarned || 0;

  if (walletLoading || !isUnlocked) return null;

  return (
    <div className="min-h-screen bg-background pb-28">
      <AppHeader title="Rewards" />

      <main className="max-w-2xl mx-auto w-full px-4 pt-5 pb-6 space-y-5">
        {/* ── Brand hero — total points ───────────────────────────── */}
        <div className="relative overflow-hidden rounded-3xl bfx-hero-brand">
          <div className="absolute inset-0 bfx-hero-brand-dotgrid opacity-50 pointer-events-none" />
          <div className="relative px-6 pt-6 pb-5">
            <p className="text-[11px] uppercase tracking-[0.12em] text-white/70 font-semibold mb-1">Total points</p>
            <h2 className="bfx-display text-[42px] font-semibold tracking-tight text-white leading-none">
              {pointsLoading ? '—' : totalPoints.toLocaleString()}
            </h2>
            <p className="text-[12px] text-emerald-300 font-medium font-mono-data tabular-nums mt-1.5">
              ≈ ${(totalPoints * usdPerPoint).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              <span className="text-white/55 font-normal ml-1.5">
                at ${usdPerPoint.toFixed(2)}/pt
              </span>
            </p>
            <div className="grid grid-cols-3 gap-2.5 mt-5">
              <div className="bg-white/[0.06] border border-white/[0.08] rounded-2xl py-2.5 px-3">
                <p className="text-[9.5px] text-white/55 uppercase tracking-[0.1em] font-semibold">Tasks</p>
                <div className="text-[14px] font-semibold font-mono-data text-white mt-1 tabular-nums">{taskPts.toLocaleString()}</div>
              </div>
              <div className="bg-white/[0.06] border border-white/[0.08] rounded-2xl py-2.5 px-3">
                <p className="text-[9.5px] text-white/55 uppercase tracking-[0.1em] font-semibold">Referrals</p>
                <div className="text-[14px] font-semibold font-mono-data text-white mt-1 tabular-nums">{referralPts.toLocaleString()}</div>
              </div>
              <div className="bg-white/[0.06] border border-white/[0.08] rounded-2xl py-2.5 px-3">
                <p className="text-[9.5px] text-white/55 uppercase tracking-[0.1em] font-semibold">Friends</p>
                <div className="text-[14px] font-semibold font-mono-data text-white mt-1 tabular-nums">{(referrals as any)?.length || 0}</div>
              </div>
            </div>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="bg-muted/50 w-full grid grid-cols-4 h-11 p-1 rounded-xl">
            <TabsTrigger
              value="tasks"
              className="rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm data-[state=active]:text-foreground text-muted-foreground text-xs font-semibold gap-1.5"
            >
              <ListChecks className="h-3.5 w-3.5" strokeWidth={2} /> Tasks
            </TabsTrigger>
            <TabsTrigger
              value="referrals"
              className="rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm data-[state=active]:text-foreground text-muted-foreground text-xs font-semibold gap-1.5"
            >
              <Users className="h-3.5 w-3.5" strokeWidth={2} /> Invite
            </TabsTrigger>
            <TabsTrigger
              value="leaderboard"
              className="rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm data-[state=active]:text-foreground text-muted-foreground text-xs font-semibold gap-1.5"
            >
              <Crown className="h-3.5 w-3.5" strokeWidth={2} /> Ranks
            </TabsTrigger>
            <TabsTrigger
              value="history"
              className="rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm data-[state=active]:text-foreground text-muted-foreground text-xs font-semibold gap-1.5"
            >
              <Clock className="h-3.5 w-3.5" strokeWidth={2} /> History
            </TabsTrigger>
          </TabsList>

          <TabsContent value="tasks" className="space-y-4">
            {/* Daily progress card */}
            <div className="rounded-2xl border border-gray-100 dark:border-border/40 bg-card px-4 py-3.5">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="h-7 w-7 rounded-full bg-orange-100 dark:bg-orange-500/10 inline-flex items-center justify-center">
                    <Flame className="h-3.5 w-3.5 text-orange-600 dark:text-orange-400" />
                  </span>
                  <span className="text-[13px] font-semibold tracking-tight">Daily progress</span>
                </div>
                <span className="text-[12px] font-mono-data tabular-nums">
                  <span className="font-semibold text-foreground">{completedToday}</span>
                  <span className="text-muted-foreground"> / {dailyTaskCount}</span>
                </span>
              </div>
              <div className="h-1.5 bg-muted/60 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-orange-400 to-orange-500 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(completionPercent, 100)}%` }}
                />
              </div>
            </div>

            {/* Category chips — segmented pills */}
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide -mx-4 px-4">
              <button
                onClick={() => setSelectedCategory('all')}
                className={`inline-flex items-center gap-1.5 px-3 h-8 rounded-full text-[11.5px] font-semibold transition-all whitespace-nowrap shrink-0 ${
                  selectedCategory === 'all'
                    ? 'bg-foreground text-background'
                    : 'bg-muted/60 text-muted-foreground hover:text-foreground border border-gray-100 dark:border-border/40'
                }`}
              >
                <ListChecks className="h-3 w-3" strokeWidth={2.2} /> All
              </button>
              {Object.entries(categoryConfig).map(([key, cfg]) => {
                const active = selectedCategory === key;
                return (
                  <button
                    key={key}
                    onClick={() => setSelectedCategory(key)}
                    className={`inline-flex items-center gap-1.5 px-3 h-8 rounded-full text-[11.5px] font-semibold transition-all whitespace-nowrap shrink-0 ${
                      active
                        ? 'bg-foreground text-background'
                        : 'bg-muted/60 text-muted-foreground hover:text-foreground border border-gray-100 dark:border-border/40'
                    }`}
                  >
                    <cfg.icon className="h-3 w-3" strokeWidth={2.2} /> {cfg.label}
                  </button>
                );
              })}
            </div>

            {isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="h-[68px] rounded-2xl bg-muted/40 animate-pulse" />
                ))}
              </div>
            ) : (
              <>
                {dailyTasks.length > 0 && (
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-2 px-1">
                      <h2 className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
                        Daily tasks
                      </h2>
                      <span className="inline-flex items-center gap-1 text-[10px] text-orange-600 dark:text-orange-400 font-semibold">
                        <Flame className="h-3 w-3" /> Resets daily
                      </span>
                    </div>
                    <div className="space-y-2">
                      {dailyTasks.map(task => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          completed={isTaskCompleted(task)}
                          onAction={() => handleTaskAction(task)}
                          isPending={completeMutation.isPending}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {oneTimeTasks.length > 0 && (
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-2 px-1">
                      <h2 className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
                        One-time bonuses
                      </h2>
                      <span className="inline-flex items-center gap-1 text-[10px] text-primary font-semibold">
                        <Gift className="h-3 w-3" />
                      </span>
                    </div>
                    <div className="space-y-2">
                      {oneTimeTasks.map(task => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          completed={isTaskCompleted(task)}
                          onAction={() => handleTaskAction(task)}
                          isPending={completeMutation.isPending}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="referrals" className="space-y-4">
            <ReferralHero
              code={referralCode?.code}
              link={referralLink}
              friendsInvited={(referrals as any)?.length || 0}
              onCopyCode={() => referralCode?.code && copyToClipboard(referralCode.code, 'Referral code')}
              onCopyLink={() => copyToClipboard(referralLink, 'Referral link')}
            />

            <HowItWorksCard />

            <Card className="rounded-2xl border-gray-100 dark:border-border/40 shadow-none">
              <CardHeader className="pb-3 pt-5 px-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="h-7 w-7 rounded-full bg-primary/10 inline-flex items-center justify-center">
                      <Users className="h-3.5 w-3.5 text-primary" />
                    </span>
                    <CardTitle className="text-[15px] font-semibold tracking-tight">
                      Your friends
                    </CardTitle>
                  </div>
                  <Badge variant="outline" className="text-[10px] rounded-full border-gray-200 dark:border-border/60 font-mono-data tabular-nums">
                    {(referrals as any)?.length || 0}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="px-5 pb-5">
                {referralsLoading ? (
                  <div className="space-y-2">
                    {[1, 2].map(i => (
                      <div key={i} className="h-14 bg-muted/40 rounded-2xl animate-pulse" />
                    ))}
                  </div>
                ) : (referrals as any)?.length > 0 ? (
                  <div className="space-y-2">
                    {(referrals as any).map((referral: any) => (
                      <ReferralRow key={referral.id} referral={referral} />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <div className="h-10 w-10 rounded-full bg-primary/10 mx-auto mb-2.5 flex items-center justify-center">
                      <Users className="h-5 w-5 text-primary" />
                    </div>
                    <p className="text-sm font-medium">No friends yet</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Share your code above to start earning together.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="leaderboard" className="space-y-4">
            <Card className="rounded-2xl border-gray-100 dark:border-border/40 shadow-none">
              <CardHeader className="pb-3 pt-5 px-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="h-7 w-7 rounded-full bg-amber-100 dark:bg-amber-500/10 inline-flex items-center justify-center">
                      <Crown className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                    </span>
                    <CardTitle className="text-[15px] font-semibold tracking-tight">Top earners</CardTitle>
                  </div>
                  <Badge variant="outline" className="text-[10px] rounded-full border-gray-200 dark:border-border/60 font-mono-data tabular-nums">
                    {leaderboard.length}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="px-3 pb-3">
                {leaderboard.length > 0 ? (
                  <div className="space-y-1">
                    {leaderboard.map((entry, i) => {
                      const isMe = entry.walletAddress?.toLowerCase() === walletAddress;
                      const rankTone = i === 0
                        ? 'bg-gradient-to-br from-amber-300 to-amber-500 text-white shadow-[0_2px_8px_-2px_rgba(245,158,11,0.4)]'
                        : i === 1
                        ? 'bg-gradient-to-br from-slate-300 to-slate-400 text-white'
                        : i === 2
                        ? 'bg-gradient-to-br from-orange-400 to-orange-600 text-white'
                        : 'bg-muted/60 text-muted-foreground';
                      return (
                        <div
                          key={entry.id}
                          className={`flex items-center gap-3 py-2.5 px-3 rounded-xl ${
                            isMe ? 'bg-primary/[0.06] border border-primary/20' : 'hover:bg-muted/30'
                          } transition-colors`}
                        >
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold font-mono-data tabular-nums shrink-0 ${rankTone}`}>
                            {i + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-semibold font-mono-data truncate">
                              {isMe ? 'You' : `${entry.walletAddress.slice(0, 6)}…${entry.walletAddress.slice(-4)}`}
                            </p>
                            {isMe && (
                              <p className="text-[10px] text-primary font-semibold mt-0.5">Current rank</p>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Star className="h-3 w-3 text-primary fill-primary" />
                            <span className="text-[13px] font-semibold font-mono-data tabular-nums">
                              {entry.totalPoints.toLocaleString()}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <div className="h-10 w-10 rounded-full bg-amber-100 dark:bg-amber-500/10 mx-auto mb-2.5 flex items-center justify-center">
                      <Crown className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                    </div>
                    <p className="text-sm font-medium">No ranks yet</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Complete tasks to climb the leaderboard.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history" className="space-y-4">
            <Card className="rounded-2xl border-gray-100 dark:border-border/40 shadow-none">
              <CardHeader className="pb-3 pt-5 px-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="h-7 w-7 rounded-full bg-primary/10 inline-flex items-center justify-center">
                      <Clock className="h-3.5 w-3.5 text-primary" />
                    </span>
                    <CardTitle className="text-[15px] font-semibold tracking-tight">Points history</CardTitle>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="px-5 pb-5">
                {transactionsLoading ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map(i => <div key={i} className="h-12 rounded-xl bg-muted/40 animate-pulse" />)}
                  </div>
                ) : (pointTransactions as any)?.length > 0 ? (
                  <div className="space-y-1.5">
                    {(pointTransactions as any).map((tx: any) => {
                      // Payout rows look different: dollar icon, USDC amount + tx-hash link
                      const isPayout = tx.type === 'task_payout';
                      // Server description for payouts is e.g. "Reward: TASK → $5.00 USDC".
                      // Pull the USD figure out so the right-hand badge can render it.
                      const usdMatch = isPayout ? /\$([\d.,]+)/.exec(tx.description || '') : null;
                      const usdLabel = usdMatch ? `+$${usdMatch[1]}` : null;
                      const txHashUrl = isPayout && tx.referenceId
                        ? `https://basescan.org/tx/${tx.referenceId}`
                        : null;
                      return (
                        <div key={tx.id} className="flex items-center justify-between p-3 rounded-xl hover:bg-muted/40 transition-colors">
                          <div className="flex items-center gap-3 min-w-0">
                            <span className={`h-8 w-8 rounded-full inline-flex items-center justify-center shrink-0 ${
                              isPayout
                                ? 'bg-amber-50 dark:bg-amber-500/10'
                                : 'bg-emerald-50 dark:bg-emerald-500/10'
                            }`}>
                              {isPayout ? (
                                <DollarSign className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" strokeWidth={2} />
                              ) : (
                                <Zap className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" strokeWidth={2} />
                              )}
                            </span>
                            <div className="min-w-0">
                              <p className="text-[13px] font-medium tracking-tight truncate">{tx.description}</p>
                              <p className="text-[10.5px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
                                <span>
                                  {new Date(tx.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                                </span>
                                {txHashUrl && (
                                  <>
                                    <span className="text-muted-foreground/40">·</span>
                                    <a
                                      href={txHashUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-primary hover:underline inline-flex items-center gap-0.5"
                                    >
                                      View tx <ExternalLink className="h-2.5 w-2.5" />
                                    </a>
                                  </>
                                )}
                              </p>
                            </div>
                          </div>
                          <span className={`text-[13px] font-semibold font-mono-data tabular-nums shrink-0 ${
                            isPayout
                              ? 'text-amber-700 dark:text-amber-300'
                              : 'text-emerald-600 dark:text-emerald-400'
                          }`}>
                            {isPayout ? usdLabel ?? `${tx.points} pts` : `+${tx.points}`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <div className="h-10 w-10 rounded-full bg-primary/10 mx-auto mb-2.5 flex items-center justify-center">
                      <Clock className="h-5 w-5 text-primary" />
                    </div>
                    <p className="text-sm font-medium">No points yet</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Complete tasks or invite friends to start earning.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* Evidence submission for manual-review tasks */}
      <Dialog open={!!evidenceTask} onOpenChange={(o) => { if (!o) setEvidenceTask(null); }}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Submit proof</DialogTitle>
            <DialogDescription>
              {evidenceTask?.title} — admin will review and award {evidenceTask?.points} points if approved.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {/* Screenshot upload */}
            <div>
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Screenshot
              </Label>
              {evidenceImage ? (
                <div className="mt-1.5 relative group rounded-xl overflow-hidden border border-gray-100 dark:border-border/40">
                  <img src={evidenceImage} alt="Evidence preview" className="w-full max-h-[200px] object-contain bg-muted/30" />
                  <button
                    type="button"
                    onClick={() => setEvidenceImage('')}
                    className="absolute top-2 right-2 h-7 w-7 rounded-full bg-black/70 text-white hover:bg-black inline-flex items-center justify-center transition-colors"
                    aria-label="Remove image"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <label className={`mt-1.5 flex items-center justify-center gap-2 h-20 rounded-xl border-2 border-dashed cursor-pointer transition-colors ${
                  uploading
                    ? 'border-primary/30 bg-primary/[0.04] pointer-events-none'
                    : 'border-gray-200 dark:border-border/40 hover:border-primary/40 hover:bg-primary/[0.02]'
                }`}>
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadEvidenceImage(f);
                      e.target.value = '';
                    }}
                    disabled={uploading}
                  />
                  {uploading ? (
                    <span className="flex items-center gap-2 text-[12px] text-muted-foreground font-medium">
                      <span className="inline-block h-3 w-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                      Uploading…
                    </span>
                  ) : (
                    <span className="flex items-center gap-2 text-[12px] text-muted-foreground font-medium">
                      <ImageIcon className="h-4 w-4" />
                      Tap to attach screenshot
                    </span>
                  )}
                </label>
              )}
              <p className="text-[10px] text-muted-foreground mt-1">Max 5 MB · JPG / PNG / HEIC</p>
            </div>

            <div>
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Link <span className="opacity-60 normal-case">(optional)</span>
              </Label>
              <Input
                value={evidenceUrl}
                onChange={(e) => setEvidenceUrl(e.target.value)}
                placeholder="https://x.com/you/status/…"
                className="mt-1 h-10 rounded-xl"
              />
            </div>
            <div>
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Note <span className="opacity-60 normal-case">(optional)</span>
              </Label>
              <Textarea
                value={evidenceText}
                onChange={(e) => setEvidenceText(e.target.value)}
                placeholder="Anything the reviewer should know…"
                className="mt-1 rounded-xl min-h-[60px]"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEvidenceTask(null)} className="rounded-xl">
                Cancel
              </Button>
              <Button
                onClick={submitEvidence}
                disabled={
                  completeMutation.isPending || uploading ||
                  (!evidenceImage && !evidenceUrl.trim() && !evidenceText.trim())
                }
                className="rounded-xl"
              >
                {completeMutation.isPending ? 'Submitting…' : 'Submit for review'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <BottomNav />
    </div>
  );
}

// ── Referral hero ─────────────────────────────────────────────────────
// The marquee share surface. Brand-navy background, big tagline, the
// short referral code as a copy chip, and a row of one-tap share buttons
// (native sheet on mobile + WhatsApp / X / Telegram / Email fallbacks).
function ReferralHero({
  code,
  link,
  friendsInvited,
  onCopyCode,
  onCopyLink,
}: {
  code?: string;
  link: string;
  friendsInvited: number;
  onCopyCode: () => void;
  onCopyLink: () => void;
}) {
  const message = code
    ? `Join me on BlockFinaX — cross-border payments and FX cover. Use my code ${code} and we both earn 50 points: ${link}`
    : '';

  const enc = encodeURIComponent;
  const shareTargets = [
    {
      key: 'native',
      label: 'Share',
      icon: Share2,
      onClick: async () => {
        if (!message) return;
        if ((navigator as any).share) {
          try {
            await (navigator as any).share({ title: 'BlockFinaX', text: message, url: link });
          } catch {}
        } else {
          onCopyLink();
        }
      },
    },
    {
      key: 'whatsapp',
      label: 'WhatsApp',
      icon: MessageCircle,
      tone: 'bg-emerald-500/15 text-emerald-50 hover:bg-emerald-500/25',
      onClick: () => window.open(`https://wa.me/?text=${enc(message)}`, '_blank'),
    },
    {
      key: 'twitter',
      label: 'X',
      icon: Twitter,
      onClick: () => window.open(`https://twitter.com/intent/tweet?text=${enc(message)}`, '_blank'),
    },
    {
      key: 'telegram',
      label: 'Telegram',
      icon: Send,
      onClick: () => window.open(`https://t.me/share/url?url=${enc(link)}&text=${enc(message)}`, '_blank'),
    },
    {
      key: 'copy',
      label: 'Copy link',
      icon: Copy,
      onClick: onCopyLink,
    },
  ] as const;

  return (
    <div className="relative overflow-hidden rounded-3xl bfx-hero-brand">
      <div className="absolute inset-0 bfx-hero-brand-dotgrid opacity-50 pointer-events-none" />
      <div className="relative px-6 pt-6 pb-5 space-y-5">
        <div>
          <p className="text-[10.5px] uppercase tracking-[0.14em] text-white/60 font-semibold flex items-center gap-1.5">
            <Gift className="h-3 w-3" /> Invite friends · Earn together
          </p>
          <h2 className="bfx-display text-[26px] sm:text-[28px] font-semibold tracking-tight text-white leading-tight mt-2">
            Share your link.<br />You both earn{' '}
            <span className="text-emerald-300">50 points</span>.
          </h2>
        </div>

        {/* Code chip */}
        {code ? (
          <button
            type="button"
            onClick={onCopyCode}
            className="w-full flex items-center justify-between gap-3 bg-white/[0.06] hover:bg-white/10 border border-white/10 rounded-2xl px-4 py-3 transition-colors active:scale-[0.99]"
          >
            <div className="text-left min-w-0">
              <p className="text-[10px] uppercase tracking-[0.12em] text-white/50 font-semibold">Your code</p>
              <p className="font-mono-data font-semibold text-white text-[18px] tracking-[0.18em] mt-0.5">
                {code}
              </p>
            </div>
            <div className="shrink-0 h-9 w-9 rounded-full bg-white/10 inline-flex items-center justify-center">
              <Copy className="h-4 w-4 text-white" />
            </div>
          </button>
        ) : (
          <div className="h-[68px] bg-white/[0.06] border border-white/10 rounded-2xl animate-pulse" />
        )}

        {/* One-tap share buttons */}
        <div className="grid grid-cols-5 gap-2">
          {shareTargets.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                type="button"
                onClick={t.onClick}
                disabled={!code}
                className="group flex flex-col items-center gap-1.5 py-2.5 rounded-2xl bg-white/[0.06] hover:bg-white/12 border border-white/10 transition-all active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none"
              >
                <span className="h-8 w-8 rounded-full bg-white/10 group-hover:bg-white/15 inline-flex items-center justify-center transition-colors">
                  <Icon className="h-4 w-4 text-white" strokeWidth={1.9} />
                </span>
                <span className="text-[9.5px] text-white/75 font-medium tracking-tight">
                  {t.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* Friends invited counter */}
        <div className="flex items-center justify-between pt-1 border-t border-white/10">
          <div className="flex items-center gap-2">
            <Users className="h-3.5 w-3.5 text-white/60" />
            <span className="text-[12px] text-white/70 font-medium">
              {friendsInvited} friend{friendsInvited === 1 ? '' : 's'} joined
            </span>
          </div>
          <span className="text-[12px] font-mono-data tabular-nums font-semibold text-emerald-300">
            +{friendsInvited * 50} pts
          </span>
        </div>
      </div>
    </div>
  );
}

// ── How it works ──────────────────────────────────────────────────────
// Three step pictorial — Share / Friend joins / You both earn.
function HowItWorksCard() {
  const steps = [
    { n: 1, icon: Share2, label: 'Share', desc: 'Send your code to a friend' },
    { n: 2, icon: UserPlus, label: 'Friend joins', desc: 'They sign up with your code' },
    { n: 3, icon: Gift,    label: 'Both earn',  desc: '50 points each, instantly' },
  ];
  return (
    <div className="rounded-2xl border border-gray-100 dark:border-border/40 bg-card px-5 py-4">
      <p className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground font-semibold mb-3">
        How it works
      </p>
      <div className="grid grid-cols-3 gap-3">
        {steps.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.n} className="text-center">
              <div className="mx-auto mb-2 h-10 w-10 rounded-full bg-primary/10 inline-flex items-center justify-center">
                <Icon className="h-4.5 w-4.5 text-primary" strokeWidth={1.9} />
              </div>
              <p className="text-[12px] font-semibold tracking-tight leading-tight">{s.label}</p>
              <p className="text-[10.5px] text-muted-foreground leading-tight mt-1">{s.desc}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Referral row ──────────────────────────────────────────────────────
// One friend in the list — colored avatar with their address initials,
// joined date, a status pill, and points earned (mono-data).
function ReferralRow({ referral }: { referral: any }) {
  const addr: string = referral.referredWalletAddress || '';
  const initials = (addr.slice(2, 4) || '??').toUpperCase();
  // Deterministic hue per address for a varied row palette
  const hue = (() => {
    let n = 0;
    for (let i = 0; i < addr.length; i++) n = (n * 31 + addr.charCodeAt(i)) >>> 0;
    return n % 360;
  })();
  const isComplete = referral.status === 'completed';
  const statusTone = isComplete
    ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-500/20'
    : 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-100 dark:border-amber-500/20';
  return (
    <div className="flex items-center justify-between p-3 rounded-2xl border border-gray-100 dark:border-border/40 bg-card hover:border-primary/30 transition-all">
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="h-9 w-9 rounded-full flex items-center justify-center font-mono-data text-[11px] font-semibold text-white shrink-0"
          style={{ background: `linear-gradient(135deg, hsl(${hue} 70% 45%), hsl(${(hue + 30) % 360} 70% 38%))` }}
        >
          {initials}
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold font-mono-data truncate">
            {addr.slice(0, 6)}…{addr.slice(-4)}
          </p>
          <p className="text-[10.5px] text-muted-foreground">
            Joined {new Date(referral.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Badge variant="outline" className={`text-[9.5px] rounded-full font-semibold ${statusTone}`}>
          {isComplete ? 'Completed' : 'Pending'}
        </Badge>
        <span className="text-[13px] font-mono-data font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
          +{referral.pointsEarned || 50}
        </span>
      </div>
    </div>
  );
}

function TaskCard({ task, completed, onAction, isPending }: {
  task: DailyTask;
  completed: boolean;
  onAction: () => void;
  isPending: boolean;
}) {
  const IconComponent = iconMap[task.icon] || Star;
  const catCfg = categoryConfig[task.category] || categoryConfig.community;

  return (
    <div
      className={`flex items-center gap-3 p-3 rounded-2xl border transition-all ${
        completed
          ? 'bg-muted/30 border-gray-100 dark:border-border/30 opacity-70'
          : 'bg-card border-gray-100 dark:border-border/40 hover:border-primary/30 hover:shadow-[0_2px_8px_-2px_rgba(26,68,128,0.12)]'
      }`}
    >
      <div className={`h-10 w-10 rounded-xl ${catCfg.bgColor} flex items-center justify-center flex-shrink-0`}>
        <IconComponent className={`h-4.5 w-4.5 ${catCfg.color}`} strokeWidth={2} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <h3 className="text-[13.5px] font-semibold tracking-tight truncate">{task.title}</h3>
          {task.actionType === 'external' && (
            <ExternalLink className="h-3 w-3 text-muted-foreground/70 flex-shrink-0" strokeWidth={2} />
          )}
        </div>
        <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">{task.description}</p>
      </div>
      <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
        <span className="text-[11px] font-semibold font-mono-data tabular-nums text-primary">
          +{task.points}
        </span>
        {completed ? (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-3 w-3" strokeWidth={2.2} />
            Done
          </span>
        ) : (
          <Button
            size="sm"
            className="h-7 text-[11px] px-2.5 rounded-lg font-semibold"
            onClick={onAction}
            disabled={isPending}
          >
            {task.actionType === 'external' ? 'Go' : 'Claim'}
            <ArrowRight className="h-3 w-3 ml-1" strokeWidth={2.2} />
          </Button>
        )}
      </div>
    </div>
  );
}
