import { useState, createContext, useContext } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/api-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Users, Activity, TrendingUp, Shield, Search, Eye, EyeOff, Copy, DollarSign,
  BarChart3, ListChecks, ArrowLeft, Wallet, MessageSquare, Clock,
  CheckCircle, AlertTriangle, ChevronRight, Award, Layers, Plus, Pencil, Lock, LogOut,
  FileText, Trash2, X, GripVertical, Save, RefreshCw
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link } from "wouter";

const AdminTokenContext = createContext<{ token: string; logout: () => void }>({ token: "", logout: () => {} });
function useAdminToken() { return useContext(AdminTokenContext); }

async function adminFetch(url: string, token: string, options?: RequestInit) {
  const res = await fetch(url, { ...options, headers: { ...options?.headers, "x-admin-token": token } });
  if (res.status === 401) {
    sessionStorage.removeItem("admin_token");
    window.location.reload();
    throw new Error("Session expired");
  }
  return res;
}

type Section = "dashboard" | "users" | "transactions" | "hedge" | "revenue" | "tasks" | "content" | "analytics";

const NAV_ITEMS: { key: Section; label: string; icon: any }[] = [
  { key: "dashboard", label: "Dashboard", icon: BarChart3 },
  { key: "users", label: "Users", icon: Users },
  { key: "transactions", label: "Transactions", icon: TrendingUp },
  { key: "hedge", label: "Hedge", icon: Shield },
  { key: "revenue", label: "Revenue & Fees", icon: DollarSign },
  { key: "tasks", label: "Tasks & Points", icon: ListChecks },
  { key: "content", label: "Content", icon: FileText },
  { key: "analytics", label: "Analytics", icon: Activity },
];

function StatCard({ title, value, sub, icon: Icon, color = "text-gray-600" }: { title: string; value: string | number; sub?: string; icon: any; color?: string }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-gray-500">{title}</CardTitle>
        <Icon className={`h-4 w-4 ${color}`} />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function shortenAddr(addr: string) {
  return addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "";
}

function DashboardSection() {
  const { token } = useAdminToken();
  const { data, isLoading, refetch, dataUpdatedAt } = useQuery({ queryKey: ["/api/admin/overview"], queryFn: () => adminFetch("/api/admin/overview", token).then(r => r.json()), refetchInterval: 30000 });
  const { data: health } = useQuery({ queryKey: ["/api/admin/health"], queryFn: () => adminFetch("/api/admin/health", token).then(r => r.json()), refetchInterval: 60000 });

  if (isLoading) return <LoadingSkeleton />;
  const s = data as any || {};
  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : '—';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Platform Overview</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Live on-chain data · Last updated {lastUpdated}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
          <Badge variant={health?.status === "healthy" ? "default" : "destructive"}>
            {health?.status === "healthy" ? <CheckCircle className="h-3 w-3 mr-1" /> : <AlertTriangle className="h-3 w-3 mr-1" />}
            {health?.status || "Unknown"}
          </Badge>
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Users" value={s.totalUsers || 0} sub="Registered wallets" icon={Users} color="text-blue-600" />
        <StatCard title="Transactions" value={s.totalTransactions || 0} sub={`Volume: ${parseFloat(s.transactionVolume || 0).toFixed(2)}`} icon={TrendingUp} color="text-green-600" />
        <StatCard title="Hedge Events" value={s.totalHedgeEvents || 0} sub={`${s.activeHedgeEvents || 0} active`} icon={Shield} color="text-purple-600" />
        <StatCard title="Tasks" value={s.totalTaskCompletions || 0} sub={`${s.totalPointsAwarded || 0} points awarded`} icon={ListChecks} color="text-orange-600" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Hedge Positions" value={s.totalPositions || 0} sub={`Premiums: $${parseFloat(s.totalPremiumsCollected || 0).toFixed(2)}`} icon={Shield} />
        <StatCard title="LP Deposits" value={s.totalLpDeposits || 0} sub={`Liquidity: $${parseFloat(s.totalLiquidity || 0).toFixed(2)}`} icon={Layers} />
        <StatCard title="Active Events" value={s.activeHedgeEvents || 0} sub="Currently open" icon={Clock} />
        <StatCard title="Platform Revenue" value={`$${s.hedgeFeeRevenue || "0.00"}`} sub="All hedge fees collected" icon={DollarSign} color="text-green-600" />
      </div>
    </div>
  );
}

function UsersSection() {
  const [search, setSearch] = useState("");
  const { toast } = useToast();
  const { token } = useAdminToken();
  const { data: users, isLoading } = useQuery({ queryKey: ["/api/admin/users"], queryFn: () => adminFetch("/api/admin/users", token).then(r => r.json()), refetchInterval: 30000 });

  const filtered = (users as any[] || []).filter((u: any) =>
    !search || u.address?.toLowerCase().includes(search.toLowerCase()) || u.name?.toLowerCase().includes(search.toLowerCase()) || u.email?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">User Management</h2>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input placeholder="Search by address, name, or email..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
      </div>
      {isLoading ? <LoadingSkeleton /> : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="text-left p-3 font-medium">Address</th>
                    <th className="text-left p-3 font-medium hidden sm:table-cell">Name</th>
                    <th className="text-left p-3 font-medium hidden md:table-cell">Email</th>
                    <th className="text-left p-3 font-medium hidden md:table-cell">Joined</th>
                    <th className="text-left p-3 font-medium">Type</th>
                    <th className="p-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((u: any) => (
                    <tr key={u.id} className="border-b hover:bg-gray-50">
                      <td className="p-3 font-mono text-xs">{shortenAddr(u.address)}</td>
                      <td className="p-3 hidden sm:table-cell">{u.name || "-"}</td>
                      <td className="p-3 hidden md:table-cell text-gray-500">{u.email || "-"}</td>
                      <td className="p-3 hidden md:table-cell text-gray-500 text-xs">{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "-"}</td>
                      <td className="p-3">
                        <Badge variant="outline" className="text-xs">{u.isImported ? "Imported" : "Created"}</Badge>
                      </td>
                      <td className="p-3">
                        <Button variant="ghost" size="sm" onClick={() => { navigator.clipboard.writeText(u.address); toast({ title: "Copied", description: "Address copied" }); }}>
                          <Copy className="h-3 w-3" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={6} className="p-6 text-center text-gray-400">No users found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
      <p className="text-sm text-gray-400">{filtered.length} users total</p>
    </div>
  );
}

function TransactionsSection() {
  const [statusFilter, setStatusFilter] = useState("");
  const [walletFilter, setWalletFilter] = useState("");
  const { token } = useAdminToken();
  const { data: txs, isLoading } = useQuery({ queryKey: ["/api/admin/transactions"], queryFn: () => adminFetch("/api/admin/transactions", token).then(r => r.json()), refetchInterval: 30000 });

  const filtered = (txs as any[] || []).filter((tx: any) => {
    if (statusFilter && tx.status !== statusFilter) return false;
    if (walletFilter && !tx.from?.toLowerCase().includes(walletFilter.toLowerCase()) && !tx.to?.toLowerCase().includes(walletFilter.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Transaction Monitoring</h2>
      <div className="flex gap-3 flex-wrap">
        <Input placeholder="Filter by wallet address..." value={walletFilter} onChange={e => setWalletFilter(e.target.value)} className="max-w-xs" />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="border rounded-md px-3 py-2 text-sm bg-white">
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="failed">Failed</option>
        </select>
      </div>
      {isLoading ? <LoadingSkeleton /> : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="text-left p-3 font-medium">Hash</th>
                    <th className="text-left p-3 font-medium">From</th>
                    <th className="text-left p-3 font-medium">To</th>
                    <th className="text-left p-3 font-medium">Value</th>
                    <th className="text-left p-3 font-medium">Status</th>
                    <th className="text-left p-3 font-medium hidden md:table-cell">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((tx: any) => (
                    <tr key={tx.id} className="border-b hover:bg-gray-50">
                      <td className="p-3 font-mono text-xs">{shortenAddr(tx.hash)}</td>
                      <td className="p-3 font-mono text-xs">{shortenAddr(tx.from)}</td>
                      <td className="p-3 font-mono text-xs">{shortenAddr(tx.to)}</td>
                      <td className="p-3 font-mono">{parseFloat(tx.value).toFixed(4)}</td>
                      <td className="p-3">
                        <Badge variant={tx.status === "confirmed" ? "default" : tx.status === "failed" ? "destructive" : "outline"} className="text-xs">
                          {tx.status}
                        </Badge>
                      </td>
                      <td className="p-3 text-gray-500 text-xs hidden md:table-cell">{tx.timestamp ? new Date(tx.timestamp).toLocaleDateString() : "-"}</td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={6} className="p-6 text-center text-gray-400">No transactions found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
      <p className="text-sm text-gray-400">{filtered.length} transactions</p>
    </div>
  );
}

function HedgeSection() {
  const { token } = useAdminToken();
  const { data, isLoading, refetch: refetchHedge, dataUpdatedAt: hedgeUpdatedAt } = useQuery({ queryKey: ["/api/admin/hedge"], queryFn: () => adminFetch("/api/admin/hedge", token).then(r => r.json()), refetchInterval: 30000 });
  const [tab, setTab] = useState<"events" | "positions" | "deposits">("events");

  if (isLoading) return <LoadingSkeleton />;
  const { events = [], positions = [], deposits = [] } = (data as any) || {};

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Hedge Management</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Live on-chain data · Last updated {hedgeUpdatedAt ? new Date(hedgeUpdatedAt).toLocaleTimeString() : '—'}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetchHedge()} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>
      <div className="flex gap-2">
        {(["events", "positions", "deposits"] as const).map(t => (
          <Button key={t} variant={tab === t ? "default" : "outline"} size="sm" onClick={() => setTab(t)} className="capitalize">
            {t} ({t === "events" ? events.length : t === "positions" ? positions.length : deposits.length})
          </Button>
        ))}
      </div>

      {tab === "events" && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="text-left p-3 font-medium">ID</th>
                    <th className="text-left p-3 font-medium">Pair</th>
                    <th className="text-left p-3 font-medium">Strike</th>
                    <th className="text-left p-3 font-medium">Premium</th>
                    <th className="text-left p-3 font-medium">Status</th>
                    <th className="text-left p-3 font-medium hidden md:table-cell">Expiry</th>
                    <th className="text-left p-3 font-medium hidden md:table-cell">Triggered</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e: any) => (
                    <tr key={e.id} className="border-b hover:bg-gray-50">
                      <td className="p-3">{e.id}</td>
                      <td className="p-3 font-semibold">{e.underlying}</td>
                      <td className="p-3 font-mono">{parseFloat(e.strike).toLocaleString()}</td>
                      <td className="p-3 font-mono text-green-600">{(parseFloat(e.premiumRate) * 100).toFixed(1)}%</td>
                      <td className="p-3">
                        <Badge variant={e.status === "open" ? "default" : e.status === "settled" ? "secondary" : "outline"} className="text-xs capitalize">{e.status}</Badge>
                      </td>
                      <td className="p-3 text-xs text-gray-500 hidden md:table-cell">{new Date(e.expiryDate).toLocaleDateString()}</td>
                      <td className="p-3 hidden md:table-cell">{e.triggered ? <CheckCircle className="h-4 w-4 text-red-500" /> : <span className="text-gray-300">-</span>}</td>
                    </tr>
                  ))}
                  {events.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-gray-400">No hedge events</td></tr>}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {tab === "positions" && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="text-left p-3 font-medium">ID</th>
                    <th className="text-left p-3 font-medium">Event</th>
                    <th className="text-left p-3 font-medium">Hedger</th>
                    <th className="text-left p-3 font-medium">Notional</th>
                    <th className="text-left p-3 font-medium">Premium</th>
                    <th className="text-left p-3 font-medium">Status</th>
                    <th className="text-left p-3 font-medium hidden md:table-cell">Payout</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p: any) => (
                    <tr key={p.id} className="border-b hover:bg-gray-50">
                      <td className="p-3">{p.id}</td>
                      <td className="p-3">#{p.eventId}</td>
                      <td className="p-3 font-mono text-xs">{shortenAddr(p.hedger || p.hedgerWallet)}</td>
                      <td className="p-3 font-mono">${parseFloat(p.notional).toFixed(2)}</td>
                      <td className="p-3 font-mono text-green-600">${parseFloat(p.premiumPaid).toFixed(2)}</td>
                      <td className="p-3"><Badge variant="outline" className="text-xs capitalize">{p.status}</Badge></td>
                      <td className="p-3 font-mono hidden md:table-cell">{p.payoutAmount ? `$${parseFloat(p.payoutAmount).toFixed(2)}` : "-"}</td>
                    </tr>
                  ))}
                  {positions.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-gray-400">No positions</td></tr>}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {tab === "deposits" && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="text-left p-3 font-medium">ID</th>
                    <th className="text-left p-3 font-medium">Event</th>
                    <th className="text-left p-3 font-medium">LP Wallet</th>
                    <th className="text-left p-3 font-medium">Amount</th>
                    <th className="text-left p-3 font-medium">Premiums Earned</th>
                    <th className="text-left p-3 font-medium">Withdrawn</th>
                  </tr>
                </thead>
                <tbody>
                  {deposits.map((d: any) => (
                    <tr key={d.id} className="border-b hover:bg-gray-50">
                      <td className="p-3">{d.id}</td>
                      <td className="p-3">#{d.eventId}</td>
                      <td className="p-3 font-mono text-xs">{shortenAddr(d.lp || d.lpWallet)}</td>
                      <td className="p-3 font-mono">${parseFloat(d.amount).toFixed(2)}</td>
                      <td className="p-3 font-mono text-green-600">${parseFloat(d.premiumsEarned || 0).toFixed(2)}</td>
                      <td className="p-3">{d.withdrawn ? <Badge variant="secondary" className="text-xs">Yes</Badge> : <span className="text-gray-300">No</span>}</td>
                    </tr>
                  ))}
                  {deposits.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-gray-400">No LP deposits</td></tr>}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function RevenueSection() {
  const { token } = useAdminToken();
  const { data, isLoading, refetch: refetchRevenue, dataUpdatedAt: revenueUpdatedAt } = useQuery({ queryKey: ["/api/admin/revenue"], queryFn: () => adminFetch("/api/admin/revenue", token).then(r => r.json()), refetchInterval: 30000 });
  if (isLoading) return <LoadingSkeleton />;
  const r = (data as any) || {};

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Revenue & Fees</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Live on-chain data · Last updated {revenueUpdatedAt ? new Date(revenueUpdatedAt).toLocaleTimeString() : '—'}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetchRevenue()} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Net Platform Revenue" value={`$${r.netPlatformRevenue || "0.00"}`} sub="All fee sources combined" icon={DollarSign} color="text-green-700" />
        <StatCard title="Transaction Fees (0.3%)" value={`$${r.totalTransactionFees || "0.00"}`} sub={`${r.transactionFeeCount || 0} transfers | Vol: $${r.totalTransferVolume || "0.00"}`} icon={DollarSign} color="text-purple-600" />
        <StatCard title="Hedge Platform Fees" value={`$${r.hedgePoolFee || "0.00"}`} sub="Creation + hedger + payout + LP fees" icon={DollarSign} color="text-blue-600" />
        <StatCard title="Total Premiums Collected" value={`$${parseFloat(r.totalPremiumsCollected || 0).toFixed(2)}`} sub="From hedge positions" icon={DollarSign} color="text-green-600" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard title="Total Payouts" value={`$${parseFloat(r.totalPayouts || 0).toFixed(2)}`} sub="Paid to hedgers" icon={DollarSign} color="text-red-600" />
        <StatCard title="Total Liquidity Deposited" value={`$${parseFloat(r.totalLiquidityDeposited || 0).toFixed(2)}`} sub="By liquidity providers" icon={Layers} />
        <StatCard title="LP Premiums Earned" value={`$${parseFloat(r.totalLpPremiumsEarned || 0).toFixed(2)}`} sub="Earned by LPs" icon={Award} />
      </div>
    </div>
  );
}

const EMPTY_TASK_FORM = { taskKey: "", title: "", description: "", points: 10, category: "social", icon: "star", actionUrl: "", actionType: "external", isDaily: true, isActive: true, sortOrder: 0 };

function TasksSection() {
  const { token } = useAdminToken();
  const { data, isLoading } = useQuery({ queryKey: ["/api/admin/tasks"], queryFn: () => adminFetch("/api/admin/tasks", token).then(r => r.json()) });
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<any>(null);
  const [form, setForm] = useState(EMPTY_TASK_FORM);

  const openCreate = () => { setEditingTask(null); setForm(EMPTY_TASK_FORM); setDialogOpen(true); };
  const openEdit = (t: any) => {
    setEditingTask(t);
    setForm({ taskKey: t.taskKey, title: t.title, description: t.description, points: t.points, category: t.category, icon: t.icon || "star", actionUrl: t.actionUrl || "", actionType: t.actionType || "external", isDaily: t.isDaily, isActive: t.isActive, sortOrder: t.sortOrder || 0 });
    setDialogOpen(true);
  };

  const saveTask = useMutation({
    mutationFn: async () => {
      const url = editingTask ? `/api/admin/tasks/${editingTask.id}` : "/api/admin/tasks";
      const method = editingTask ? "PATCH" : "POST";
      const res = await adminFetch(url, token, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.message || "Failed to save task"); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/tasks"] });
      toast({ title: editingTask ? "Task updated" : "Task created" });
      setDialogOpen(false);
    },
    onError: (err: any) => { toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  const toggleTask = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      const res = await adminFetch(`/api/admin/tasks/${id}`, token, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive }) });
      if (!res.ok) throw new Error("Failed to update task");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/tasks"] });
      toast({ title: "Task updated" });
    },
  });

  if (isLoading) return <LoadingSkeleton />;
  const { tasks = [], completions = [], leaderboard = [] } = (data as any) || {};

  const completionMap: Record<number, { count: number; totalPoints: number }> = {};
  completions.forEach((c: any) => { completionMap[c.taskId] = { count: c.count, totalPoints: c.totalPoints }; });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Tasks & Points</h2>
        <Button onClick={openCreate} size="sm"><Plus className="h-4 w-4 mr-1" /> Create Task</Button>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingTask ? "Edit Task" : "Create New Task"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Task Key</Label>
                <Input placeholder="e.g. follow_twitter" value={form.taskKey} onChange={e => setForm(f => ({ ...f, taskKey: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Category</Label>
                <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className="w-full border rounded-md px-3 py-2 text-sm bg-white">
                  <option value="social">Social</option>
                  <option value="onchain">On-Chain</option>
                  <option value="community">Community</option>
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input placeholder="Task title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea placeholder="What does the user need to do?" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Points</Label>
                <Input type="number" value={form.points} onChange={e => setForm(f => ({ ...f, points: parseInt(e.target.value) || 0 }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Sort Order</Label>
                <Input type="number" value={form.sortOrder} onChange={e => setForm(f => ({ ...f, sortOrder: parseInt(e.target.value) || 0 }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Icon</Label>
                <Input placeholder="star" value={form.icon} onChange={e => setForm(f => ({ ...f, icon: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Action Type</Label>
                <select value={form.actionType} onChange={e => setForm(f => ({ ...f, actionType: e.target.value }))} className="w-full border rounded-md px-3 py-2 text-sm bg-white">
                  <option value="external">External Link</option>
                  <option value="internal">Internal Action</option>
                  <option value="verify">Verify</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Action URL</Label>
                <Input placeholder="https://..." value={form.actionUrl} onChange={e => setForm(f => ({ ...f, actionUrl: e.target.value }))} />
              </div>
            </div>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Switch checked={form.isDaily} onCheckedChange={v => setForm(f => ({ ...f, isDaily: v }))} />
                <Label>Daily Task</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.isActive} onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))} />
                <Label>Active</Label>
              </div>
            </div>
            <Button onClick={() => saveTask.mutate()} disabled={saveTask.isPending || !form.taskKey || !form.title || !form.description} className="w-full">
              {saveTask.isPending ? "Saving..." : editingTask ? "Save Changes" : "Create Task"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <CardTitle>Daily Tasks</CardTitle>
          <CardDescription>Manage community engagement tasks</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="text-left p-3 font-medium">Task</th>
                  <th className="text-left p-3 font-medium hidden sm:table-cell">Category</th>
                  <th className="text-left p-3 font-medium">Points</th>
                  <th className="text-left p-3 font-medium hidden md:table-cell">Completions</th>
                  <th className="text-left p-3 font-medium hidden md:table-cell">Type</th>
                  <th className="text-left p-3 font-medium">Active</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t: any) => {
                  const stats = completionMap[t.id];
                  return (
                    <tr key={t.id} className="border-b hover:bg-gray-50">
                      <td className="p-3">
                        <div className="font-medium">{t.title}</div>
                        <div className="text-xs text-gray-400 mt-0.5 hidden sm:block">{t.description}</div>
                      </td>
                      <td className="p-3 hidden sm:table-cell"><Badge variant="outline" className="text-xs capitalize">{t.category}</Badge></td>
                      <td className="p-3 font-semibold">{t.points}</td>
                      <td className="p-3 hidden md:table-cell">{stats?.count || 0}</td>
                      <td className="p-3 hidden md:table-cell"><Badge variant="outline" className="text-xs">{t.isDaily ? "Daily" : "One-time"}</Badge></td>
                      <td className="p-3">
                        <Switch checked={t.isActive} onCheckedChange={(checked) => toggleTask.mutate({ id: t.id, isActive: checked })} />
                      </td>
                      <td className="p-3">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(t)}><Pencil className="h-3 w-3" /></Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Leaderboard</CardTitle>
          <CardDescription>Top 20 users by points</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="text-left p-3 font-medium">#</th>
                  <th className="text-left p-3 font-medium">Wallet</th>
                  <th className="text-left p-3 font-medium">Points</th>
                  <th className="text-left p-3 font-medium">Tasks Done</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((entry: any, i: number) => (
                  <tr key={entry.walletAddress} className="border-b hover:bg-gray-50">
                    <td className="p-3 font-semibold">{i + 1}</td>
                    <td className="p-3 font-mono text-xs">{shortenAddr(entry.walletAddress)}</td>
                    <td className="p-3 font-semibold text-green-600">{entry.totalPoints}</td>
                    <td className="p-3">{entry.tasksCompleted}</td>
                  </tr>
                ))}
                {leaderboard.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-gray-400">No completions yet</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const ARTICLE_CATEGORIES = ["FX Protection", "Payments", "DeFi", "Education", "Earning"];

function ContentSection() {
  const { token } = useAdminToken();
  const { toast } = useToast();
  const [editingArticle, setEditingArticle] = useState<any>(null);
  const [showEditor, setShowEditor] = useState(false);

  const { data: articles = [], isLoading } = useQuery({
    queryKey: ["/api/admin/articles"],
    queryFn: () => adminFetch("/api/admin/articles", token).then(r => r.json()),
  });

  const saveMutation = useMutation({
    mutationFn: async (article: any) => {
      const isNew = !article.id;
      const url = isNew ? "/api/admin/articles" : `/api/admin/articles/${article.id}`;
      const method = isNew ? "POST" : "PATCH";
      const { id, createdAt, updatedAt, ...body } = article;
      const res = await adminFetch(url, token, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to save article");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/articles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      setShowEditor(false);
      setEditingArticle(null);
      toast({ title: "Article saved" });
    },
    onError: () => toast({ variant: "destructive", title: "Failed to save article" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await adminFetch(`/api/admin/articles/${id}`, token, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/articles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      toast({ title: "Article deleted" });
    },
  });

  const togglePublish = useMutation({
    mutationFn: async ({ id, isPublished }: { id: number; isPublished: boolean }) => {
      const res = await adminFetch(`/api/admin/articles/${id}`, token, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublished }),
      });
      if (!res.ok) throw new Error("Failed to update");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/articles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
    },
  });

  const openNewArticle = () => {
    setEditingArticle({
      slug: "",
      title: "",
      subtitle: "",
      category: "Education",
      readTime: "5 min read",
      date: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
      content: [{ type: "heading", content: "" }, { type: "text", content: "" }],
      isPublished: true,
      sortOrder: (articles as any[]).length,
    });
    setShowEditor(true);
  };

  const openEditArticle = (article: any) => {
    setEditingArticle({ ...article });
    setShowEditor(true);
  };

  if (isLoading) return <LoadingSkeleton />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Content Management</h2>
        <Button onClick={openNewArticle} className="bg-[#1a4480] hover:bg-[#153a6e]">
          <Plus className="h-4 w-4 mr-2" /> New Article
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Insights Articles</CardTitle>
          <CardDescription>{(articles as any[]).length} articles total</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left p-3 font-medium text-gray-500">Title</th>
                  <th className="text-left p-3 font-medium text-gray-500">Category</th>
                  <th className="text-left p-3 font-medium text-gray-500">Date</th>
                  <th className="text-center p-3 font-medium text-gray-500">Published</th>
                  <th className="text-right p-3 font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(articles as any[]).map((article: any) => (
                  <tr key={article.id} className="hover:bg-gray-50">
                    <td className="p-3">
                      <div className="font-medium text-gray-900 line-clamp-1">{article.title}</div>
                      <div className="text-xs text-gray-400 font-mono">{article.slug}</div>
                    </td>
                    <td className="p-3">
                      <Badge variant="outline" className="text-xs">{article.category}</Badge>
                    </td>
                    <td className="p-3 text-gray-500 text-xs">{article.date}</td>
                    <td className="p-3 text-center">
                      <Switch
                        checked={article.isPublished}
                        onCheckedChange={(checked) => togglePublish.mutate({ id: article.id, isPublished: checked })}
                      />
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openEditArticle(article)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-500 hover:text-red-700"
                          onClick={() => {
                            if (confirm("Delete this article?")) deleteMutation.mutate(article.id);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {(articles as any[]).length === 0 && (
                  <tr><td colSpan={5} className="p-6 text-center text-gray-400">No articles yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={showEditor} onOpenChange={(open) => { if (!open) { setShowEditor(false); setEditingArticle(null); } }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          {editingArticle && (
            <ArticleEditor
              article={editingArticle}
              onSave={(article) => saveMutation.mutate(article)}
              onCancel={() => { setShowEditor(false); setEditingArticle(null); }}
              isSaving={saveMutation.isPending}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ArticleEditor({ article, onSave, onCancel, isSaving }: {
  article: any;
  onSave: (article: any) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const [form, setForm] = useState(article);
  const [contentSections, setContentSections] = useState<any[]>(
    Array.isArray(article.content) ? article.content : []
  );

  const updateField = (field: string, value: any) => {
    setForm((f: any) => ({ ...f, [field]: value }));
  };

  const addSection = (type: string) => {
    if (type === "list") {
      setContentSections([...contentSections, { type: "list", items: [""] }]);
    } else if (type === "cta") {
      setContentSections([...contentSections, { type: "cta", title: "", description: "", link: "/hedge", linkText: "Learn More" }]);
    } else {
      setContentSections([...contentSections, { type, content: "" }]);
    }
  };

  const updateSection = (index: number, updates: any) => {
    const updated = [...contentSections];
    updated[index] = { ...updated[index], ...updates };
    setContentSections(updated);
  };

  const removeSection = (index: number) => {
    setContentSections(contentSections.filter((_, i) => i !== index));
  };

  const moveSection = (index: number, direction: -1 | 1) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= contentSections.length) return;
    const updated = [...contentSections];
    [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
    setContentSections(updated);
  };

  const handleSave = () => {
    const slug = form.slug || form.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    onSave({ ...form, slug, content: contentSections });
  };

  return (
    <div>
      <DialogHeader className="flex flex-row items-center justify-between pb-4">
        <DialogTitle>{article.id ? "Edit Article" : "New Article"}</DialogTitle>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onCancel} disabled={isSaving}>Cancel</Button>
          <Button onClick={handleSave} disabled={isSaving} className="bg-[#1a4480] hover:bg-[#153a6e]">
            {isSaving ? "Saving..." : "Save Article"}
          </Button>
        </div>
      </DialogHeader>
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Title</Label>
            <Input value={form.title} onChange={(e) => updateField("title", e.target.value)} placeholder="Article title" />
          </div>
          <div className="space-y-2">
            <Label>Slug (URL path)</Label>
            <Input value={form.slug} onChange={(e) => updateField("slug", e.target.value)} placeholder="auto-generated-from-title" />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Subtitle</Label>
          <Textarea value={form.subtitle} onChange={(e) => updateField("subtitle", e.target.value)} placeholder="Brief description" rows={2} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="space-y-2">
            <Label>Category</Label>
            <Select value={form.category} onValueChange={(v) => updateField("category", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ARTICLE_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Read Time</Label>
            <Input value={form.readTime || form.read_time || ""} onChange={(e) => updateField("readTime", e.target.value)} placeholder="5 min read" />
          </div>
          <div className="space-y-2">
            <Label>Date</Label>
            <Input value={form.date} onChange={(e) => updateField("date", e.target.value)} placeholder="February 15, 2026" />
          </div>
          <div className="space-y-2">
            <Label>Sort Order</Label>
            <Input type="number" value={form.sortOrder ?? 0} onChange={(e) => updateField("sortOrder", parseInt(e.target.value) || 0)} />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Switch checked={form.isPublished ?? true} onCheckedChange={(v) => updateField("isPublished", v)} />
          <Label>Published</Label>
        </div>

        <div className="border-t pt-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Content Sections</h3>
            <div className="flex gap-1 flex-wrap">
              {[
                { type: "heading", label: "Heading" },
                { type: "subheading", label: "Subheading" },
                { type: "text", label: "Text" },
                { type: "list", label: "List" },
                { type: "callout", label: "Callout" },
                { type: "cta", label: "CTA" },
              ].map(s => (
                <Button key={s.type} size="sm" variant="outline" onClick={() => addSection(s.type)} className="text-xs">
                  <Plus className="h-3 w-3 mr-1" /> {s.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            {contentSections.map((section, index) => (
              <div key={index} className="border rounded-lg p-3 bg-gray-50">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs capitalize">{section.type}</Badge>
                    <span className="text-xs text-gray-400">#{index + 1}</span>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => moveSection(index, -1)} disabled={index === 0} className="h-6 w-6 p-0">
                      <span className="text-xs">&#x25B2;</span>
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => moveSection(index, 1)} disabled={index === contentSections.length - 1} className="h-6 w-6 p-0">
                      <span className="text-xs">&#x25BC;</span>
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => removeSection(index)} className="h-6 w-6 p-0 text-red-500 hover:text-red-700">
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>

                {(section.type === "heading" || section.type === "subheading" || section.type === "callout") && (
                  <Input
                    value={section.content || ""}
                    onChange={(e) => updateSection(index, { content: e.target.value })}
                    placeholder={`${section.type} text...`}
                  />
                )}

                {section.type === "text" && (
                  <Textarea
                    value={section.content || ""}
                    onChange={(e) => updateSection(index, { content: e.target.value })}
                    placeholder="Paragraph text..."
                    rows={3}
                  />
                )}

                {section.type === "list" && (
                  <div className="space-y-2">
                    {(section.items || [""]).map((item: string, i: number) => (
                      <div key={i} className="flex gap-2">
                        <Input
                          value={item}
                          onChange={(e) => {
                            const items = [...(section.items || [""])];
                            items[i] = e.target.value;
                            updateSection(index, { items });
                          }}
                          placeholder={`List item ${i + 1}`}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            const items = (section.items || [""]).filter((_: any, j: number) => j !== i);
                            updateSection(index, { items: items.length ? items : [""] });
                          }}
                          className="text-red-400 h-9 w-9 p-0 flex-shrink-0"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => updateSection(index, { items: [...(section.items || [""]), ""] })}
                      className="text-xs"
                    >
                      <Plus className="h-3 w-3 mr-1" /> Add Item
                    </Button>
                  </div>
                )}

                {section.type === "cta" && (
                  <div className="grid grid-cols-2 gap-2">
                    <Input value={section.title || ""} onChange={(e) => updateSection(index, { title: e.target.value })} placeholder="CTA Title" />
                    <Input value={section.link || ""} onChange={(e) => updateSection(index, { link: e.target.value })} placeholder="/hedge" />
                    <Input value={section.description || ""} onChange={(e) => updateSection(index, { description: e.target.value })} placeholder="CTA Description" />
                    <Input value={section.linkText || ""} onChange={(e) => updateSection(index, { linkText: e.target.value })} placeholder="Button text" />
                  </div>
                )}
              </div>
            ))}

            {contentSections.length === 0 && (
              <div className="text-center py-8 text-gray-400 border-2 border-dashed rounded-lg">
                No content sections yet. Add sections using the buttons above.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AnalyticsSection() {
  const { token } = useAdminToken();
  const { data, isLoading, refetch: refetchAnalytics, dataUpdatedAt: analyticsUpdatedAt } = useQuery({ queryKey: ["/api/admin/analytics"], queryFn: () => adminFetch("/api/admin/analytics", token).then(r => r.json()), refetchInterval: 30000 });
  if (isLoading) return <LoadingSkeleton />;
  const { usersByDay = [], hedgesByPair = [], hedgesByStatus = [], txByDay = [] } = (data as any) || {};

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Analytics</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>User Growth</CardTitle>
            <CardDescription>New wallets by day</CardDescription>
          </CardHeader>
          <CardContent>
            {usersByDay.length > 0 ? (
              <div className="space-y-2">
                {usersByDay.slice(-14).map((d: any) => (
                  <div key={d.date} className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">{d.date}</span>
                    <div className="flex items-center gap-2">
                      <div className="h-2 bg-blue-500 rounded" style={{ width: `${Math.max(8, d.count * 20)}px` }} />
                      <span className="font-semibold w-6 text-right">{d.count}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="text-gray-400 text-center py-4">No data yet</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Hedge Events by Pair</CardTitle>
            <CardDescription>Distribution across currency pairs</CardDescription>
          </CardHeader>
          <CardContent>
            {hedgesByPair.length > 0 ? (
              <div className="space-y-3">
                {hedgesByPair.map((p: any) => {
                  const total = hedgesByPair.reduce((s: number, x: any) => s + x.count, 0);
                  const pct = total > 0 ? ((p.count / total) * 100).toFixed(0) : 0;
                  return (
                    <div key={p.pair} className="flex items-center justify-between text-sm">
                      <span className="font-medium">{p.pair}</span>
                      <div className="flex items-center gap-2">
                        <div className="w-24 bg-gray-100 rounded-full h-2">
                          <div className="bg-purple-500 rounded-full h-2" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-gray-500 w-16 text-right">{p.count} ({pct}%)</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : <p className="text-gray-400 text-center py-4">No data yet</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Hedge Events by Status</CardTitle>
          </CardHeader>
          <CardContent>
            {hedgesByStatus.length > 0 ? (
              <div className="flex gap-4 flex-wrap">
                {hedgesByStatus.map((s: any) => (
                  <div key={s.status} className="text-center px-4 py-3 border rounded-lg">
                    <div className="text-2xl font-bold">{s.count}</div>
                    <div className="text-xs text-gray-500 capitalize">{s.status}</div>
                  </div>
                ))}
              </div>
            ) : <p className="text-gray-400 text-center py-4">No data yet</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Transaction Volume</CardTitle>
            <CardDescription>Daily transaction count and volume</CardDescription>
          </CardHeader>
          <CardContent>
            {txByDay.length > 0 ? (
              <div className="space-y-2">
                {txByDay.slice(-14).map((d: any) => (
                  <div key={d.date} className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">{d.date}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-400">{d.count} txs</span>
                      <span className="font-mono font-semibold">{parseFloat(d.volume).toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="text-gray-400 text-center py-4">No data yet</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 bg-gray-200 rounded w-48" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => <div key={i} className="h-28 bg-gray-200 rounded-lg" />)}
      </div>
    </div>
  );
}

function AdminLogin({ onLogin }: { onLogin: (token: string) => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const data = await res.json();
      if (!res.ok) { setError(data.message || "Login failed"); return; }
      sessionStorage.setItem("admin_token", data.token);
      onLogin(data.token);
    } catch { setError("Connection error"); } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 rounded-xl bg-[#1a4480] flex items-center justify-center mb-2">
            <Lock className="h-6 w-6 text-white" />
          </div>
          <CardTitle>Admin Login</CardTitle>
          <CardDescription>Enter your admin password to continue</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <Input type={showPassword ? "text" : "password"} placeholder="Admin password" value={password} onChange={e => setPassword(e.target.value)} autoFocus className="pr-10" />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <Button type="submit" className="w-full bg-[#1a4480] hover:bg-[#153a6e]" disabled={loading || !password}>
              {loading ? "Logging in..." : "Login"}
            </Button>
          </form>
          <div className="mt-4 text-center">
            <Link href="/">
              <span className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer">Back to site</span>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminDashboard() {
  const [section, setSection] = useState<Section>("dashboard");
  const [adminToken, setAdminToken] = useState<string | null>(() => sessionStorage.getItem("admin_token"));

  const logout = () => {
    if (adminToken) {
      fetch("/api/admin/logout", { method: "POST", headers: { "x-admin-token": adminToken } }).catch(() => {});
    }
    sessionStorage.removeItem("admin_token");
    setAdminToken(null);
  };

  if (!adminToken) {
    return <AdminLogin onLogin={(t) => setAdminToken(t)} />;
  }

  return (
    <AdminTokenContext.Provider value={{ token: adminToken, logout }}>
    <div className="min-h-screen bg-gray-50 flex">
      <aside className="w-56 bg-white border-r border-gray-200 flex-shrink-0 hidden md:flex flex-col">
        <div className="p-4 border-b">
          <Link href="/">
            <div className="flex items-center gap-2 cursor-pointer hover:opacity-70 transition">
              <ArrowLeft className="h-4 w-4" />
              <span className="font-bold text-[#1a4480]">BlockFinaX</span>
            </div>
          </Link>
          <p className="text-xs text-gray-400 mt-1">Admin Platform</p>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {NAV_ITEMS.map(item => (
            <button
              key={item.key}
              onClick={() => setSection(item.key)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                section === item.key ? "bg-[#1a4480] text-white" : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="p-2 border-t">
          <button onClick={logout} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-red-500 hover:bg-red-50 transition-colors">
            <LogOut className="h-4 w-4" /> Logout
          </button>
        </div>
      </aside>

      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t z-50 flex overflow-x-auto">
        {NAV_ITEMS.map(item => (
          <button
            key={item.key}
            onClick={() => setSection(item.key)}
            className={`flex-1 min-w-0 flex flex-col items-center gap-0.5 py-2 px-1 text-[10px] transition-colors ${
              section === item.key ? "text-[#1a4480] font-semibold" : "text-gray-400"
            }`}
          >
            <item.icon className="h-4 w-4" />
            <span className="truncate">{item.label}</span>
          </button>
        ))}
      </div>

      <main className="flex-1 p-4 md:p-6 overflow-y-auto pb-20 md:pb-6">
        {section === "dashboard" && <DashboardSection />}
        {section === "users" && <UsersSection />}
        {section === "transactions" && <TransactionsSection />}
        {section === "hedge" && <HedgeSection />}
        {section === "revenue" && <RevenueSection />}
        {section === "tasks" && <TasksSection />}
        {section === "content" && <ContentSection />}
        {section === "analytics" && <AnalyticsSection />}
      </main>
    </div>
    </AdminTokenContext.Provider>
  );
}