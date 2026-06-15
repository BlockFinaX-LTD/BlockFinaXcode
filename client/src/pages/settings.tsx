/**
 * Settings — BlockFinaX 2026 redesign
 *
 * Grouped settings list: Security, Preferences, Network, Legal.
 * Each group is a rounded card with divided rows. Value renders on the
 * right (mono if numeric/short, switch if boolean, chevron if drill-in).
 */
import { useState } from 'react';
import { useLocation } from 'wouter';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ArrowLeft,
  Shield,
  Trash2,
  Lock,
  Globe,
  ExternalLink,
  FileText,
  ChevronRight,
  Clock,
  DollarSign,
  Copy,
  CheckCircle,
  LogOut,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useWallet } from '@/hooks/use-wallet';
import { BottomNav } from '@/components/bottom-nav';
import { Pill, Dot, shortAddr } from '@/components/ui/bfx';

const CURRENCIES = [
  { value: 'USD', label: 'USD — US Dollar' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'GBP', label: 'GBP — British Pound' },
  { value: 'NGN', label: 'NGN — Nigerian Naira' },
  { value: 'GHS', label: 'GHS — Ghanaian Cedi' },
  { value: 'KES', label: 'KES — Kenyan Shilling' },
  { value: 'ZAR', label: 'ZAR — South African Rand' },
];

const AUTO_LOCK_OPTIONS = [
  { value: '1', label: '1 minute' },
  { value: '5', label: '5 minutes' },
  { value: '15', label: '15 minutes' },
  { value: '30', label: '30 minutes' },
  { value: '60', label: '1 hour' },
];

function SectionHd({ title }: { title: string }) {
  return (
    <p className="px-1 pt-5 pb-2 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
      {title}
    </p>
  );
}

function Row({
  icon: Icon,
  label,
  sub,
  onClick,
  trailing,
  danger,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  sub?: string;
  onClick?: () => void;
  trailing?: React.ReactNode;
  danger?: boolean;
}) {
  const interactive = !!onClick && !trailing;
  return (
    <div
      onClick={interactive ? onClick : undefined}
      role={interactive ? 'button' : undefined}
      className={`flex items-center justify-between px-4 py-3.5 transition-colors ${
        interactive ? 'cursor-pointer hover:bg-muted/50' : 'cursor-default'
      }`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div
          className={`h-9 w-9 rounded-full inline-flex items-center justify-center shrink-0 ${
            danger
              ? 'bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-400'
              : 'bg-muted text-muted-foreground'
          }`}
        >
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.7} />
        </div>
        <div className="min-w-0">
          <p className={`text-sm font-medium truncate ${danger ? 'text-red-600 dark:text-red-400' : ''}`}>
            {label}
          </p>
          {sub && <p className="text-[11px] text-muted-foreground truncate">{sub}</p>}
        </div>
      </div>
      <div className="shrink-0">
        {trailing ? trailing : interactive ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : null}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { wallet, settings, updateSettings, deleteWallet, isUnlocked } = useWallet();

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [copied, setCopied] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: 'Copied to clipboard' });
    } catch {
      toast({ title: 'Copy failed — please select and copy manually', variant: 'destructive' });
    }
  };

  const handleDeleteWallet = () => {
    deleteWallet();
    setShowDeleteDialog(false);
    setLocation('/auth');
  };

  if (!isUnlocked) return null;

  return (
    <div className="min-h-screen bg-background pb-28">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/70 border-b border-border/60">
        <div className="max-w-2xl mx-auto px-3 h-14 flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation('/home')}
            className="h-9 w-9 rounded-full"
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="bfx-display text-[17px] font-semibold tracking-tight">Settings</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4">
        {/* SECURITY */}
        <SectionHd title="Security" />
        <Card className="rounded-2xl overflow-hidden">
          <CardContent className="p-0 divide-y divide-border/60">
            <Row
              icon={Lock}
              label="Auto-lock"
              sub={settings.autoLock ? `Locks after ${settings.autoLockTimeout} min` : 'Disabled'}
              trailing={
                <Switch
                  checked={settings.autoLock}
                  onCheckedChange={(v) => updateSettings({ autoLock: v })}
                />
              }
            />
            {settings.autoLock && (
              <Row
                icon={Clock}
                label="Lock after"
                sub="Inactivity timeout"
                trailing={
                  <Select
                    value={String(settings.autoLockTimeout)}
                    onValueChange={(v) => updateSettings({ autoLockTimeout: parseInt(v) })}
                  >
                    <SelectTrigger className="w-32 h-8 text-xs rounded-lg">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AUTO_LOCK_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                }
              />
            )}
            <Row
              icon={Trash2}
              danger
              label="Delete wallet"
              sub="Permanently remove from this device"
              onClick={() => setShowDeleteDialog(true)}
            />
          </CardContent>
        </Card>

        {/* PREFERENCES */}
        <SectionHd title="Preferences" />
        <Card className="rounded-2xl overflow-hidden">
          <CardContent className="p-0 divide-y divide-border/60">
            <Row
              icon={DollarSign}
              label="Display currency"
              sub="Used for balance estimates"
              trailing={
                <Select
                  value={settings.currency}
                  onValueChange={(v: any) => updateSettings({ currency: v })}
                >
                  <SelectTrigger className="w-36 h-8 text-xs rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              }
            />
          </CardContent>
        </Card>

        {/* NETWORK */}
        <SectionHd title="Network" />
        <Card className="rounded-2xl overflow-hidden">
          <CardContent className="p-0 divide-y divide-border/60">
            <Row
              icon={Globe}
              label="Base Mainnet"
              sub="Chain ID 8453 · Live network"
              trailing={
                <Pill tone="success" uppercase={false}>
                  <Dot size={4} className="text-emerald-500" /> Live
                </Pill>
              }
            />
            <Row
              icon={Globe}
              label="BNB Smart Chain"
              sub="Chain ID 56 · Live network"
              trailing={
                <Pill tone="success" uppercase={false}>
                  <Dot size={4} className="text-emerald-500" /> Live
                </Pill>
              }
            />
            <Row
              icon={ExternalLink}
              label="Block explorer"
              sub="View transactions on Basescan"
              onClick={() => window.open('https://basescan.org', '_blank')}
            />
          </CardContent>
        </Card>

        {/* LEGAL */}
        <SectionHd title="Legal" />
        <Card className="rounded-2xl overflow-hidden">
          <CardContent className="p-0 divide-y divide-border/60">
            <Row icon={FileText} label="Terms of service" onClick={() => setLocation('/terms')} />
            <Row icon={Shield} label="Privacy policy" onClick={() => setLocation('/privacy')} />
          </CardContent>
        </Card>

        {/* Wallet address */}
        {wallet?.address && (
          <div className="mt-5">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5 px-1">
              Your wallet address
            </p>
            <div className="flex items-center gap-2 bg-muted/50 rounded-xl px-3.5 py-3 border border-border/60">
              <p className="font-mono-data text-[12px] text-muted-foreground flex-1 truncate">
                {wallet.address}
              </p>
              <button
                onClick={() => copyToClipboard(wallet.address)}
                className="shrink-0 inline-flex items-center justify-center h-8 w-8 rounded-full hover:bg-background"
                aria-label="Copy address"
              >
                {copied ? (
                  <CheckCircle className="h-4 w-4 text-emerald-500" />
                ) : (
                  <Copy className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5 px-1 font-mono-data">
              {shortAddr(wallet.address)} · Base &amp; BSC Mainnet
            </p>
          </div>
        )}

        <p className="text-center text-[11px] text-muted-foreground mt-8 mb-2">
          BlockFinaX · Base &amp; BNB Smart Chain
        </p>
      </main>

      {/* Delete Wallet Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="h-5 w-5" />
              Remove Wallet
            </DialogTitle>
            <DialogDescription>
              This will remove your wallet link from this device. Your wallet is secured by your Rift
              sign-in — you can reconnect anytime by signing in again.
              <strong className="block mt-2 text-foreground">
                This action cannot be undone on this device.
              </strong>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-sm">
                Type <strong>DELETE</strong> to confirm
              </Label>
              <Input
                className="mt-1.5"
                placeholder="DELETE"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowDeleteDialog(false);
                setDeleteConfirmText('');
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteConfirmText !== 'DELETE'}
              onClick={handleDeleteWallet}
            >
              <LogOut className="h-4 w-4 mr-1.5" />
              Remove wallet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BottomNav />
    </div>
  );
}
