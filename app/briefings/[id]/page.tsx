import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getWorkspace, logUsage, USAGE } from '@/lib/workspace'
import { getOrBuildBriefing, type BriefingRow } from '@/lib/briefings'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { UpgradeNotice } from '@/components/workspace/Upgrade'
import { TrackBriefing } from '@/components/workspace/TrackBriefing'
import { buttonClass } from '@/components/ui/Button'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Briefing', robots: { index: false } }
export const maxDuration = 120

interface Props { params: Promise<{ id: string }> }

async function teamWatchIds(ws: NonNullable<Awaited<ReturnType<typeof getWorkspace>>>) {
  return (await ws.db.many<{ id: string }>(
    `select distinct i.entity_id id from app.watchlist w join app.watchlist_item i on i.watchlist_id = w.id join entity e on e.id = i.entity_id
      where w.team_id = $1 and e.kind in ('person','org') limit 50`, [ws.team.id])).map(r => r.id)
}

export default async function BriefingPage({ params }: Props) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const ws = await getWorkspace()
  if (!ws) redirect(`/auth/login?next=/briefings/${id}`)
  const kind = (await ws.db.one<{ kind: string }>(`select kind from entity where id = $1`, [id]))?.kind
  if (!kind || !['bill', 'person', 'org'].includes(kind)) notFound()
  const allowed = kind === 'bill' ? ws.features.briefings : ws.features.dossiers
  let row: BriefingRow | null = null
  if (allowed) {
    row = await getOrBuildBriefing(ws.db, id, { watchIds: kind === 'bill' ? undefined : await teamWatchIds(ws) })
    await logUsage(ws.db, ws.team.id, ws.user.id, USAGE.BRIEFING, id)
  }
  const c = row?.content
  const sources = row?.cites.length ? await ws.db.many<{ id: string; title: string | null; source: string; doc_date: string | null }>(
    `select id, title, source, doc_date::text doc_date from document where id = any($1::uuid[])`, [row.cites]) : []
  const order = new Map<string, number>()
  const note = (ids: string[]) => ids.forEach(d => { if (!order.has(d)) order.set(d, order.size + 1) })
  c?.summary.sentences.forEach(s => note(s.documentIds))
  c?.sections.forEach(s => s.lines.forEach(l => note(l.documentIds)))
  const cite = (ids: string[]) => ids.map(d => <sup key={d}><a href={`/documents/${d}`} className="link-quiet">[{order.get(d)}]</a></sup>)
  const back = kind === 'bill' ? `/bills/${id}` : null
  return (
    <>
      <Header signedIn />
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 sm:px-6 py-8">
        {!allowed || !c ? <UpgradeNotice feature={kind === 'bill' ? 'Bill briefings' : 'Dossiers'} tier={ws.features.tier} /> : (
          <article className="space-y-8">
            <TrackBriefing kind={kind} />
            <header className="pb-6 border-b border-ink flex flex-wrap justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">{kind === 'bill' ? 'Bill briefing' : 'Dossier'} · generated {new Date(row!.generated_at).toISOString().slice(0, 16).replace('T', ' ')} UTC</p>
                <h1 className="text-3xl font-bold">{back ? <Link href={back} className="link-quiet">{c.entity.name}</Link> : c.entity.name}</h1>
              </div>
              <a href={`/api/briefings/${id}/pdf`} className={buttonClass('secondary', 'sm')}>Download PDF</a>
            </header>
            <section>
              <h2 className="text-xl font-bold mb-2">Summary</h2>
              <p className="leading-relaxed">{c.summary.sentences.map((s, i) => <span key={i}>{s.text} {cite(s.documentIds)} </span>)}</p>
              <p className="text-xs text-muted mt-2">{c.summary.source === 'model' ? 'Written by AI from the cited records only; each sentence links to its source.' : 'Compiled directly from the cited records.'}</p>
            </section>
            {c.sections.map(s => (
              <section key={s.key}>
                <h2 className="text-lg font-bold mb-2 pb-1 border-b border-ink">{s.title}</h2>
                {s.note && <p className="text-xs text-muted mb-2">{s.note}</p>}
                {s.lines.length ? <ul className="space-y-1">{s.lines.map((l, i) => <li key={i}>{l.text} {cite(l.documentIds)}</li>)}</ul> : <p className="text-sm text-muted">No records.</p>}
              </section>
            ))}
            <section>
              <h2 className="text-lg font-bold mb-2 pb-1 border-b border-ink">Sources</h2>
              <ol className="text-sm space-y-1">{[...sources].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)).map(s => <li key={s.id}>[{order.get(s.id)}] <a href={`/documents/${s.id}`}>{s.title ?? s.source}</a> <span className="text-muted">— {s.source.replace(/_/g, ' ')}{s.doc_date ? `, ${s.doc_date}` : ''}</span></li>)}</ol>
            </section>
          </article>
        )}
      </main>
      <Footer />
    </>
  )
}
