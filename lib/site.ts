/** Canonical site origin. NEXT_PUBLIC_SITE_URL is the single source of truth (trimmed, no trailing slash). */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://constellation.hoku.fm').trim().replace(/\/$/, '')
