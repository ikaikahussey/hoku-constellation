import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getServiceDb } from '@/lib/db/service'
import { getEntityBySlug, getEdges, getEdgeTotals, getArticlesForEntity, getEventsForEntity, getSummary } from '@/lib/db/queries'
import type { EdgeTotals, EdgeWithEnds } from '@/lib/db/queries/edges'
import { getCurrentUser } from '@/lib/auth'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { EntityTools } from '@/components/workspace/EntityTools'
import { PersonHeader } from '@/components/profile/PersonHeader'
import { BioSection } from '@/components/profile/BioSection'
import { RelationshipList } from '@/components/profile/RelationshipList'
import { ArticleList } from '@/components/profile/ArticleList'
import { TimelineView } from '@/components/profile/TimelineView'
import { ProfileTabs } from '@/components/profile/ProfileTabs'
import { TrackEntityView } from '@/components/profile/TrackEntityView'
import { MoneySection } from '@/components/finance/MoneySection'
import { GraphWrapper } from '@/components/graph/GraphWrapper'
import { POSITION_TYPES, attr, isCurrent } from '@/components/profile/edges'

export const dynamic = 'force-dynamic'

interface Props { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const db = await getServiceDb()
  const person = await getEntityBySlug(db, 'person', slug)
  if (!person) return { title: 'Not found' }
  const bio = attr(person, 'bio_summary')
  const office = attr(person, 'office_held')
  const description = bio ? bio.slice(0, 155) : `${person.name}${office ? ` — ${office}` : ''} on HOKU Insider`
  return {
    title: person.name,
    description,
    openGraph: { title: `${person.name} — HOKU Insider`, description },
  }
}

export default async function PersonProfilePage({ params }: Props) {
  const { slug } = await params
  const db = await getServiceDb()
  const person = await getEntityBySlug(db, 'person', slug)
  if (!person) notFound()

  const user = await getCurrentUser()
  const hasAccess = !!user?.canAccessGated

  const [positions, articles, events, summary, received, given, totals] = await Promise.all([
    getEdges(db, person.id, { types: [...POSITION_TYPES], limit: 500 }),
    getArticlesForEntity(db, person.id, 20),
    getEventsForEntity(db, person.id, 100),
    getSummary(db, person.id, hasAccess ? {} : { tier: 'free' }),
    hasAccess ? getEdges(db, person.id, { types: ['contributed_to'], direction: 'in', limit: 100 }) : Promise.resolve([] as EdgeWithEnds[]),
    hasAccess ? getEdges(db, person.id, { types: ['contributed_to'], direction: 'out', limit: 100 }) : Promise.resolve([] as EdgeWithEnds[]),
    hasAccess ? getEdgeTotals(db, person.id) : Promise.resolve([] as EdgeTotals[]),
  ])

  const current = positions.filter(isCurrent)
  const bio = attr(person, 'bio_summary') ?? summary?.body ?? null
  const graphEdges = positions.map(e => ({
    id: e.id, type: e.type, from_id: e.from_id, to_id: e.to_id, from_name: e.from_name, to_name: e.to_name,
    from_kind: e.from_kind, to_kind: e.to_kind, from_slug: e.from_slug, to_slug: e.to_slug, end_date: e.end_date, is_current: isCurrent(e),
  }))

  return (
    <>
      <Header signedIn={!!user} />
      <TrackEntityView kind="person" id={person.id} gateHit={!hasAccess} />
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
        <PersonHeader person={person} connectionCount={positions.length} />

        <ProfileTabs
          overviewContent={
            <div className="space-y-10">
              <BioSection content={bio} emptyMessage="No biographical summary available yet." />
              {current.length > 0 && (
                <section>
                  <h2 className="text-xl font-bold mb-4">Current positions</h2>
                  <RelationshipList edges={current} entityId={person.id} />
                </section>
              )}
            </div>
          }
          connectionsContent={<RelationshipList edges={positions} entityId={person.id} />}
          moneyContent={
            <MoneySection entityId={person.id} hasAccess={hasAccess} location="person_money" received={received} given={given} totals={totals} />
          }
          reportingContent={<ArticleList articles={articles} />}
          timelineContent={<TimelineView events={events} />}
          graphContent={
            <GraphWrapper centerId={person.id} centerName={person.name} centerKind="person" centerSlug={slug} edges={graphEdges} />
          }
        />
        <EntityTools entityId={person.id} kind="person" name={person.name} path={`/person/${slug}`} />
      </main>
      <Footer />
    </>
  )
}
