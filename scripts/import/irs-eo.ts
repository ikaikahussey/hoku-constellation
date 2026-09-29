#!/usr/bin/env -S npx tsx --tsconfig tsconfig.scripts.json
/**
 * CLI: npx tsx --tsconfig tsconfig.scripts.json scripts/import/irs-eo.ts [--dry] [--limit=N] [--state=hi]
 * Downloads the IRS Exempt Organizations BMF extract for Hawaiʻi and resolves each organization by EIN.
 */
import { runCli } from './_cli'

runCli('irs_eo')
