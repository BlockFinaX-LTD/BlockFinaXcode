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

type Section = "dashboard" | "users" | "hedge" | "revenue" | "tasks" | "analytics";

const NAV_ITEMS: { key: Section; label: string; icon: any }[] = [
  { key: "dashboard", label: "Dashboard", icon: BarChart3 },
  { key: "users", label: "Users", icon: Users },
  { key: "hedge", label: "Hedge", icon: Shield },
  { key: "revenue", label: "Revenue & Fees", icon: DollarSign },
  { key: "tasks", label: "Tasks & Points", icon: ListChecks },
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


function AnalyticsSection() {
  const { token } = useAdminToken();
  const { data, isLoading, refetch: refetchAnalytics, dataUpdatedAt: analyticsUpdatedAt } = useQuery({ queryKey: ["/api/admin/analytics"], queryFn: () => adminFetch("/api/admin/analytics", token).then(r => r.json()), refetchInterval: 30000 });
  if (isLoading) return <LoadingSkeleton />;
  const { usersByDay = [], hedgesByPair = [], hedgesByStatus = [] } = (data as any) || {};

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
        {section === "hedge" && <HedgeSection />}
        {section === "revenue" && <RevenueSection />}
        {section === "tasks" && <TasksSection />}
        {section === "analytics" && <AnalyticsSection />}
      </main>
    </div>
    </AdminTokenContext.Provider>
  );
}