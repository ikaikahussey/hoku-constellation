import { Badge } from '@/components/ui/Badge'

interface OrgHeaderProps {
  org: Record<string, unknown>
  relationshipCount: number
}

export function OrgHeader({ org, relationshipCount }: OrgHeaderProps) {
  return (
    <div className="mb-8">
      <div className="flex items-start gap-6">
        <div className="w-20 h-20 rounded-lg bg-ocean/20 border border-ocean/30 flex items-center justify-center flex-shrink-0">
          <svg className="w-10 h-10 text-ocean" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-3xl font-bold text-white">{org.name as string}</h1>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {org.org_type ? <Badge variant="ocean">{String(org.org_type).replace(/_/g, ' ')}</Badge> : null}
            {org.sector ? <Badge variant="default">{String(org.sector).replace(/_/g, ' ')}</Badge> : null}
            {org.island ? <Badge variant="outline">{String(org.island)}</Badge> : null}
            <Badge variant={org.status === 'active' ? 'success' : 'default'}>
              {org.status as string}
            </Badge>
          </div>
          <div className="flex items-center gap-6 mt-4 text-sm text-white/40">
            <span>{relationshipCount} connection{relationshipCount !== 1 ? 's' : ''}</span>
            {org.website_url ? (
              <a href={String(org.website_url)} target="_blank" rel="noopener noreferrer" className="text-gold/60 hover:text-gold">
                Website
              </a>
            ) : null}
          </div>
          {(org.ein || org.dcca_file_number || org.sec_cik || org.fec_committee_id) ? (
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-white/30">
              {org.ein ? <span>EIN: {String(org.ein)}</span> : null}
              {org.dcca_file_number ? <span>DCCA: {String(org.dcca_file_number)}</span> : null}
              {org.sec_cik ? <span>SEC CIK: {String(org.sec_cik)}</span> : null}
              {org.fec_committee_id ? <span>FEC: {String(org.fec_committee_id)}</span> : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
