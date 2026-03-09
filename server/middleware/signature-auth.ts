/**
 * Signature Authentication Middleware
 * 
 * Verifies that API requests for sensitive trade lifecycle operations
 * are signed by the wallet address making the request.
 * 
 * Clients must include these headers:
 *   X-Wallet-Address: The wallet address making the request
 *   X-Signature: EIP-191 signature of the request payload
 *   X-Timestamp: Unix timestamp (ms) of when the signature was created
 * 
 * The signed message format: `${method}:${path}:${timestamp}:${bodyHash}`
 * where bodyHash is keccak256 of the JSON-stringified body (or empty string for GET).
 */

import { Request, Response, NextFunction } from "express";
import { ethers } from "ethers";

const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

export interface AuthenticatedRequest extends Request {
  walletAddress?: string;
}

export function requireSignature(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const networkMode = process.env.NETWORK_MODE || "testnet";
  if (networkMode !== "mainnet") {
    const walletAddress = req.headers["x-wallet-address"] as string;
    if (walletAddress) {
      req.walletAddress = walletAddress.toLowerCase();
    }
    return next();
  }

  try {
    const walletAddress = req.headers["x-wallet-address"] as string;
    const signature = req.headers["x-signature"] as string;
    const timestamp = req.headers["x-timestamp"] as string;

    if (!walletAddress || !signature || !timestamp) {
      return res.status(401).json({
        error: "Authentication required",
        details: "Missing required headers: X-Wallet-Address, X-Signature, X-Timestamp"
      });
    }

    const timestampMs = parseInt(timestamp, 10);
    const now = Date.now();
    if (isNaN(timestampMs) || Math.abs(now - timestampMs) > SIGNATURE_MAX_AGE_MS) {
      return res.status(401).json({
        error: "Signature expired",
        details: "Timestamp is too old or too far in the future. Max age: 5 minutes."
      });
    }

    const bodyString = req.body && Object.keys(req.body).length > 0
      ? JSON.stringify(req.body)
      : "";
    const bodyHash = bodyString
      ? ethers.keccak256(ethers.toUtf8Bytes(bodyString))
      : ethers.keccak256(ethers.toUtf8Bytes(""));

    const message = `${req.method}:${req.path}:${timestamp}:${bodyHash}`;

    const recoveredAddress = ethers.verifyMessage(message, signature);

    if (recoveredAddress.toLowerCase() !== walletAddress.toLowerCase()) {
      return res.status(401).json({
        error: "Invalid signature",
        details: "Signature does not match the provided wallet address"
      });
    }

    if (!ethers.isAddress(walletAddress)) {
      return res.status(401).json({
        error: "Invalid wallet address",
        details: "The provided wallet address is not a valid Ethereum address"
      });
    }

    req.walletAddress = walletAddress.toLowerCase();
    next();
  } catch (error) {
    return res.status(401).json({
      error: "Authentication failed",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
}

export function optionalSignature(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const walletAddress = req.headers["x-wallet-address"] as string;
  const signature = req.headers["x-signature"] as string;

  if (walletAddress && signature) {
    return requireSignature(req, res, next);
  }

  if (walletAddress) {
    req.walletAddress = walletAddress.toLowerCase();
  }
  next();
}
