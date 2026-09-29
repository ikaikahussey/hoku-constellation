import { SOURCE_REGISTRY } from '@/lib/import/source-registry'

const SOURCE_NAMES = new Map(SOURCE_REGISTRY.map(s => [s.key, s.name]))

/** Source keys written by the legacy port and the first importers, which predate the registry's keys. */
const SOURCE_ALIASES: Record<string, string> = {
  hawaii_csc: 'csc',
  hawaii_ethics: 'ethics_lobbyists',
  hawaii_puc: 'puc',
  hawaii_capitol: 'capitol_measures',
}

const LEGACY_LABELS: Record<string, string> = {
  legacy_timeline: 'Editorial timeline — imported from the legacy database',
  legacy_relationship: 'Editorial relationships — imported from the legacy database',
}

function registryName(key: string): string | undefined {
  return SOURCE_NAMES.get(key) ?? SOURCE_NAMES.get(SOURCE_ALIASES[key] ?? '') ?? LEGACY_LABELS[key]
}

/** Human label for a `document.source` key: the registry name (before the em dash), else the key itself. */
export function sourceLabel(key: string): string {
  const name = registryName(key)
  if (!name) return key.replace(/_/g, ' ')
  return name.split(' — ')[0]
}

/** Full registry name, used for tooltips. */
export function sourceTitle(key: string): string {
  return registryName(key) ?? key
}

export function docTypeLabel(type: string): string {
  return type.replace(/_/g, ' ')
}
