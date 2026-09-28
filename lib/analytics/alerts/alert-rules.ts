/**
 * Declarative alert rules over canonical edges. Each rule: (db, since ISO) => AlertRecord[].
 * "since" compares against document.fetched_at (the ingestion time of the backing record).
 */
import type { Db } from '@/lib/db/types'
import type { AlertRecord } from '../types'

type Rule = (db: Db, since: string) => Promise<AlertRecord[]>

interface EdgeAlertRow {
  id: string; from_id: string | null; to_id: string | null; from_name_raw: string | null; to_name_raw: string | null
  amount: string | null; role: string | null; source: string; from_name: string | null; to_name: string | null
}

const EDGE_SINCE = `
  select e.id, e.from_id, e.to_id, e.from_name_raw, e.to_name_raw, e.amount::text, e.role, d.source, f.name from_name, t.name to_name
    from edge e join document d on d.id = e.document_id
    left join entity f on f.id = e.from_id left join entity t on t.id = e.to_id
   where e.type = $1 and d.fetched_at >= $2`

export const largeDonationRule: Rule = async (db, since) => {
  const rows = await db.many<EdgeAlertRow>(`${EDGE_SINCE} and e.match_status <> 'unmatched'`, ['contributed_to', since])
  const out: AlertRecord[] = []
  for (const c of rows) {
    const amt = Number(c.amount)
    const threshold = c.source === 'fec' ? 10000 : 5000
    if (amt < threshold) continue
    out.push({
      alert_type: 'large_donation',
      severity: amt >= threshold * 5 ? 'high' : 'medium',
      entity_id: c.from_id ?? c.to_id ?? null,
      headline: `Large donation: ${c.from_name ?? c.from_name_raw} → ${c.to_name ?? c.to_name_raw} ($${amt.toLocaleString()})`,
      detail: { amount: amt, source: c.source },
      source_records: [{ table: 'edge', id: c.id }],
    })
  }
  return out
}

export const newLobbyistRule: Rule = async (db, since) => {
  const rows = await db.many<EdgeAlertRow>(EDGE_SINCE, ['lobbied_for', since])
  return rows.map(l => ({
    alert_type: 'new_lobbyist_registration',
    severity: 'medium' as const,
    entity_id: l.from_id ?? l.to_id ?? null,
    headline: `New lobbyist registration: ${l.from_name ?? l.from_name_raw ?? 'lobbyist'} for ${l.to_name ?? l.to_name_raw ?? 'client'}`,
    detail: {},
    source_records: [{ table: 'edge', id: l.id }],
  }))
}

export const boardAppointmentRule: Rule = async (db, since) => {
  const rows = await db.many<EdgeAlertRow>(EDGE_SINCE, ['appointed_to', since])
  return rows.map(r => ({
    alert_type: 'new_board_appointment',
    severity: /BLNR|LUC|PUC|Regents|OHA|Land Use|Water Resource/i.test(`${r.role ?? ''} ${r.to_name ?? ''}`) ? 'high' as const : 'medium' as const,
    entity_id: r.from_id ?? null,
    headline: `New board appointment: ${r.from_name ?? r.from_name_raw} — ${r.role ?? r.to_name ?? r.to_name_raw}`,
    detail: {},
    source_records: [{ table: 'edge', id: r.id }],
  }))
}

export const largeContractRule: Rule = async (db, since) => {
  const rows = await db.many<EdgeAlertRow>(`${EDGE_SINCE} and e.amount >= 500000`, ['awarded_contract', since])
  return rows.map(c => ({
    alert_type: 'large_contract_award',
    severity: Number(c.amount) >= 5_000_000 ? 'high' as const : 'medium' as const,
    entity_id: c.to_id ?? c.from_id ?? null,
    headline: `${c.to_name ?? c.to_name_raw} awarded $${Number(c.amount).toLocaleString()} by ${c.from_name ?? c.from_name_raw}`,
    detail: { amount: Number(c.amount) },
    source_records: [{ table: 'edge', id: c.id }],
  }))
}

export const propertyTransferRule: Rule = async (db, since) => {
  const rows = await db.many<EdgeAlertRow>(`${EDGE_SINCE} and e.from_id is not null`, ['owns', since])
  return rows.map(p => ({
    alert_type: 'new_property_transfer',
    severity: 'medium' as const,
    entity_id: p.from_id,
    headline: `Property record: ${p.from_name ?? p.from_name_raw} — ${p.to_name ?? p.to_name_raw}`,
    detail: {},
    source_records: [{ table: 'edge', id: p.id }],
  }))
}

export const testimonySurgeRule: Rule = async (db, since) => {
  const rows = await db.many<{ from_id: string; n: string }>(
    `select e.from_id, count(*)::text n from edge e join document d on d.id = e.document_id
      where e.type = 'testified_on' and d.fetched_at >= $1 and e.from_id is not null group by e.from_id having count(*) >= 3`, [since])
  return rows.map(r => ({
    alert_type: 'testimony_surge',
    severity: 'medium' as const,
    entity_id: r.from_id,
    headline: `Testimony surge: ${r.n} measures in recent window`,
    detail: { count: Number(r.n) },
    source_records: [],
  }))
}

export const sanctionRule: Rule = async (db, since) => {
  const rows = await db.many<EdgeAlertRow>(EDGE_SINCE, ['sanctioned_by', since])
  return rows.map(s => ({
    alert_type: 'enforcement_action',
    severity: 'high' as const,
    entity_id: s.from_id ?? null,
    headline: `Enforcement action: ${s.from_name ?? s.from_name_raw} — ${s.role ?? 'sanction'} (${s.to_name ?? s.to_name_raw})`,
    detail: { amount: s.amount ? Number(s.amount) : null },
    source_records: [{ table: 'edge', id: s.id }],
  }))
}

export const ALERT_RULES: Rule[] = [
  largeDonationRule, newLobbyistRule, boardAppointmentRule, largeContractRule, propertyTransferRule, testimonySurgeRule, sanctionRule,
]
