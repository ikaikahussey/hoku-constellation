/**
 * Tag taxonomy for `entity.attributes.entity_types`.
 *
 * Tags are not mutually exclusive: one person can be a candidate, a donor, and a lobbyist at once, and an
 * organization can be a donor and a contractor. The taxonomy only groups tags for display and lets a
 * filter name a whole branch (`politics` = any politics tag). Stored values are never rewritten.
 *
 * `elected_official` is a legacy tag that was also applied to candidates who never won office, so it is
 * labeled "Candidate or officeholder" rather than implying election.
 */

export interface TagNode { key: string; label: string }
export interface TagBranch { key: string; label: string; tags: readonly TagNode[] }

export const TAG_TAXONOMY: readonly TagBranch[] = [
  { key: 'politics', label: 'Politics & government', tags: [
    { key: 'candidate', label: 'Candidate' },
    { key: 'elected_official', label: 'Candidate or officeholder' },
    { key: 'legislator', label: 'Legislator' },
    { key: 'appointed_official', label: 'Appointed official' },
  ] },
  { key: 'influence', label: 'Money & influence', tags: [
    { key: 'donor', label: 'Donor' },
    { key: 'lobbyist', label: 'Lobbyist' },
    { key: 'contractor', label: 'Contractor' },
  ] },
  { key: 'business', label: 'Business', tags: [
    { key: 'executive', label: 'Executive' },
    { key: 'business_leader', label: 'Business leader' },
  ] },
  { key: 'civic', label: 'Civic life', tags: [
    { key: 'nonprofit_leader', label: 'Nonprofit leader' },
    { key: 'labor_leader', label: 'Labor leader' },
    { key: 'university_admin', label: 'University administrator' },
    { key: 'media_figure', label: 'Media figure' },
    { key: 'cultural_practitioner', label: 'Cultural practitioner' },
    { key: 'legal_professional', label: 'Legal professional' },
  ] },
]

/** Branch for tags present in the data but not in the taxonomy. */
export const OTHER_BRANCH = { key: 'other', label: 'Other' } as const

/** Tags that only restate the entity kind; never shown or filtered on. */
export const IGNORED_TAGS: readonly string[] = ['person', 'org', 'organization', 'other']

export function humanize(value: string): string {
  const s = value.replace(/[_-]+/g, ' ').trim()
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

const NODE_BY_KEY = new Map(TAG_TAXONOMY.flatMap(b => b.tags.map(t => [t.key, { ...t, branch: b.key }] as const)))
const BRANCH_BY_KEY = new Map(TAG_TAXONOMY.map(b => [b.key, b]))

/** Display label for one stored tag. */
export function tagLabel(tag: string): string {
  return NODE_BY_KEY.get(tag)?.label ?? humanize(tag)
}

export function isBranch(key: string): boolean {
  return BRANCH_BY_KEY.has(key)
}

/** Label for a filter token (a branch key or a tag). */
export function tokenLabel(token: string): string {
  return BRANCH_BY_KEY.get(token)?.label ?? tagLabel(token)
}

/** Legacy `?role=` / `?entityType=` values from earlier links → tag filter tokens. */
const LEGACY_TOKENS: Record<string, string> = { political: 'politics' }

export function normalizeToken(token: string): string {
  const t = token.trim()
  return LEGACY_TOKENS[t] ?? t
}

/** A filter token → the stored tags it matches: a branch expands to its tags, a tag matches itself. */
export function tagsForToken(token: string): string[] {
  const b = BRANCH_BY_KEY.get(normalizeToken(token))
  return b ? b.tags.map(t => t.key) : [normalizeToken(token)]
}

/** Visible tags on an entity, in taxonomy order, unknown tags last. */
export function visibleTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const tags = [...new Set(raw.filter((t): t is string => typeof t === 'string' && !!t.trim() && !IGNORED_TAGS.includes(t)))]
  const order = (t: string) => { const keys = [...NODE_BY_KEY.keys()]; const i = keys.indexOf(t); return i < 0 ? keys.length : i }
  return tags.sort((a, b) => order(a) - order(b) || a.localeCompare(b))
}

export interface TagTreeOption { value: string; label: string; count: number }
export interface TagTreeBranch extends TagTreeOption { tags: TagTreeOption[] }

/**
 * Tag counts → the taxonomy tree for the filter panel. A branch count is the number of entities with
 * at least one of its tags (`branchCounts`), not the sum, because tags overlap. Empty tags and branches
 * are dropped unless selected, so a selected token never disappears from the panel.
 */
export function tagTree(tagCounts: Map<string, number>, branchCounts: Map<string, number>, selected: readonly string[] = []): TagTreeBranch[] {
  const keep = (key: string, n: number) => n > 0 || selected.includes(key)
  const out: TagTreeBranch[] = []
  const known = new Set<string>(IGNORED_TAGS)
  for (const b of TAG_TAXONOMY) {
    const tags = b.tags.map(t => { known.add(t.key); return { value: t.key, label: t.label, count: tagCounts.get(t.key) ?? 0 } }).filter(t => keep(t.value, t.count))
    const count = branchCounts.get(b.key) ?? 0
    if (tags.length || keep(b.key, count)) out.push({ value: b.key, label: b.label, count, tags })
  }
  const other = [...tagCounts.entries()].filter(([t, n]) => !known.has(t) && keep(t, n))
    .map(([t, n]) => ({ value: t, label: tagLabel(t), count: n }))
  for (const s of selected) if (!known.has(s) && !isBranch(s) && !other.some(o => o.value === s)) other.push({ value: s, label: tagLabel(s), count: 0 })
  if (other.length) out.push({ value: OTHER_BRANCH.key, label: OTHER_BRANCH.label, count: -1, tags: other.sort((a, b) => a.label.localeCompare(b.label)) })
  return out
}
