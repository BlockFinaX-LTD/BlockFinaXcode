/** Whether this build is the testnet app (VITE_NETWORK_MODE=testnet). */
export const isWalletSandbox = import.meta.env.VITE_NETWORK_MODE === 'testnet';

const env = import.meta.env;

export const SANDBOX_CHAIN_ID = 84532;
export const walletDefaultChainId = isWalletSandbox ? SANDBOX_CHAIN_ID : 8453;
export const sandboxTokenAddress = (env.VITE_SANDBOX_USD_ADDRESS || '').trim();
export const sandboxDiamondAddress = (env.VITE_SANDBOX_DIAMOND_ADDRESS || '').trim();
export const sandboxSigningMessage = 'Testnet signing is not connected yet. Transfers and contract transactions are unavailable.';
export function assertWalletTransactionsEnabled() {
  if (isWalletSandbox) throw new Error(sandboxSigningMessage);
}
