import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { OrgHeader } from '@/components/profile/OrgHeader'
import { BioSection } from '@/components/profile/BioSection'
import { RelationshipList } from '@/components/profile/RelationshipList'
import { ArticleList } from '@/components/profile/ArticleList'
import { TimelineView } from '@/components/profile/TimelineView'
import { ContributionTable } from '@/components/finance/ContributionTable'
import { LobbyingSection } from '@/components/profile/LobbyingSection'
import { GovernmentContractsSection } from '@/components/profile/GovernmentContractsSection'
import { PropertySection } from '@/components/profile/PropertySection'
import { TestimonySection } from '@/components/profile/TestimonySection'
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
    { data: lobbyistRegistrations },
    { data: lobbyistExpenditures },
    { data: orgExpenditures },
    { data: contracts },
    { data: properties },
    { data: testimony },
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
    supabase
      .from('lobbyist_registration')
      .select(`
        *,
        lobbyist:lobbyist_person_id(id, full_name, slug),
        firm:lobbying_firm_org_id(id, name, slug)
      `)
      .eq('client_org_id', org.id),
    supabase
      .from('lobbyist_expenditure')
      .select('*')
      .eq('client_org_id', org.id)
      .order('period', { ascending: false }),
    supabase
      .from('org_lobbying_expenditure')
      .select('*')
      .eq('org_id', org.id)
      .order('period', { ascending: false }),
    supabase
      .from('government_contract')
      .select('*')
      .eq('vendor_org_id', org.id)
      .order('award_date', { ascending: false })
      .limit(50),
    supabase
      .from('property_ownership')
      .select('*')
      .eq('owner_org_id', org.id)
      .order('assessed_value', { ascending: false })
      .limit(50),
    supabase
      .from('legislative_testimony')
      .select(`
        *,
        person:person_id(id, full_name, slug)
      `)
      .eq('organization_id', org.id)
      .order('hearing_date', { ascending: false })
      .limit(50),
  ])

  const hasLobbyingData = (lobbyistRegistrations && lobbyistRegistrations.length > 0) ||
    (lobbyistExpenditures && lobbyistExpenditures.length > 0) ||
    (orgExpenditures && orgExpenditures.length > 0)
  const hasPublicRecords = (contracts && contracts.length > 0) ||
    (properties && properties.length > 0) ||
    (testimony && testimony.length > 0)

  const extraTabs = []

  if (hasLobbyingData) {
    extraTabs.push({
      value: 'lobbying',
      label: 'Lobbying',
      content: (
        <LobbyingSection
          registrations={lobbyistRegistrations || []}
          expenditures={lobbyistExpenditures || []}
          orgExpenditures={orgExpenditures || []}
        />
      ),
    })
  }

  if (hasPublicRecords) {
    extraTabs.push({
      value: 'public-records',
      label: 'Public Records',
      content: (
        <div className="space-y-10">
          {testimony && testimony.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-white mb-4">Legislative Testimony</h2>
              <TestimonySection testimony={testimony} />
            </div>
          )}
          {contracts && contracts.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-white mb-4">Government Contracts</h2>
              <GovernmentContractsSection contracts={contracts} />
            </div>
          )}
          {properties && properties.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-white mb-4">Property Ownership</h2>
              <PropertySection properties={properties} />
            </div>
          )}
        </div>
      ),
    })
  }

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
          extraTabs={extraTabs.length > 0 ? extraTabs : undefined}
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
