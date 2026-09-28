#!/usr/bin/env -S npx tsx --tsconfig tsconfig.scripts.json
/**
 * CLI: npx tsx --tsconfig tsconfig.scripts.json scripts/import/csc.ts [--dry] [--limit=N] [--offset=N] [--batch=N] [--restart] [--key=value]
 * Runs the `csc` importer against DATABASE_URL (service role) with cursor tracking in import_cursor.
 */
import { runCli } from './_cli'

runCli('csc')
