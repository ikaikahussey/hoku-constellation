import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { OrgHeader } from '@/components/profile/OrgHeader'
import { BioSection } from '@/components/profile/BioSection'
import { RelationshipList } from '@/components/profile/RelationshipList'
import { ArticleList } from '@/components/profile/ArticleList'
import { TimelineView } from '@/components/profile/TimelineView'
import { ContributionTable } from '@/components/finance/ContributionTable'
import { ProfileTabs } from '@/components/profile/ProfileTabs'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

interface Props {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const supabase = await createClient()
  const { data: org } = await supabase.from('organization').select('name, description').eq('slug', slug).single()

  if (!org) return { title: 'Not Found' }

  const description = org.description
    ? org.description.slice(0, 155)
    : `${org.name} on Hoku Constellation`

  return {
    title: org.name,
    description,
    openGraph: {
      title: `${org.name} — Hoku Constellation`,
      description,
    },
  }
}

export default async function OrgProfilePage({ params }: Props) {
  const { slug } = await params
  const supabase = await createClient()

  const { data: org } = await supabase.from('organization').select('*').eq('slug', slug).single()
  if (!org) notFound()

  const [
    { data: relationships },
    { data: articles },
    { data: timeline },
    { data: contributions },
    { data: dockets },
  ] = await Promise.all([
    supabase
      .from('relationship')
      .select(`
        *,
        target_person:target_person_id(id, full_name, slug, entity_types),
        target_org:target_org_id(id, name, slug, org_type),
        source_person:source_person_id(id, full_name, slug, entity_types),
        source_org:source_org_id(id, name, slug, org_type)
      `)
      .or(`source_org_id.eq.${org.id},target_org_id.eq.${org.id}`)
      .order('is_current', { ascending: false }),
    supabase
      .from('article_entity_mention')
      .select('mention_type, article:article_id(id, title, url, published_at, source, summary)')
      .eq('organization_id', org.id)
      .limit(20),
    supabase
      .from('timeline_event')
      .select('*')
      .eq('organization_id', org.id)
      .order('event_date', { ascending: false }),
    supabase
      .from('contribution')
      .select('*')
      .or(`donor_org_id.eq.${org.id},recipient_org_id.eq.${org.id}`)
      .order('contribution_date', { ascending: false })
      .limit(50),
    supabase
      .from('puc_participant')
      .select('role, docket:docket_id(id, docket_number, title, status, filed_date, utility_type)')
      .eq('organization_id', org.id)
      .limit(20),
  ])

  return (
    <>
      <Header />
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
        <OrgHeader org={org} relationshipCount={relationships?.length || 0} />

        <ProfileTabs
          overviewContent={
            <div className="space-y-8">
              <BioSection content={org.description} />
              {relationships && relationships.filter((r: Record<string, unknown>) => r.is_current).length > 0 && (
                <div>
                  <h2 className="text-lg font-semibold text-white mb-4">Key People</h2>
                  <RelationshipList relationships={relationships.filter((r: Record<string, unknown>) => r.is_current)} centerId={org.id} centerType="organization" />
                </div>
              )}
            </div>
          }
          connectionsContent={
            <RelationshipList relationships={relationships || []} centerId={org.id} centerType="organization" />
          }
          moneyContent={
            <div className="space-y-8">
              <ContributionTable contributions={contributions || []} entityId={org.id} entityType="organization" />
              {dockets && dockets.length > 0 && (
                <div>
                  <h2 className="text-lg font-semibold text-white mb-4">PUC Dockets</h2>
                  <div className="space-y-2">
                    {dockets.map((d, i) => {
                      const docket = d.docket as unknown as Record<string, unknown> | null
                      if (!docket) return null
                      return (
                        <div key={i} className="bg-navy-light rounded-md border border-white/10 p-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-gold">{docket.docket_number as string}</span>
                            <span className="text-xs text-white/30">{d.role}</span>
                          </div>
                          <p className="text-sm text-white mt-1">{docket.title as string}</p>
                          <div className="flex gap-2 mt-1 text-xs text-white/30">
                            <span>{docket.status as string}</span>
                            {docket.utility_type ? <span>· {String(docket.utility_type)}</span> : null}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          }
          reportingContent={
            <ArticleList mentions={articles || []} />
          }
          timelineContent={
            <TimelineView events={timeline || []} />
          }
        />
      </main>
      <Footer />
    </>
  )
}
