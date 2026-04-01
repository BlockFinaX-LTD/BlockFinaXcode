import { useState, createContext, useContext, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/api-client";
import { hedgeContract, type HedgeFeeConfig, USDC_ADDRESS, USDT_ADDRESS_SEPOLIA } from "@/lib/hedge-contract";
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
  Users, Activity, TrendingUp, Shield, Search, Copy, DollarSign,
  BarChart3, ListChecks, ArrowLeft, Wallet, MessageSquare, Clock,
  CheckCircle, AlertTriangle, ChevronRight, Award, Layers, Plus, Pencil, LogOut,
  FileText, Trash2, X, GripVertical, Save, RefreshCw, Settings, ExternalLink, Download, Info
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

type Section = "dashboard" | "users" | "hedge" | "revenue" | "tasks" | "analytics" | "content" | "protocol";

const NAV_ITEMS: { key: Section; label: string; icon: any }[] = [
  { key: "dashboard", label: "Dashboard", icon: BarChart3 },
  { key: "users", label: "Users", icon: Users },
  { key: "hedge", label: "Hedge", icon: Shield },
  { key: "revenue", label: "Revenue & Fees", icon: DollarSign },
  { key: "tasks", label: "Tasks & Points", icon: ListChecks },
  { key: "analytics", label: "Analytics", icon: Activity },
  { key: "content", label: "Content", icon: FileText },
  { key: "protocol", label: "Protocol", icon: Settings },
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

function TokenBadge({ address }: { address?: string }) {
  if (!address) return <Badge variant="outline" className="text-xs">USDC</Badge>;
  const lower = address.toLowerCase();
  if (lower === USDT_ADDRESS_SEPOLIA.toLowerCase()) {
    return <Badge className="text-xs bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100">USDT</Badge>;
  }
  return <Badge className="text-xs bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-100">USDC</Badge>;
}

function ResetTestnetDialog({ token, onReset }: { token: string; onReset: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const TABLES_CLEARED = [
    "wallets", "user_profiles", "user_accounts", "auth_sessions",
    "magic_links", "webauthn_credentials", "hedge_events", "hedge_positions",
    "hedge_lp_deposits", "user_task_completions", "platform_fees",
    "rate_snapshots", "terms_acceptances", "referrals", "user_points",
  ];
  const TABLES_KEPT = ["networks", "daily_tasks", "articles", "data_room_content"];

  const handleReset = async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/api/admin/reset-testnet", token, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      toast({ title: "Testnet data cleared", description: "All user and transaction data has been removed." });
      setOpen(false);
      setConfirm("");
      onReset();
    } catch (e: any) {
      toast({ title: "Reset failed", description: e.message, variant: "destructive" });
    } finally { setLoading(false); }
  };

  return (
    <>
      <Button variant="outline" size="sm" className="border-red-200 text-red-600 hover:bg-red-50"
        onClick={() => { setConfirm(""); setOpen(true); }}>
        <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Clear Testnet Data
      </Button>

      <Dialog open={open} onOpenChange={o => { if (!loading) { setOpen(o); setConfirm(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" /> Clear Testnet Data
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 text-sm">
            <p className="text-gray-700">This permanently deletes all user and transaction data. Use this to start clean before going live on mainnet.</p>

            <div className="space-y-2">
              <p className="font-medium text-red-600">Will be deleted:</p>
              <div className="bg-red-50 rounded p-3 text-xs text-red-700 font-mono leading-relaxed">
                {TABLES_CLEARED.join(" · ")}
              </div>
            </div>

            <div className="space-y-2">
              <p className="font-medium text-green-700">Will be kept:</p>
              <div className="bg-green-50 rounded p-3 text-xs text-green-700 font-mono leading-relaxed">
                {TABLES_KEPT.join(" · ")}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Type <strong>RESET</strong> to confirm</Label>
              <Input
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="RESET"
                className="font-mono"
                autoComplete="off"
              />
            </div>

            <div className="flex gap-2 justify-end pt-1">
              <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={loading}>Cancel</Button>
              <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white"
                disabled={confirm !== "RESET" || loading}
                onClick={handleReset}>
                {loading ? "Clearing…" : "Clear all testnet data"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
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

      {/* Danger zone */}
      <div className="border border-red-200 rounded-lg p-4 bg-red-50/30">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-red-700">Danger Zone</p>
            <p className="text-xs text-red-500 mt-0.5">Permanently removes all testnet user and transaction data. Articles, tasks, and network config are preserved.</p>
          </div>
          <ResetTestnetDialog token={token} onReset={() => refetch()} />
        </div>
      </div>
    </div>
  );
}

const KYC_STATUS_STYLES: Record<string, { label: string; className: string }> = {
  not_started: { label: "Not Started", className: "bg-gray-100 text-gray-500" },
  pending:     { label: "Pending",     className: "bg-amber-50 text-amber-700 border border-amber-200" },
  approved:    { label: "Approved",    className: "bg-green-50 text-green-700 border border-green-200" },
  rejected:    { label: "Rejected",    className: "bg-red-50 text-red-700 border border-red-200" },
};

function KycBadge({ status }: { status: string }) {
  const s = KYC_STATUS_STYLES[status] || KYC_STATUS_STYLES.not_started;
  return <span className={`text-xs font-medium px-2 py-0.5 rounded ${s.className}`}>{s.label}</span>;
}

function KycDetailDialog({ user, token, onClose, onUpdate }: { user: any; token: string; onClose: () => void; onUpdate: () => void }) {
  const { toast } = useToast();
  const { data: profile, isLoading } = useQuery({
    queryKey: ["/api/admin/kyc", user.address],
    queryFn: () => adminFetch(`/api/admin/kyc/${user.address}`, token).then(r => r.ok ? r.json() : null),
  });
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (profile?.reviewerNotes) setNotes(profile.reviewerNotes); }, [profile]);

  const updateStatus = async (kycStatus: string) => {
    setSaving(true);
    try {
      const res = await adminFetch(`/api/admin/kyc/${user.address}`, token, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kycStatus, reviewerNotes: notes }),
      });
      if (!res.ok) throw new Error("Update failed");
      toast({ title: `Status set to ${kycStatus}` });
      onUpdate();
      onClose();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const saveNotes = async () => {
    setSaving(true);
    try {
      await adminFetch(`/api/admin/kyc/${user.address}`, token, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewerNotes: notes }),
      });
      toast({ title: "Notes saved" });
    } catch { toast({ title: "Error saving notes", variant: "destructive" }); }
    finally { setSaving(false); }
  };

  const Field = ({ label, value }: { label: string; value?: string | boolean | null }) => (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-sm font-medium text-gray-900 mt-0.5">
        {value === null || value === undefined || value === "" ? <span className="text-gray-400 italic">Not provided</span>
          : typeof value === "boolean" ? (value ? "Yes" : "No")
          : value}
      </p>
    </div>
  );

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            KYC Profile
            {profile && <KycBadge status={profile.kycStatus || "not_started"} />}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="py-8 text-center text-gray-400">Loading profile…</div>
        ) : !profile ? (
          <div className="py-8 text-center text-gray-400">No KYC data submitted yet for this user.</div>
        ) : (
          <div className="space-y-5">
            {/* Tier 1 */}
            <div>
              <p className="text-xs font-semibold text-[#1a4480] uppercase tracking-wide mb-3">Tier 1 — Basic Identity</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Full Name" value={profile.firstName && profile.lastName ? `${profile.firstName} ${profile.lastName}` : profile.displayName} />
                <Field label="Date of Birth" value={profile.dateOfBirth} />
                <Field label="Nationality" value={profile.nationality} />
                <Field label="Country of Residence" value={profile.country} />
                <Field label="Phone Number" value={profile.phoneNumber} />
                <Field label="Email" value={profile.email} />
              </div>
            </div>

            {/* Tier 2 */}
            <div className="border-t pt-4">
              <p className="text-xs font-semibold text-[#1a4480] uppercase tracking-wide mb-3">Tier 2 — Identity Documents</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="ID Type" value={profile.idType} />
                <Field label="ID Number" value={profile.idNumber} />
                <Field label="Tax ID (TIN)" value={profile.taxId} />
                <Field label="Address" value={profile.address} />
                <Field label="City" value={profile.city} />
                <Field label="Postal Code" value={profile.postalCode} />
              </div>
              {profile.kycDocuments && (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  {["id_front", "id_back", "selfie", "proof_of_address"].map(k => {
                    const docs = typeof profile.kycDocuments === "string" ? JSON.parse(profile.kycDocuments) : profile.kycDocuments;
                    const url = docs?.[k];
                    return url ? (
                      <a key={k} href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-[#1a4480] hover:underline flex items-center gap-1">
                        <ExternalLink className="h-3 w-3" />{k.replace(/_/g, " ")}
                      </a>
                    ) : (
                      <div key={k}><p className="text-xs text-gray-400 italic">{k.replace(/_/g, " ")} — not uploaded</p></div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Tier 3 */}
            <div className="border-t pt-4">
              <p className="text-xs font-semibold text-[#1a4480] uppercase tracking-wide mb-3">Tier 3 — Enhanced Due Diligence</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Source of Funds" value={profile.sourceOfFunds} />
                <Field label="Politically Exposed Person (PEP)" value={profile.isPep} />
              </div>
            </div>

            {/* Provider info */}
            <div className="border-t pt-4">
              <p className="text-xs font-semibold text-[#1a4480] uppercase tracking-wide mb-3">Provider</p>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-gray-500">Provider</p>
                  <p className="font-medium capitalize mt-0.5">{profile.kycProvider || "manual"}</p>
                </div>
                <div>
                  <p className="text-gray-500">Reference ID</p>
                  <p className="font-mono mt-0.5 break-all">{profile.kycProviderRef || "—"}</p>
                </div>
                <div>
                  <p className="text-gray-500">Submitted</p>
                  <p className="font-medium mt-0.5">{profile.submittedAt ? new Date(profile.submittedAt).toLocaleString() : "—"}</p>
                </div>
                <div>
                  <p className="text-gray-500">Reviewed</p>
                  <p className="font-medium mt-0.5">{profile.reviewedAt ? new Date(profile.reviewedAt).toLocaleString() : "—"}</p>
                </div>
              </div>
              {profile.kycProvider && profile.kycProvider !== "manual" && profile.kycProviderRef && (
                <Button variant="outline" size="sm" className="mt-3 text-xs"
                  onClick={async () => {
                    setSaving(true);
                    try {
                      const r = await adminFetch(`/api/admin/kyc/${user.address}/sync`, token, { method: "POST" });
                      const data = await r.json();
                      if (!r.ok) throw new Error(data.message);
                      toast({ title: `Synced — status: ${data.kycStatus}` });
                      onUpdate();
                    } catch (e: any) { toast({ title: "Sync failed", description: e.message, variant: "destructive" }); }
                    finally { setSaving(false); }
                  }} disabled={saving}>
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Sync status from {profile.kycProvider}
                </Button>
              )}
            </div>

            {/* Reviewer notes */}
            <div className="border-t pt-4 space-y-2">
              <Label className="text-xs font-semibold">Reviewer Notes</Label>
              <Textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Internal notes (not visible to user)…" />
              <Button variant="outline" size="sm" onClick={saveNotes} disabled={saving}>Save Notes</Button>
            </div>

            {/* Status actions — manual override always available */}
            <div className="border-t pt-4 flex items-center gap-2 flex-wrap">
              <span className="text-sm text-gray-600 mr-1">
                {profile.kycProvider && profile.kycProvider !== "manual" ? "Override status:" : "Set status:"}
              </span>
              {["pending", "approved", "rejected"].map(s => (
                <Button key={s} size="sm" variant="outline"
                  className={s === "approved" ? "border-green-300 text-green-700 hover:bg-green-50" : s === "rejected" ? "border-red-300 text-red-700 hover:bg-red-50" : ""}
                  onClick={() => updateStatus(s)} disabled={saving || profile.kycStatus === s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </Button>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function UsersSection() {
  const [search, setSearch] = useState("");
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const { toast } = useToast();
  const { token } = useAdminToken();
  const { data: users, isLoading, refetch } = useQuery({ queryKey: ["/api/admin/users"], queryFn: () => adminFetch("/api/admin/users", token).then(r => r.json()), refetchInterval: 30000 });

  const filtered = (users as any[] || []).filter((u: any) =>
    !search || u.address?.toLowerCase().includes(search.toLowerCase()) || u.name?.toLowerCase().includes(search.toLowerCase()) || u.email?.toLowerCase().includes(search.toLowerCase())
  );

  const kycCounts = (users as any[] || []).reduce((acc: any, u: any) => {
    const s = u.kyc?.kycStatus || "not_started";
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">User Management</h2>
      </div>

      {/* KYC summary pills */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(KYC_STATUS_STYLES).map(([key, { label, className }]) => (
          <div key={key} className={`text-xs px-3 py-1 rounded-full ${className}`}>
            {label}: <strong>{kycCounts[key] || 0}</strong>
          </div>
        ))}
      </div>

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
                    <th className="text-left p-3 font-medium">KYC</th>
                    <th className="p-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((u: any) => (
                    <tr key={u.id} className="border-b hover:bg-gray-50 cursor-pointer" onClick={() => setSelectedUser(u)}>
                      <td className="p-3 font-mono text-xs">{shortenAddr(u.address)}</td>
                      <td className="p-3 hidden sm:table-cell">{u.name || "-"}</td>
                      <td className="p-3 hidden md:table-cell text-gray-500">{u.email || "-"}</td>
                      <td className="p-3 hidden md:table-cell text-gray-500 text-xs">{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "-"}</td>
                      <td className="p-3">
                        <KycBadge status={u.kyc?.kycStatus || "not_started"} />
                      </td>
                      <td className="p-3">
                        <Button variant="ghost" size="sm" onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(u.address); toast({ title: "Copied", description: "Address copied" }); }}>
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

      {selectedUser && (
        <KycDetailDialog
          user={selectedUser}
          token={token}
          onClose={() => setSelectedUser(null)}
          onUpdate={() => { refetch(); setSelectedUser(null); }}
        />
      )}
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
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 flex items-start gap-2">
        <Info className="h-4 w-4 mt-0.5 flex-shrink-0 text-blue-600" />
        <span>All hedge events and positions are stored on <strong>Lisk Mainnet</strong> — they are permanent on-chain records. Resetting the platform database does not affect this data.</span>
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
                    <th className="text-left p-3 font-medium">Token</th>
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
                      <td className="p-3"><TokenBadge address={e.paymentToken} /></td>
                      <td className="p-3">
                        <Badge variant={e.status === "open" ? "default" : e.status === "settled" ? "secondary" : "outline"} className="text-xs capitalize">{e.status}</Badge>
                      </td>
                      <td className="p-3 text-xs text-gray-500 hidden md:table-cell">{new Date(e.expiryDate).toLocaleDateString()}</td>
                      <td className="p-3 hidden md:table-cell">{e.triggered ? <CheckCircle className="h-4 w-4 text-red-500" /> : <span className="text-gray-300">-</span>}</td>
                    </tr>
                  ))}
                  {events.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-gray-400">No hedge events</td></tr>}
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
  const [feeConfig, setFeeConfig] = useState<HedgeFeeConfig | null>(null);
  const [feeLoading, setFeeLoading] = useState(true);
  const [feeError, setFeeError] = useState(false);

  const loadFeeConfig = async () => {
    setFeeLoading(true);
    setFeeError(false);
    try {
      const config = await hedgeContract.getFeeConfig();
      setFeeConfig(config);
    } catch {
      setFeeError(true);
    } finally {
      setFeeLoading(false);
    }
  };

  useEffect(() => { loadFeeConfig(); }, []);

  if (isLoading) return <LoadingSkeleton />;
  const r = (data as any) || {};

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Revenue & Fees</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Live on-chain data · Last updated {revenueUpdatedAt ? new Date(revenueUpdatedAt).toLocaleTimeString() : '—'}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { refetchRevenue(); loadFeeConfig(); }} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 flex items-start gap-2">
        <Info className="h-4 w-4 mt-0.5 flex-shrink-0 text-blue-600" />
        <span>Revenue figures are read directly from the <strong>Lisk Mainnet</strong> Diamond contract — these are permanent on-chain records. Resetting the platform database does not affect this data.</span>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-blue-600" />
            <CardTitle className="text-base">On-Chain Fee Configuration</CardTitle>
            <Badge variant="outline" className="text-xs ml-auto">Live from contract</Badge>
          </div>
          <CardDescription>Current fee rates set in the Diamond contract. Change these by running the admin script.</CardDescription>
        </CardHeader>
        <CardContent>
          {feeLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 animate-pulse">
              {[...Array(5)].map((_, i) => <div key={i} className="h-14 bg-gray-100 rounded-lg" />)}
            </div>
          ) : feeError ? (
            <div className="flex items-center gap-2 text-sm text-red-500 py-2">
              <AlertTriangle className="h-4 w-4" />
              Could not load fee config from chain. Check RPC connection.
            </div>
          ) : feeConfig ? (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="rounded-lg border bg-amber-50 border-amber-200 px-3 py-2 text-center">
                <div className="text-xs text-amber-700 font-medium mb-0.5">Creation Fee</div>
                <div className="text-xl font-bold text-amber-800">${feeConfig.creationFee.toFixed(2)}</div>
                <div className="text-xs text-amber-600 mt-0.5">per event</div>
              </div>
              <div className="rounded-lg border bg-blue-50 border-blue-200 px-3 py-2 text-center">
                <div className="text-xs text-blue-700 font-medium mb-0.5">Hedger Fee</div>
                <div className="text-xl font-bold text-blue-800">{(feeConfig.hedgerFeeRate * 100).toFixed(2)}%</div>
                <div className="text-xs text-blue-600 mt-0.5">on premium</div>
              </div>
              <div className="rounded-lg border bg-purple-50 border-purple-200 px-3 py-2 text-center">
                <div className="text-xs text-purple-700 font-medium mb-0.5">Payout Fee</div>
                <div className="text-xl font-bold text-purple-800">{(feeConfig.hedgerPayoutFeeRate * 100).toFixed(2)}%</div>
                <div className="text-xs text-purple-600 mt-0.5">on payout</div>
              </div>
              <div className="rounded-lg border bg-green-50 border-green-200 px-3 py-2 text-center">
                <div className="text-xs text-green-700 font-medium mb-0.5">LP Profit Fee</div>
                <div className="text-xl font-bold text-green-800">{(feeConfig.lpProfitFeeRate * 100).toFixed(2)}%</div>
                <div className="text-xs text-green-600 mt-0.5">on LP profit</div>
              </div>
              <div className="rounded-lg border bg-orange-50 border-orange-200 px-3 py-2 text-center">
                <div className="text-xs text-orange-700 font-medium mb-0.5">Creator Loyalty</div>
                <div className="text-xl font-bold text-orange-800">{(feeConfig.creatorLoyaltyRate * 100).toFixed(2)}%</div>
                <div className="text-xs text-orange-600 mt-0.5">rebate to creator</div>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

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
            <CardDescription>Distribution across asset pairs</CardDescription>
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

const CATEGORIES = ["Hedging", "Payments", "Education", "Earning"];

const EMPTY_ARTICLE = { title: "", subtitle: "", slug: "", category: "Hedging", readTime: "5 min read", published: true, body: "" };

function bodyToBlocks(body: string): Array<{ type: string; content?: string; items?: string[] }> {
  const blocks: Array<{ type: string; content?: string; items?: string[] }> = [];
  const lines = body.split("\n");
  let listItems: string[] = [];
  const flushList = () => { if (listItems.length) { blocks.push({ type: "list", items: [...listItems] }); listItems = []; } };
  for (const line of lines) {
    const t = line.trim();
    if (!t) { flushList(); continue; }
    if (t.startsWith("## ")) { flushList(); blocks.push({ type: "heading", content: t.slice(3) }); }
    else if (t.startsWith("### ")) { flushList(); blocks.push({ type: "subheading", content: t.slice(4) }); }
    else if (t.startsWith("> ")) { flushList(); blocks.push({ type: "callout", content: t.slice(2) }); }
    else if (t.startsWith("- ")) { listItems.push(t.slice(2)); }
    else { flushList(); blocks.push({ type: "text", content: t }); }
  }
  flushList();
  return blocks;
}

function blocksToBody(blocks: Array<{ type: string; content?: string; items?: string[] }>): string {
  return (blocks || []).map(b => {
    if (b.type === "heading") return `## ${b.content}`;
    if (b.type === "subheading") return `### ${b.content}`;
    if (b.type === "callout") return `> ${b.content}`;
    if (b.type === "list") return (b.items || []).map(i => `- ${i}`).join("\n");
    return b.content || "";
  }).join("\n\n");
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ─── Protocol / Owner Functions ─────────────────────────────────────────────

const DIAMOND = "0x3eDfA00a1E3C158A591097de2FA1756aCD66860D";
const SAFE_ADDR = "0xfce89FA90Ee1C78B15eE0f12f62B03153814699D";
const USDC_MAINNET = "0xF242275d3a6527d877f2c927a82D9b057609cc71";
const USDT_MAINNET = "0x05D032ac25d322df992303dCa074EE7392C117b9";
const LISK_CHAIN_ID = 1135;
const LISK_HEX = "0x46F";
const LISK_RPC = "https://rpc.api.lisk.com";

const SAFE_ABI = [
  "function nonce() view returns (uint256)",
  "function getThreshold() view returns (uint256)",
  "function getOwners() view returns (address[])",
  "function execTransaction(address to, uint256 value, bytes calldata data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes memory signatures) payable returns (bool)",
];

const OWNER_ABI = [
  "function owner() view returns (address)",
  "function getHedgeFeeConfig() view returns (uint256,uint256,uint256,uint256,uint256)",
  "function getHedgePlatformFees() view returns (uint256)",
  "function getPlatformFeesByToken(address) view returns (uint256)",
  "function isAllowedPaymentToken(address) view returns (bool)",
  "function withdrawPlatformFees(uint256)",
  "function withdrawPlatformFeesByToken(address,uint256)",
  "function initializeHedgeFees(uint256,uint256,uint256,uint256,uint256)",
  "function addOracle(address)",
  "function removeOracle(address)",
  "function setOracleAdmin(address)",
  "function setAllowedPaymentToken(address,bool)",
];

async function ensureLisk() {
  const eth = (window as any).ethereum;
  if (!eth) throw new Error("MetaMask not found.");
  await eth.request({ method: "eth_requestAccounts" });
  const chainId = parseInt(await eth.request({ method: "eth_chainId" }), 16);
  if (chainId !== LISK_CHAIN_ID) {
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: LISK_HEX }] });
    } catch {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [{ chainId: LISK_HEX, chainName: "Lisk", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: [LISK_RPC], blockExplorerUrls: ["https://blockscout.lisk.com"] }],
      });
    }
  }
  const { ethers } = await import("ethers");
  const provider = new ethers.BrowserProvider(eth);
  const signer = await provider.getSigner();
  const contract = new ethers.Contract(DIAMOND, OWNER_ABI, signer);
  return { ethers, signer, contract, provider };
}

async function readContract() {
  const { ethers } = await import("ethers");
  const provider = new ethers.JsonRpcProvider(LISK_RPC);
  return new ethers.Contract(DIAMOND, OWNER_ABI, provider);
}

function fmtUSDC(raw: bigint) {
  return (Number(raw) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

const BLOCKSCOUT_API = "https://blockscout.lisk.com/api";

async function fetchTotalWithdrawn(tokenAddress: string): Promise<number> {
  try {
    const url = `${BLOCKSCOUT_API}?module=account&action=tokentx&address=${DIAMOND}&contractaddress=${tokenAddress}&sort=asc`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data.result || !Array.isArray(data.result)) return 0;
    // Sum transfers where Diamond is the sender (outflows = withdrawals)
    return data.result
      .filter((tx: any) => tx.from?.toLowerCase() === DIAMOND.toLowerCase())
      .reduce((sum: number, tx: any) => sum + Number(tx.value) / 1e6, 0);
  } catch {
    return 0;
  }
}

interface ProtocolState {
  usdcFees: string;
  usdtFees: string;
  usdcWithdrawn: number;
  usdtWithdrawn: number;
  feeConfig: { creationFee: string; hedgerFeeRate: string; hedgerPayoutFeeRate: string; lpProfitFeeRate: string; creatorLoyaltyRate: string } | null;
  usdcAllowed: boolean;
  usdtAllowed: boolean;
  wallet: string;
  diamondOwner: string;
  loading: boolean;
}

function ProtocolSection() {
  const { toast } = useToast();
  const { token } = useAdminToken();
  const [backupBusy, setBackupBusy] = useState(false);
  const [oracleNodes, setOracleNodes] = useState<{ label: string; address: string | null; configured: boolean }[]>([]);

  useEffect(() => {
    adminFetch("/api/admin/oracle-addresses", token)
      .then(r => r.json())
      .then(setOracleNodes)
      .catch(() => {});
  }, [token]);

  const [state, setState] = useState<ProtocolState>({
    usdcFees: "—", usdtFees: "—", usdcWithdrawn: 0, usdtWithdrawn: 0,
    feeConfig: null, usdcAllowed: true, usdtAllowed: false,
    wallet: "", diamondOwner: "", loading: true,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [oracleInput, setOracleInput] = useState("");
  const [feeForm, setFeeForm] = useState({ creationFee: "", hedgerFeeRate: "", hedgerPayoutFeeRate: "", lpProfitFeeRate: "", creatorLoyaltyRate: "" });
  const [feeFormOpen, setFeeFormOpen] = useState(false);
  const [safeTxModal, setSafeTxModal] = useState<{ to: string; data: string; label: string } | null>(null);
  const [safeExecuting, setSafeExecuting] = useState(false);

  const load = async () => {
    setState(s => ({ ...s, loading: true }));
    try {
      const c = await readContract();
      const { ethers } = await import("ethers");
      const [rawUsdc, rawUsdt, rawFees, usdcAllowed, usdtAllowed, usdcWithdrawn, usdtWithdrawn, diamondOwner] = await Promise.all([
        c.getHedgePlatformFees().catch(() => 0n),
        c.getPlatformFeesByToken(USDT_MAINNET).catch(() => 0n),
        c.getHedgeFeeConfig().catch(() => null),
        c.isAllowedPaymentToken(USDC_MAINNET).catch(() => true),
        c.isAllowedPaymentToken(USDT_MAINNET).catch(() => false),
        fetchTotalWithdrawn(USDC_MAINNET),
        fetchTotalWithdrawn(USDT_MAINNET),
        c.owner().catch(() => ""),
      ]);
      const feeConfig = rawFees ? {
        creationFee: (Number(rawFees[0]) / 1e6).toFixed(2),
        hedgerFeeRate: (Number(ethers.formatUnits(rawFees[1], 6)) * 100).toFixed(4),
        hedgerPayoutFeeRate: (Number(ethers.formatUnits(rawFees[2], 6)) * 100).toFixed(4),
        lpProfitFeeRate: (Number(ethers.formatUnits(rawFees[3], 6)) * 100).toFixed(4),
        creatorLoyaltyRate: (Number(ethers.formatUnits(rawFees[4], 6)) * 100).toFixed(4),
      } : null;
      if (feeConfig) setFeeForm({ creationFee: feeConfig.creationFee, hedgerFeeRate: feeConfig.hedgerFeeRate, hedgerPayoutFeeRate: feeConfig.hedgerPayoutFeeRate, lpProfitFeeRate: feeConfig.lpProfitFeeRate, creatorLoyaltyRate: feeConfig.creatorLoyaltyRate });

      const eth = (window as any).ethereum;
      let wallet = "";
      if (eth) {
        const accounts: string[] = await eth.request({ method: "eth_accounts" });
        wallet = accounts[0] || "";
      }
      setState(s => ({ ...s, usdcFees: fmtUSDC(BigInt(rawUsdc)), usdtFees: fmtUSDC(BigInt(rawUsdt)), usdcWithdrawn, usdtWithdrawn, feeConfig, usdcAllowed, usdtAllowed, wallet, diamondOwner: (diamondOwner as string).toLowerCase(), loading: false }));
    } catch (e: any) {
      setState(s => ({ ...s, loading: false }));
      toast({ title: "Failed to load contract state", description: e.message, variant: "destructive" });
    }
  };

  useEffect(() => { load(); }, []);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
      toast({ title: `${label} — done` });
      await load();
    } catch (e: any) {
      toast({ title: `${label} failed`, description: e.message || String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const withdrawUsdc = () => run("Withdraw USDC fees", async () => {
    const { ethers, contract } = await ensureLisk();
    const raw = await contract.getHedgePlatformFees();
    if (BigInt(raw) === 0n) throw new Error("No USDC fees to withdraw.");
    const tx = await contract.withdrawPlatformFees(raw);
    await tx.wait();
  });

  const withdrawUsdt = () => run("Withdraw USDT fees", async () => {
    const { contract } = await ensureLisk();
    const raw = await contract.getPlatformFeesByToken(USDT_MAINNET);
    if (BigInt(raw) === 0n) throw new Error("No USDT fees to withdraw.");
    const tx = await contract.withdrawPlatformFeesByToken(USDT_MAINNET, raw);
    await tx.wait();
  });

  const updateFees = () => run("Update fee config (direct EOA)", async () => {
    const { ethers, contract, signer } = await ensureLisk();
    const signerAddr = (await signer.getAddress()).toLowerCase();
    const onChainOwner = (await contract.owner().catch(() => "")).toLowerCase();
    if (onChainOwner && signerAddr !== onChainOwner) {
      throw new Error(`Wrong wallet — Diamond owner is ${onChainOwner} but MetaMask is using ${signerAddr}. Use "Send via Safe" instead.`);
    }
    const p = (pct: string) => ethers.parseUnits((parseFloat(pct) / 100).toFixed(8), 6);
    const tx = await contract.initializeHedgeFees(
      ethers.parseUnits(feeForm.creationFee, 6),
      p(feeForm.hedgerFeeRate),
      p(feeForm.hedgerPayoutFeeRate),
      p(feeForm.lpProfitFeeRate),
      p(feeForm.creatorLoyaltyRate),
    );
    await tx.wait();
    setFeeFormOpen(false);
  });

  const genSafeFeeTx = async () => {
    try {
      const { ethers } = await import("ethers");
      const iface = new ethers.Interface(OWNER_ABI);
      const p = (pct: string) => ethers.parseUnits((parseFloat(pct) / 100).toFixed(8), 6);
      const calldata = iface.encodeFunctionData("initializeHedgeFees", [
        ethers.parseUnits(feeForm.creationFee || "0", 6),
        p(feeForm.hedgerFeeRate || "0"),
        p(feeForm.hedgerPayoutFeeRate || "0"),
        p(feeForm.lpProfitFeeRate || "0"),
        p(feeForm.creatorLoyaltyRate || "0"),
      ]);
      setSafeTxModal({ to: DIAMOND, data: calldata, label: "Update Fee Parameters" });
    } catch (e: any) {
      toast({ title: "Failed to encode calldata", description: e.message, variant: "destructive" });
    }
  };

  const genSafeOracleTx = async (address: string) => {
    try {
      const { ethers } = await import("ethers");
      const iface = new ethers.Interface(OWNER_ABI);
      const calldata = iface.encodeFunctionData("addOracle", [address]);
      setSafeTxModal({ to: DIAMOND, data: calldata, label: `Add Oracle ${shortAddr(address)}` });
    } catch (e: any) {
      toast({ title: "Failed to encode calldata", description: e.message, variant: "destructive" });
    }
  };

  const signAndExecSafe = async (to: string, data: string) => {
    setSafeExecuting(true);
    try {
      await ensureLisk();
      const { ethers } = await import("ethers");
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const signerAddr = (await signer.getAddress()).toLowerCase();

      const safe = new ethers.Contract(SAFE_ADDR, SAFE_ABI, provider);
      const [nonce, threshold, owners]: [bigint, bigint, string[]] = await Promise.all([
        safe.nonce(),
        safe.getThreshold(),
        safe.getOwners(),
      ]);

      const ownerList: string[] = (owners as string[]).map((o: string) => o.toLowerCase());
      if (!ownerList.includes(signerAddr)) {
        throw new Error(`Connected wallet (${signerAddr}) is not a Safe owner. Safe owners: ${ownerList.join(", ")}`);
      }

      // EIP-712 sign the Safe transaction
      const domain = { chainId: LISK_CHAIN_ID, verifyingContract: SAFE_ADDR };
      const types = {
        SafeTx: [
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "data", type: "bytes" },
          { name: "operation", type: "uint8" },
          { name: "safeTxGas", type: "uint256" },
          { name: "baseGas", type: "uint256" },
          { name: "gasPrice", type: "uint256" },
          { name: "gasToken", type: "address" },
          { name: "refundReceiver", type: "address" },
          { name: "nonce", type: "uint256" },
        ],
      };
      const message = {
        to,
        value: BigInt(0),
        data,
        operation: 0,
        safeTxGas: BigInt(0),
        baseGas: BigInt(0),
        gasPrice: BigInt(0),
        gasToken: ethers.ZeroAddress,
        refundReceiver: ethers.ZeroAddress,
        nonce,
      };

      const signature = await signer.signTypedData(domain, types, message);

      if (Number(threshold) > 1) {
        toast({
          title: `Signed — needs ${threshold} signatures total`,
          description: `This Safe requires ${threshold} confirmations. Collect other owner signatures to execute.`,
        });
        setSafeExecuting(false);
        return;
      }

      // Threshold = 1 — execute immediately
      const safeWithSigner = new ethers.Contract(SAFE_ADDR, SAFE_ABI, signer);
      const tx = await (safeWithSigner as any).execTransaction(
        to, BigInt(0), data, 0, BigInt(0), BigInt(0), BigInt(0),
        ethers.ZeroAddress, ethers.ZeroAddress,
        signature,
      );
      await tx.wait();
      toast({ title: "Transaction executed successfully via Safe" });
      setSafeTxModal(null);
      await load();
    } catch (e: any) {
      toast({ title: "Safe execution failed", description: e.message || String(e), variant: "destructive" });
    } finally {
      setSafeExecuting(false);
    }
  };

  const setOracle = () => run("Add oracle", async () => {
    if (!oracleInput.startsWith("0x") || oracleInput.length !== 42) throw new Error("Invalid address.");
    const { contract } = await ensureLisk();
    const tx = await contract.addOracle(oracleInput);
    await tx.wait();
    setOracleInput("");
  });

  const toggleToken = (token: string, enable: boolean, label: string) => run(`${enable ? "Enable" : "Disable"} ${label}`, async () => {
    const { contract } = await ensureLisk();
    const tx = await contract.setAllowedPaymentToken(token, enable);
    await tx.wait();
  });

  const connectedLabel = state.wallet ? shortAddr(state.wallet) : "Not connected";
  const ownerLabel = state.diamondOwner ? shortAddr(state.diamondOwner) : "—";
  const walletIsOwner = state.wallet && state.diamondOwner
    ? state.wallet.toLowerCase() === state.diamondOwner.toLowerCase()
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Protocol Controls</h2>
          <p className="text-sm text-gray-500 mt-0.5">On-chain owner functions — each action sends a transaction via MetaMask</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={state.loading}>
            <RefreshCw className={`h-3 w-3 mr-1 ${state.loading ? "animate-spin" : ""}`} />Refresh
          </Button>
        </div>
      </div>

      {/* Owner wallet check */}
      <div className={`rounded-lg border p-3 text-sm flex items-start gap-3 ${walletIsOwner === false ? "border-red-200 bg-red-50" : walletIsOwner === true ? "border-green-200 bg-green-50" : "border-gray-200 bg-gray-50"}`}>
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-gray-500">Diamond owner: <span className="font-mono font-medium text-gray-800">{state.diamondOwner || "loading…"}</span></span>
            <span className="text-gray-400">|</span>
            <span className="text-gray-500">Your wallet: <span className="font-mono font-medium text-gray-800">{state.wallet || "not connected"}</span></span>
          </div>
          {walletIsOwner === false && (
            <p className="text-red-700 font-medium flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
              Wrong wallet — MetaMask is connected to <span className="font-mono">{connectedLabel}</span> but the Diamond owner is <span className="font-mono">{ownerLabel}</span>. Switch MetaMask to the owner wallet before sending any transaction.
            </p>
          )}
          {walletIsOwner === true && (
            <p className="text-green-700 font-medium">Wallet matches contract owner — ready to sign transactions.</p>
          )}
        </div>
      </div>

      {/* Database Backup */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Download className="h-4 w-4 text-[#1a4480]" />Database Backup
          </CardTitle>
          <CardDescription>Download a full snapshot of all platform data — users, positions, fees, articles, referrals. Private keys are never included.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
            <div>
              <p className="text-sm font-medium text-gray-700">Full data export</p>
              <p className="text-xs text-gray-500 mt-0.5">13 tables · JSON format · timestamped filename</p>
            </div>
            <Button
              size="sm"
              disabled={backupBusy}
              className="bg-[#1a4480] hover:bg-[#153a6e] text-white"
              onClick={async () => {
                setBackupBusy(true);
                try {
                  const res = await adminFetch("/api/admin/backup/export", token);
                  if (!res.ok) { toast({ title: "Backup failed", variant: "destructive" }); return; }
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `blockfinax-backup-${new Date().toISOString().slice(0, 10)}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                  toast({ title: "Backup downloaded" });
                } catch {
                  toast({ title: "Backup failed", variant: "destructive" });
                } finally {
                  setBackupBusy(false);
                }
              }}
            >
              <Download className={`h-3 w-3 mr-1 ${backupBusy ? "animate-bounce" : ""}`} />
              {backupBusy ? "Exporting…" : "Download Backup"}
            </Button>
          </div>
          <p className="text-xs text-amber-600 mt-3 flex items-start gap-1.5">
            <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
            Also enable automatic backups in your Railway dashboard under the database service settings for daily scheduled snapshots.
          </p>
        </CardContent>
      </Card>

      {/* Fee Balances & Withdraw */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-[#1a4480]" />Platform Fee Balances
          </CardTitle>
          <CardDescription>On-chain fee balances and all-time withdrawal history from the Diamond contract</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Summary bar */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Total Earned (USDC)", value: `$${(state.usdcWithdrawn + parseFloat(state.usdcFees === "—" ? "0" : state.usdcFees)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color: "text-[#1a4480]" },
              { label: "Total Withdrawn (USDC)", value: `$${state.usdcWithdrawn.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color: "text-green-700" },
              { label: "Pending in Contract", value: `$${state.usdcFees === "—" ? "—" : state.usdcFees}`, color: "text-orange-600" },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded-lg bg-gray-50 p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">{label}</p>
                <p className={`text-lg font-bold ${color}`}>{value}</p>
              </div>
            ))}
          </div>

          {/* Token cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* USDC */}
            <div className="rounded-lg border border-gray-200 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">USDC — Pending</p>
                  <p className="text-2xl font-bold text-gray-900">{state.usdcFees === "—" ? "—" : `$${state.usdcFees}`}</p>
                </div>
                <span className="text-xs font-medium bg-blue-50 text-blue-700 px-2 py-0.5 rounded">USDC</span>
              </div>
              <div className="flex items-center justify-between text-xs text-gray-500 border-t pt-2">
                <span>All-time withdrawn</span>
                <span className="font-semibold text-green-700">${state.usdcWithdrawn.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <Button size="sm" className="w-full bg-[#1a4480] hover:bg-[#153a6e]" onClick={withdrawUsdc} disabled={busy !== null || state.usdcFees === "0.00" || state.usdcFees === "—"}>
                {busy === "Withdraw USDC fees" ? "Sending…" : "Withdraw USDC to wallet"}
              </Button>
            </div>

            {/* USDT */}
            <div className="rounded-lg border border-gray-200 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">USDT — Pending</p>
                  <p className="text-2xl font-bold text-gray-900">{state.usdtFees === "—" ? "—" : `$${state.usdtFees}`}</p>
                </div>
                <span className="text-xs font-medium bg-green-50 text-green-700 px-2 py-0.5 rounded">USDT</span>
              </div>
              <div className="flex items-center justify-between text-xs text-gray-500 border-t pt-2">
                <span>All-time withdrawn</span>
                <span className="font-semibold text-green-700">${state.usdtWithdrawn.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <Button size="sm" className="w-full bg-[#1a4480] hover:bg-[#153a6e]" onClick={withdrawUsdt} disabled={busy !== null || state.usdtFees === "0.00" || state.usdtFees === "—"}>
                {busy === "Withdraw USDT fees" ? "Sending…" : "Withdraw USDT to wallet"}
              </Button>
            </div>
          </div>

          <p className="text-xs text-gray-400 flex items-center gap-1">
            <CheckCircle className="h-3 w-3" />Funds go to your connected wallet ({connectedLabel}). "All-time withdrawn" is sourced from on-chain token transfer history.
          </p>
        </CardContent>
      </Card>

      {/* Fee Parameters */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Settings className="h-4 w-4 text-[#1a4480]" />Fee Parameters
              </CardTitle>
              <CardDescription>Current on-chain fee rates — all values shown as percentages</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => setFeeFormOpen(!feeFormOpen)}>
              {feeFormOpen ? <X className="h-3 w-3 mr-1" /> : <Pencil className="h-3 w-3 mr-1" />}
              {feeFormOpen ? "Cancel" : "Edit"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {state.feeConfig ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  { label: "Event creation fee", value: `$${state.feeConfig.creationFee} USDC`, sub: "flat" },
                  { label: "Hedger fee rate", value: `${state.feeConfig.hedgerFeeRate}%`, sub: "on premium" },
                  { label: "Hedger payout fee", value: `${state.feeConfig.hedgerPayoutFeeRate}%`, sub: "on payout" },
                  { label: "LP profit fee", value: `${state.feeConfig.lpProfitFeeRate}%`, sub: "on LP earnings" },
                  { label: "Creator loyalty", value: `${state.feeConfig.creatorLoyaltyRate}%`, sub: "rebate" },
                ].map(({ label, value, sub }) => (
                  <div key={label} className="rounded-lg bg-gray-50 p-3">
                    <p className="text-xs text-gray-500">{label}</p>
                    <p className="font-semibold text-gray-900">{value}</p>
                    <p className="text-xs text-gray-400">{sub}</p>
                  </div>
                ))}
              </div>

              {feeFormOpen && (
                <div className="border-t pt-4 space-y-3">
                  <p className="text-sm font-medium text-gray-700">Update fee parameters</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Creation fee (USDC flat amount)</Label>
                      <Input type="number" step="0.01" value={feeForm.creationFee} onChange={e => setFeeForm(f => ({ ...f, creationFee: e.target.value }))} placeholder="e.g. 5.00" className="mt-1" />
                    </div>
                    <div>
                      <Label className="text-xs">Hedger fee rate (%)</Label>
                      <Input type="number" step="0.001" value={feeForm.hedgerFeeRate} onChange={e => setFeeForm(f => ({ ...f, hedgerFeeRate: e.target.value }))} placeholder="e.g. 1.00" className="mt-1" />
                    </div>
                    <div>
                      <Label className="text-xs">Hedger payout fee (%)</Label>
                      <Input type="number" step="0.001" value={feeForm.hedgerPayoutFeeRate} onChange={e => setFeeForm(f => ({ ...f, hedgerPayoutFeeRate: e.target.value }))} placeholder="e.g. 0.5000" className="mt-1" />
                    </div>
                    <div>
                      <Label className="text-xs">LP profit fee (%)</Label>
                      <Input type="number" step="0.001" value={feeForm.lpProfitFeeRate} onChange={e => setFeeForm(f => ({ ...f, lpProfitFeeRate: e.target.value }))} placeholder="e.g. 2.00" className="mt-1" />
                    </div>
                    <div>
                      <Label className="text-xs">Creator loyalty rebate (%)</Label>
                      <Input type="number" step="0.001" value={feeForm.creatorLoyaltyRate} onChange={e => setFeeForm(f => ({ ...f, creatorLoyaltyRate: e.target.value }))} placeholder="e.g. 0.5000" className="mt-1" />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button className="bg-[#1a4480] hover:bg-[#153a6e]" onClick={genSafeFeeTx}>
                      Send via Safe
                    </Button>
                    <Button variant="outline" onClick={updateFees} disabled={busy !== null || walletIsOwner !== true} title={walletIsOwner !== true ? "Only works when your EOA is the Diamond owner" : ""}>
                      {busy === "Update fee config (direct EOA)" ? "Sending tx…" : "Send direct (EOA only)"}
                    </Button>
                  </div>
                  {walletIsOwner !== true && (
                    <p className="text-xs text-amber-700 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      Diamond owner is a Safe — use "Send via Safe" to generate the transaction.
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-400">{state.loading ? "Loading…" : "Could not read fee config from contract."}</p>
          )}
        </CardContent>
      </Card>

      {/* Oracle Admin */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4 text-[#1a4480]" />Oracle Node Registration
          </CardTitle>
          <CardDescription>Register each oracle node wallet on the Diamond contract. Each requires a MetaMask transaction signed by the contract owner.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Auto-detected node addresses */}
          {oracleNodes.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Detected oracle node wallets</p>
              {oracleNodes.map((node) => (
                <div key={node.label} className="flex items-center gap-3 p-2.5 bg-gray-50 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-700">{node.label}</p>
                    {node.configured && node.address ? (
                      <p className="text-xs font-mono text-gray-500 truncate">{node.address}</p>
                    ) : (
                      <p className="text-xs text-amber-600">Key not configured in environment</p>
                    )}
                  </div>
                  {node.configured && node.address && (
                    <div className="flex gap-1.5">
                      <Button
                        size="sm"
                        className="shrink-0 text-xs bg-[#1a4480] hover:bg-[#153a6e] text-white"
                        onClick={() => genSafeOracleTx(node.address!)}
                      >
                        Via Safe
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0 text-xs"
                        disabled={busy !== null || walletIsOwner !== true}
                        onClick={() => {
                          setOracleInput(node.address!);
                          setTimeout(() => setOracle(), 50);
                        }}
                      >
                        Direct
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Manual override */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Or enter address manually</p>
            <div className="flex items-center gap-3">
              <Input
                placeholder="Oracle wallet address (0x…)"
                value={oracleInput}
                onChange={e => setOracleInput(e.target.value)}
                className="font-mono text-sm"
              />
              <Button className="shrink-0 bg-[#1a4480] hover:bg-[#153a6e]" onClick={setOracle} disabled={busy !== null || !oracleInput}>
                {busy === "Add oracle" ? "Sending…" : "Add Oracle"}
              </Button>
            </div>
          </div>
          <p className="text-xs text-gray-400">Uses addOracle() — supports multiple oracle nodes. Already-registered nodes are skipped automatically on startup.</p>
        </CardContent>
      </Card>

      {/* Payment Tokens */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Layers className="h-4 w-4 text-[#1a4480]" />Allowed Payment Tokens
          </CardTitle>
          <CardDescription>Toggle which ERC-20 tokens users can use to buy protection and provide liquidity</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { label: "USDC", address: USDC_MAINNET, allowed: state.usdcAllowed },
              { label: "USDT", address: USDT_MAINNET, allowed: state.usdtAllowed },
            ].map(({ label, address, allowed }) => (
              <div key={address} className="flex items-center justify-between rounded-lg border border-gray-200 p-3">
                <div>
                  <p className="font-medium text-sm">{label}</p>
                  <p className="text-xs text-gray-400 font-mono">{shortAddr(address)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded ${allowed ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                    {allowed ? "Enabled" : "Disabled"}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => toggleToken(address, !allowed, label)}
                    disabled={busy !== null}
                  >
                    {busy === `${!allowed ? "Enable" : "Disable"} ${label}` ? "Sending…" : allowed ? "Disable" : "Enable"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-lg bg-gray-50 p-3">
            <p className="text-xs text-gray-500 font-medium mb-1">Contract &amp; Safe addresses</p>
            <div className="space-y-1">
              {[
                ["Diamond", DIAMOND],
                ["Safe (treasury)", SAFE_ADDR],
              ].map(([label, addr]) => (
                <div key={addr} className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">{label}</span>
                  <a href={`https://blockscout.lisk.com/address/${addr}`} target="_blank" rel="noopener noreferrer" className="font-mono text-[#1a4480] hover:underline flex items-center gap-1">
                    {shortAddr(addr)}<ExternalLink className="h-2.5 w-2.5" />
                  </a>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Safe Transaction Modal */}
      <Dialog open={safeTxModal !== null} onOpenChange={() => setSafeTxModal(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-[#1a4480]" />
              Safe Transaction — {safeTxModal?.label}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-green-900 text-xs leading-relaxed">
              <strong>Sign &amp; execute directly — no Safe web UI needed.</strong>
              <p className="mt-1 text-green-800">Connect the MetaMask wallet that is a Safe owner, then click <strong>Sign &amp; Execute</strong>. MetaMask will ask you to sign the transaction — no browser extension or Safe app required. If your Safe needs only 1 signature it executes immediately.</p>
            </div>

            <div className="space-y-3">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Safe contract</p>
                <div className="flex items-center gap-2 bg-gray-50 rounded-lg border p-2.5">
                  <code className="text-xs font-mono flex-1 text-gray-800">{SAFE_ADDR}</code>
                  <a href={`https://blockscout.lisk.com/address/${SAFE_ADDR}`} target="_blank" rel="noopener noreferrer" className="shrink-0">
                    <Button size="sm" variant="ghost" className="h-7 text-xs px-2"><ExternalLink className="h-3 w-3" /></Button>
                  </a>
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Target (Diamond)</p>
                <div className="flex items-center gap-2 bg-gray-50 rounded-lg border p-2.5">
                  <code className="text-xs font-mono flex-1 break-all text-gray-800">{safeTxModal?.to}</code>
                  <Button size="sm" variant="outline" className="shrink-0 h-7 text-xs" onClick={() => { navigator.clipboard.writeText(safeTxModal?.to || ""); toast({ title: "Copied" }); }}>
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Calldata</p>
                <div className="flex items-start gap-2 bg-gray-50 rounded-lg border p-2.5">
                  <code className="text-xs font-mono flex-1 break-all text-gray-500 leading-relaxed line-clamp-3">{safeTxModal?.data}</code>
                  <Button size="sm" variant="outline" className="shrink-0 h-7 text-xs" onClick={() => { navigator.clipboard.writeText(safeTxModal?.data || ""); toast({ title: "Calldata copied" }); }}>
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="outline" onClick={() => setSafeTxModal(null)} disabled={safeExecuting}>Cancel</Button>
              <Button
                className="bg-[#1a4480] hover:bg-[#153a6e]"
                disabled={safeExecuting}
                onClick={() => safeTxModal && signAndExecSafe(safeTxModal.to, safeTxModal.data)}
              >
                {safeExecuting ? (
                  <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />Signing…</>
                ) : (
                  <><Shield className="h-3.5 w-3.5 mr-1.5" />Sign &amp; Execute</>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ContentSection() {
  const { token } = useAdminToken();
  const { toast } = useToast();
  const { data: articles, isLoading, refetch } = useQuery({
    queryKey: ["/api/admin/articles"],
    queryFn: () => adminFetch("/api/admin/articles", token).then(r => r.json()),
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY_ARTICLE });
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const openCreate = () => { setEditingId(null); setForm({ ...EMPTY_ARTICLE }); setDialogOpen(true); };
  const openEdit = (a: any) => {
    setEditingId(a.id);
    setForm({ title: a.title, subtitle: a.subtitle || "", slug: a.slug, category: a.category, readTime: a.readTime || "5 min read", published: a.published, body: blocksToBody(a.content) });
    setDialogOpen(true);
  };

  const saveArticle = useMutation({
    mutationFn: async () => {
      const payload = { ...form, content: bodyToBlocks(form.body), slug: form.slug || slugify(form.title) };
      const url = editingId ? `/api/admin/articles/${editingId}` : "/api/admin/articles";
      const method = editingId ? "PATCH" : "POST";
      const res = await adminFetch(url, token, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.message || "Failed to save"); }
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/articles"] }); toast({ title: editingId ? "Article updated" : "Article published" }); setDialogOpen(false); refetch(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteArticle = useMutation({
    mutationFn: async (id: number) => {
      const res = await adminFetch(`/api/admin/articles/${id}`, token, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/articles"] }); toast({ title: "Article deleted" }); setDeleteId(null); refetch(); },
    onError: () => toast({ title: "Error deleting article", variant: "destructive" }),
  });

  const togglePublished = useMutation({
    mutationFn: async ({ id, published }: { id: number; published: boolean }) => {
      const res = await adminFetch(`/api/admin/articles/${id}`, token, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ published }) });
      if (!res.ok) throw new Error("Failed to update");
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/articles"] }); refetch(); },
  });

  if (isLoading) return <LoadingSkeleton />;
  const list = (articles as any[] || []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Content</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{list.length} article{list.length !== 1 ? "s" : ""} total</p>
        </div>
        <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> New Article</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="text-left p-3 font-medium">Title</th>
                  <th className="text-left p-3 font-medium hidden sm:table-cell">Category</th>
                  <th className="text-left p-3 font-medium hidden md:table-cell">Read time</th>
                  <th className="text-left p-3 font-medium">Status</th>
                  <th className="p-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.map((a: any) => (
                  <tr key={a.id} className="border-b hover:bg-gray-50">
                    <td className="p-3">
                      <div className="font-medium">{a.title}</div>
                      <div className="text-xs text-gray-400 mt-0.5 hidden sm:block font-mono">{a.slug}</div>
                    </td>
                    <td className="p-3 hidden sm:table-cell"><Badge variant="outline" className="text-xs">{a.category}</Badge></td>
                    <td className="p-3 hidden md:table-cell text-gray-500 text-xs">{a.readTime}</td>
                    <td className="p-3">
                      <Switch checked={a.published} onCheckedChange={(v) => togglePublished.mutate({ id: a.id, published: v })} />
                    </td>
                    <td className="p-3 text-right flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(a)}><Pencil className="h-3 w-3" /></Button>
                      <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-600" onClick={() => setDeleteId(a.id)}><Trash2 className="h-3 w-3" /></Button>
                    </td>
                  </tr>
                ))}
                {list.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-gray-400">No articles yet — create your first one</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Article" : "New Article"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label className="text-xs mb-1 block">Title *</Label>
                <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value, slug: f.slug || slugify(e.target.value) }))} placeholder="Article title" />
              </div>
              <div className="col-span-2">
                <Label className="text-xs mb-1 block">Subtitle</Label>
                <Input value={form.subtitle} onChange={e => setForm(f => ({ ...f, subtitle: e.target.value }))} placeholder="Short description shown on the card" />
              </div>
              <div>
                <Label className="text-xs mb-1 block">Slug (URL)</Label>
                <Input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: slugify(e.target.value) }))} placeholder="url-friendly-slug" />
              </div>
              <div>
                <Label className="text-xs mb-1 block">Read time</Label>
                <Input value={form.readTime} onChange={e => setForm(f => ({ ...f, readTime: e.target.value }))} placeholder="5 min read" />
              </div>
              <div>
                <Label className="text-xs mb-1 block">Category</Label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2 pt-5">
                <Switch checked={form.published} onCheckedChange={v => setForm(f => ({ ...f, published: v }))} />
                <Label className="text-xs">Published</Label>
              </div>
            </div>
            <div>
              <Label className="text-xs mb-1 block">
                Body — use <code className="bg-gray-100 px-1 rounded">## Heading</code>, <code className="bg-gray-100 px-1 rounded">### Sub</code>, <code className="bg-gray-100 px-1 rounded">&gt; Callout</code>, <code className="bg-gray-100 px-1 rounded">- list item</code>
              </Label>
              <Textarea
                value={form.body}
                onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                placeholder={"## Introduction\n\nWrite your article here...\n\n> Key insight to highlight\n\n- Bullet point one\n- Bullet point two"}
                className="min-h-[320px] font-mono text-sm"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={() => saveArticle.mutate()} disabled={saveArticle.isPending || !form.title}>
                {saveArticle.isPending ? "Saving..." : editingId ? "Save changes" : "Publish"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete article?</DialogTitle></DialogHeader>
          <p className="text-sm text-gray-500">This cannot be undone.</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteId && deleteArticle.mutate(deleteId)} disabled={deleteArticle.isPending}>
              {deleteArticle.isPending ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
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
  const [error, setError] = useState("");
  const [step, setStep] = useState<"idle" | "signing" | "verifying">("idle");

  const loading = step !== "idle";

  const handleConnect = async () => {
    setError("");
    const eth = (window as any).ethereum;
    if (!eth) {
      setError("MetaMask not found. Please install MetaMask and try again.");
      return;
    }

    try {
      // 1. Request account
      setStep("signing");
      const accounts: string[] = await eth.request({ method: "eth_requestAccounts" });
      const address = accounts[0];
      if (!address) { setError("No account selected."); setStep("idle"); return; }

      // 2. Fetch signing challenge from backend
      const challengeRes = await fetch("/api/admin/wallet-challenge", { method: "POST" });
      const { nonce, message } = await challengeRes.json();

      // 3. Ask MetaMask to sign the message
      const signature = await eth.request({
        method: "personal_sign",
        params: [message, address],
      });

      // 4. Submit to backend
      setStep("verifying");
      const loginRes = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, signature, nonce }),
      });
      const data = await loginRes.json();
      if (!loginRes.ok) { setError(data.message || "Access denied."); setStep("idle"); return; }

      sessionStorage.setItem("admin_token", data.token);
      onLogin(data.token);
    } catch (err: any) {
      if (err?.code === 4001) {
        setError("Signature request cancelled.");
      } else {
        setError(err?.message || "Something went wrong.");
      }
      setStep("idle");
    }
  };

  const stepLabel = step === "signing" ? "Check MetaMask to sign…" : step === "verifying" ? "Verifying…" : "Connect Wallet";

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 rounded-xl bg-[#1a4480] flex items-center justify-center mb-2">
            <Wallet className="h-6 w-6 text-white" />
          </div>
          <CardTitle>Admin Access</CardTitle>
          <CardDescription>Connect your owner wallet to continue</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-600">
              {error}
            </div>
          )}
          <Button
            onClick={handleConnect}
            className="w-full bg-[#1a4480] hover:bg-[#153a6e]"
            disabled={loading}
          >
            {loading && <span className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />}
            {stepLabel}
          </Button>
          <p className="text-center text-xs text-gray-400">
            Only authorised owner addresses can access the admin panel.
          </p>
          <div className="text-center">
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
        {section === "content" && <ContentSection />}
        {section === "protocol" && <ProtocolSection />}
      </main>
    </div>
    </AdminTokenContext.Provider>
  );
}