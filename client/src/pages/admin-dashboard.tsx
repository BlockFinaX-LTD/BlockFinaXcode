import { useState, createContext, useContext, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/api-client";
import { hedgeContract, type HedgeFeeConfig, USDC_ADDRESS, USDT_ADDRESS_SEPOLIA } from "@/lib/hedge-contract";
import { getAuthMethod, sendCrypto, sendOtp, getCachedUserSummary } from "@/lib/rift-client";
import { useRift } from "@rift-finance/react";
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
  FileText, Trash2, X, GripVertical, Save, RefreshCw, Settings, ExternalLink, Download, Info, Send, FileSignature, Bot, Scale,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link } from "wouter";
import { LoiSection } from "@/components/admin/loi-section";
import { AgentSection } from "@/components/admin/agent-section";
import { ComplianceSection } from "@/components/admin/compliance-section";

import { DocumentsSection } from "@/components/admin/documents-section";

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

type Section = "docs" | "dashboard" | "agent" | "compliance" | "users" | "hedge" | "revenue" | "tasks" | "payouts" | "analytics" | "content" | "agreements" | "protocol";

const NAV_ITEMS: { key: Section; label: string; icon: any }[] = [
  { key: "dashboard", label: "Dashboard", icon: BarChart3 },
  { key: "agent", label: "Agent", icon: Bot },
  { key: "compliance", label: "Compliance", icon: Scale },
  { key: "users", label: "Users", icon: Users },
  { key: "hedge", label: "Hedge", icon: Shield },
  { key: "revenue", label: "Revenue & Fees", icon: DollarSign },
  { key: "tasks", label: "Tasks & Points", icon: ListChecks },
  { key: "payouts", label: "Reviews & Payouts", icon: Wallet },
  { key: "analytics", label: "Analytics", icon: Activity },
  { key: "docs", label: "Documents", icon: FileText },
  { key: "content", label: "Content", icon: FileText },
  { key: "agreements", label: "Agreements", icon: FileSignature },
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
        <span>Hedge events and positions are permanent on-chain records on <strong>Base and BSC Mainnets</strong>. Resetting the platform database does not affect on-chain data.</span>
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
        <span>Revenue figures are read directly from the selected chain's Diamond contract — permanent on-chain records. Use the chain selector in the Protocol section to view fees across Base and BSC.</span>
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
        <StatCard
          title="On-Chain Platform Fees"
          value={`$${r.hedgePoolFee || "0.00"}`}
          sub={r.chainFeeDetails
            ? Object.entries(r.chainFeeDetails as Record<string, { fees: number; source: string }>)
                .map(([chain, d]) => `${chain}: $${d.fees.toFixed(2)} (${d.source})`)
                .join(' · ')
            : `${r.eventCount || 0} events`}
          icon={DollarSign}
          color="text-blue-600"
        />
        <StatCard title="Transfer Fees (0.3%)" value={`$${r.totalTransactionFees || "0.00"}`} sub={`${r.transactionFeeCount || 0} transfers | Vol: $${r.totalTransferVolume || "0.00"}`} icon={DollarSign} color="text-purple-600" />
        <StatCard title="Total Premiums Collected" value={`$${parseFloat(r.totalPremiumsCollected || 0).toFixed(2)}`} sub={`From ${r.eventCount || 0} on-chain hedge events`} icon={DollarSign} color="text-green-600" />
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

// Admin dashboard targets the CURRENT production Diamonds (post v8 upgrade).
// Diamond proxy addresses match client/src/lib/hedge-contract.ts CHAIN_DIAMOND_MAP
// — single source of truth lives there; if you ever rotate, update both.
const ADMIN_CHAINS = {
  base: {
    label: "Base",
    chainId: 8453, hex: "0x2105", rpc: "https://mainnet.base.org",
    diamond: "0xbCC51E62C4948FD35ab505bd71804C849601e4Ef",
    safe: "0x7909a2f1fAd63678eEDcC5A75462B66D062189Bb",
    primaryFeeToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    primaryFeeSymbol: "USDC",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    usdt: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
    usdcDecimals: 6, usdtDecimals: 6,
    explorer: "https://basescan.org",
    explorerApi: "https://base.blockscout.com/api",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    blockExplorerUrls: ["https://basescan.org"],
  },
  bsc: {
    label: "BSC",
    chainId: 56, hex: "0x38", rpc: "https://bsc-dataseed.binance.org",
    diamond: "0xaC939C0897981Abc0711ec4e37527F13106180fc",
    safe: "0x2a0ab363E01b518B189218e39f79Bfc3AE310807",
    primaryFeeToken: "0x55d398326f99059fF775485246999027B3197955",
    primaryFeeSymbol: "USDT",
    usdc: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    usdt: "0x55d398326f99059fF775485246999027B3197955",
    usdcDecimals: 18, usdtDecimals: 18,
    explorer: "https://bscscan.com",
    explorerApi: "https://api.bscscan.com/api",
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    blockExplorerUrls: ["https://bscscan.com"],
  },
} as const;

type AdminChainKey = keyof typeof ADMIN_CHAINS;
type AdminChainCfg = typeof ADMIN_CHAINS[AdminChainKey];

const SAFE_ABI = [
  "function nonce() view returns (uint256)",
  "function getThreshold() view returns (uint256)",
  "function getOwners() view returns (address[])",
  "function getTransactionHash(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce) view returns (bytes32)",
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

const TIMELOCK_ABI = [
  "function getPendingCutIds() view returns (bytes32[])",
  "function getProposal(bytes32) view returns (uint8 status, uint256 executeAfter, address initAddress, bytes initCalldata)",
  "function executeCut(bytes32 proposalId)",
  "function cancelCut(bytes32 proposalId)",
];

async function getInjectedWalletProvider(): Promise<any | null> {
  const win = window as any;
  if (win.__blockFinaXWalletConnectProvider) return win.__blockFinaXWalletConnectProvider;
  if (win.ethereum) return win.ethereum;

  // EIP-6963 lets injected wallets announce themselves without claiming the
  // global window.ethereum slot (common when multiple wallets are installed).
  const announced: any[] = [];
  const onAnnounce = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (detail?.provider) announced.push(detail.provider);
  };
  window.addEventListener("eip6963:announceProvider", onAnnounce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  await new Promise(resolve => setTimeout(resolve, 200));
  window.removeEventListener("eip6963:announceProvider", onAnnounce);
  return announced[0] || null;
}

async function ensureChain(cfg: AdminChainCfg) {
  const eth = await getInjectedWalletProvider();
  if (!eth) throw new Error("No browser wallet detected. Enable a wallet that owns this Treasury Safe, then reload the dashboard.");
  await eth.request({ method: "eth_requestAccounts" });
  const chainId = parseInt(await eth.request({ method: "eth_chainId" }), 16);
  if (chainId !== cfg.chainId) {
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: cfg.hex }] });
    } catch {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [{ chainId: cfg.hex, chainName: cfg.label, nativeCurrency: cfg.nativeCurrency, rpcUrls: [cfg.rpc], blockExplorerUrls: cfg.blockExplorerUrls }],
      });
    }
  }
  const { ethers } = await import("ethers");
  const provider = new ethers.BrowserProvider(eth);
  const signer = await provider.getSigner();
  const contract = new ethers.Contract(cfg.diamond, OWNER_ABI, signer);
  return { ethers, signer, contract, provider };
}

async function readChainContract(cfg: AdminChainCfg) {
  const { ethers } = await import("ethers");
  const provider = new ethers.JsonRpcProvider(cfg.rpc);
  return new ethers.Contract(cfg.diamond, OWNER_ABI, provider);
}

function fmtToken(raw: bigint, decimals: number) {
  return (Number(raw) / Math.pow(10, decimals)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

async function fetchTotalWithdrawn(cfg: AdminChainCfg, tokenAddress: string, decimals: number, token: string): Promise<number> {
  try {
    const params = new URLSearchParams({
      explorerApi: cfg.explorerApi,
      diamond: cfg.diamond,
      token: tokenAddress,
      decimals: String(decimals),
    });
    const res = await fetch(`/api/admin/total-withdrawn?${params}`, {
      headers: { "x-admin-token": token },
    });
    const data = await res.json();
    return typeof data.total === "number" ? data.total : 0;
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
  const [selectedChainKey, setSelectedChainKey] = useState<AdminChainKey>("base");
  const cfg = ADMIN_CHAINS[selectedChainKey];
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
  const [safeTxModal, setSafeTxModal] = useState<{ to: string; data: string; label: string; nonce?: bigint; nonceRepair?: boolean } | null>(null);
  const [safeExecuting, setSafeExecuting] = useState(false);
  const [walletConnecting, setWalletConnecting] = useState(false);
  const [walletConnectActive, setWalletConnectActive] = useState(false);

  type TimelockProposal = {
    id: string;
    status: number;
    executeAfter: number;
    initAddress: string;
    ready: boolean;
    secondsLeft: number;
  };
  const [proposals, setProposals] = useState<TimelockProposal[]>([]);
  const [proposalsLoading, setProposalsLoading] = useState(false);

  const loadProposals = async () => {
    setProposalsLoading(true);
    try {
      const { ethers } = await import("ethers");
      const provider = new ethers.JsonRpcProvider(cfg.rpc);
      const tl = new ethers.Contract(cfg.diamond, TIMELOCK_ABI, provider);
      const ids: string[] = await tl.getPendingCutIds().catch(() => []);
      const now = Math.floor(Date.now() / 1000);
      const details: TimelockProposal[] = await Promise.all(
        ids.map(async (id) => {
          try {
            const p = await tl.getProposal(id);
            const executeAfter = Number(p.executeAfter);
            return { id, status: Number(p.status), executeAfter, initAddress: p.initAddress, ready: now >= executeAfter, secondsLeft: Math.max(0, executeAfter - now) };
          } catch {
            return { id, status: 0, executeAfter: 0, initAddress: "", ready: false, secondsLeft: 0 };
          }
        })
      );
      setProposals(details.filter(p => p.status === 0));
    } catch { /* silent */ }
    finally { setProposalsLoading(false); }
  };

  useEffect(() => { loadProposals(); }, [selectedChainKey]);

  const load = async () => {
    setState({ usdcFees: "—", usdtFees: "—", usdcWithdrawn: 0, usdtWithdrawn: 0, feeConfig: null, usdcAllowed: true, usdtAllowed: false, wallet: "", diamondOwner: "", loading: true });
    try {
      const c = await readChainContract(cfg);
      const { ethers } = await import("ethers");
      const usdtAddr = cfg.usdt;
      const [rawLegacyFees, rawPrimaryTokenFees, rawUsdt, rawFees, usdcAllowed, usdtAllowed, usdcWithdrawn, usdtWithdrawn, diamondOwner] = await Promise.all([
        c.getHedgePlatformFees().catch(() => 0n),
        c.getPlatformFeesByToken(cfg.primaryFeeToken).catch(() => 0n),
        usdtAddr ? c.getPlatformFeesByToken(usdtAddr).catch(() => 0n) : Promise.resolve(0n),
        c.getHedgeFeeConfig().catch(() => null),
        c.isAllowedPaymentToken(cfg.usdc).catch(() => true),
        usdtAddr ? c.isAllowedPaymentToken(usdtAddr).catch(() => false) : Promise.resolve(false),
        fetchTotalWithdrawn(cfg, cfg.primaryFeeToken, cfg.usdcDecimals, token),
        usdtAddr ? fetchTotalWithdrawn(cfg, usdtAddr, cfg.usdtDecimals, token) : Promise.resolve(0),
        c.owner().catch(() => ""),
      ]);
      const rawPrimaryFees = BigInt(rawPrimaryTokenFees) > BigInt(rawLegacyFees) ? rawPrimaryTokenFees : rawLegacyFees;
      const feeConfig = rawFees ? {
        creationFee: (Number(rawFees[0]) / 1e6).toFixed(2),
        hedgerFeeRate: (Number(ethers.formatUnits(rawFees[1], 6)) * 100).toFixed(4),
        hedgerPayoutFeeRate: (Number(ethers.formatUnits(rawFees[2], 6)) * 100).toFixed(4),
        lpProfitFeeRate: (Number(ethers.formatUnits(rawFees[3], 6)) * 100).toFixed(4),
        creatorLoyaltyRate: (Number(ethers.formatUnits(rawFees[4], 6)) * 100).toFixed(4),
      } : null;
      if (feeConfig) setFeeForm({ creationFee: feeConfig.creationFee, hedgerFeeRate: feeConfig.hedgerFeeRate, hedgerPayoutFeeRate: feeConfig.hedgerPayoutFeeRate, lpProfitFeeRate: feeConfig.lpProfitFeeRate, creatorLoyaltyRate: feeConfig.creatorLoyaltyRate });

      const eth = await getInjectedWalletProvider();
      let wallet = "";
      if (eth) {
        const accounts: string[] = await eth.request({ method: "eth_accounts" });
        wallet = accounts[0] || "";
      }
      setState(s => ({ ...s, usdcFees: fmtToken(BigInt(rawPrimaryFees), cfg.usdcDecimals), usdtFees: fmtToken(BigInt(rawUsdt), cfg.usdtDecimals), usdcWithdrawn, usdtWithdrawn, feeConfig, usdcAllowed, usdtAllowed, wallet, diamondOwner: (diamondOwner as string).toLowerCase(), loading: false }));
    } catch (e: any) {
      setState(s => ({ ...s, loading: false }));
      toast({ title: "Failed to load contract state", description: e.message, variant: "destructive" });
    }
  };

  useEffect(() => { load(); }, [selectedChainKey]);

  const connectWalletWithQr = async () => {
    const projectId = (import.meta as any).env?.VITE_WALLETCONNECT_PROJECT_ID?.trim();
    if (!projectId) {
      toast({
        title: "WalletConnect needs setup",
        description: "The dashboard needs its WalletConnect Project ID configured before QR scanning can start.",
        variant: "destructive",
      });
      return;
    }
    setWalletConnecting(true);
    try {
      let wc = (window as any).__blockFinaXWalletConnectProvider;
      if (!wc) {
        const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
        wc = await EthereumProvider.init({
          projectId,
          chains: [cfg.chainId],
          showQrModal: true,
          rpcMap: { [cfg.chainId]: cfg.rpc },
          metadata: {
            name: "BlockFinaX Admin",
            description: "Sign BlockFinaX Treasury Safe proposals",
            url: window.location.origin,
            icons: [],
          },
        });
        (window as any).__blockFinaXWalletConnectProvider = wc;
        wc.on("accountsChanged", (accounts: string[]) => {
          setState(current => ({ ...current, wallet: accounts[0] || "" }));
        });
        wc.on("disconnect", () => {
          delete (window as any).__blockFinaXWalletConnectProvider;
          setWalletConnectActive(false);
          setState(current => ({ ...current, wallet: "" }));
        });
      }
      // `connected` only reports the relay socket state. It can be true before
      // a wallet session has been paired, so request() would then fail with
      // "Please call connect() before request()". Check the actual WC session.
      if (!wc.session) await wc.connect();
      const accounts: string[] = await wc.request({ method: "eth_requestAccounts" });
      if (!accounts.length) throw new Error("The wallet connected without providing an account.");
      setWalletConnectActive(true);
      await load();
      toast({ title: "Wallet connected", description: `${shortAddr(accounts[0])}. Check that this is a Treasury Safe owner before signing.` });
    } catch (e: any) {
      // A failed pairing attempt must not leave the rejected provider cached.
      // Reusing it on the next click keeps stale relay subscriptions alive;
      // WalletConnect then accumulates listeners and repeats restore warnings.
      const failedWc = (window as any).__blockFinaXWalletConnectProvider;
      if (failedWc && !failedWc.session) {
        try { failedWc.signer?.abortPairingAttempt?.(); } catch { /* best-effort relay cleanup */ }
        try { await failedWc.disconnect?.(); } catch { /* discard failed session either way */ }
        if ((window as any).__blockFinaXWalletConnectProvider === failedWc) {
          delete (window as any).__blockFinaXWalletConnectProvider;
        }
      }
      setWalletConnectActive(false);
      toast({ title: "WalletConnect connection failed", description: e.message || String(e), variant: "destructive" });
    } finally {
      setWalletConnecting(false);
    }
  };

  const disconnectQrWallet = async () => {
    const wc = (window as any).__blockFinaXWalletConnectProvider;
    try { await wc?.disconnect(); } catch { /* clear the local session either way */ }
    delete (window as any).__blockFinaXWalletConnectProvider;
    setWalletConnectActive(false);
    setState(current => ({ ...current, wallet: "" }));
  };

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

  const proposePrimaryFeeWithdrawal = async () => {
    try {
      const { ethers } = await import("ethers");
      const contract = await readChainContract(cfg);
      const [legacyRaw, tokenRaw] = await Promise.all([
        contract.getHedgePlatformFees().catch(() => 0n),
        contract.getPlatformFeesByToken(cfg.primaryFeeToken).catch(() => 0n),
      ]);
      const useTokenCounter = BigInt(tokenRaw) >= BigInt(legacyRaw);
      const raw = useTokenCounter ? tokenRaw : legacyRaw;
      if (BigInt(raw) === 0n) throw new Error(`No ${cfg.primaryFeeSymbol} fees to withdraw.`);
      const iface = new ethers.Interface(OWNER_ABI);
      const data = useTokenCounter
        ? iface.encodeFunctionData("withdrawPlatformFeesByToken", [cfg.primaryFeeToken, raw])
        : iface.encodeFunctionData("withdrawPlatformFees", [raw]);
      setSafeTxModal({ to: cfg.diamond, data, label: `Withdraw ${ethers.formatUnits(raw, cfg.usdcDecimals)} ${cfg.primaryFeeSymbol} to Treasury Safe` });
    } catch (e: any) {
      toast({ title: "Could not prepare withdrawal", description: e.message || String(e), variant: "destructive" });
    }
  };

  const proposeUsdtFeeWithdrawal = async () => {
    try {
      if (!cfg.usdt || cfg.usdt.toLowerCase() === cfg.primaryFeeToken.toLowerCase()) throw new Error("No separate USDT fee balance on this chain.");
      const { ethers } = await import("ethers");
      const contract = await readChainContract(cfg);
      const raw = await contract.getPlatformFeesByToken(cfg.usdt);
      if (BigInt(raw) === 0n) throw new Error("No USDT fees to withdraw.");
      const iface = new ethers.Interface(OWNER_ABI);
      const data = iface.encodeFunctionData("withdrawPlatformFeesByToken", [cfg.usdt, raw]);
      setSafeTxModal({ to: cfg.diamond, data, label: `Withdraw ${ethers.formatUnits(raw, cfg.usdtDecimals)} USDT to Treasury Safe` });
    } catch (e: any) {
      toast({ title: "Could not prepare withdrawal", description: e.message || String(e), variant: "destructive" });
    }
  };

  const updateFees = () => run("Update fee config (direct EOA)", async () => {
    const { ethers, contract, signer } = await ensureChain(cfg);
    const signerAddr = (await signer.getAddress()).toLowerCase();
    const onChainOwner = (await contract.owner().catch(() => "")).toLowerCase();
    if (onChainOwner && signerAddr !== onChainOwner) {
      throw new Error(`Wrong wallet — Diamond owner is ${onChainOwner} but MetaMask is using ${signerAddr}. Use "Send via Safe" instead.`);
    }
    const p = (pct: string) => ethers.parseUnits((parseFloat(pct) / 100).toFixed(8), 6);
    const tx = await contract.initializeHedgeFees(
      // Creation fee is denominated in the chain's payment token, which is
      // 6dp on Base (USDC) and 18dp on BSC (USDT). Hardcoding 6 wrote a fee
      // ~1e12 too small on BSC, i.e. effectively free pool creation.
      ethers.parseUnits(feeForm.creationFee, cfg.usdcDecimals),
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
        // Same per-chain decimals rule as the direct path above.
        ethers.parseUnits(feeForm.creationFee || "0", cfg.usdcDecimals),
        p(feeForm.hedgerFeeRate || "0"),
        p(feeForm.hedgerPayoutFeeRate || "0"),
        p(feeForm.lpProfitFeeRate || "0"),
        p(feeForm.creatorLoyaltyRate || "0"),
      ]);
      setSafeTxModal({ to: cfg.diamond, data: calldata, label: "Update Fee Parameters" });
    } catch (e: any) {
      toast({ title: "Failed to encode calldata", description: e.message, variant: "destructive" });
    }
  };

  const genSafeOracleTx = async (address: string) => {
    try {
      const { ethers } = await import("ethers");
      const iface = new ethers.Interface(OWNER_ABI);
      const calldata = iface.encodeFunctionData("addOracle", [address]);
      setSafeTxModal({ to: cfg.diamond, data: calldata, label: `Add Oracle ${shortAddr(address)}` });
    } catch (e: any) {
      toast({ title: "Failed to encode calldata", description: e.message, variant: "destructive" });
    }
  };

  const prepareSafeNonceRepair = async () => {
    try {
      const { ethers } = await import("ethers");
      const provider = new ethers.JsonRpcProvider(cfg.rpc);
      const safe = new ethers.Contract(cfg.safe, SAFE_ABI, provider);
      const onChainNonce: bigint = await safe.nonce();
      const serviceBase = cfg.chainId === 8453
        ? "https://api.safe.global/tx-service/base/api/v1"
        : "https://api.safe.global/tx-service/bnb/api/v1";
      const response = await fetch(`${serviceBase}/safes/${cfg.safe}/multisig-transactions/?executed=false&limit=100`, {
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error(`Could not safely inspect the Safe queue (${response.status}). Try again later or contact your Safe administrator.`);
      const queue = await response.json();
      const pending = Array.isArray(queue.results) ? queue.results : [];
      const hasCurrentNonce = pending.some((tx: any) => BigInt(tx.nonce) === onChainNonce);
      const hasLaterNonce = pending.some((tx: any) => BigInt(tx.nonce) > onChainNonce);
      if (hasCurrentNonce) {
        throw new Error(`The Safe already has a proposal at nonce ${onChainNonce}. Open that proposal in Safe; this repair is not needed.`);
      }
      if (!hasLaterNonce) {
        throw new Error(`No later pending Safe transaction was found. The dashboard will not create a repair transaction without a confirmed nonce gap.`);
      }
      setSafeTxModal({
        to: cfg.safe,
        data: "0x",
        label: `Repair Safe queue at nonce ${onChainNonce}`,
        nonce: onChainNonce,
        nonceRepair: true,
      });
    } catch (e: any) {
      toast({ title: "Could not prepare Safe queue repair", description: e.message || String(e), variant: "destructive" });
    }
  };

  const signAndExecSafe = async (to: string, data: string, requestedNonce?: bigint, nonceRepair = false) => {
    setSafeExecuting(true);
    try {
      const { ethers, provider, signer } = await ensureChain(cfg);
      const signerAddr = (await signer.getAddress()).toLowerCase();

      const safe = new ethers.Contract(cfg.safe, SAFE_ABI, provider);
      const [onChainNonce, threshold, owners]: [bigint, bigint, string[]] = await Promise.all([
        safe.nonce(),
        safe.getThreshold(),
        safe.getOwners(),
      ]);
      const nonce = requestedNonce ?? onChainNonce;
      if (nonce !== onChainNonce) {
        throw new Error(`Safe nonce changed while this dialog was open (now ${onChainNonce}). Close it and check the queue again.`);
      }

      const ownerList: string[] = (owners as string[]).map((o: string) => o.toLowerCase());
      if (!ownerList.includes(signerAddr)) {
        throw new Error(`Connected wallet (${signerAddr}) is not a Safe owner. Safe owners: ${ownerList.join(", ")}`);
      }

      // EIP-712 sign the Safe transaction
      const domain = { chainId: cfg.chainId, verifyingContract: cfg.safe };
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

      const safeTx = {
        to,
        value: "0",
        data,
        operation: 0,
        safeTxGas: "0",
        baseGas: "0",
        gasPrice: "0",
        gasToken: ethers.ZeroAddress,
        refundReceiver: ethers.ZeroAddress,
        nonce: nonce.toString(),
      };
      const safeTxHash = await safe.getTransactionHash(
        to, 0, data, 0, 0, 0, 0, ethers.ZeroAddress, ethers.ZeroAddress, nonce,
      );
      const signature = await signer.signTypedData(domain, types, message);
      const serviceBase = cfg.chainId === 8453
        ? "https://api.safe.global/tx-service/base/api/v1"
        : "https://api.safe.global/tx-service/bnb/api/v1";
      const response = await fetch(`${serviceBase}/safes/${cfg.safe}/multisig-transactions/`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          ...safeTx,
          contractTransactionHash: safeTxHash,
          sender: signerAddr,
          signature,
          origin: "BlockFinaX Admin Dashboard",
        }),
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Safe Transaction Service rejected the proposal (${response.status}): ${detail.slice(0, 300)}`);
      }
      toast({
        title: nonceRepair ? "Nonce repair queued for approval" : "Safe transaction queued for approval",
        description: `Hash ${safeTxHash}. Your signature was added; this Safe requires ${threshold} owner confirmations. ${nonceRepair ? "This zero-value transaction moves no funds; execute it before the later withdrawal." : "No funds move until execution."}`,
      });
      setSafeTxModal(null);
      await load();
    } catch (e: any) {
      toast({ title: "Safe proposal failed", description: e.message || String(e), variant: "destructive" });
    } finally {
      setSafeExecuting(false);
    }
  };

  const setOracle = () => run("Add oracle", async () => {
    if (!oracleInput.startsWith("0x") || oracleInput.length !== 42) throw new Error("Invalid address.");
    const { contract } = await ensureChain(cfg);
    const tx = await contract.addOracle(oracleInput);
    await tx.wait();
    setOracleInput("");
  });

  const toggleToken = (tokenAddr: string, enable: boolean, label: string) => run(`${enable ? "Enable" : "Disable"} ${label}`, async () => {
    const { contract } = await ensureChain(cfg);
    const tx = await contract.setAllowedPaymentToken(tokenAddr, enable);
    await tx.wait();
  });

  const connectedLabel = state.wallet ? shortAddr(state.wallet) : "Not connected";
  const ownerLabel = state.diamondOwner ? shortAddr(state.diamondOwner) : "—";
  const walletIsOwner = state.wallet && state.diamondOwner
    ? state.wallet.toLowerCase() === state.diamondOwner.toLowerCase()
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Protocol Controls</h2>
          <p className="text-sm text-gray-500 mt-0.5">On-chain owner functions — each action sends a transaction via MetaMask</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedChainKey} onValueChange={(v) => setSelectedChainKey(v as AdminChainKey)}>
            <SelectTrigger className="w-36 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(ADMIN_CHAINS) as AdminChainKey[]).map(k => (
                <SelectItem key={k} value={k}>{ADMIN_CHAINS[k].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
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
              { label: `Total Earned (${cfg.primaryFeeSymbol} · ${cfg.label})`, value: `$${(state.usdcWithdrawn + parseFloat(state.usdcFees === "—" ? "0" : state.usdcFees)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color: "text-[#1a4480]" },
              { label: `Total Withdrawn (${cfg.primaryFeeSymbol})`, value: `$${state.usdcWithdrawn.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color: "text-green-700" },
              { label: "Pending in Contract", value: `$${state.usdcFees === "—" ? "—" : state.usdcFees}`, color: "text-orange-600" },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded-lg bg-gray-50 p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">{label}</p>
                <p className={`text-lg font-bold ${color}`}>{value}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-gray-50 p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">Safe owner wallet</p>
              <p className="text-xs text-gray-500">
                {state.wallet ? `Connected: ${state.wallet}` : "Scan with your phone wallet to sign Safe proposals."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={connectWalletWithQr} disabled={walletConnecting || safeExecuting}>
                {walletConnecting ? <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />Connecting…</> : <><Wallet className="h-3.5 w-3.5 mr-1.5" />Connect wallet by QR</>}
              </Button>
              {walletConnectActive && <Button size="sm" variant="ghost" onClick={disconnectQrWallet} disabled={walletConnecting || safeExecuting}>Disconnect</Button>}
            </div>
          </div>

          {/* Token cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* USDC */}
            <div className="rounded-lg border border-gray-200 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">{cfg.primaryFeeSymbol} — Pending</p>
                  <p className="text-2xl font-bold text-gray-900">{state.usdcFees === "—" ? "—" : `$${state.usdcFees}`}</p>
                </div>
                <span className="text-xs font-medium bg-blue-50 text-blue-700 px-2 py-0.5 rounded">{cfg.primaryFeeSymbol}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-gray-500 border-t pt-2">
                <span>All-time withdrawn</span>
                <span className="font-semibold text-green-700">${state.usdcWithdrawn.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <Button size="sm" className="w-full bg-[#1a4480] hover:bg-[#153a6e]" onClick={proposePrimaryFeeWithdrawal} disabled={state.loading || state.usdcFees === "—"}>
                <Shield className="h-3 w-3 mr-1" />Propose {cfg.primaryFeeSymbol} withdrawal to Safe
              </Button>
              {cfg.chainId === 8453 && <Button size="sm" variant="outline" className="w-full" onClick={prepareSafeNonceRepair} disabled={safeExecuting}>
                <RefreshCw className="h-3 w-3 mr-1" />Check / repair Safe queue gap
              </Button>}
            </div>

            {/* USDT */}
            {cfg.usdt.toLowerCase() !== cfg.primaryFeeToken.toLowerCase() && <div className="rounded-lg border border-gray-200 p-4 space-y-3">
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
              <Button size="sm" className="w-full bg-[#1a4480] hover:bg-[#153a6e]" onClick={proposeUsdtFeeWithdrawal} disabled={state.loading || state.usdtFees === "—"}>
                <Shield className="h-3 w-3 mr-1" />Propose USDT withdrawal to Safe
              </Button>
            </div>}
          </div>

          <p className="text-xs text-gray-400 flex items-center gap-1">
            <CheckCircle className="h-3 w-3" />Withdrawals are proposed to the Treasury Safe ({shortAddr(cfg.safe)}). A Safe owner signs the proposal; the required owners approve and execute it in Safe.
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
              { label: "USDC", address: cfg.usdc, allowed: state.usdcAllowed },
              ...(cfg.usdt ? [{ label: "USDT", address: cfg.usdt, allowed: state.usdtAllowed }] : []),
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
                ["Diamond", cfg.diamond],
                ["Safe (treasury)", cfg.safe],
              ].map(([label, addr]) => (
                <div key={addr} className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">{label}</span>
                  <a href={`${cfg.explorer}/address/${addr}`} target="_blank" rel="noopener noreferrer" className="font-mono text-[#1a4480] hover:underline flex items-center gap-1">
                    {shortAddr(addr)}<ExternalLink className="h-2.5 w-2.5" />
                  </a>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pending Upgrade Proposals */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4 text-[#1a4480]" />Pending Upgrade Proposals
              </CardTitle>
              <CardDescription>Diamond upgrade proposals queued via the timelock. Once the waiting period has passed, click Execute to confirm.</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={loadProposals} disabled={proposalsLoading}>
              <RefreshCw className={`h-3 w-3 mr-1 ${proposalsLoading ? "animate-spin" : ""}`} />Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {proposalsLoading ? (
            <div className="text-sm text-gray-400 py-4 text-center">Loading proposals from {cfg.label}…</div>
          ) : proposals.length === 0 ? (
            <div className="rounded-lg bg-gray-50 border border-dashed border-gray-200 p-6 text-center">
              <Clock className="h-6 w-6 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">No pending upgrade proposals</p>
              <p className="text-xs text-gray-400 mt-1">When a Diamond upgrade is proposed, it will appear here after the timelock delay has passed.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {proposals.map((p) => {
                const hoursLeft = Math.floor(p.secondsLeft / 3600);
                const minsLeft = Math.floor((p.secondsLeft % 3600) / 60);
                const timeStr = p.ready ? "Ready to execute" : hoursLeft > 0 ? `${hoursLeft}h ${minsLeft}m remaining` : `${minsLeft}m remaining`;
                const execDate = p.executeAfter ? new Date(p.executeAfter * 1000).toLocaleString() : "—";
                return (
                  <div key={p.id} className={`rounded-lg border p-4 ${p.ready ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${p.ready ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>
                            {p.ready ? "✓ Ready" : "⏳ Waiting"}
                          </span>
                          <span className="text-xs text-gray-500">{timeStr}</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">Proposal ID: <code className="font-mono text-gray-700 break-all">{p.id.slice(0, 18)}…</code></p>
                        <p className="text-xs text-gray-500">Executable from: <span className="font-medium text-gray-700">{execDate}</span></p>
                        {p.initAddress && p.initAddress !== "0x0000000000000000000000000000000000000000" && (
                          <p className="text-xs text-gray-500">Init contract: <code className="font-mono text-gray-700">{shortAddr(p.initAddress)}</code></p>
                        )}
                      </div>
                      <div className="flex flex-col gap-2 shrink-0">
                        {p.ready ? (
                          <Button
                            size="sm"
                            className="bg-[#1a4480] hover:bg-[#153a6e] text-white"
                            onClick={async () => {
                              try {
                                const { ethers } = await import("ethers");
                                const iface = new ethers.Interface(TIMELOCK_ABI);
                                const calldata = iface.encodeFunctionData("executeCut", [p.id]);
                                setSafeTxModal({ to: cfg.diamond, data: calldata, label: `Execute Upgrade (${p.id.slice(0, 10)}…)` });
                              } catch (e: any) {
                                toast({ title: "Failed to encode transaction", description: e.message, variant: "destructive" });
                              }
                            }}
                          >
                            <Shield className="h-3.5 w-3.5 mr-1.5" />Execute via Safe
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" disabled>
                            <Clock className="h-3.5 w-3.5 mr-1.5" />Waiting…
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-600 hover:text-red-700 hover:bg-red-50 text-xs"
                          onClick={async () => {
                            try {
                              const { ethers } = await import("ethers");
                              const iface = new ethers.Interface(TIMELOCK_ABI);
                              const calldata = iface.encodeFunctionData("cancelCut", [p.id]);
                              setSafeTxModal({ to: cfg.diamond, data: calldata, label: `Cancel Proposal (${p.id.slice(0, 10)}…)` });
                            } catch (e: any) {
                              toast({ title: "Failed to encode cancel", description: e.message, variant: "destructive" });
                            }
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
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
            <div className={`rounded-lg border p-3 text-xs leading-relaxed ${safeTxModal?.nonceRepair ? "bg-amber-50 border-amber-200 text-amber-950" : "bg-green-50 border-green-200 text-green-900"}`}>
              {safeTxModal?.nonceRepair ? <>
                <strong>This is a zero-value Safe queue repair at nonce {safeTxModal.nonce?.toString()}.</strong>
                <p className="mt-1">It sends 0 ETH from the Safe to itself and moves no tokens. Connect a Safe owner wallet and sign the proposal. The other required owners must approve it, then execute this repair in Safe before the withdrawal.</p>
              </> : <>
                <strong>Queue a Safe proposal for owner approval.</strong>
                <p className="mt-1 text-green-800">Connect a Safe owner wallet and click <strong>Sign &amp; Queue</strong>. Your wallet will request an off-chain signature and add the proposal to the Safe Transaction Service. No funds move here; the required owners must approve and execute it in Safe.</p>
              </>}
            </div>

            <div className="space-y-3">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Safe contract</p>
                <div className="flex items-center gap-2 bg-gray-50 rounded-lg border p-2.5">
                  <code className="text-xs font-mono flex-1 text-gray-800">{cfg.safe}</code>
                  <a href={`${cfg.explorer}/address/${cfg.safe}`} target="_blank" rel="noopener noreferrer" className="shrink-0">
                    <Button size="sm" variant="ghost" className="h-7 text-xs px-2"><ExternalLink className="h-3 w-3" /></Button>
                  </a>
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Target {safeTxModal?.nonceRepair ? "(Safe itself)" : "(Diamond)"}</p>
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
                onClick={() => safeTxModal && signAndExecSafe(safeTxModal.to, safeTxModal.data, safeTxModal.nonce, safeTxModal.nonceRepair)}
              >
                {safeExecuting ? (
                  <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />Queueing…</>
                ) : (
                  <><Shield className="h-3.5 w-3.5 mr-1.5" />Sign &amp; Queue for Approval</>
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
  const { isAuthenticated, user, open, getAccessToken } = useRift();
  const [error, setError] = useState("");
  const [step, setStep] = useState<"idle" | "verifying">("idle");
  const loading = step !== "idle";

  const handleContinue = async () => {
    setError("");
    if (!isAuthenticated) {
      open();
      return;
    }
    setStep("verifying");
    try {
      const accessToken = await getAccessToken();
      const r = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.message || "Access denied.");
        setStep("idle");
        return;
      }
      sessionStorage.setItem("admin_token", data.token);
      onLogin(data.token);
    } catch (err: any) {
      setError(err?.message || "Something went wrong.");
      setStep("idle");
    }
  };

  // Resolve the email the widget signed in with for the friendly label.
  // We pull from the cached user summary maintained by the rest of the app
  // and fall back to the Rift user.user UUID if the email isn't cached yet.
  const cached = getCachedUserSummary();
  const userLabel = (user as any)?.email || cached?.user || (user?.user ?? "");

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 rounded-xl bg-[#1a4480] flex items-center justify-center mb-2">
            <Shield className="h-6 w-6 text-white" />
          </div>
          <CardTitle>Admin Access</CardTitle>
          <CardDescription>
            {isAuthenticated
              ? "Continue with your BlockFinaX account"
              : "Sign in with BlockFinaX to continue"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-600">
              {error}
            </div>
          )}

          {isAuthenticated && userLabel && (
            <div className="rounded-md bg-gray-50 border border-gray-200 px-3 py-2 text-sm text-gray-600">
              Signed in as <span className="font-medium text-gray-900">{userLabel}</span>
            </div>
          )}

          <Button
            onClick={handleContinue}
            className="w-full bg-[#1a4480] hover:bg-[#153a6e]"
            disabled={loading}
          >
            {loading && <span className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />}
            {isAuthenticated ? (loading ? "Verifying…" : "Continue as admin") : "Sign in"}
          </Button>

          <p className="text-center text-xs text-gray-400">
            Only allowlisted email accounts can access the admin panel.
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

// ── Payouts section ─────────────────────────────────────────────────────
//
// Admin tooling for converting earned points into real USDC. Backed by:
//   - GET  /api/admin/settings/point-value     (admin: read current $/point)
//   - PUT  /api/admin/settings/point-value     (admin: update $/point)
//   - GET  /api/admin/task-completions         (admin: list paid/unpaid)
//   - POST /api/admin/task-completions/:id/payout
//                                              (admin: record the Rift tx hash)
//
// The actual transfer happens through the Rift SDK from the admin's own
// signed-in account (sendCrypto with OTP/password). The endpoint only files
// the hash so the queue knows the row is settled.

interface CompletionRow {
  completionId: number;
  walletAddress: string;
  completedAt: string;
  pointsEarned: number;
  reviewStatus: 'auto' | 'pending' | 'approved' | 'rejected';
  evidenceUrl: string | null;
  evidenceImage: string | null;
  evidenceText: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  paidTxHash: string | null;
  paidAmount: string | null;
  paidToken: string | null;
  paidChainId: number | null;
  paidAt: string | null;
  paidBy: string | null;
  taskId: number;
  taskKey: string;
  taskTitle: string;
  taskCategory: string;
  taskVerifier: string | null;
  taskIsDaily: boolean | null;
}

function PayoutValueCard({ token }: { token: string }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const { data, refetch } = useQuery<{ usdPerPoint: number }>({
    queryKey: ["admin-point-value", token],
    queryFn: async () => {
      const r = await adminFetch("/api/admin/settings/point-value", token);
      return r.json();
    },
  });

  const current = data?.usdPerPoint ?? 0.05;

  const save = async () => {
    const num = Number(draft);
    if (!Number.isFinite(num) || num < 0) {
      toast({ title: "Invalid value", description: "Enter a non-negative number.", variant: "destructive" });
      return;
    }
    const r = await adminFetch("/api/admin/settings/point-value", token, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usdPerPoint: num }),
    });
    if (!r.ok) {
      toast({ title: "Save failed", variant: "destructive" });
      return;
    }
    toast({ title: "Point value updated", description: `Now $${num.toFixed(4)}/pt — users will see the new value immediately.` });
    setEditing(false);
    refetch();
    queryClient.invalidateQueries({ queryKey: ["/api/platform/settings/point-value"] });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Point value</CardTitle>
            <CardDescription className="text-xs">
              How much one point is worth in USD. Shown to users on the Earn page.
            </CardDescription>
          </div>
          {!editing && (
            <Button size="sm" variant="outline" onClick={() => { setDraft(String(current)); setEditing(true); }}>
              <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {editing ? (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label className="text-xs">USD per point</Label>
              <div className="relative mt-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
                <Input
                  type="number" step="0.001" min="0"
                  value={draft} onChange={e => setDraft(e.target.value)}
                  className="pl-7"
                  autoFocus
                />
              </div>
            </div>
            <Button size="sm" onClick={save}>
              <Save className="h-3.5 w-3.5 mr-1.5" /> Save
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        ) : (
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-[#1a4480]">${current.toFixed(4)}</span>
            <span className="text-xs text-gray-500">per point</span>
            <span className="ml-auto text-xs text-gray-400">e.g. 100 pts ≈ ${(current * 100).toFixed(2)}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PayoutRow({
  row, usdPerPoint, adminWallet, token, onPaid,
}: {
  row: CompletionRow;
  usdPerPoint: number;
  adminWallet: string | null;
  token: string;
  onPaid: () => void;
}) {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [password, setPassword] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const authMethod = getAuthMethod();

  const usdAmount = row.pointsEarned * usdPerPoint;

  const openPay = async () => {
    if (!authMethod) {
      toast({
        title: "Sign in with Rift first",
        description: "Open the main app, sign in, and come back here — this admin pays out from their own Rift wallet.",
        variant: "destructive",
      });
      return;
    }
    setDialogOpen(true);
    setOtpCode(""); setPassword(""); setOtpSent(false);
    // For OTP users, ping the server to send the code right away.
    if (authMethod.kind !== "password") {
      setBusy("Sending code…");
      try {
        if (authMethod.kind === "email") await sendOtp({ email: authMethod.email });
        else await sendOtp({ phone: authMethod.phoneNumber });
        setOtpSent(true);
      } catch (e: any) {
        toast({ title: "Failed to send code", description: e?.message, variant: "destructive" });
      } finally { setBusy(null); }
    }
  };

  const confirm = async () => {
    if (!authMethod || !adminWallet) return;
    setBusy("Sending payment…");
    try {
      const creds: any = authMethod.kind === "password"
        ? { externalId: authMethod.externalId, password }
        : authMethod.kind === "email"
          ? { email: authMethod.email, otpCode }
          : { phoneNumber: authMethod.phoneNumber, otpCode };

      const res = await sendCrypto({
        to: row.walletAddress,
        value: usdAmount.toFixed(6),
        token: "USDC" as any,
        chain: "BASE" as any,
        type: "gasless" as any,
        ...creds,
      });
      const txHash = (res as any)?.transactionHash || (res as any)?.hash;
      if (!txHash) throw new Error("Rift did not return a transaction hash");

      // File the hash so the queue marks the row paid
      const r = await adminFetch(`/api/admin/task-completions/${row.completionId}/payout`, token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          txHash, amount: usdAmount.toFixed(6),
          token: "USDC", chainId: 8453, paidBy: adminWallet,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).message || "Failed to record payout");

      toast({ title: "Paid!", description: `Sent $${usdAmount.toFixed(2)} USDC to ${row.walletAddress.slice(0, 6)}…${row.walletAddress.slice(-4)}` });
      setDialogOpen(false);
      onPaid();
    } catch (e: any) {
      toast({ title: "Payment failed", description: e?.message || "Try again.", variant: "destructive" });
    } finally { setBusy(null); }
  };

  return (
    <>
      <tr className="border-b last:border-0 hover:bg-gray-50">
        <td className="p-3 font-mono text-xs">{row.walletAddress.slice(0, 6)}…{row.walletAddress.slice(-4)}</td>
        <td className="p-3">
          <div className="flex flex-col">
            <span className="text-sm font-medium text-gray-900">{row.taskTitle}</span>
            <span className="text-[10px] text-gray-400 uppercase tracking-wider">
              {row.taskIsDaily ? "Daily" : "One-time"} · {row.taskCategory}
              {row.taskVerifier?.startsWith("onchain:") && (
                <span className="ml-1 text-emerald-600 font-medium">· on-chain verified</span>
              )}
            </span>
          </div>
        </td>
        <td className="p-3 text-right font-mono tabular-nums text-sm">{row.pointsEarned}</td>
        <td className="p-3 text-right font-mono tabular-nums text-sm font-semibold text-[#1a4480]">${usdAmount.toFixed(2)}</td>
        <td className="p-3 text-xs text-gray-500">{new Date(row.completedAt).toLocaleDateString()}</td>
        <td className="p-3 text-right">
          {row.paidTxHash ? (
            <a
              href={`https://basescan.org/tx/${row.paidTxHash}`}
              target="_blank" rel="noopener noreferrer"
              className="text-xs text-emerald-600 hover:underline inline-flex items-center gap-0.5">
              Paid <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            <Button size="sm" onClick={openPay} className="bg-[#1a4480] hover:bg-[#153a6e] text-white h-8 text-xs">
              <Send className="h-3 w-3 mr-1" /> Pay
            </Button>
          )}
        </td>
      </tr>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-4 w-4" /> Pay {row.pointsEarned} pts via Rift
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border bg-gray-50 p-3 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-gray-500">To</span><span className="font-mono">{row.walletAddress.slice(0, 8)}…{row.walletAddress.slice(-6)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Task</span><span>{row.taskTitle}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Points</span><span className="font-mono tabular-nums">{row.pointsEarned}</span></div>
              <div className="flex justify-between pt-2 border-t border-gray-200">
                <span className="font-semibold">Amount</span>
                <span className="font-mono tabular-nums text-lg font-bold text-[#1a4480]">${usdAmount.toFixed(2)} USDC</span>
              </div>
              <div className="flex justify-between text-[10px] text-gray-400">
                <span>Network</span><span>Base · gasless · USDC</span>
              </div>
            </div>

            {authMethod?.kind === "password" ? (
              <div>
                <Label className="text-xs">Password</Label>
                <Input type="password" autoFocus value={password} onChange={e => setPassword(e.target.value)} placeholder="Your Rift password" />
              </div>
            ) : (
              <div>
                <Label className="text-xs">
                  Verification code
                  {authMethod ? <span className="text-gray-400 ml-1">— sent to {authMethod.kind === "email" ? (authMethod as any).email : (authMethod as any).phoneNumber}</span> : null}
                </Label>
                <Input
                  autoFocus
                  value={otpCode}
                  onChange={e => setOtpCode(e.target.value.trim())}
                  placeholder="Verification code"
                  className="font-mono tracking-widest uppercase"
                  maxLength={16}
                  autoComplete="one-time-code"
                />
                {!otpSent && busy === "Sending code…" && (
                  <p className="text-[10px] text-gray-400 mt-1">Sending code…</p>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={!!busy}>Cancel</Button>
              <Button
                onClick={confirm}
                disabled={!!busy || (authMethod?.kind === "password" ? !password : !otpCode)}
                className="bg-[#1a4480] hover:bg-[#153a6e]">
                {busy ? busy : `Send $${usdAmount.toFixed(2)}`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Row presented in the "Pending review" view — has evidence + approve/reject controls.
function ReviewRow({
  row, usdPerPoint, adminWallet, token, onReviewed,
}: {
  row: CompletionRow;
  usdPerPoint: number;
  adminWallet: string | null;
  token: string;
  onReviewed: () => void;
}) {
  const { toast } = useToast();
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);

  const act = async (kind: "approve" | "reject") => {
    if (!adminWallet) {
      toast({ title: "Sign in with Rift first", description: "Open the main app and sign in.", variant: "destructive" });
      return;
    }
    setBusy(kind);
    try {
      const r = await adminFetch(`/api/admin/task-completions/${row.completionId}/${kind}`, token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewer: adminWallet, notes: notes.trim() || undefined }),
      });
      if (!r.ok) throw new Error((await r.json()).message || "Failed");
      toast({
        title: kind === "approve" ? "Approved" : "Rejected",
        description: kind === "approve"
          ? `Credited ${row.pointsEarned} pts to ${row.walletAddress.slice(0, 6)}…${row.walletAddress.slice(-4)}`
          : `Submission marked rejected.`,
      });
      onReviewed();
    } catch (e: any) {
      toast({ title: "Failed", description: e?.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  return (
    <tr className="border-b last:border-0 align-top">
      <td className="p-3 font-mono text-xs whitespace-nowrap">
        {row.walletAddress.slice(0, 6)}…{row.walletAddress.slice(-4)}
      </td>
      <td className="p-3">
        <div className="flex flex-col">
          <span className="text-sm font-medium text-gray-900">{row.taskTitle}</span>
          <span className="text-[10px] text-gray-400 uppercase tracking-wider mt-0.5">
            {row.taskCategory} · {row.pointsEarned} pts ≈ ${(row.pointsEarned * usdPerPoint).toFixed(2)}
          </span>
          <div className="mt-2 space-y-2">
            {row.evidenceImage && (
              <a
                href={row.evidenceImage}
                target="_blank"
                rel="noopener noreferrer"
                title="Open full-size in new tab"
                className="block w-fit rounded-lg overflow-hidden border border-gray-200 hover:border-[#1a4480]/60 transition-colors"
              >
                <img
                  src={row.evidenceImage}
                  alt="Submitted evidence"
                  className="max-h-[140px] max-w-[260px] object-contain bg-gray-50"
                  loading="lazy"
                />
              </a>
            )}
            {row.evidenceUrl && (
              <a
                href={row.evidenceUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-[#1a4480] hover:underline break-all"
              >
                {row.evidenceUrl} <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            )}
            {row.evidenceText && (
              <p className="text-[11px] text-gray-600 italic">"{row.evidenceText}"</p>
            )}
            {!row.evidenceImage && !row.evidenceUrl && !row.evidenceText && (
              <p className="text-[11px] text-gray-400 italic">No evidence provided.</p>
            )}
          </div>
        </div>
      </td>
      <td className="p-3 text-xs text-gray-500 whitespace-nowrap">
        {new Date(row.completedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
      </td>
      <td className="p-3">
        <div className="space-y-2 min-w-[200px]">
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional note (visible in admin records)"
            className="h-8 text-xs"
          />
          <div className="flex gap-1.5">
            <Button
              size="sm"
              onClick={() => act("approve")}
              disabled={!!busy}
              className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs flex-1"
            >
              {busy === "approve" ? "…" : <><CheckCircle className="h-3 w-3 mr-1" /> Approve</>}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => act("reject")}
              disabled={!!busy}
              className="h-8 text-xs flex-1 border-red-200 text-red-700 hover:bg-red-50"
            >
              {busy === "reject" ? "…" : <><X className="h-3 w-3 mr-1" /> Reject</>}
            </Button>
          </div>
        </div>
      </td>
    </tr>
  );
}

function PayoutsSection() {
  const { token } = useContext(AdminTokenContext);
  const [filter, setFilter] = useState<"pending" | "unpaid" | "paid" | "all">("pending");
  // The admin's own Rift wallet address — used as `paidBy` on the audit trail.
  const adminWallet = getCachedUserSummary()?.address ?? null;

  const { data: pointValue } = useQuery<{ usdPerPoint: number }>({
    queryKey: ["admin-point-value", token],
    queryFn: async () => {
      const r = await adminFetch("/api/admin/settings/point-value", token);
      return r.json();
    },
  });
  const usdPerPoint = pointValue?.usdPerPoint ?? 0.05;

  const { data: rows = [], refetch, isLoading } = useQuery<CompletionRow[]>({
    queryKey: ["admin-task-completions", filter, token],
    queryFn: async () => {
      const r = await adminFetch(`/api/admin/task-completions?status=${filter}&limit=200`, token);
      return r.json();
    },
  });

  const unpaidTotal = rows.filter(r => !r.paidTxHash).reduce((s, r) => s + r.pointsEarned * usdPerPoint, 0);
  const isReviewMode = filter === "pending";

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Payouts &amp; Reviews</h1>
        <p className="text-sm text-gray-500 mt-1">
          Approve manual submissions and pay out earned points. Payments send from your Rift wallet via OTP.
        </p>
      </div>

      <PayoutValueCard token={token} />

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <CardTitle className="text-base">
                {isReviewMode ? "Submissions awaiting review" : "Task completions"}
              </CardTitle>
              <CardDescription className="text-xs">
                {isReviewMode
                  ? `${rows.length} pending submission(s) — approve to credit points`
                  : filter === "unpaid"
                    ? `${rows.length} pending · $${unpaidTotal.toFixed(2)} total owed`
                    : `${rows.length} record(s)`}
              </CardDescription>
            </div>
            <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 flex-wrap">
              {([
                { key: "pending", label: "Pending" },
                { key: "unpaid", label: "Unpaid" },
                { key: "paid", label: "Paid" },
                { key: "all", label: "All" },
              ] as const).map(s => (
                <button key={s.key}
                  onClick={() => setFilter(s.key)}
                  className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                    filter === s.key ? "bg-white text-[#1a4480] shadow-sm" : "text-gray-500 hover:text-gray-900"
                  }`}>
                  {s.label}
                </button>
              ))}
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => refetch()} title="Refresh">
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {!adminWallet && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 mb-3 text-xs text-amber-800">
              You're not signed in to Rift in this browser. Open <a href="/auth" className="underline">/auth</a> and sign in
              before reviewing or paying — admin actions are signed from your Rift wallet.
            </div>
          )}
          {isReviewMode ? (
            <table className="w-full text-sm min-w-[720px]">
              <thead className="text-xs text-gray-500 uppercase tracking-wider">
                <tr className="border-b">
                  <th className="text-left p-3 font-medium">User</th>
                  <th className="text-left p-3 font-medium">Task &amp; Evidence</th>
                  <th className="text-left p-3 font-medium">Submitted</th>
                  <th className="text-left p-3 font-medium">Review</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={4} className="p-6 text-center text-gray-400 text-sm">Loading…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={4} className="p-8 text-center text-gray-400 text-sm">No submissions waiting for review.</td></tr>
                ) : rows.map(r => (
                  <ReviewRow
                    key={r.completionId}
                    row={r}
                    usdPerPoint={usdPerPoint}
                    adminWallet={adminWallet}
                    token={token}
                    onReviewed={() => refetch()}
                  />
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-sm min-w-[720px]">
              <thead className="text-xs text-gray-500 uppercase tracking-wider">
                <tr className="border-b">
                  <th className="text-left p-3 font-medium">User</th>
                  <th className="text-left p-3 font-medium">Task</th>
                  <th className="text-right p-3 font-medium">Points</th>
                  <th className="text-right p-3 font-medium">USD</th>
                  <th className="text-left p-3 font-medium">Completed</th>
                  <th className="text-right p-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={6} className="p-6 text-center text-gray-400 text-sm">Loading…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={6} className="p-8 text-center text-gray-400 text-sm">
                    {filter === "unpaid" ? "No pending payouts." : filter === "paid" ? "No paid completions yet." : "No completions yet."}
                  </td></tr>
                ) : rows.map(r => (
                  <PayoutRow
                    key={r.completionId}
                    row={r}
                    usdPerPoint={usdPerPoint}
                    adminWallet={adminWallet}
                    token={token}
                    onPaid={() => refetch()}
                  />
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminDashboard() {
  const [section, setSection] = useState<Section>(() => window.location.hash === "#docs" ? "docs" : "dashboard");
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
      <AdminLayout section={section} setSection={setSection} adminToken={adminToken} logout={logout} />
    </AdminTokenContext.Provider>
  );
}

function AdminLayout({
  section, setSection, adminToken, logout,
}: { section: Section; setSection: (s: Section) => void; adminToken: string; logout: () => void }) {
  // Live count of submissions awaiting review — drives the sidebar badge so
  // the admin sees right away that there's work to do without clicking in.
  const { data: pendingRows } = useQuery<any[]>({
    queryKey: ["admin-pending-count", adminToken],
    queryFn: async () => {
      const r = await adminFetch("/api/admin/task-completions?status=pending&limit=200", adminToken);
      return r.json();
    },
    refetchInterval: 30_000,
  });
  const pendingCount = Array.isArray(pendingRows) ? pendingRows.length : 0;

  const badgeFor = (key: Section) =>
    key === "payouts" && pendingCount > 0 ? (
      <span className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-amber-500 text-white text-[10px] font-bold tabular-nums">
        {pendingCount}
      </span>
    ) : null;

  return (
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
              <span className="flex-1 text-left">{item.label}</span>
              {badgeFor(item.key)}
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
        {section === "docs" && <DocumentsSection token={adminToken} />}
        {section === "dashboard" && <DashboardSection />}
        {section === "users" && <UsersSection />}
        {section === "hedge" && <HedgeSection />}
        {section === "revenue" && <RevenueSection />}
        {section === "tasks" && <TasksSection />}
        {section === "payouts" && <PayoutsSection />}
        {section === "analytics" && <AnalyticsSection />}
        {section === "content" && <ContentSection />}
        {section === "agreements" && <LoiSection token={adminToken} />}
        {section === "agent" && <AgentSection token={adminToken} />}
        {section === "compliance" && <ComplianceSection token={adminToken} />}
        {section === "protocol" && <ProtocolSection />}
      </main>
    </div>
  );
}
