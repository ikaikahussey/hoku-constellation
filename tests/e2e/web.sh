#!/usr/bin/env bash
# Starts the Next.js production server for Playwright against the PGlite wire server (tests/e2e/db-server.ts).
# Reuses an existing .next build when present; E2E_REBUILD=1 forces a rebuild.
set -euo pipefail
cd "$(dirname "$0")/../.."
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:${E2E_PG_PORT:-54329}/postgres"
export DATABASE_URL_UNPOOLED="$DATABASE_URL"
export HOKU_DB_DRIVER=pg
export PG_POOL_MAX=1   # PGlite serves one connection at a time
export PG_IDLE_TIMEOUT_MS=1000
export NEON_AUTH_BASE_URL="${NEON_AUTH_BASE_URL:-http://127.0.0.1:9/auth}"      # unreachable → every request is anonymous
export NEON_AUTH_COOKIE_SECRET="${NEON_AUTH_COOKIE_SECRET:-e2e-cookie-secret-must-be-at-least-32-chars}"
export NEXT_PUBLIC_NEON_AUTH_URL="${NEXT_PUBLIC_NEON_AUTH_URL:-http://127.0.0.1:9/auth}"
export NEXT_PUBLIC_NEON_DATA_API_URL="${NEXT_PUBLIC_NEON_DATA_API_URL:-http://127.0.0.1:9/rest/v1}"
export NEXT_PUBLIC_SITE_URL="http://127.0.0.1:${E2E_WEB_PORT:-3100}"
export NEXT_TELEMETRY_DISABLED=1
# Part E offline flow: test sessions (localhost only), in-process email outbox, signed Stripe webhooks.
export E2E_TEST_AUTH_SECRET="${E2E_TEST_AUTH_SECRET:-e2e-test-auth-secret-0123456789}"
export EMAIL_TRANSPORT=memory
export CRON_SECRET="${CRON_SECRET:-e2e-cron-secret}"
export APP_ENCRYPTION_KEY="${APP_ENCRYPTION_KEY:-MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=}"
export STRIPE_SECRET_KEY="${STRIPE_SECRET_KEY:-sk_test_e2e_unused}"
export STRIPE_WEBHOOK_SECRET="${STRIPE_WEBHOOK_SECRET:-whsec_e2e_secret}"
export STRIPE_PRICE_PRO_YEARLY="${STRIPE_PRICE_PRO_YEARLY:-price_e2e_pro_yearly}"
export STRIPE_PRICE_PRO_MONTHLY="${STRIPE_PRICE_PRO_MONTHLY:-price_e2e_pro_monthly}"
export OWNER_EMAIL="${OWNER_EMAIL:-owner@example.com}"
if [ "${E2E_REBUILD:-0}" = "1" ] || [ ! -f .next/BUILD_ID ]; then npx next build; fi
exec npx next start -p "${E2E_WEB_PORT:-3100}"
