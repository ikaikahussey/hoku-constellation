import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getServiceDb } from '@/lib/db/service'
import { getEntityBySlug, getEdges, getEdgeTotals, getArticlesForEntity, getEventsForEntity, getSummary } from '@/lib/db/queries'
import type { EdgeTotals, EdgeWithEnds } from '@/lib/db/queries/edges'
import { getCurrentUser } from '@/lib/auth'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { EntityTools } from '@/components/workspace/EntityTools'
import { OrgHeader } from '@/components/profile/OrgHeader'
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
  const org = await getEntityBySlug(db, 'org', slug)
  if (!org) return { title: 'Not found' }
  const desc = attr(org, 'description')
  const description = desc ? desc.slice(0, 155) : `${org.name} on HOKU Insider`
  return {
    title: org.name,
    description,
    openGraph: { title: `${org.name} — HOKU Insider`, description },
  }
}

export default async function OrgProfilePage({ params }: Props) {
  const { slug } = await params
  const db = await getServiceDb()
  const org = await getEntityBySlug(db, 'org', slug)
  if (!org) notFound()

  const user = await getCurrentUser()
  const hasAccess = !!user?.canAccessGated

  const [positions, articles, events, summary, received, given, totals] = await Promise.all([
    getEdges(db, org.id, { types: [...POSITION_TYPES], limit: 500 }),
    getArticlesForEntity(db, org.id, 20),
    getEventsForEntity(db, org.id, 100),
    getSummary(db, org.id, hasAccess ? {} : { tier: 'free' }),
    hasAccess ? getEdges(db, org.id, { types: ['contributed_to'], direction: 'in', limit: 100 }) : Promise.resolve([] as EdgeWithEnds[]),
    hasAccess ? getEdges(db, org.id, { types: ['contributed_to'], direction: 'out', limit: 100 }) : Promise.resolve([] as EdgeWithEnds[]),
    hasAccess ? getEdgeTotals(db, org.id) : Promise.resolve([] as EdgeTotals[]),
  ])

  const current = positions.filter(isCurrent)
  const dockets = positions.filter(e => e.type === 'party_to')
  const description = attr(org, 'description') ?? summary?.body ?? null
  const graphEdges = positions.map(e => ({
    id: e.id, type: e.type, from_id: e.from_id, to_id: e.to_id, from_name: e.from_name, to_name: e.to_name,
    from_kind: e.from_kind, to_kind: e.to_kind, from_slug: e.from_slug, to_slug: e.to_slug, end_date: e.end_date, is_current: isCurrent(e),
  }))

  return (
    <>
      <Header signedIn={!!user} />
      <TrackEntityView kind="org" id={org.id} gateHit={!hasAccess} />
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
        <OrgHeader org={org} connectionCount={positions.length} />

        <ProfileTabs
          overviewContent={
            <div className="space-y-10">
              <BioSection content={description} emptyMessage="No description available yet." />
              {current.length > 0 && (
                <section>
                  <h2 className="text-xl font-bold mb-4">Key people</h2>
                  <RelationshipList edges={current.filter(e => e.type !== 'party_to')} entityId={org.id} emptyMessage="No current people documented." />
                </section>
              )}
            </div>
          }
          connectionsContent={<RelationshipList edges={positions} entityId={org.id} />}
          moneyContent={
            <div className="space-y-10">
              <MoneySection entityId={org.id} hasAccess={hasAccess} location="org_money" received={received} given={given} totals={totals} />
              {dockets.length > 0 && (
                <section>
                  <h2 className="text-xl font-bold mb-4">Regulatory dockets</h2>
                  <RelationshipList edges={dockets} entityId={org.id} />
                </section>
              )}
            </div>
          }
          reportingContent={<ArticleList articles={articles} />}
          timelineContent={<TimelineView events={events} />}
          graphContent={
            <GraphWrapper centerId={org.id} centerName={org.name} centerKind="org" centerSlug={slug} edges={graphEdges} />
          }
        />
        <EntityTools entityId={org.id} kind="org" name={org.name} path={`/org/${slug}`} />
      </main>
      <Footer />
    </>
  )
}
