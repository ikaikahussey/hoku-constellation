/**
 * Person role tags (`entity.attributes.entity_types`) and how they are labeled and grouped in the UI.
 *
 * `elected_official` is a legacy tag that was also applied to candidates who never won office, so it
 * is labeled and filtered together with `candidate` and `legislator` as "Candidates & officeholders".
 * The stored values are unchanged.
 */

export interface RoleGroup {
  /** URL value (`?role=`) */
  key: string
  label: string
  /** entity_types values that belong to the group */
  tags: readonly string[]
}

export const POLITICAL_TAGS = ['elected_official', 'candidate', 'legislator'] as const

export const ROLE_GROUPS: readonly RoleGroup[] = [
  { key: 'political', label: 'Candidates & officeholders', tags: POLITICAL_TAGS },
  { key: 'appointed_official', label: 'Appointed officials', tags: ['appointed_official'] },
  { key: 'lobbyist', label: 'Lobbyists', tags: ['lobbyist'] },
  { key: 'donor', label: 'Donors', tags: ['donor'] },
  { key: 'contractor', label: 'Contractors', tags: ['contractor'] },
  { key: 'executive', label: 'Executives', tags: ['executive', 'business_leader'] },
  { key: 'nonprofit_leader', label: 'Nonprofit leaders', tags: ['nonprofit_leader'] },
  { key: 'labor_leader', label: 'Labor leaders', tags: ['labor_leader'] },
  { key: 'university_admin', label: 'University administrators', tags: ['university_admin'] },
  { key: 'media_figure', label: 'Media figures', tags: ['media_figure'] },
  { key: 'cultural_practitioner', label: 'Cultural practitioners', tags: ['cultural_practitioner'] },
  { key: 'legal_professional', label: 'Legal professionals', tags: ['legal_professional'] },
]

/** Tags that carry no information for filtering or display. */
export const IGNORED_TAGS: readonly string[] = ['person', 'org', 'organization']

const TAG_LABEL: Record<string, string> = {
  elected_official: 'Candidate or officeholder',
  candidate: 'Candidate',
  legislator: 'Legislator',
  appointed_official: 'Appointed official',
  business_leader: 'Business leader',
}

export function humanize(value: string): string {
  const s = value.replace(/[_-]+/g, ' ').trim()
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

/** Display label for one stored role tag. */
export function tagLabel(tag: string): string {
  return TAG_LABEL[tag] ?? humanize(tag)
}

export function roleGroupForTag(tag: string): RoleGroup | null {
  return ROLE_GROUPS.find(g => g.tags.includes(tag)) ?? null
}

/**
 * Role URL value → the tags to filter on. A known group key expands to its tags; a tag that belongs to a
 * group expands to that group (so old `?entityType=elected_official` links include candidates);
 * any other value is treated as a single tag.
 */
export function tagsForRole(role: string): string[] {
  const g = ROLE_GROUPS.find(x => x.key === role) ?? roleGroupForTag(role)
  return g ? [...g.tags] : [role]
}

export function roleLabel(role: string): string {
  return ROLE_GROUPS.find(g => g.key === role)?.label ?? tagLabel(role)
}

/** Fold raw tag counts into role options: groups first (in ROLE_GROUPS order), then unknown tags A–Z. */
export function roleOptions(tagCounts: Map<string, number>): { value: string; label: string; count: number }[] {
  const out: { value: string; label: string; count: number }[] = []
  const used = new Set<string>(IGNORED_TAGS)
  for (const g of ROLE_GROUPS) {
    let n = 0
    for (const t of g.tags) { n += tagCounts.get(t) ?? 0; used.add(t) }
    if (n > 0) out.push({ value: g.key, label: g.label, count: n })
  }
  const rest = [...tagCounts.entries()].filter(([t, n]) => !used.has(t) && n > 0).sort(([a], [b]) => a.localeCompare(b))
  for (const [t, n] of rest) out.push({ value: t, label: tagLabel(t), count: n })
  return out
}
