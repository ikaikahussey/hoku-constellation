/**
 * Shared CLI body for scripts/import/<source>.ts. Uses the service-role connection (DATABASE_URL);
 * `--dry` wraps the connection so nothing is written.
 */
import { getServiceDb, closeServiceDb } from '@/lib/db/service'
import { runImporter, parseCliArgs } from '@/lib/import/run'
import { loadImporter } from '@/lib/import/sources'
import { readFile } from 'node:fs/promises'

export function runCli(source: string): void {
  const args = parseCliArgs()
  ;(async () => {
    // Local --file=<path> is read here so importers stay free of fs access (Next.js route bundles import them).
    if (args.params.file && !/^https?:/.test(args.params.file)) args.params.csv = await readFile(args.params.file, 'utf8')
    const db = await getServiceDb()
    try {
      const mod = await loadImporter(source)
      const summary = await runImporter(db, source, mod.importBatch, args)
      console.log(JSON.stringify(summary, null, 2))
    } finally {
      await closeServiceDb()
    }
  })().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
}
