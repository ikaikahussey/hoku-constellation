#!/usr/bin/env -S npx tsx --tsconfig tsconfig.scripts.json
/**
 * CLI: npx tsx --tsconfig tsconfig.scripts.json scripts/import/dcca-breg.ts --file=<export.csv> [--dry] [--limit=N]
 * Manual source: loads a DCCA Entity List Builder export or UIPA registry extract. Nothing is fetched.
 * Run with --dry first: the log line lists which columns were recognised and which were ignored.
 */
import { runCli } from './_cli'

runCli('dcca_breg')
