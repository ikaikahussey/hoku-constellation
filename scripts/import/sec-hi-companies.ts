#!/usr/bin/env -S npx tsx --tsconfig tsconfig.scripts.json
/**
 * CLI: npx tsx --tsconfig tsconfig.scripts.json scripts/import/sec-hi-companies.ts [--dry] [--limit=N]
 * Discovers every EDGAR filer with a Hawaiʻi business address and imports each company's registrant record.
 */
import { runCli } from './_cli'

runCli('sec_hi_companies')
