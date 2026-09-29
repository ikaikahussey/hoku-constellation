import { SOURCE_REGISTRY } from '@/lib/import/source-registry'

const SOURCE_NAMES = new Map(SOURCE_REGISTRY.map(s => [s.key, s.name]))

/** Human label for a `document.source` key: the registry name (before the em dash), else the key itself. */
export function sourceLabel(key: string): string {
  const name = SOURCE_NAMES.get(key)
  if (!name) return key.replace(/_/g, ' ')
  return name.split(' — ')[0]
}

/** Full registry name, used for tooltips. */
export function sourceTitle(key: string): string {
  return SOURCE_NAMES.get(key) ?? key
}

export function docTypeLabel(type: string): string {
  return type.replace(/_/g, ' ')
}
