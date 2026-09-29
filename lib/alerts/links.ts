import { sign } from '@/lib/crypto'
import { SITE_URL } from '@/lib/site'

export const unsubscribeUrl = (ruleId: string) => `${SITE_URL}/api/alerts/unsubscribe?r=${ruleId}&s=${sign(`unsub:${ruleId}`)}`
export const openPixelUrl = (deliveryId: string) => `${SITE_URL}/api/alerts/open?d=${deliveryId}&s=${sign(`open:${deliveryId}`)}`

export function entityHref(e: { id: string; kind: string | null; slug: string | null } | null, documentId?: string | null): string {
  if (e?.kind === 'bill') return `${SITE_URL}/bills/${e.id}`
  if (e?.kind === 'person' && e.slug) return `${SITE_URL}/person/${e.slug}`
  if (e?.kind === 'org' && e.slug) return `${SITE_URL}/org/${e.slug}`
  if (documentId) return `${SITE_URL}/documents/${documentId}`
  return `${SITE_URL}/account/alerts`
}
export const documentHref = (id: string) => `${SITE_URL}/documents/${id}`
