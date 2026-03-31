/**
 * Database Initialization
 *
 * Creates all tables (IF NOT EXISTS) then seeds default data.
 * Safe to run on every startup — idempotent.
 */

import { db } from "./db";
import { sql } from "drizzle-orm";
import { networks } from "@shared/schema";
import { eq } from "drizzle-orm";

async function createTables() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS user_accounts (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE,
      google_id TEXT UNIQUE,
      name TEXT,
      avatar_url TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS magic_links (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMP NOT NULL,
      used BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id SERIAL PRIMARY KEY,
      session_token TEXT NOT NULL UNIQUE,
      user_id INTEGER REFERENCES user_accounts(id),
      wallet_address TEXT,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS webauthn_credentials (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES user_accounts(id),
      credential_id TEXT NOT NULL UNIQUE,
      public_key TEXT NOT NULL,
      counter INTEGER DEFAULT 0,
      device_unlock_key TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS wallets (
      id SERIAL PRIMARY KEY,
      address TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      encrypted_private_key TEXT NOT NULL,
      encrypted_mnemonic TEXT,
      email TEXT,
      user_id INTEGER REFERENCES user_accounts(id),
      pin_salt TEXT,
      is_imported BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS networks (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      chain_id INTEGER NOT NULL UNIQUE,
      rpc_url TEXT NOT NULL,
      symbol TEXT NOT NULL,
      block_explorer_url TEXT,
      is_testnet BOOLEAN DEFAULT TRUE,
      usdc_contract_address TEXT
    );

    CREATE TABLE IF NOT EXISTS hedge_events (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      underlying TEXT NOT NULL,
      strike DECIMAL(18,6) NOT NULL,
      premium_rate DECIMAL(10,6) NOT NULL,
      payout_rate DECIMAL(10,6) NOT NULL,
      safety_factor DECIMAL(5,2) NOT NULL DEFAULT 0.80,
      expiry_date TIMESTAMP NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      settlement_price DECIMAL(18,6),
      triggered BOOLEAN DEFAULT FALSE,
      settled_at TIMESTAMP,
      pool_open BOOLEAN NOT NULL DEFAULT FALSE,
      allow_external_lp BOOLEAN NOT NULL DEFAULT TRUE,
      created_by TEXT NOT NULL,
      creator_earnings DECIMAL(18,6) DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS hedge_positions (
      id SERIAL PRIMARY KEY,
      event_id INTEGER REFERENCES hedge_events(id) NOT NULL,
      hedger_wallet TEXT NOT NULL,
      notional DECIMAL(18,2) NOT NULL,
      premium_paid DECIMAL(18,2) NOT NULL,
      max_payout DECIMAL(18,2) NOT NULL,
      payout_amount DECIMAL(18,2),
      claimed BOOLEAN DEFAULT FALSE,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS hedge_lp_deposits (
      id SERIAL PRIMARY KEY,
      event_id INTEGER REFERENCES hedge_events(id) NOT NULL,
      lp_wallet TEXT NOT NULL,
      amount DECIMAL(18,2) NOT NULL,
      shares DECIMAL(18,6) NOT NULL,
      premiums_earned DECIMAL(18,2) DEFAULT 0,
      premiums_withdrawn DECIMAL(18,2) DEFAULT 0,
      withdrawn BOOLEAN DEFAULT FALSE,
      withdrawn_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS daily_tasks (
      id SERIAL PRIMARY KEY,
      task_key VARCHAR(50) UNIQUE NOT NULL,
      title VARCHAR(100) NOT NULL,
      description TEXT NOT NULL,
      points INTEGER NOT NULL DEFAULT 10,
      category VARCHAR(30) NOT NULL,
      icon VARCHAR(30) NOT NULL DEFAULT 'star',
      action_url TEXT,
      action_type VARCHAR(20) NOT NULL DEFAULT 'external',
      is_daily BOOLEAN DEFAULT TRUE,
      is_active BOOLEAN DEFAULT TRUE,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS user_task_completions (
      id SERIAL PRIMARY KEY,
      wallet_address VARCHAR(42) NOT NULL,
      task_id INTEGER REFERENCES daily_tasks(id) NOT NULL,
      completed_at TIMESTAMP DEFAULT NOW() NOT NULL,
      points_earned INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS platform_fees (
      id SERIAL PRIMARY KEY,
      tx_hash TEXT NOT NULL,
      fee_tx_hash TEXT,
      from_wallet TEXT NOT NULL,
      to_wallet TEXT NOT NULL,
      transfer_amount DECIMAL(24,6) NOT NULL,
      fee_amount DECIMAL(24,6) NOT NULL,
      fee_percent DECIMAL(5,2) NOT NULL,
      token TEXT NOT NULL DEFAULT 'USDC',
      chain_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'collected',
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS rate_snapshots (
      id SERIAL PRIMARY KEY,
      pair TEXT NOT NULL,
      rate DECIMAL(30,10) NOT NULL,
      asset_class TEXT NOT NULL,
      recorded_at TIMESTAMP DEFAULT NOW() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS terms_acceptances (
      id SERIAL PRIMARY KEY,
      wallet_address TEXT NOT NULL,
      version TEXT NOT NULL,
      accepted_at TIMESTAMP DEFAULT NOW() NOT NULL,
      UNIQUE(wallet_address, version)
    );

    CREATE TABLE IF NOT EXISTS articles (
      id SERIAL PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      subtitle TEXT DEFAULT '',
      category TEXT NOT NULL DEFAULT 'Hedging',
      content JSONB NOT NULL DEFAULT '[]',
      read_time TEXT DEFAULT '5 min read',
      published BOOLEAN DEFAULT TRUE,
      published_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS data_room_content (
      id SERIAL PRIMARY KEY,
      doc_id TEXT NOT NULL UNIQUE,
      data JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS user_profiles (
      id SERIAL PRIMARY KEY,
      wallet_address TEXT NOT NULL UNIQUE,
      display_name TEXT,
      first_name TEXT,
      last_name TEXT,
      email TEXT,
      phone_number TEXT,
      company_name TEXT,
      job_title TEXT,
      country TEXT,
      city TEXT,
      address TEXT,
      postal_code TEXT,
      date_of_birth TEXT,
      nationality TEXT,
      id_type TEXT,
      id_number TEXT,
      tax_id TEXT,
      website TEXT,
      linkedin TEXT,
      twitter TEXT,
      bio TEXT,
      avatar TEXT,
      kyc_status TEXT DEFAULT 'not_started',
      kyc_documents JSONB,
      is_pep BOOLEAN DEFAULT FALSE,
      kyc_tier INTEGER DEFAULT 0,
      source_of_funds TEXT,
      submitted_at TIMESTAMP,
      reviewed_at TIMESTAMP,
      reviewer_notes TEXT,
      kyc_provider TEXT DEFAULT 'manual',
      kyc_provider_ref TEXT,
      kyc_webhook_data TEXT,
      is_public BOOLEAN DEFAULT FALSE,
      last_updated TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS referral_codes (
      id SERIAL PRIMARY KEY,
      code VARCHAR(20) UNIQUE NOT NULL,
      referrer_wallet_address VARCHAR(42) NOT NULL,
      description VARCHAR(255) DEFAULT 'Invite your partners',
      is_active BOOLEAN DEFAULT TRUE NOT NULL,
      max_uses INTEGER,
      current_uses INTEGER DEFAULT 0 NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      expires_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS referrals (
      id SERIAL PRIMARY KEY,
      referral_code VARCHAR(20) NOT NULL,
      referrer_wallet_address VARCHAR(42) NOT NULL,
      referred_wallet_address VARCHAR(42) NOT NULL,
      points_earned INTEGER DEFAULT 50 NOT NULL,
      status VARCHAR(20) DEFAULT 'pending' NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      completed_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_points (
      id SERIAL PRIMARY KEY,
      wallet_address VARCHAR(42) UNIQUE NOT NULL,
      total_points INTEGER DEFAULT 0 NOT NULL,
      referral_points INTEGER DEFAULT 0 NOT NULL,
      last_updated TIMESTAMP DEFAULT NOW() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS point_transactions (
      id SERIAL PRIMARY KEY,
      wallet_address VARCHAR(42) NOT NULL,
      type VARCHAR(20) NOT NULL,
      points INTEGER NOT NULL,
      description TEXT NOT NULL,
      reference_id VARCHAR(50),
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);
}

const defaultNetworks = [
  {
    name: "Lisk Sepolia",
    chainId: 4202,
    rpcUrl: "https://rpc.sepolia-api.lisk.com",
    symbol: "ETH",
    blockExplorerUrl: "https://sepolia-blockscout.lisk.com",
    isTestnet: true,
  },
];

export async function initializeDatabase() {
  console.log("Initializing database...");

  try {
    await createTables();
    console.log("All tables ready.");
  } catch (error) {
    console.error("Failed to create tables:", error);
    throw error;
  }

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
