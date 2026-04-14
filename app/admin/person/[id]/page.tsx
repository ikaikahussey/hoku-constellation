import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

type ContributionRow = {
  id: string
  amount: number | null
  contribution_date: string | null
  donor_name_raw: string | null
  recipient_name_raw: string | null
  donor_person_id: string | null
  recipient_person_id: string | null
  source: string | null
  contribution_type: string | null
  election_period: string | null
}

type RelationshipRow = {
  id: string
  relationship_type: string
  is_current: boolean | null
  start_date: string | null
  end_date: string | null
  source_person_id: string | null
  source_org_id: string | null
  target_person_id: string | null
  target_org_id: string | null
}

function formatAmount(n: number | null): string {
  if (n === null || n === undefined) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

function formatDate(s: string | null): string {
  if (!s) return '—'
  try {
    return new Date(s).toLocaleDateString()
  } catch {
    return s
  }
}

export default async function AdminPersonDetail({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: person, error } = await supabase
    .from('person')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !person) notFound()

  // Run related queries in parallel
  const [
    recipientContribs,
    donorContribs,
    relationships,
    timelineEvents,
    articleMentions,
  ] = await Promise.all([
    supabase
      .from('contribution')
      .select('id, amount, contribution_date, donor_name_raw, recipient_name_raw, donor_person_id, recipient_person_id, source, contribution_type, election_period')
      .eq('recipient_person_id', id)
      .order('contribution_date', { ascending: false })
      .limit(50),
    supabase
      .from('contribution')
      .select('id, amount, contribution_date, donor_name_raw, recipient_name_raw, donor_person_id, recipient_person_id, source, contribution_type, election_period')
      .eq('donor_person_id', id)
      .order('contribution_date', { ascending: false })
      .limit(50),
    supabase
      .from('relationship')
      .select('*')
      .or(`source_person_id.eq.${id},target_person_id.eq.${id}`)
      .order('is_current', { ascending: false }),
    supabase
      .from('timeline_event')
      .select('*')
      .eq('person_id', id)
      .order('event_date', { ascending: false })
      .limit(20),
    supabase
      .from('article_entity_mention')
      .select('mention_type, article:article_id(id, title, url, published_at, source)')
      .eq('person_id', id)
      .limit(20),
  ])

  const asRecipient: ContributionRow[] = recipientContribs.data || []
  const asDonor: ContributionRow[] = donorContribs.data || []
  const rels: RelationshipRow[] = relationships.data || []

  // Aggregate totals
  const totalReceived = asRecipient.reduce((sum, c) => sum + (c.amount || 0), 0)
  const totalGiven = asDonor.reduce((sum, c) => sum + (c.amount || 0), 0)

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-white/40 mb-2">
          <Link href="/admin/person" className="hover:text-white">People</Link>
          <span>/</span>
          <span className="text-white/70">{person.full_name}</span>
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">{person.full_name}</h1>
            <div className="flex flex-wrap gap-1 mt-2">
              {(person.entity_types || []).map((t: string) => (
                <span key={t} className="inline-flex items-center rounded-full bg-gold/10 px-2 py-0.5 text-xs text-gold">
                  {t.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            {person.slug && (
              <Link
                href={`/person/${person.slug}`}
                target="_blank"
                className="px-4 py-2 rounded-md text-sm font-medium bg-white/5 text-white/70 hover:bg-white/10 hover:text-white transition-colors"
              >
                View public profile ↗
              </Link>
            )}
            <Link
              href={`/admin/person/${person.id}/edit`}
              className="px-4 py-2 rounded-md text-sm font-semibold bg-gold text-navy hover:bg-gold-light transition-colors"
            >
              Edit
            </Link>
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-navy-light rounded-lg border border-white/10 p-4">
          <p className="text-2xl font-bold text-gold">{asRecipient.length.toLocaleString()}</p>
          <p className="text-sm text-white/50">Contributions received</p>
          <p className="text-xs text-white/40 mt-1">{formatAmount(totalReceived)} shown</p>
        </div>
        <div className="bg-navy-light rounded-lg border border-white/10 p-4">
          <p className="text-2xl font-bold text-gold">{asDonor.length.toLocaleString()}</p>
          <p className="text-sm text-white/50">Contributions given</p>
          <p className="text-xs text-white/40 mt-1">{formatAmount(totalGiven)} shown</p>
        </div>
        <div className="bg-navy-light rounded-lg border border-white/10 p-4">
          <p className="text-2xl font-bold text-gold">{rels.length.toLocaleString()}</p>
          <p className="text-sm text-white/50">Relationships</p>
        </div>
        <div className="bg-navy-light rounded-lg border border-white/10 p-4">
          <p className="text-2xl font-bold text-gold">{(articleMentions.data || []).length.toLocaleString()}</p>
          <p className="text-sm text-white/50">Article mentions</p>
        </div>
      </div>

      {/* Core fields */}
      <div className="bg-navy-light rounded-lg border border-white/10 p-6 mb-6">
        <h2 className="text-lg font-semibold text-white mb-4">Details</h2>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-sm">
          <Field label="Full name" value={person.full_name} />
          <Field label="Slug" value={person.slug} mono />
          <Field label="First name" value={person.first_name} />
          <Field label="Last name" value={person.last_name} />
          <Field label="Office held" value={person.office_held} />
          <Field label="Party" value={person.party} />
          <Field label="District" value={person.district} />
          <Field label="Island" value={person.island} />
          <Field label="Term start" value={formatDate(person.term_start)} />
          <Field label="Term end" value={formatDate(person.term_end)} />
          <Field label="Status" value={person.status} />
          <Field label="Visibility" value={person.visibility} />
          <Field label="Website" value={person.website_url} link />
          <Field label="Photo URL" value={person.photo_url} mono />
          <Field label="Created" value={formatDate(person.created_at)} />
          <Field label="Updated" value={formatDate(person.updated_at)} />
        </dl>

        {person.aliases && person.aliases.length > 0 && (
          <div className="mt-4 pt-4 border-t border-white/10">
            <p className="text-xs text-white/50 mb-2">Aliases</p>
            <div className="flex flex-wrap gap-1">
              {person.aliases.map((a: string, i: number) => (
                <span key={i} className="inline-flex items-center rounded bg-white/5 px-2 py-0.5 text-xs text-white/70">
                  {a}
                </span>
              ))}
            </div>
          </div>
        )}

        {person.bio_summary && (
          <div className="mt-4 pt-4 border-t border-white/10">
            <p className="text-xs text-white/50 mb-2">Bio</p>
            <p className="text-sm text-white/80 whitespace-pre-wrap">{person.bio_summary}</p>
          </div>
        )}
      </div>

      {/* Contributions received */}
      {asRecipient.length > 0 && (
        <Section title={`Contributions received (${asRecipient.length})`}>
          <ContribTable rows={asRecipient} side="recipient" />
        </Section>
      )}

      {/* Contributions given */}
      {asDonor.length > 0 && (
        <Section title={`Contributions given (${asDonor.length})`}>
          <ContribTable rows={asDonor} side="donor" />
        </Section>
      )}

      {/* Relationships */}
      {rels.length > 0 && (
        <Section title={`Relationships (${rels.length})`}>
          <div className="divide-y divide-white/5">
            {rels.map((r) => (
              <div key={r.id} className="py-3 text-sm flex items-center justify-between gap-4">
                <div>
                  <p className="text-white">{r.relationship_type.replace(/_/g, ' ')}</p>
                  <p className="text-xs text-white/40">
                    {formatDate(r.start_date)} → {r.end_date ? formatDate(r.end_date) : 'present'}
                  </p>
                </div>
                <span className={`text-xs ${r.is_current ? 'text-green-400' : 'text-white/40'}`}>
                  {r.is_current ? 'current' : 'historical'}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Timeline */}
      {timelineEvents.data && timelineEvents.data.length > 0 && (
        <Section title={`Timeline (${timelineEvents.data.length})`}>
          <div className="divide-y divide-white/5">
            {timelineEvents.data.map((e: { id: string; event_date: string | null; title: string; description: string | null }) => (
              <div key={e.id} className="py-3 text-sm">
                <p className="text-white">{e.title}</p>
                <p className="text-xs text-white/40">{formatDate(e.event_date)}</p>
                {e.description && <p className="text-xs text-white/60 mt-1">{e.description}</p>}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}

function Field({ label, value, mono, link }: { label: string; value: string | null | undefined; mono?: boolean; link?: boolean }) {
  const display = value || '—'
  return (
    <div>
      <dt className="text-xs text-white/50">{label}</dt>
      <dd className={`text-sm text-white/90 ${mono ? 'font-mono text-xs' : ''}`}>
        {link && value ? (
          <a href={value} target="_blank" rel="noopener noreferrer" className="text-gold hover:underline break-all">
            {value}
          </a>
        ) : (
          <span className="break-all">{display}</span>
        )}
      </dd>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-navy-light rounded-lg border border-white/10 p-6 mb-6">
      <h2 className="text-lg font-semibold text-white mb-4">{title}</h2>
      {children}
    </div>
  )
}

function ContribTable({ rows, side }: { rows: ContributionRow[]; side: 'donor' | 'recipient' }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10">
            <th className="text-left py-2 text-white/50 font-medium text-xs">Date</th>
            <th className="text-left py-2 text-white/50 font-medium text-xs">
              {side === 'recipient' ? 'From' : 'To'}
            </th>
            <th className="text-right py-2 text-white/50 font-medium text-xs">Amount</th>
            <th className="text-left py-2 text-white/50 font-medium text-xs">Type</th>
            <th className="text-left py-2 text-white/50 font-medium text-xs">Period</th>
            <th className="text-left py-2 text-white/50 font-medium text-xs">Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="border-b border-white/5">
              <td className="py-2 text-white/70 text-xs whitespace-nowrap">{formatDate(c.contribution_date)}</td>
              <td className="py-2 text-white/90">
                {side === 'recipient' ? c.donor_name_raw : c.recipient_name_raw}
              </td>
              <td className="py-2 text-white text-right font-medium">{formatAmount(c.amount)}</td>
              <td className="py-2 text-white/50 text-xs">{c.contribution_type || '—'}</td>
              <td className="py-2 text-white/50 text-xs">{c.election_period || '—'}</td>
              <td className="py-2 text-white/40 text-xs">{c.source || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
