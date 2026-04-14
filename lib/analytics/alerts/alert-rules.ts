/**
 * Declarative alert rules. Each rule is a function:
 *   (supabase, since: ISO string) => AlertRecord[]
 *
 * Rules query canonical tables for records imported after `since` and
 * produce an AlertRecord describing the newsworthy change.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AlertRecord } from '../types'

type Rule = (supabase: SupabaseClient, since: string) => Promise<AlertRecord[]>

export const largeDonationRule: Rule = async (supabase, since) => {
  const { data } = await supabase
    .from('contribution')
    .select('id, amount, source, donor_person_id, recipient_person_id, donor_name_raw, recipient_name_raw')
    .gte('imported_at', since)
    .neq('match_status', 'unmatched')
  const out: AlertRecord[] = []
  for (const c of data ?? []) {
    const amt = Number(c.amount)
    const threshold = c.source === 'fec' ? 10000 : 5000
    if (amt < threshold) continue
    out.push({
      alert_type: 'large_donation',
      severity: amt >= threshold * 5 ? 'high' : 'medium',
      person_id: c.donor_person_id ?? c.recipient_person_id ?? null,
      headline: `Large donation: ${c.donor_name_raw} → ${c.recipient_name_raw} ($${amt.toLocaleString()})`,
      detail: { amount: amt, source: c.source },
      source_records: [{ table: 'contribution', id: c.id }],
    })
  }
  return out
}

export const newLobbyistRule: Rule = async (supabase, since) => {
  const { data } = await supabase
    .from('lobbyist_registration')
    .select('id, lobbyist_person_id, client_org_id, client_name_raw')
    .gte('imported_at', since)
  return (data ?? []).map(l => ({
    alert_type: 'new_lobbyist_registration',
    severity: 'medium' as const,
    person_id: l.lobbyist_person_id ?? null,
    organization_id: l.client_org_id ?? null,
    headline: `New lobbyist registration for ${l.client_name_raw ?? 'client'}`,
    detail: {},
    source_records: [{ table: 'lobbyist_registration', id: l.id }],
  }))
}

export const boardAppointmentRule: Rule = async (supabase, since) => {
  const { data } = await supabase
    .from('relationship')
    .select('id, source_person_id, title, created_at')
    .eq('relationship_type', 'appointed_to')
    .gte('created_at', since)
  return (data ?? []).map(r => ({
    alert_type: 'new_board_appointment',
    severity: /BLNR|LUC|PUC|UH Regents|OHA/i.test(r.title ?? '') ? 'high' as const : 'medium' as const,
    person_id: r.source_person_id ?? null,
    headline: `New board appointment: ${r.title}`,
    detail: {},
    source_records: [{ table: 'relationship', id: r.id }],
  }))
}

export const largeContractRule: Rule = async (supabase, since) => {
  const { data } = await supabase
    .from('government_contract')
    .select('id, vendor_org_id, vendor_name_raw, contract_amount, awarding_agency')
    .gte('imported_at', since)
    .gte('contract_amount', 500000)
  return (data ?? []).map(c => ({
    alert_type: 'large_contract_award',
    severity: Number(c.contract_amount) >= 5_000_000 ? 'high' as const : 'medium' as const,
    organization_id: c.vendor_org_id ?? null,
    headline: `${c.vendor_name_raw} awarded $${Number(c.contract_amount).toLocaleString()} by ${c.awarding_agency}`,
    detail: { amount: c.contract_amount },
    source_records: [{ table: 'government_contract', id: c.id }],
  }))
}

export const propertyTransferRule: Rule = async (supabase, since) => {
  const { data } = await supabase
    .from('property_ownership')
    .select('id, owner_person_id, owner_name_raw, tmk, assessed_value')
    .gte('imported_at', since)
    .not('owner_person_id', 'is', null)
  return (data ?? []).map(p => ({
    alert_type: 'new_property_transfer',
    severity: 'medium' as const,
    person_id: p.owner_person_id,
    headline: `Property transfer: ${p.owner_name_raw} — TMK ${p.tmk}`,
    detail: { tmk: p.tmk, value: p.assessed_value },
    source_records: [{ table: 'property_ownership', id: p.id }],
  }))
}

export const testimonySurgeRule: Rule = async (supabase, since) => {
  const { data } = await supabase
    .from('legislative_testimony')
    .select('person_id')
    .gte('imported_at', since)
    .not('person_id', 'is', null)
  const counts = new Map<string, number>()
  for (const t of data ?? []) counts.set(t.person_id!, (counts.get(t.person_id!) ?? 0) + 1)
  return [...counts.entries()]
    .filter(([, c]) => c >= 3)
    .map(([pid, c]) => ({
      alert_type: 'testimony_surge',
      severity: 'medium' as const,
      person_id: pid,
      headline: `Testimony surge: ${c} bills in recent window`,
      detail: { count: c },
      source_records: [],
    }))
}

export const ALERT_RULES: Rule[] = [
  largeDonationRule,
  newLobbyistRule,
  boardAppointmentRule,
  largeContractRule,
  propertyTransferRule,
  testimonySurgeRule,
]
