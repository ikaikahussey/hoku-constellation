/**
 * Live importer modules keyed by source-registry key. Lazy-loaded so the admin route and workers only
 * pull in the parser (cheerio, unpdf) for the source they run.
 */
import type { SourceModule } from '../types'

export const IMPORTERS: Record<string, () => Promise<SourceModule>> = {
  employee_compensation: () => import('./employee-compensation'),
}

export const LIVE_SOURCE_KEYS = Object.keys(IMPORTERS)

export async function loadImporter(key: string): Promise<SourceModule> {
  const loader = IMPORTERS[key]
  if (!loader) throw new Error(`No importer for source "${key}"`)
  const mod = await loader()
  if (mod.SOURCE_KEY !== key) throw new Error(`Importer ${key} exports SOURCE_KEY=${mod.SOURCE_KEY}`)
  return mod
}
