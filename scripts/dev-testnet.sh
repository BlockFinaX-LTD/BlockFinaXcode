#!/bin/sh
# Run the app on this computer exactly like the testnet deployment: the passkey wallet,
# Stellar testnet and Base Sepolia. Settings come from the Railway testnet service (never
# written to disk); the database is a local Postgres, because the testnet database only
# accepts connections from inside Railway. The local .env (legacy settings) is not read.
#
# One-time setup:
#   brew install postgresql@16 && brew services start postgresql@16
#   /opt/homebrew/opt/postgresql@16/bin/createdb blockfinax_testnet
#   npm run db:push:testnet-local
set -e
cd "$(dirname "$0")/.."
LOCAL_DB="postgresql://localhost:5432/blockfinax_testnet"
if [ "$1" = "push" ]; then
  exec railway run -e testnet -s blockfinax-testnet -- env DATABASE_URL="$LOCAL_DB" npx drizzle-kit push --force
fi
exec railway run -e testnet -s blockfinax-testnet -- env \
  DOTENV_CONFIG_PATH=/dev/null \
  DATABASE_URL="$LOCAL_DB" \
  PUBLIC_APP_URL=http://localhost:5173 \
  APP_URL=http://localhost:5173 \
  PASSKEY_RP_ID=localhost \
  PASSKEY_RELATED_ORIGINS= \
  PORT=5173 \
  NODE_OPTIONS='--dns-result-order=ipv4first --no-network-family-autoselection' \
  npm run dev
