#!/usr/bin/env -S npx tsx --tsconfig tsconfig.scripts.json
/**
 * CLI: npx tsx --tsconfig tsconfig.scripts.json scripts/import/employee-compensation.ts --file=<path.csv> [--dry] [--limit=N]
 * Manual (UIPA) source: reads the supplied CSV; nothing is fetched.
 */
import { runCli } from './_cli'

runCli('employee_compensation')
