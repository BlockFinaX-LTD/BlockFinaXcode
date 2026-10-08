/** Explicit isolation for the wallet sandbox. Rift DEVELOPMENT uses production URLs. */
export const isWalletSandbox = import.meta.env.VITE_NETWORK_MODE === 'testnet';

const env = import.meta.env;
// Reuse the existing sign-in project until a dedicated sandbox project is supplied.
// Sandbox credentials take precedence, so switching projects needs no code change.
const currentKey = (env.VITE_RIFT_PUBLIC_KEY || env.VITE_RIFT_API_KEY || '').trim();
const currentWidgetUrl = (env.VITE_RIFT_WIDGET_URL || 'https://widget.blockfinax.com').trim();
const sandboxKey = (env.VITE_SANDBOX_RIFT_PUBLIC_KEY || currentKey).trim();
export const walletRiftKey = isWalletSandbox
  ? (sandboxKey.startsWith('pk_') ? sandboxKey : '')
  : currentKey;
export const walletWidgetUrl = isWalletSandbox
  ? (env.VITE_SANDBOX_RIFT_WIDGET_URL || currentWidgetUrl).trim()
  : currentWidgetUrl;
export const walletSdkUrl = isWalletSandbox
  ? (env.VITE_SANDBOX_RIFT_SDK_URL || 'https://payment.riftfi.xyz').trim()
  : undefined;
export const walletSigningUrl = isWalletSandbox
  ? (env.VITE_SANDBOX_RIFT_SIGNING_URL || 'https://sandbox-unconfigured.invalid').trim()
  : (env.VITE_RIFT_API_BASE || 'https://service.riftfi.xyz').trim();

// Auth may reuse the current project; transaction signing stays isolated.
export const SANDBOX_CHAIN_ID = 84532;
export const walletDefaultChainId = isWalletSandbox ? SANDBOX_CHAIN_ID : 8453;
export const sandboxTokenAddress = (env.VITE_SANDBOX_USD_ADDRESS || '').trim();
export const sandboxDiamondAddress = (env.VITE_SANDBOX_DIAMOND_ADDRESS || '').trim();
export const sandboxSigningMessage = 'Testnet signing is not connected yet. Transfers and contract transactions are unavailable.';
export function assertWalletTransactionsEnabled() {
  if (isWalletSandbox) throw new Error(sandboxSigningMessage);
}
