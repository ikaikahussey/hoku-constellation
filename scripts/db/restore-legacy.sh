#!/usr/bin/env bash
# Restores a Supabase `public` schema dump into the Neon database as schema `legacy`, ready for
# scripts/db/port-legacy.ts. pg_restore cannot rename schemas, so the dump is restored into a
# scratch database first and moved.
#
#   SUPABASE_DB_URL=postgres://...  DATABASE_URL_UNPOOLED=postgres://...  scripts/db/restore-legacy.sh [legacy.dump]
#
# Requires psql, pg_dump, pg_restore (Postgres 16+ client tools). Idempotent: an existing `legacy`
# schema on the target is dropped and recreated.
set -euo pipefail

DUMP="${1:-legacy.dump}"
: "${DATABASE_URL_UNPOOLED:?set DATABASE_URL_UNPOOLED (Neon direct connection)}"

if [ ! -f "$DUMP" ]; then
  : "${SUPABASE_DB_URL:?set SUPABASE_DB_URL (Supabase direct/unpooled connection) or pass an existing dump}"
  echo "[restore] dumping Supabase public + auth.users → $DUMP"
  pg_dump --schema=public --table=auth.users --no-owner --no-privileges --no-comments -Fc "$SUPABASE_DB_URL" -f "$DUMP"
fi

# Scratch database on the same Neon endpoint (Neon allows CREATE DATABASE for the project owner).
SCRATCH_DB="legacy_scratch_$(date +%s)"
BASE_URL="${DATABASE_URL_UNPOOLED%\?*}"
QS="${DATABASE_URL_UNPOOLED#*\?}"; [ "$QS" = "$DATABASE_URL_UNPOOLED" ] && QS="" || QS="?$QS"
SCRATCH_URL="${BASE_URL%/*}/$SCRATCH_DB$QS"

echo "[restore] creating scratch database $SCRATCH_DB"
psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 -c "create database \"$SCRATCH_DB\""
cleanup() { psql "$DATABASE_URL_UNPOOLED" -c "drop database if exists \"$SCRATCH_DB\"" >/dev/null || true; }
trap cleanup EXIT

echo "[restore] restoring dump into scratch (policies, triggers and extensions from Supabase are skipped)"
pg_restore --no-owner --no-acl --no-comments --schema=public --schema=auth -d "$SCRATCH_URL" "$DUMP" 2> >(grep -v "already exists\|does not exist\|extension" >&2 || true) || true
psql "$SCRATCH_URL" -v ON_ERROR_STOP=1 <<'SQL'
-- Flatten: everything the port reads lives in one schema named legacy.
alter schema public rename to legacy;
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'auth' and table_name = 'users') then
    alter table auth.users set schema legacy;
  end if;
end $$;
-- Drop Supabase-specific objects that cannot exist on Neon.
drop schema if exists auth cascade;
SQL

echo "[restore] moving schema legacy into the target database"
psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 -c "drop schema if exists legacy cascade"
pg_dump --schema=legacy --no-owner --no-privileges --no-comments "$SCRATCH_URL" \
  | sed -E '/^(CREATE|ALTER) (POLICY|PUBLICATION)/d; /^ALTER TABLE .* ENABLE ROW LEVEL SECURITY;/d; /^CREATE EXTENSION/d' \
  | psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 -q

echo "[restore] legacy row counts:"
psql "$DATABASE_URL_UNPOOLED" -At -c "
select table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) c from legacy.%I', table_name), false, true, '')))[1]::text
  from information_schema.tables where table_schema = 'legacy' order by 1"
echo "[restore] done. Next: npx tsx --tsconfig tsconfig.scripts.json scripts/db/port-legacy.ts --markdown docs/PORT_RECONCILIATION.md"
