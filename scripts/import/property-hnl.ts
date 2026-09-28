#!/usr/bin/env -S npx tsx --tsconfig tsconfig.scripts.json
/**
 * CLI: npx tsx --tsconfig tsconfig.scripts.json scripts/import/property-hnl.ts [--dry] [--limit=N] [--offset=N] [--batch=N] [--restart] [--key=value]
 * Runs the `property_hnl` importer against DATABASE_URL (service role) with cursor tracking in import_cursor.
 */
import { runCli } from './_cli'

runCli('property_hnl')
