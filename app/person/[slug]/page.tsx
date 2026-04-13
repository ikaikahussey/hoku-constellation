import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { PersonHeader } from '@/components/profile/PersonHeader'
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
  const { data: person } = await supabase.from('person').select('full_name, bio_summary, office_held').eq('slug', slug).single()

  if (!person) return { title: 'Not Found' }

  const description = person.bio_summary
    ? person.bio_summary.slice(0, 155)
    : `${person.full_name}${person.office_held ? ` — ${person.office_held}` : ''} on Hoku Constellation`

  return {
    title: person.full_name,
    description,
    openGraph: {
      title: `${person.full_name} — Hoku Constellation`,
      description,
    },
  }
}

export default async function PersonProfilePage({ params }: Props) {
  const { slug } = await params
  const supabase = await createClient()

  const { data: person } = await supabase.from('person').select('*').eq('slug', slug).single()
  if (!person) notFound()

  const [
    { data: relationships },
    { data: articles },
    { data: timeline },
    { data: contributions },
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
      .or(`source_person_id.eq.${person.id},target_person_id.eq.${person.id}`)
      .order('is_current', { ascending: false }),
    supabase
      .from('article_entity_mention')
      .select('mention_type, article:article_id(id, title, url, published_at, source, summary)')
      .eq('person_id', person.id)
      .order('article(published_at)', { ascending: false })
      .limit(20),
    supabase
      .from('timeline_event')
      .select('*')
      .eq('person_id', person.id)
      .order('event_date', { ascending: false }),
    supabase
      .from('contribution')
      .select('*')
      .or(`donor_person_id.eq.${person.id},recipient_person_id.eq.${person.id}`)
      .order('contribution_date', { ascending: false })
      .limit(50),
  ])

  return (
    <>
      <Header />
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
        <PersonHeader person={person} relationshipCount={relationships?.length || 0} />

        <ProfileTabs
          overviewContent={
            <div className="space-y-8">
              <BioSection content={person.bio_summary} />
              {relationships && relationships.length > 0 && (
                <div>
                  <h2 className="text-lg font-semibold text-white mb-4">Current Positions & Connections</h2>
                  <RelationshipList relationships={relationships.filter((r: Record<string, unknown>) => r.is_current)} centerId={person.id} centerType="person" />
                </div>
              )}
            </div>
          }
          connectionsContent={
            <RelationshipList relationships={relationships || []} centerId={person.id} centerType="person" />
          }
          moneyContent={
            <ContributionTable contributions={contributions || []} entityId={person.id} entityType="person" />
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
