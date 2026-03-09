/**
 * API Request Signer - Signs API requests with wallet private key
 *
 * Creates EIP-191 signatures for authenticated API requests on mainnet.
 * Used by the frontend to sign sensitive trade lifecycle operations.
 * Exports: signApiRequest, createSignedHeaders
 */

import { ethers } from "ethers";
import { isMainnet } from "./networks";

export interface SignedHeaders {
  "X-Wallet-Address": string;
  "X-Signature": string;
  "X-Timestamp": string;
  "Content-Type": string;
}

export async function createSignedHeaders(
  method: string,
  path: string,
  body: Record<string, any> | null,
  privateKey: string,
  walletAddress: string
): Promise<SignedHeaders> {
  const timestamp = Date.now().toString();
  
  const bodyString = body && Object.keys(body).length > 0
    ? JSON.stringify(body)
    : "";
  const bodyHash = bodyString
    ? ethers.keccak256(ethers.toUtf8Bytes(bodyString))
    : ethers.keccak256(ethers.toUtf8Bytes(""));

  const message = `${method}:${path}:${timestamp}:${bodyHash}`;

  const wallet = new ethers.Wallet(privateKey);
  const signature = await wallet.signMessage(message);

  return {
    "X-Wallet-Address": walletAddress,
    "X-Signature": signature,
    "X-Timestamp": timestamp,
    "Content-Type": "application/json"
  };
}

export function requiresSigning(): boolean {
  return isMainnet();
}
