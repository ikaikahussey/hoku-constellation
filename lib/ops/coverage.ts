/**
 * Source coverage and freshness (E8). Built from lib/import/source-registry.ts and import_cursor:
 * what each source provides, the date range held, the last successful update, and the freshness
 * target. Tier 1 sources that miss their target by 2x alert the owner (checkFreshness).
 */
import type { Db } from '@/lib/db/types'
import { SOURCE_REGISTRY, type SourceDefinition } from '@/lib/import/source-registry'
import { CADENCE_MS } from '@/lib/import/schedule'
import { renderEmail } from '@/lib/email/template'
import { getEmailTransport, type EmailTransport } from '@/lib/email/resend'
import { SITE_URL } from '@/lib/site'

export interface CoverageRow {
  key: string; name: string; agency: string; jurisdiction: string; tier: number; status: SourceDefinition['status']; cadence: string
  docTypes: string[]; notes: string | null
  documents: number; earliest: string | null; latest: string | null
  lastSuccess: string | null; lastStatus: string | null
  targetMs: number | null; ageMs: number | null; fresh: boolean | null; late2x: boolean
}

/** Legislative tracking target in session: 15 minutes (E1). Other sources use their registry cadence. */
export function freshnessTargetMs(def: SourceDefinition): number | null {
  return CADENCE_MS[def.cadence] ?? null
}

export async function coverage(db: Db, now = new Date()): Promise<CoverageRow[]> {
  const docs = await db.many<{ source: string; n: number; earliest: string | null; latest: string | null }>(
    `select source, count(*)::int n, min(doc_date)::text earliest, max(doc_date)::text latest from document group by source`)
  const cursors = await db.many<{ source: string; last_run_at: string | null; status: string | null; metadata: Record<string, unknown> | null }>(
    `select source, last_run_at::text, status, metadata from import_cursor`)
  const byDoc = new Map(docs.map(d => [d.source, d]))
  const byCur = new Map(cursors.map(c => [c.source, c]))
  return SOURCE_REGISTRY.map(def => {
    const d = byDoc.get(def.key), c = byCur.get(def.key)
    const lastSuccess = c && c.status !== 'error' ? c.last_run_at : ((c?.metadata?.last_success_at as string | undefined) ?? null)
    const targetMs = freshnessTargetMs(def)
    const ageMs = lastSuccess ? now.getTime() - new Date(lastSuccess).getTime() : null
    const live = def.status === 'live'
    return {
      key: def.key, name: def.name, agency: def.agency, jurisdiction: def.jurisdiction, tier: def.tier, status: def.status, cadence: def.cadence,
      docTypes: def.docTypes, notes: def.notes ?? null,
      documents: d?.n ?? 0, earliest: d?.earliest ?? null, latest: d?.latest ?? null,
      lastSuccess, lastStatus: c?.status ?? null, targetMs, ageMs,
      fresh: live && targetMs && ageMs != null ? ageMs <= targetMs : null,
      late2x: live && def.tier === 1 && !!targetMs && (ageMs == null || ageMs > 2 * targetMs),
    }
  })
}

export function formatDuration(ms: number | null): string {
  if (ms == null) return '—'
  const h = ms / 3600_000
  if (h < 1) return `${Math.round(ms / 60_000)} min`
  if (h < 48) return `${Math.round(h)} h`
  return `${Math.round(h / 24)} days`
}

/** Email the owner about Tier 1 sources more than 2x past their freshness target (at most once per source per 24 h). */
export async function checkFreshness(db: Db, opts: { now?: Date; transport?: EmailTransport } = {}): Promise<string[]> {
  const now = opts.now ?? new Date()
  const late = (await coverage(db, now)).filter(r => r.late2x)
  const alerted: string[] = []
  for (const r of late) {
    const key = `freshness_alert:${r.key}`
    const last = await db.one<{ watermark: string }>(`select watermark::text watermark from app.matcher_state where key = $1`, [key])
    if (last && now.getTime() - new Date(last.watermark).getTime() < 24 * 3600_000) continue
    alerted.push(r.key)
    await db.query(`insert into app.matcher_state(key, watermark) values ($1, $2) on conflict (key) do update set watermark = excluded.watermark, updated_at = now()`, [key, now.toISOString()])
  }
  const owner = process.env.OWNER_EMAIL
  if (alerted.length && owner) {
    const rows = late.filter(r => alerted.includes(r.key))
    const { html, text } = renderEmail({
      title: `${rows.length} Tier 1 source${rows.length === 1 ? ' is' : 's are'} stale`,
      intro: 'These sources have missed their freshness target by more than 2x.',
      blocks: [{ lines: rows.map(r => ({ text: r.name, meta: `last success ${r.lastSuccess ?? 'never'} · target ${formatDuration(r.targetMs)} · status ${r.lastStatus ?? 'never run'}`, href: `${SITE_URL}/admin/workers` })) }],
      footer: [{ text: 'Coverage', href: `${SITE_URL}/coverage` }],
    })
    await (opts.transport ?? getEmailTransport()).send([{ to: [owner], subject: `[HOKU Insider ops] Stale Tier 1 sources: ${rows.map(r => r.key).join(', ')}`, html, text, tags: { kind: 'ops_freshness' } }])
  }
  return alerted
}
