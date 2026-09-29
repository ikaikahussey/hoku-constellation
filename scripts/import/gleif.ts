#!/usr/bin/env -S npx tsx --tsconfig tsconfig.scripts.json
/**
 * CLI: npx tsx --tsconfig tsconfig.scripts.json scripts/import/gleif.ts [--dry] [--limit=N]
 * Imports GLEIF LEI records for entities formed under Hawaiʻi law, with DCCA file numbers and parents.
 */
import { runCli } from './_cli'

runCli('gleif')
