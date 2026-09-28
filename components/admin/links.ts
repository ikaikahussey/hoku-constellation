/** Admin detail route for an entity of any kind. */
export function adminEntityHref(kind: string | null | undefined, id: string): string {
  return kind === 'person' ? `/admin/person/${id}` : `/admin/entity/${id}`
}

export function adminEditHref(kind: string | null | undefined, id: string): string | null {
  if (kind === 'person') return `/admin/person/${id}/edit`
  if (kind === 'org') return `/admin/org/${id}/edit`
  return null
}

/** Public route for an entity, when the kind has a public page. */
export function publicEntityHref(kind: string | null | undefined, slug: string | null | undefined): string | null {
  if (!slug) return null
  if (kind === 'person') return `/person/${slug}`
  if (kind === 'org') return `/org/${slug}`
  return null
}
