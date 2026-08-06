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
      created_at TIMESTAMP DEFAULT NOW(),
      chain_id INTEGER,
      on_chain_event_id INTEGER
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

async function createIndexes() {
  await db.execute(sql`
    -- auth_sessions: wallet_address + expires_at (session cleanup & lookup)
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_wallet ON auth_sessions(wallet_address);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);

    -- user_profiles: kyc_provider_ref (webhook lookups), kyc_status (admin filters)
    CREATE INDEX IF NOT EXISTS idx_user_profiles_kyc_ref ON user_profiles(kyc_provider_ref);
    CREATE INDEX IF NOT EXISTS idx_user_profiles_kyc_status ON user_profiles(kyc_status);

    -- user_task_completions: wallet_address (progress lookups), composite (duplicate check)
    CREATE INDEX IF NOT EXISTS idx_task_completions_wallet ON user_task_completions(wallet_address);
    CREATE INDEX IF NOT EXISTS idx_task_completions_wallet_task ON user_task_completions(wallet_address, task_id);

    -- user_points: total_points DESC (leaderboard ordering)
    CREATE INDEX IF NOT EXISTS idx_user_points_leaderboard ON user_points(total_points DESC);

    -- hedge_events: status (filter open events), underlying (pair lookups)
    CREATE INDEX IF NOT EXISTS idx_hedge_events_status ON hedge_events(status);
    CREATE INDEX IF NOT EXISTS idx_hedge_events_underlying ON hedge_events(underlying);

    -- hedge_positions: hedger_wallet (user positions), event_id (event aggregation), status
    CREATE INDEX IF NOT EXISTS idx_hedge_positions_wallet ON hedge_positions(hedger_wallet);
    CREATE INDEX IF NOT EXISTS idx_hedge_positions_event ON hedge_positions(event_id);
    CREATE INDEX IF NOT EXISTS idx_hedge_positions_status ON hedge_positions(status);

    -- hedge_lp_deposits: lp_wallet (user deposits), event_id (event aggregation)
    CREATE INDEX IF NOT EXISTS idx_lp_deposits_wallet ON hedge_lp_deposits(lp_wallet);
    CREATE INDEX IF NOT EXISTS idx_lp_deposits_event ON hedge_lp_deposits(event_id);

    -- rate_snapshots: pair (FX rate lookups), pair+recorded_at (time-series queries)
    CREATE INDEX IF NOT EXISTS idx_rate_snapshots_pair ON rate_snapshots(pair);
    CREATE INDEX IF NOT EXISTS idx_rate_snapshots_pair_time ON rate_snapshots(pair, recorded_at DESC);

    -- platform_fees: from_wallet (user fee history)
    CREATE INDEX IF NOT EXISTS idx_platform_fees_wallet ON platform_fees(from_wallet);

    -- point_transactions: wallet_address (point history)
    CREATE INDEX IF NOT EXISTS idx_point_transactions_wallet ON point_transactions(wallet_address);

    -- referrals: referrer + referred wallet lookups
    CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_wallet_address);
    CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_wallet_address);

    -- referral_codes: referrer wallet (user's own codes)
    CREATE INDEX IF NOT EXISTS idx_referral_codes_referrer ON referral_codes(referrer_wallet_address);

    -- magic_links: email (check before creating new link)
    CREATE INDEX IF NOT EXISTS idx_magic_links_email ON magic_links(email);

    -- wallets: user_id (join with user_accounts)
    CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id);
  `);
}

const isProd = process.env.NODE_ENV === "production" || process.env.NETWORK_MODE === "mainnet";

const defaultNetworks = isProd
  ? [
      {
        name: "Base",
        chainId: 8453,
        rpcUrl: "https://mainnet.base.org",
        symbol: "ETH",
        blockExplorerUrl: "https://basescan.org",
        isTestnet: false,
      },
      {
        name: "BNB Smart Chain",
        chainId: 56,
        rpcUrl: "https://bsc-dataseed.binance.org",
        symbol: "BNB",
        blockExplorerUrl: "https://bscscan.com",
        isTestnet: false,
      },
    ]
  : [];

export async function initializeDatabase() {
  console.log("Initializing database...");

  try {
    await createTables();
    console.log("All tables ready.");
  } catch (error) {
    console.error("Failed to create tables:", error);
    throw error;
  }

  try {
    await createIndexes();
    console.log("All indexes ready.");
  } catch (error) {
    console.error("Failed to create indexes:", error);
    // Non-fatal — app can still run without indexes, just slower
  }

  // Idempotent column migrations — safe to run on every startup
  try {
    await db.execute(sql`ALTER TABLE hedge_events ADD COLUMN IF NOT EXISTS chain_id INTEGER`);
    await db.execute(sql`ALTER TABLE hedge_events ADD COLUMN IF NOT EXISTS on_chain_event_id INTEGER`);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS hedge_events_chain_id_on_chain_event_id_idx
        ON hedge_events (chain_id, on_chain_event_id)
        WHERE chain_id IS NOT NULL AND on_chain_event_id IS NOT NULL
    `);
  } catch (error) {
    console.error("Failed to apply hedge_events column migration:", error);
  }

  // Historical on-chain log backfill: hedge_activity gains a block number so
  // the traction feed can order by chain position, and a cursor table records
  // how far each chain has been scanned so restarts resume instead of rescanning.
  try {
    await db.execute(sql`ALTER TABLE hedge_activity ADD COLUMN IF NOT EXISTS block_number INTEGER`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS chain_log_cursors (
        chain_id INTEGER PRIMARY KEY,
        last_scanned_block INTEGER NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
  } catch (error) {
    console.error("Failed to apply chain log backfill migration:", error);
  }

  // Smart Letter of Intent. Six tables: the document itself plus the four
  // satellites that make a signature defensible (access tokens, one-time
  // codes, signatures, audit events) and the collaboration layer (comments).
  // Child tables cascade so deleting a draft leaves nothing orphaned.
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS loi_documents (
        id SERIAL PRIMARY KEY,
        public_id TEXT NOT NULL UNIQUE,
        doc_type TEXT NOT NULL DEFAULT 'loi',
        template_key TEXT NOT NULL DEFAULT 'loi_generic',
        status TEXT NOT NULL DEFAULT 'draft',
        sender_company TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        sender_position TEXT,
        sender_email TEXT NOT NULL,
        sender_phone TEXT,
        recipient_company TEXT NOT NULL,
        recipient_name TEXT NOT NULL,
        recipient_position TEXT,
        recipient_email TEXT NOT NULL,
        recipient_country TEXT,
        relationship_type TEXT NOT NULL DEFAULT 'other',
        terms JSONB NOT NULL DEFAULT '{}'::jsonb,
        body_markdown TEXT NOT NULL DEFAULT '',
        custom_clauses JSONB NOT NULL DEFAULT '[]'::jsonb,
        personal_message TEXT,
        expires_at TIMESTAMP,
        sent_at TIMESTAMP,
        first_viewed_at TIMESTAMP,
        signed_at TIMESTAMP,
        declined_at TIMESTAMP,
        decline_reason TEXT,
        locked_at TIMESTAMP,
        pdf_base64 TEXT,
        created_by TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        last_activity_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS loi_tokens (
        id SERIAL PRIMARY KEY,
        loi_id INTEGER NOT NULL REFERENCES loi_documents(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        revoked_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS loi_otps (
        id SERIAL PRIMARY KEY,
        loi_id INTEGER NOT NULL REFERENCES loi_documents(id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        code_hash TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        expires_at TIMESTAMP NOT NULL,
        consumed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS loi_signatures (
        id SERIAL PRIMARY KEY,
        loi_id INTEGER NOT NULL REFERENCES loi_documents(id) ON DELETE CASCADE,
        party TEXT NOT NULL,
        signer_name TEXT NOT NULL,
        signer_email TEXT NOT NULL,
        signer_position TEXT,
        method TEXT NOT NULL,
        signature_data TEXT NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        browser TEXT,
        device TEXT,
        country TEXT,
        signed_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS loi_comments (
        id SERIAL PRIMARY KEY,
        loi_id INTEGER NOT NULL REFERENCES loi_documents(id) ON DELETE CASCADE,
        party TEXT NOT NULL,
        author_name TEXT NOT NULL,
        anchor TEXT,
        kind TEXT NOT NULL DEFAULT 'comment',
        body TEXT NOT NULL,
        suggested_text TEXT,
        resolution TEXT,
        resolved_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS loi_events (
        id SERIAL PRIMARY KEY,
        loi_id INTEGER NOT NULL REFERENCES loi_documents(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        actor TEXT,
        actor_email TEXT,
        detail TEXT,
        meta JSONB,
        ip_address TEXT,
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS loi_documents_status_idx ON loi_documents(status);
      CREATE INDEX IF NOT EXISTS loi_documents_recipient_idx ON loi_documents(recipient_email);
      CREATE INDEX IF NOT EXISTS loi_tokens_loi_idx ON loi_tokens(loi_id);
      CREATE INDEX IF NOT EXISTS loi_otps_loi_idx ON loi_otps(loi_id);
      CREATE INDEX IF NOT EXISTS loi_signatures_loi_idx ON loi_signatures(loi_id);
      CREATE INDEX IF NOT EXISTS loi_comments_loi_idx ON loi_comments(loi_id);
      CREATE INDEX IF NOT EXISTS loi_events_loi_idx ON loi_events(loi_id);
    `);
    // Opt-in disclosure of a counterparty's identity in the investor data
    // room. Added after the initial release, so existing rows need it too.
    await db.execute(sql`
      ALTER TABLE loi_documents
        ADD COLUMN IF NOT EXISTS show_in_data_room BOOLEAN NOT NULL DEFAULT FALSE
    `);
  } catch (error) {
    console.error("Failed to create Letter of Intent tables:", error);
  }

  // Mini-CEO agent. See docs/agent-design.md. Notably absent: any table that
  // could record a signature, a transfer, or a contract change — the agent has
  // no capability to produce one.
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS agent_proposals (
        id SERIAL PRIMARY KEY,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        rationale TEXT NOT NULL DEFAULT '',
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        edited_payload JSONB,
        status TEXT NOT NULL DEFAULT 'proposed',
        priority TEXT NOT NULL DEFAULT 'normal',
        source_type TEXT,
        source_id INTEGER,
        run_id INTEGER,
        proposed_at TIMESTAMP DEFAULT NOW(),
        decided_at TIMESTAMP,
        decided_by TEXT,
        executed_at TIMESTAMP,
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS agent_decisions (
        id SERIAL PRIMARY KEY,
        proposal_id INTEGER NOT NULL,
        kind TEXT NOT NULL,
        decision TEXT NOT NULL,
        original TEXT NOT NULL DEFAULT '',
        final TEXT,
        note TEXT,
        decided_by TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS agent_rules (
        id SERIAL PRIMARY KEY,
        scope TEXT NOT NULL DEFAULT 'internal',
        rule TEXT NOT NULL,
        origin TEXT NOT NULL DEFAULT 'manual',
        evidence_count INTEGER NOT NULL DEFAULT 0,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS agent_runs (
        id SERIAL PRIMARY KEY,
        scope TEXT NOT NULL DEFAULT 'internal',
        trigger TEXT NOT NULL,
        model TEXT,
        tokens_in INTEGER NOT NULL DEFAULT 0,
        tokens_out INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        tool_calls INTEGER NOT NULL DEFAULT 0,
        proposals_created INTEGER NOT NULL DEFAULT 0,
        started_at TIMESTAMP DEFAULT NOW(),
        finished_at TIMESTAMP,
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS agent_messages (
        id SERIAL PRIMARY KEY,
        thread_id TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'internal',
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_calls JSONB,
        run_id INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS agent_facts (
        id SERIAL PRIMARY KEY,
        fact TEXT NOT NULL,
        source_type TEXT,
        source_id INTEGER,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS agent_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW(),
        updated_by TEXT
      );

      CREATE INDEX IF NOT EXISTS agent_proposals_status_idx ON agent_proposals(status);
      CREATE INDEX IF NOT EXISTS agent_proposals_kind_idx ON agent_proposals(kind);
      CREATE INDEX IF NOT EXISTS agent_decisions_kind_idx ON agent_decisions(kind);
      CREATE INDEX IF NOT EXISTS agent_messages_thread_idx ON agent_messages(thread_id);
    `);
  } catch (error) {
    console.error("Failed to create agent tables:", error);
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
