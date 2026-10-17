import path from 'node:path';
import { ethers } from 'ethers';
import { createSandboxWalletApp } from './wallet-app';

async function start() {
if (process.env.APP_ENV !== 'sandbox' || process.env.VITE_NETWORK_MODE !== 'testnet') {
  throw new Error('Wallet sandbox requires APP_ENV=sandbox and VITE_NETWORK_MODE=testnet');
}
const rpcUrl = process.env.SANDBOX_RPC_URL || 'https://sepolia.base.org';
const provider = new ethers.JsonRpcProvider(rpcUrl);
const network = await provider.getNetwork();
if (network.chainId !== BigInt(84532)) throw new Error('Wallet sandbox RPC must be Base Sepolia (84532)');
const tokenAddress = process.env.VITE_SANDBOX_USD_ADDRESS;
const diamondAddress = process.env.VITE_SANDBOX_DIAMOND_ADDRESS;
for (const address of [tokenAddress, diamondAddress].filter(Boolean)) {
  if (!ethers.isAddress(address!) || await provider.getCode(address!) === '0x') throw new Error('Configured sandbox contract has no testnet bytecode');
}
const app = createSandboxWalletApp({ rpcUrl, tokenAddress, diamondAddress, publicDir: path.resolve('dist/public') });
app.listen(Number(process.env.PORT || 5002), '0.0.0.0', () => console.log('BlockFinaX wallet sandbox listening on Base Sepolia'));

}
start().catch(error => { console.error(error instanceof Error ? error.message : 'Wallet sandbox startup failed'); process.exitCode = 1; });
