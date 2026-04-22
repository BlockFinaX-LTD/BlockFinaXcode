/**
 * backup-warning-banner.tsx
 *
 * No longer needed — Lit Protocol wallets have no seed phrase to back up.
 * The user's Google identity IS their wallet key.
 * Kept as a no-op export to avoid breaking imports.
 */

export const BACKUP_SKIPPED_KEY = (_address: string) => `bfx_backup_skipped_${_address.toLowerCase()}`;

export function BackupWarningBanner() {
  return null;
}
