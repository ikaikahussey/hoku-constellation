import type { Metadata } from 'next'
import { getServiceDb } from '@/lib/db/service'
import { coverage, formatDuration } from '@/lib/ops/coverage'
import { getSessionUser } from '@/lib/auth'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { Badge } from '@/components/ui/Badge'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Coverage', description: 'Every public source HOKU Insider ingests: what it covers, the date range held, when it last updated, and its freshness target.' }

const STATUS: Record<string, string> = { live: 'Ingested', planned: 'Planned', blocked: 'Not available', manual: 'By records request', retired: 'Retired' }
const JURIS: Record<string, string> = { state: 'State', federal: 'Federal', honolulu: 'Honolulu', maui: 'Maui', hawaii: 'Hawaiʻi County', kauai: 'Kauaʻi' }

export default async function CoveragePage() {
  const [rows, user] = await Promise.all([coverage(await getServiceDb()), getSessionUser()])
  const groups = ['live', 'manual', 'planned', 'blocked', 'retired'].map(s => ({ s, rows: rows.filter(r => r.status === s) })).filter(g => g.rows.length)
  return (
    <>
      <Header signedIn={!!user} />
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-12">
        <h1 className="text-3xl sm:text-4xl font-bold mb-3">Coverage</h1>
        <p className="text-muted max-w-3xl mb-2">Every source HOKU Insider ingests or has evaluated, generated from the source registry and the ingestion log. Freshness targets are how often each source is checked. Tier 1 sources that fall more than twice behind their target raise an alert to our staff.</p>
        <p className="text-sm text-muted mb-10">During the legislative session, measure status is polled more often, with a target of 15 minutes for status changes to appear.</p>
        {groups.map(g => (
          <section key={g.s} className="mb-12">
            <h2 className="text-xl font-bold mb-3">{STATUS[g.s]} <span className="text-muted font-normal text-base tabular">({g.rows.length})</span></h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-ink text-left"><tr>
                  <th className="py-2 pr-3">Source</th><th className="py-2 pr-3">What is ingested</th><th className="py-2 pr-3 text-right">Records</th>
                  <th className="py-2 pr-3">Date range</th><th className="py-2 pr-3">Last successful update</th><th className="py-2">Freshness target</th></tr></thead>
                <tbody>{g.rows.map(r => (
                  <tr key={r.key} className="border-b border-rule align-top">
                    <td className="py-2 pr-3"><strong>{r.name}</strong><div className="text-xs text-muted">{r.agency} · {JURIS[r.jurisdiction] ?? r.jurisdiction} · Tier {r.tier}</div>
                      {g.s === 'blocked' && r.notes && <div className="text-xs text-muted mt-1">{r.notes}</div>}</td>
                    <td className="py-2 pr-3">{r.docTypes.map(t => t.replace(/_/g, ' ')).join(', ')}</td>
                    <td className="py-2 pr-3 text-right tabular">{r.documents.toLocaleString('en-US')}</td>
                    <td className="py-2 pr-3 tabular whitespace-nowrap">{r.earliest ? `${r.earliest} – ${r.latest}` : '—'}</td>
                    <td className="py-2 pr-3 tabular whitespace-nowrap">{r.lastSuccess ? `${r.lastSuccess.slice(0, 16).replace('T', ' ')} UTC` : '—'}
                      {r.fresh === false && <> <Badge variant="outline">{r.late2x ? 'stale' : 'late'}</Badge></>}</td>
                    <td className="py-2 tabular whitespace-nowrap">{g.s === 'live' ? `${r.cadence} (${formatDuration(r.targetMs)})` : '—'}</td>
                  </tr>))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
        <p className="text-sm">Found a gap or an error? <a href="/corrections/new?page=/coverage">Report it</a>. See also <a href="/methodology">methodology</a>.</p>
      </main>
      <Footer />
    </>
  )
}
