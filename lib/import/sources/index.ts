/**
 * Live importer modules keyed by source-registry key. Lazy-loaded so the admin route and workers only
 * pull in the parser (cheerio, unpdf) for the source they run.
 */
import type { SourceModule } from '../types'

export const IMPORTERS: Record<string, () => Promise<SourceModule>> = {
  csc: () => import('./csc'),
  ethics_lobbyists: () => import('./ethics-lobbyists'),
  capitol_measures: () => import('./capitol-measures'),
  capitol_testimony: () => import('./capitol-testimony'),
  boards: () => import('./boards'),
  spo_hands: () => import('./spo-hands'),
  puc: () => import('./puc'),
  fec: () => import('./fec'),
  usaspending: () => import('./usaspending'),
  propublica_990: () => import('./propublica-990'),
  irs_eo: () => import('./irs-eo'),
  gleif: () => import('./gleif'),
  sec_edgar: () => import('./sec-edgar'),
  sec_hi_companies: () => import('./sec-hi-companies'),
  property_hnl: () => import('./property-hnl'),
  employee_compensation: () => import('./employee-compensation'),
  dcca_breg: () => import('./dcca-breg'),
}

export const LIVE_SOURCE_KEYS = Object.keys(IMPORTERS)

export async function loadImporter(key: string): Promise<SourceModule> {
  const loader = IMPORTERS[key]
  if (!loader) throw new Error(`No importer for source "${key}"`)
  const mod = await loader()
  if (mod.SOURCE_KEY !== key) throw new Error(`Importer ${key} exports SOURCE_KEY=${mod.SOURCE_KEY}`)
  return mod
}
