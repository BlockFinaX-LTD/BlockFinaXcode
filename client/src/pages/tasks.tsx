import { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'wouter';
import { BottomNav } from '@/components/bottom-nav';
import { AppHeader } from '@/components/app-header';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';
import { useWallet } from '@/hooks/use-wallet';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [activeTab, setActiveTab] = useState('tasks');

  useEffect(() => {
    if (!walletLoading) {
      if (!walletExists()) {
        setLocation('/');
      } else if (!isUnlocked) {
        setLocation('/unlock-wallet');
      }
    }
  }, [isUnlocked, walletExists, walletLoading, setLocation]);

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

  const completeMutation = useMutation({
    mutationFn: async (taskId: number) => {
      const res = await apiRequest('POST', '/api/tasks/complete', { walletAddress, taskId });
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: `+${data.pointsEarned} Points!`,
        description: `Total: ${data.totalPoints} points`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/tasks/progress', walletAddress] });
      queryClient.invalidateQueries({ queryKey: ['/api/tasks/leaderboard'] });
      queryClient.invalidateQueries({ queryKey: ['/api/points', wallet?.address] });
    },
    onError: (err: any) => {
      toast({ title: 'Task Error', description: err.message || 'Could not complete task', variant: 'destructive' });
    },
  });

  const handleTaskAction = (task: DailyTask) => {
    if (task.actionType === 'external' && task.actionUrl) {
      window.open(task.actionUrl, '_blank');
      setTimeout(() => completeMutation.mutate(task.id), 2000);
    } else if (task.actionType === 'internal' && task.actionUrl) {
      completeMutation.mutate(task.id);
      setTimeout(() => setLocation(task.actionUrl!), 500);
    } else {
      completeMutation.mutate(task.id);
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
    <div className="min-h-screen bg-background pb-24">
      <AppHeader
        title="Rewards"
        rightContent={
          <div className="flex items-center gap-1 bg-primary/10 px-3 py-1.5 rounded-full">
            <Star className="h-4 w-4 text-primary fill-primary" />
            <span className="text-sm font-bold text-primary">{totalPoints}</span>
          </div>
        }
      />

      <main className="w-full px-4 py-4 space-y-4">
        <Card className="border-primary/20 bg-gradient-to-r from-primary/5 via-primary/10 to-primary/5 overflow-hidden relative">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Total Points</p>
                <p className="text-3xl font-bold text-primary mt-1">{totalPoints}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Redeemable at mainnet launch
                </p>
              </div>
              <div className="text-right">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                  <Trophy className="h-8 w-8 text-primary" />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-primary/10">
              <div className="text-center">
                <p className="text-sm font-bold">{taskPts}</p>
                <p className="text-[10px] text-muted-foreground">Task Points</p>
              </div>
              <div className="text-center">
                <p className="text-sm font-bold">{referralPts}</p>
                <p className="text-[10px] text-muted-foreground">Referral Points</p>
              </div>
              <div className="text-center">
                <p className="text-sm font-bold">{(referrals as any)?.length || 0}</p>
                <p className="text-[10px] text-muted-foreground">Friends Invited</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {referralLink && (
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 p-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">Your referral link — share & earn tokens</p>
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400 truncate">{referralLink}</p>
            </div>
            <Button size="sm" variant="outline"
              className="shrink-0 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 h-8 text-xs hover:bg-emerald-100 dark:hover:bg-emerald-900"
              onClick={() => copyToClipboard(referralLink, 'Referral link')}>
              Copy
            </Button>
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="tasks" className="text-xs">Tasks</TabsTrigger>
            <TabsTrigger value="referrals" className="text-xs">Referrals</TabsTrigger>
            <TabsTrigger value="leaderboard" className="text-xs">Ranking</TabsTrigger>
            <TabsTrigger value="history" className="text-xs">History</TabsTrigger>
          </TabsList>

          <TabsContent value="tasks" className="space-y-4">
            <div className="mt-1">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-muted-foreground">Daily progress</span>
                <span className="font-medium">{completedToday}/{dailyTaskCount} completed</span>
              </div>
              <Progress value={Math.min(completionPercent, 100)} className="h-2" />
            </div>

            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
              <Button
                variant={selectedCategory === 'all' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedCategory('all')}
                className="rounded-full text-xs whitespace-nowrap"
              >
                <ListChecks className="h-3.5 w-3.5 mr-1" />
                All
              </Button>
              {Object.entries(categoryConfig).map(([key, cfg]) => (
                <Button
                  key={key}
                  variant={selectedCategory === key ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedCategory(key)}
                  className="rounded-full text-xs whitespace-nowrap"
                >
                  <cfg.icon className="h-3.5 w-3.5 mr-1" />
                  {cfg.label}
                </Button>
              ))}
            </div>

            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map(i => (
                  <Card key={i} className="animate-pulse">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-muted" />
                        <div className="flex-1 space-y-2">
                          <div className="h-4 bg-muted rounded w-2/3" />
                          <div className="h-3 bg-muted rounded w-1/2" />
                        </div>
                        <div className="h-8 w-16 bg-muted rounded" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <>
                {dailyTasks.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Flame className="h-4 w-4 text-orange-500" />
                      <h2 className="text-sm font-semibold">Daily Tasks</h2>
                      <Badge variant="outline" className="text-[10px]">
                        <Clock className="h-3 w-3 mr-0.5" />
                        Resets daily
                      </Badge>
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
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Gift className="h-4 w-4 text-primary" />
                      <h2 className="text-sm font-semibold">One-Time Tasks</h2>
                      <Badge variant="outline" className="text-[10px]">Bonus</Badge>
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
            <Card className="border-primary/20 bg-gradient-to-r from-primary/5 via-primary/10 to-primary/5">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center space-x-2 text-base">
                  <Share2 className="h-5 w-5 text-primary" />
                  <span>Your Referral Code</span>
                </CardTitle>
                <CardDescription className="text-xs">Share this code with friends — you both earn 50 points</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {referralCode?.code ? (
                  <>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-xl font-mono font-bold bg-card border border-border px-4 py-3 rounded-lg text-center tracking-wider">
                        {referralCode.code}
                      </code>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-12 w-12 shrink-0"
                        onClick={() => copyToClipboard(referralCode.code, 'Referral code')}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => copyToClipboard(referralLink, 'Referral link')}
                    >
                      <Link className="h-4 w-4 mr-2" />
                      Copy Invite Link
                    </Button>
                    <p className="text-xs text-muted-foreground text-center">
                      {referralCode.currentUses || 0} friends invited
                    </p>
                  </>
                ) : (
                  <div className="h-12 bg-muted rounded-lg animate-pulse" />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Your Referrals</CardTitle>
                <CardDescription className="text-xs">Friends who joined using your code</CardDescription>
              </CardHeader>
              <CardContent>
                {referralsLoading ? (
                  <div className="text-sm text-muted-foreground">Loading...</div>
                ) : (referrals as any)?.length > 0 ? (
                  <div className="space-y-2">
                    {(referrals as any).map((referral: any) => (
                      <div key={referral.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div>
                          <div className="text-sm font-mono">
                            {referral.referredWalletAddress?.slice(0, 6)}...{referral.referredWalletAddress?.slice(-4)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {new Date(referral.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={referral.status === 'completed' ? "default" : "secondary"} className="text-[10px]">
                            {referral.status}
                          </Badge>
                          <span className="text-sm font-bold text-emerald-600">+{referral.pointsEarned || 50}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-6 text-muted-foreground text-sm">
                    No referrals yet. Share your code to start earning!
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="leaderboard" className="space-y-4">
            {leaderboard.length > 0 ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Crown className="h-4 w-4 text-amber-500" />
                    Top Earners
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <div className="space-y-2">
                    {leaderboard.map((entry, i) => {
                      const isMe = entry.walletAddress?.toLowerCase() === walletAddress;
                      return (
                        <div key={entry.id} className={`flex items-center gap-3 py-2 px-2 rounded-lg ${isMe ? 'bg-primary/5 border border-primary/20' : ''}`}>
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                            i === 0 ? 'bg-amber-500/20 text-amber-500' :
                            i === 1 ? 'bg-gray-400/20 text-gray-400' :
                            i === 2 ? 'bg-orange-600/20 text-orange-600' :
                            'bg-muted text-muted-foreground'
                          }`}>
                            {i + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-mono truncate">
                              {isMe ? 'You' : `${entry.walletAddress.slice(0, 6)}...${entry.walletAddress.slice(-4)}`}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            <Star className="h-3 w-3 text-primary fill-primary" />
                            <span className="text-sm font-bold">{entry.totalPoints}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No leaderboard data yet. Complete tasks to climb the ranks!
              </div>
            )}
          </TabsContent>

          <TabsContent value="history" className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Points History</CardTitle>
                <CardDescription className="text-xs">All your point earnings</CardDescription>
              </CardHeader>
              <CardContent>
                {transactionsLoading ? (
                  <div className="text-sm text-muted-foreground">Loading...</div>
                ) : (pointTransactions as any)?.length > 0 ? (
                  <div className="space-y-2">
                    {(pointTransactions as any).map((tx: any) => (
                      <div key={tx.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div>
                          <div className="text-sm font-medium">{tx.description}</div>
                          <div className="text-xs text-muted-foreground">
                            {new Date(tx.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                        <span className="text-sm font-bold text-emerald-600">+{tx.points}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-6 text-muted-foreground text-sm">
                    No points earned yet. Complete tasks or invite friends!
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      <BottomNav />
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
    <Card className={`transition-all ${completed ? 'opacity-60 bg-muted/30' : 'hover:shadow-md'}`}>
      <CardContent className="p-3">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full ${catCfg.bgColor} flex items-center justify-center flex-shrink-0`}>
            <IconComponent className={`h-5 w-5 ${catCfg.color}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-semibold truncate">{task.title}</h3>
              {task.actionType === 'external' && <ExternalLink className="h-3 w-3 text-muted-foreground flex-shrink-0" />}
            </div>
            <p className="text-xs text-muted-foreground line-clamp-1">{task.description}</p>
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <span className="text-xs font-bold text-primary">+{task.points}</span>
            {completed ? (
              <Badge variant="secondary" className="text-[10px] px-2">
                <CheckCircle2 className="h-3 w-3 mr-0.5 text-green-500" />
                Done
              </Badge>
            ) : (
              <Button
                size="sm"
                className="h-7 text-xs px-3"
                onClick={onAction}
                disabled={isPending}
              >
                {task.actionType === 'external' ? 'Go' : 'Claim'}
                <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
