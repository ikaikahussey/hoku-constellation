#!/usr/bin/env -S npx tsx --tsconfig tsconfig.scripts.json
/**
 * CLI: npx tsx --tsconfig tsconfig.scripts.json scripts/import/spo-hands.ts [--dry] [--limit=N] [--offset=N] [--batch=N] [--restart] [--key=value]
 * Runs the `spo_hands` importer against DATABASE_URL (service role) with cursor tracking in import_cursor.
 */
import { runCli } from './_cli'

runCli('spo_hands')
