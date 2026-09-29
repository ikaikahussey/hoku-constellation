#!/usr/bin/env -S npx tsx --tsconfig tsconfig.scripts.json
/**
 * CLI: npx tsx --tsconfig tsconfig.scripts.json scripts/import/sec-form-d.ts [--dry] [--restart] [--max-batches=N]
 * Reads the SEC quarterly Form D data sets (one quarter per batch) and imports Hawaiʻi issuers and their
 * executive officers and directors. The cursor counts quarters.
 */
import { runCli } from './_cli'

runCli('sec_form_d')
