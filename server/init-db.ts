/**
 * Database Initialization
 * 
 * Sets up default blockchain networks for the communication platform.
 * Ensures essential network configurations are available for wallet operations.
 */

import { db } from "./db";
import { networks } from "@shared/schema";
import { eq } from "drizzle-orm";

const defaultNetworks = [
  {
    name: "Lisk Sepolia",
    chainId: 4202,
    rpcUrl: "https://rpc.sepolia-api.lisk.com",
    symbol: "ETH",
    blockExplorerUrl: "https://sepolia-blockscout.lisk.com",
    isTestnet: true
  }
];

export async function initializeDatabase() {
  console.log("Initializing database with default networks...");
  
  for (const network of defaultNetworks) {
    try {
      const existing = await db
        .select()
        .from(networks)
        .where(eq(networks.chainId, network.chainId))
        .limit(1);
      
      if (existing.length === 0) {
        await db.insert(networks).values(network);
        console.log(`Added network: ${network.name}`);
      } else {
        console.log(`Network already exists: ${network.name}`);
      }
    } catch (error) {
      console.error(`Failed to add network ${network.name}:`, error);
    }
  }
  
  console.log("Database initialization completed");
}
