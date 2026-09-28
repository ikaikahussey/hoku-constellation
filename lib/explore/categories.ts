import type { EntityKind } from '@/lib/db/types'
import type { ListEntitiesOptions } from '@/lib/db/queries/entities'

/**
 * Browse categories for /explore/<slug>. Each category is a fixed, shareable URL that lists the
 * entities matching its filter. Filters map onto `listEntities` options so the SQL does the work.
 */
export type ExploreGroup = 'office' | 'sector' | 'island'

export interface ExploreCategory {
  slug: string
  label: string
  group: ExploreGroup
  kind: EntityKind
  description: string
  filter: Pick<ListEntitiesOptions, 'entityTypes' | 'officeHeldLike' | 'sector' | 'island'>
}

export const EXPLORE_CATEGORIES: readonly ExploreCategory[] = [
  // ---- by office (people)
  { slug: 'elected-officials', label: 'Elected officials', group: 'office', kind: 'person',
    description: 'People currently or formerly holding elected office in Hawaiʻi.',
    filter: { entityTypes: ['elected_official'] } },
  { slug: 'appointed-officials', label: 'Appointed officials', group: 'office', kind: 'person',
    description: 'Cabinet directors, deputies, and other appointees.',
    filter: { entityTypes: ['appointed_official'] } },
  { slug: 'county-mayors', label: 'County mayors', group: 'office', kind: 'person',
    description: 'Mayors of Honolulu, Maui, Hawaiʻi, and Kauaʻi counties.',
    filter: { officeHeldLike: ['%mayor%'] } },
  { slug: 'puc-commissioners', label: 'PUC commissioners', group: 'office', kind: 'person',
    description: 'Members of the Hawaiʻi Public Utilities Commission.',
    filter: { officeHeldLike: ['%public utilities commission%', '%puc %', '%puc'] } },
  // ---- by sector (organizations)
  { slug: 'energy', label: 'Energy', group: 'sector', kind: 'org', description: 'Utilities, fuel, and renewable-energy organizations.', filter: { sector: ['energy', 'electric_services', 'utilities', 'renewable_energy', 'oil_and_gas'] } },
  { slug: 'real-estate', label: 'Real estate', group: 'sector', kind: 'org', description: 'Developers, landowners, and property companies.', filter: { sector: ['real_estate', 'real_estate_development', 'development', 'property'] } },
  { slug: 'healthcare', label: 'Healthcare', group: 'sector', kind: 'org', description: 'Hospitals, insurers, and health systems.', filter: { sector: ['healthcare', 'health_care', 'health', 'medical', 'hospital'] } },
  { slug: 'tourism', label: 'Tourism', group: 'sector', kind: 'org', description: 'Hotels, resorts, airlines, and visitor-industry groups.', filter: { sector: ['tourism', 'hospitality', 'travel', 'visitor_industry'] } },
  { slug: 'construction', label: 'Construction', group: 'sector', kind: 'org', description: 'Contractors, engineering firms, and building trades.', filter: { sector: ['construction', 'contractor', 'engineering', 'building'] } },
  { slug: 'finance', label: 'Finance', group: 'sector', kind: 'org', description: 'Banks, insurers, and investment firms.', filter: { sector: ['finance', 'financial_services', 'banking', 'insurance', 'investment'] } },
  // ---- by island (people and organizations)
  { slug: 'oahu', label: 'Oʻahu', group: 'island', kind: 'person', description: 'People and organizations based on Oʻahu.', filter: { island: ['Oahu', 'Oʻahu', 'O‘ahu'] } },
  { slug: 'maui', label: 'Maui', group: 'island', kind: 'person', description: 'People and organizations based on Maui.', filter: { island: ['Maui'] } },
  { slug: 'hawaii-island', label: 'Hawaiʻi Island', group: 'island', kind: 'person', description: 'People and organizations based on Hawaiʻi Island.', filter: { island: ['Hawaii', 'Hawaiʻi', 'Hawai‘i', 'Hawaii Island', 'Big Island'] } },
  { slug: 'kauai', label: 'Kauaʻi', group: 'island', kind: 'person', description: 'People and organizations based on Kauaʻi.', filter: { island: ['Kauai', 'Kauaʻi', 'Kaua‘i'] } },
]

export const GROUP_LABEL: Record<ExploreGroup, string> = { office: 'By office', sector: 'By sector', island: 'By island' }

export function getExploreCategory(slug: string): ExploreCategory | null {
  return EXPLORE_CATEGORIES.find(c => c.slug === slug) ?? null
}

export function categoriesInGroup(group: ExploreGroup): ExploreCategory[] {
  return EXPLORE_CATEGORIES.filter(c => c.group === group)
}

export function exploreHref(slug: string): string {
  return `/explore/${slug}`
}

/** `listEntities` / `countEntities` options for a category. */
export function categoryListOptions(c: ExploreCategory): ListEntitiesOptions {
  return { kind: categoryKinds(c), ...c.filter }
}

/** Island categories list people and organizations; office and sector categories list one kind. */
export function categoryKinds(c: ExploreCategory): EntityKind[] {
  return c.group === 'island' ? ['person', 'org'] : [c.kind]
}
