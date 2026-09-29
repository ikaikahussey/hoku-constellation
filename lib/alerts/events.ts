/**
 * Alert event vocabulary (E2). Stored in app.alert_event.event_type and app.alert_rule.event_types.
 */
export const ALERT_EVENT_TYPES = [
  // bill
  'bill.status_change', 'bill.new_draft', 'bill.hearing_scheduled', 'bill.hearing_changed', 'bill.hearing_canceled',
  'bill.vote_recorded', 'bill.testimony_deadline', 'bill.new_testimony', 'bill.committee_report',
  // entity
  'entity.new_edge', 'entity.mention',
  // keyword / source
  'keyword.match', 'source.new_document',
  // committee
  'committee.referral', 'committee.hearing_notice',
] as const
export type AlertEventType = (typeof ALERT_EVENT_TYPES)[number]

export const EVENT_LABELS: Record<AlertEventType, string> = {
  'bill.status_change': 'Status change',
  'bill.new_draft': 'New draft',
  'bill.hearing_scheduled': 'Hearing scheduled',
  'bill.hearing_changed': 'Hearing changed',
  'bill.hearing_canceled': 'Hearing canceled',
  'bill.vote_recorded': 'Vote recorded',
  'bill.testimony_deadline': 'Testimony deadline within 48 hours',
  'bill.new_testimony': 'New testimony filed',
  'bill.committee_report': 'Committee report filed',
  'entity.new_edge': 'New record',
  'entity.mention': 'Mentioned in a document',
  'keyword.match': 'Keyword match',
  'source.new_document': 'New document from a watched source',
  'committee.referral': 'New referral',
  'committee.hearing_notice': 'Hearing notice',
}

/** Edge types that raise entity.new_edge for a watched person or organization. */
export const WATCHED_EDGE_TYPES = new Set([
  'contributed_to', 'spent_with', 'loaned_to', 'lobbied_for', 'lobbied_on', 'appointed_to', 'confirmed_by',
  'awarded_contract', 'awarded_grant', 'leases', 'owns', 'sanctioned_by', 'disclosed_interest', 'licensed_by',
  'officer_of', 'director_of', 'employed_by', 'party_to', 'sponsored',
])

export const INSTANT_CHANNELS = new Set(['email', 'slack', 'sms'])
export const DIGEST_CHANNELS = new Set(['digest_daily', 'digest_weekly'])
/** When several rules for one user match one event, the first channel here wins. */
export const CHANNEL_PRIORITY = ['email', 'sms', 'digest_daily', 'digest_weekly'] as const

export interface StatusClassification {
  type: AlertEventType
  committees: string[]
  hearingAt: Date | null
}

/**
 * Classify the latest status line of a measure (data.capitol.hawaii.gov status text) into a bill
 * event. Also returns committee codes named in referrals and hearing notices, and the hearing time.
 */
export function classifyStatus(text: string): StatusClassification {
  const t = text.replace(/\s+/g, ' ').trim()
  const committees = committeeCodes(t)
  const hearingAt = parseHearingTime(t)
  let type: AlertEventType = 'bill.status_change'
  if (/cancel/i.test(t) && /hearing|heard|decision/i.test(t)) type = 'bill.hearing_canceled'
  else if (/reschedul|changed|amended notice|time change|room change/i.test(t) && /hearing|heard|decision/i.test(t)) type = 'bill.hearing_changed'
  else if (/scheduled to be heard|scheduled a public hearing|scheduled for decision|public hearing on|heard by/i.test(t)) type = 'bill.hearing_scheduled'
  else if (/Stand\.?\s*Com\.?\s*Rep|Conf\.?\s*Com\.?\s*Rep|reported from/i.test(t)) type = 'bill.committee_report'
  else if (/\b(ayes?|noes?|voting (aye|no)|votes? (were|in))\b/i.test(t)) type = 'bill.vote_recorded'
  else if (/\b(HD|SD|CD)\s?\d\b/i.test(t) && /amended|draft/i.test(t)) type = 'bill.new_draft'
  return { type, committees, hearingAt }
}

/** Committee codes in "Referred to EET, CPN." / "heard by HLT" / "referred to the committee(s) on FIN". */
export function committeeCodes(text: string): string[] {
  // Prefixes are case-insensitive; committee codes are uppercase only (so "referral sheet" is not a code).
  const m = text.match(/(?:[Rr][Ee]-?[Rr]eferred to(?: the committee\(s\) on)?|[Rr]eferred to(?: the committee\(s\) on)?|heard by|[Cc]ommittee\(s\) on)\s+([A-Z]{2,4}\b(?:\s*[,/&]\s*[A-Z]{2,4}\b)*)/)
  if (!m) return []
  return [...new Set(m[1].split(/\s*[,/&]\s*/).map(s => s.trim().toUpperCase()).filter(s => /^[A-Z]{2,4}$/.test(s)))]
}

/** "02-10-26 9:00AM" / "2/10/2026 9:00 AM" in HST → Date (UTC). */
export function parseHearingTime(text: string): Date | null {
  const m = text.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})\s+(\d{1,2}):(\d{2})\s*([AP])\.?M/i)
  if (!m) return null
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
  let hour = Number(m[4]) % 12
  if (/p/i.test(m[6])) hour += 12
  return new Date(Date.UTC(year, Number(m[1]) - 1, Number(m[2]), hour + 10, Number(m[5])))
}
