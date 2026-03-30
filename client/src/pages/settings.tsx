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
  const { wallet, settings, updateSettings, exportPrivateKey, exportMnemonic, deleteWallet, lockWallet, isUnlocked } = useWallet();

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showKeyDialog, setShowKeyDialog] = useState(false);
  const [showPhraseDialog, setShowPhraseDialog] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [revealedPhrase, setRevealedPhrase] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: 'Copied to clipboard' });
  };

  const handleRevealKey = () => {
    try {
      const key = exportPrivateKey();
      setRevealedKey(key);
      setPinError('');
    } catch {
      setPinError('Failed to export key. Make sure your wallet is unlocked.');
    }
  };

  const handleRevealPhrase = () => {
    try {
      const phrase = exportMnemonic();
      if (!phrase) {
        setPinError('No recovery phrase available for this wallet (imported via private key).');
        return;
      }
      setRevealedPhrase(phrase);
      setPinError('');
    } catch {
      setPinError('Failed to export recovery phrase.');
    }
  };

  const handleCloseKeyDialog = () => {
    setShowKeyDialog(false);
    setRevealedKey(null);
    setShowKey(false);
    setPinInput('');
    setPinError('');
  };

  const handleClosePhraseDialog = () => {
    setShowPhraseDialog(false);
    setRevealedPhrase(null);
    setPinInput('');
    setPinError('');
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
    <button
      onClick={onClick}
      className={`w-full flex items-center justify-between px-4 py-3.5 hover:bg-muted/50 transition-colors ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
      disabled={!onClick && !children}
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
        <div onClick={e => e.stopPropagation()}>{children}</div>
      ) : onClick ? (
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      ) : null}
    </button>
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

            <SettingRow
              icon={Key}
              label="Export private key"
              sublabel="Show the raw key for this wallet"
              onClick={() => { setRevealedKey(null); setShowKey(false); setShowKeyDialog(true); }}
            />

            <SettingRow
              icon={BookOpen}
              label="Backup recovery phrase"
              sublabel="12-word seed phrase"
              onClick={() => { setRevealedPhrase(null); setShowPhraseDialog(true); }}
            />

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

      {/* Export Private Key Dialog */}
      <Dialog open={showKeyDialog} onOpenChange={handleCloseKeyDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              Export Private Key
            </DialogTitle>
            <DialogDescription>
              Your private key gives full access to your wallet. Never share it with anyone.
              Anyone with this key can steal all your funds.
            </DialogDescription>
          </DialogHeader>

          {!revealedKey ? (
            <div className="space-y-4">
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3 text-sm text-yellow-800 dark:text-yellow-300">
                Make sure no one is looking at your screen before proceeding.
              </div>
              {pinError && <p className="text-sm text-red-500">{pinError}</p>}
              <DialogFooter>
                <Button variant="outline" onClick={handleCloseKeyDialog}>Cancel</Button>
                <Button variant="destructive" onClick={handleRevealKey}>Reveal Key</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="relative bg-muted rounded-lg p-3">
                <p className="font-mono text-xs break-all pr-8 select-all">
                  {showKey ? revealedKey : '•'.repeat(64)}
                </p>
                <button
                  onClick={() => setShowKey(!showKey)}
                  className="absolute top-3 right-3 text-muted-foreground hover:text-foreground"
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button className="w-full" variant="outline" onClick={() => copyToClipboard(revealedKey)}>
                <Copy className="h-4 w-4 mr-2" /> Copy Key
              </Button>
              <Button className="w-full" onClick={handleCloseKeyDialog}>Done</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Backup Phrase Dialog */}
      <Dialog open={showPhraseDialog} onOpenChange={handleClosePhraseDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              Recovery Phrase
            </DialogTitle>
            <DialogDescription>
              Your 12-word recovery phrase is the master backup for your wallet.
              Store it offline in a safe place — never share it with anyone.
            </DialogDescription>
          </DialogHeader>

          {!revealedPhrase ? (
            <div className="space-y-4">
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3 text-sm text-yellow-800 dark:text-yellow-300">
                Make sure no one is looking at your screen before proceeding.
              </div>
              {pinError && <p className="text-sm text-red-500">{pinError}</p>}
              <DialogFooter>
                <Button variant="outline" onClick={handleClosePhraseDialog}>Cancel</Button>
                <Button variant="destructive" onClick={handleRevealPhrase}>Reveal Phrase</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                {revealedPhrase.split(' ').map((word, i) => (
                  <div key={i} className="bg-muted rounded-lg px-2 py-1.5 flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground w-4">{i + 1}.</span>
                    <span className="text-sm font-medium">{word}</span>
                  </div>
                ))}
              </div>
              <Button className="w-full" variant="outline" onClick={() => copyToClipboard(revealedPhrase)}>
                <Copy className="h-4 w-4 mr-2" /> Copy All Words
              </Button>
              <Button className="w-full" onClick={handleClosePhraseDialog}>Done</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Wallet Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="h-5 w-5" />
              Delete Wallet
            </DialogTitle>
            <DialogDescription>
              This will permanently remove your wallet from this device.
              Make sure you have backed up your private key or recovery phrase before proceeding.
              <strong className="block mt-2 text-foreground">This action cannot be undone.</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-800 dark:text-red-300">
              You will lose access to your funds if you have not backed up your wallet.
            </div>
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
              Delete Wallet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BottomNav />
    </div>
  );
}
