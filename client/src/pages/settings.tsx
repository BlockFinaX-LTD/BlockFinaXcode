import { useState } from 'react';
import { useLocation } from 'wouter';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
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
  Key,
  BookOpen,
  Trash2,
  Lock,
  Globe,
  ExternalLink,
  FileText,
  ChevronRight,
  Clock,
  DollarSign,
  AlertTriangle,
  Eye,
  EyeOff,
  Copy,
  CheckCircle,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useWallet } from '@/hooks/use-wallet';
import { BottomNav } from '@/components/bottom-nav';
import logoPath from "@/assets/logo.png";

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

export default function SettingsPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { wallet, settings, updateSettings, deleteWallet, lockWallet, isUnlocked } = useWallet();

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [copied, setCopied] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  const copyToClipboard = async (text: string) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for environments where clipboard API is unavailable
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
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
    setLocation('/wallet');
  };

  const SettingRow = ({
    icon: Icon,
    label,
    sublabel,
    onClick,
    children,
    danger,
  }: {
    icon: any;
    label: string;
    sublabel?: string;
    onClick?: () => void;
    children?: React.ReactNode;
    danger?: boolean;
  }) => (
    <div
      onClick={children ? undefined : onClick}
      role={!children && onClick ? 'button' : undefined}
      className={`w-full flex items-center justify-between px-4 py-3.5 hover:bg-muted/50 transition-colors ${!children && onClick ? 'cursor-pointer' : 'cursor-default'}`}
    >
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${danger ? 'bg-red-100 dark:bg-red-900/30' : 'bg-muted'}`}>
          <Icon className={`h-4 w-4 ${danger ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`} />
        </div>
        <div className="text-left">
          <p className={`text-sm font-medium ${danger ? 'text-red-600 dark:text-red-400' : ''}`}>{label}</p>
          {sublabel && <p className="text-xs text-muted-foreground">{sublabel}</p>}
        </div>
      </div>
      {children ? (
        <div>{children}</div>
      ) : onClick ? (
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      ) : null}
    </div>
  );

  const SectionHeader = ({ title }: { title: string }) => (
    <div className="px-4 pt-5 pb-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b border-border/50">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => setLocation('/home')} className="p-1.5 hover:bg-muted rounded-lg transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <img src={logoPath} alt="BlockFinaX" className="h-6 w-auto" />
          <h1 className="text-lg font-semibold">Settings</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto">

        {/* SECURITY */}
        <SectionHeader title="Security" />
        <Card className="mx-4 overflow-hidden">
          <CardContent className="p-0 divide-y divide-border/50">

            <SettingRow
              icon={Lock}
              label="Auto-lock"
              sublabel={settings.autoLock ? `Locks after ${settings.autoLockTimeout} min` : 'Disabled'}
            >
              <Switch
                checked={settings.autoLock}
                onCheckedChange={(v) => updateSettings({ autoLock: v })}
              />
            </SettingRow>

            {settings.autoLock && (
              <SettingRow icon={Clock} label="Lock after" sublabel="Inactivity timeout">
                <Select
                  value={String(settings.autoLockTimeout)}
                  onValueChange={(v) => updateSettings({ autoLockTimeout: parseInt(v) })}
                >
                  <SelectTrigger className="w-32 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AUTO_LOCK_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingRow>
            )}

            {/* Export private key + Backup recovery phrase removed — Rift custodies the
                key material; users authenticate via OTP/password rather than holding a seed. */}

            <SettingRow
              icon={Trash2}
              label="Delete wallet"
              sublabel="Permanently remove from this device"
              onClick={() => setShowDeleteDialog(true)}
              danger
            />

          </CardContent>
        </Card>

        {/* PREFERENCES */}
        <SectionHeader title="Preferences" />
        <Card className="mx-4 overflow-hidden">
          <CardContent className="p-0 divide-y divide-border/50">

            <SettingRow icon={DollarSign} label="Display currency" sublabel="Used for balance estimates">
              <Select
                value={settings.currency}
                onValueChange={(v: any) => updateSettings({ currency: v })}
              >
                <SelectTrigger className="w-36 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map(c => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingRow>

          </CardContent>
        </Card>

        {/* NETWORK */}
        <SectionHeader title="Network" />
        <Card className="mx-4 overflow-hidden">
          <CardContent className="p-0 divide-y divide-border/50">

            <div className="flex items-center justify-between px-4 py-3.5">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium">Lisk Mainnet</p>
                  <p className="text-xs text-muted-foreground">Chain ID 1135 · Live network</p>
                </div>
              </div>
              <Badge variant="secondary" className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                Live
              </Badge>
            </div>

            <SettingRow
              icon={ExternalLink}
              label="Block explorer"
              sublabel="View transactions on Blockscout"
              onClick={() => window.open('https://blockscout.lisk.com', '_blank')}
            />

          </CardContent>
        </Card>

        {/* LEGAL */}
        <SectionHeader title="Legal" />
        <Card className="mx-4 overflow-hidden">
          <CardContent className="p-0 divide-y divide-border/50">

            <SettingRow
              icon={FileText}
              label="Terms of Service"
              onClick={() => setLocation('/terms')}
            />

            <SettingRow
              icon={Shield}
              label="Privacy Policy"
              onClick={() => setLocation('/privacy')}
            />

          </CardContent>
        </Card>

        {/* Wallet address */}
        {wallet?.address && (
          <div className="mx-4 mt-5 mb-2">
            <p className="text-xs text-muted-foreground mb-1 px-1">Your wallet address</p>
            <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2">
              <p className="font-mono text-xs text-muted-foreground flex-1 truncate">{wallet.address}</p>
              <button onClick={() => copyToClipboard(wallet.address)}>
                {copied ? <CheckCircle className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4 text-muted-foreground" />}
              </button>
            </div>
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground mt-6 mb-4">BlockFinaX · Lisk Mainnet</p>
      </div>

      {/* Delete Wallet Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="h-5 w-5" />
              Remove Wallet
            </DialogTitle>
            <DialogDescription>
              This will remove your wallet link from this device.
              Your wallet is secured by your Google account via Lit Protocol — you can reconnect anytime by signing in again.
              <strong className="block mt-2 text-foreground">This action cannot be undone on this device.</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-sm">Type <strong>DELETE</strong> to confirm</Label>
              <Input
                className="mt-1.5"
                placeholder="DELETE"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowDeleteDialog(false); setDeleteConfirmText(''); }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteConfirmText !== 'DELETE'}
              onClick={handleDeleteWallet}
            >
              Remove Wallet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BottomNav />
    </div>
  );
}
