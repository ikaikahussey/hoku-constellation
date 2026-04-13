export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[ʻ'']/g, '') // Remove Hawaiian okina and smart quotes
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}
