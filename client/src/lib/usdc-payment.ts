/**
 * USDC Payment - On-chain USDC payment verification and processing
 *
 * Sends USDC payments with balance validation and transaction confirmation.
 * Exports: sendUSDCPayment
 */
import { ethers } from "ethers";
import { getNetworkById, getNetworkByChainId } from "./networks";
import { getTokensForNetwork } from "./tokens";

function chainIdToNetworkId(chainId: number): number {
  if (chainId === 1135) return 1;   // Lisk Mainnet
  if (chainId === 4202) return 2;   // Lisk Sepolia
  return chainId;
}

function getUsdcConfig(chainId: number): { address: string; rpcUrl: string; decimals: number } | null {
  const networkId = chainIdToNetworkId(chainId);
  const network = getNetworkById(networkId);
  if (!network) return null;
  
  const tokens = getTokensForNetwork(networkId);
  const usdcToken = tokens.find(t => t.symbol === 'USDC' || t.symbol === 'USDC.e');
  if (!usdcToken) return null;
  
  return {
    address: usdcToken.address,
    rpcUrl: network.rpcUrl,
    decimals: usdcToken.decimals
  };
}

const USDC_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)"
];

interface PaymentResult {
  success: boolean;
  txHash?: string;
  error?: string;
}

export async function sendUSDCPayment(
  privateKey: string,
  toAddress: string,
  amountUSDC: string,
  chainId: number = 1135
): Promise<PaymentResult> {
  try {
    
    const config = getUsdcConfig(chainId);
    if (!config) {
      return {
        success: false,
        error: `No USDC configuration found for chainId ${chainId}`
      };
    }
    
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    
    const usdcContract = new ethers.Contract(config.address, USDC_ABI, wallet);
    
    const balance = await usdcContract.balanceOf(wallet.address);
    const balanceFormatted = ethers.formatUnits(balance, config.decimals);
    
    const amountInUnits = ethers.parseUnits(amountUSDC, config.decimals);
    
    if (balance < amountInUnits) {
      return {
        success: false,
        error: `Insufficient USDC balance. Required: ${amountUSDC} USDC, Available: ${balanceFormatted} USDC`
      };
    }
    
    const tx = await usdcContract.transfer(toAddress, amountInUnits);
    
    const receipt = await tx.wait();
    
    if (receipt.status === 1) {
      return {
        success: true,
        txHash: tx.hash
      };
    } else {
      return {
        success: false,
        error: "Transaction failed on-chain"
      };
    }
    
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown payment error"
    };
  }
}
