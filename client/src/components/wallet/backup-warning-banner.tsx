/**
 * backup-warning-banner.tsx
 *
 * Shown on the home and wallet pages for any user who skipped backing up their
 * seed phrase during wallet creation. Persists across sessions until they
 * confirm they've saved it. Can be hidden for the current session with the ×
 * button, but re-appears on the next login.
 */

import { useState } from 'react';
import { AlertTriangle, Copy, Shield, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useWallet } from '@/hooks/use-wallet';

// localStorage key (per wallet address) that marks backup as skipped
export const BACKUP_SKIPPED_KEY = (address: string) => `bfx_backup_skipped_${address.toLowerCase()}`;
// sessionStorage key — user hid the banner for this session only
const BANNER_SESSION_HIDDEN = 'bfx_banner_session_hidden';

export function BackupWarningBanner() {
  const { wallet, exportMnemonic } = useWallet();
  const address = wallet?.address ?? '';

  // Check if the flag was set (skipped backup)
  const isSkipped = address ? !!localStorage.getItem(BACKUP_SKIPPED_KEY(address)) : false;
  // Check if they hid it for this session
  const isHiddenThisSession = !!sessionStorage.getItem(BANNER_SESSION_HIDDEN);

  const [visible, setVisible] = useState(isSkipped && !isHiddenThisSession);
  const [backupOpen, setBackupOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!visible || !address) return null;

  const mnemonic = exportMnemonic() ?? '';

  const handleDismissSession = () => {
    sessionStorage.setItem(BANNER_SESSION_HIDDEN, '1');
    setVisible(false);
  };

  const handleConfirmedSaved = () => {
    localStorage.removeItem(BACKUP_SKIPPED_KEY(address));
    setBackupOpen(false);
    setVisible(false);
  };

  const handleCopy = async () => {
    if (!mnemonic) return;
    await navigator.clipboard.writeText(mnemonic);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      {/* Warning banner */}
      <div className="mx-4 mt-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 flex items-start gap-3">
        <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-300 leading-snug">
            Your secret phrase is not backed up
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5 leading-snug">
            Without it, you cannot recover your wallet if you lose access to this device.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-2 h-7 text-xs border-amber-400 dark:border-amber-600 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50"
            onClick={() => setBackupOpen(true)}
          >
            <Shield className="w-3 h-3 mr-1" />
            Back up now
          </Button>
        </div>
        <button
          onClick={handleDismissSession}
          className="text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 shrink-0 mt-0.5"
          aria-label="Dismiss for now"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Backup dialog */}
      <Dialog open={backupOpen} onOpenChange={setBackupOpen}>
        <DialogContent className="max-w-sm mx-auto">
          <DialogHeader>
            <div className="h-12 w-12 rounded-full bg-amber-50 dark:bg-amber-950 flex items-center justify-center mx-auto mb-2">
              <Shield className="h-6 w-6 text-amber-500" />
            </div>
            <DialogTitle className="text-center">Back up your secret phrase</DialogTitle>
            <DialogDescription className="text-center">
              Write these 12 words down in order and store them somewhere safe. Never share them with anyone.
            </DialogDescription>
          </DialogHeader>

          {mnemonic ? (
            <div className="grid grid-cols-3 gap-2 my-4">
              {mnemonic.split(' ').map((word, i) => (
                <div key={i} className="flex items-center gap-1.5 bg-muted rounded-lg px-2 py-2">
                  <span className="text-[10px] text-muted-foreground w-4 shrink-0">{i + 1}.</span>
                  <span className="text-sm font-mono font-medium">{word}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="my-4 bg-muted rounded-lg p-4 text-center text-sm text-muted-foreground">
              Unlock your wallet to view your secret phrase.
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Button variant="outline" className="w-full" onClick={handleCopy} disabled={!mnemonic}>
              <Copy className="h-4 w-4 mr-2" />
              {copied ? 'Copied!' : 'Copy all words'}
            </Button>
            <Button className="w-full" onClick={handleConfirmedSaved}>
              I've saved my secret phrase
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
