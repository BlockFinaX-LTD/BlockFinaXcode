-- Additive multi-chain account metadata. This migration intentionally does not
-- copy or delete the legacy wallets table, Rift credentials, or Stellar SQLite data.
-- Review the mapping and backfill separately before any production cutover.
BEGIN;

CREATE TABLE IF NOT EXISTS auth_identity_links (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  provider varchar(32) NOT NULL,
  provider_subject text NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  last_authenticated_at timestamptz,
  CONSTRAINT auth_identity_links_provider_subject_uq UNIQUE (provider, provider_subject)
);
CREATE INDEX IF NOT EXISTS auth_identity_links_user_idx ON auth_identity_links(user_id);

CREATE TABLE IF NOT EXISTS chain_wallet_accounts (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  chain_namespace varchar(24) NOT NULL,
  network_key varchar(80) NOT NULL,
  address text NOT NULL,
  address_canonical text NOT NULL,
  wallet_provider varchar(32) NOT NULL,
  account_type varchar(32) NOT NULL,
  display_name text,
  is_primary boolean NOT NULL DEFAULT false,
  status varchar(16) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  CONSTRAINT chain_wallet_accounts_network_address_uq
    UNIQUE (chain_namespace, network_key, address_canonical)
);
CREATE INDEX IF NOT EXISTS chain_wallet_accounts_user_chain_idx
  ON chain_wallet_accounts(user_id, chain_namespace, network_key);

CREATE TABLE IF NOT EXISTS chain_transactions (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  wallet_account_id integer NOT NULL REFERENCES chain_wallet_accounts(id) ON DELETE RESTRICT,
  chain_namespace varchar(24) NOT NULL,
  network_key varchar(80) NOT NULL,
  transaction_hash text,
  idempotency_key varchar(128),
  operation varchar(64) NOT NULL,
  status varchar(24) NOT NULL,
  failure_code varchar(80),
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  confirmed_at timestamptz,
  CONSTRAINT chain_transactions_network_hash_uq
    UNIQUE (chain_namespace, network_key, transaction_hash),
  CONSTRAINT chain_transactions_network_idempotency_uq
    UNIQUE (chain_namespace, network_key, idempotency_key)
);
CREATE INDEX IF NOT EXISTS chain_transactions_user_created_idx
  ON chain_transactions(user_id, created_at);
CREATE INDEX IF NOT EXISTS chain_transactions_wallet_idx
  ON chain_transactions(wallet_account_id);

COMMIT;
