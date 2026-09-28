/**
 * Legistar Web API client (webapi.legistar.com/v1/<client>). Used for Maui and Hawaiʻi County councils.
 * Client names must be verified live (scripts/import/verify-sources.ts); a wrong name returns 404.
 */
import { fetchJson } from '../http'

export interface LegistarMatter {
  MatterId: number; MatterGuid: string; MatterFile: string; MatterName: string | null; MatterTitle: string | null
  MatterTypeName: string | null; MatterStatusName: string | null; MatterBodyName: string | null
  MatterIntroDate: string | null; MatterPassedDate: string | null; MatterLastModifiedUtc: string
}
export interface LegistarSponsor { MatterSponsorId: number; MatterSponsorName: string; MatterSponsorSequence: number }
export interface LegistarPerson { PersonId: number; PersonGuid: string; PersonFullName: string; PersonActiveFlag: number; PersonEmail: string | null }
export interface LegistarEventItem {
  EventItemId: number; EventItemMatterId: number | null; EventItemMatterFile: string | null; EventItemTitle: string | null
  EventItemPassedFlagName: string | null; EventItemActionName: string | null
}
export interface LegistarVote { VoteId: number; VotePersonId: number; VotePersonName: string; VoteValueName: string }
export interface LegistarEvent { EventId: number; EventBodyName: string; EventDate: string; EventTime: string | null; EventAgendaFile: string | null; EventMinutesFile: string | null }

export class LegistarClient {
  constructor(private client: string, private token = process.env.LEGISTAR_API_TOKEN) {}

  private url(path: string, params: Record<string, string | number | undefined> = {}): string {
    const u = new URL(`https://webapi.legistar.com/v1/${this.client}/${path}`)
    for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, String(v))
    if (this.token) u.searchParams.set('token', this.token)
    return u.toString()
  }

  matters(opts: { top?: number; skip?: number; filter?: string; orderby?: string } = {}): Promise<LegistarMatter[]> {
    return fetchJson(this.url('matters', { $top: opts.top ?? 1000, $skip: opts.skip ?? 0, $filter: opts.filter, $orderby: opts.orderby ?? 'MatterId' }))
  }
  matterSponsors(matterId: number): Promise<LegistarSponsor[]> { return fetchJson(this.url(`matters/${matterId}/sponsors`)) }
  persons(opts: { top?: number; skip?: number } = {}): Promise<LegistarPerson[]> { return fetchJson(this.url('persons', { $top: opts.top ?? 1000, $skip: opts.skip ?? 0 })) }
  events(opts: { top?: number; skip?: number; filter?: string } = {}): Promise<LegistarEvent[]> { return fetchJson(this.url('events', { $top: opts.top ?? 1000, $skip: opts.skip ?? 0, $filter: opts.filter, $orderby: 'EventDate' })) }
  eventItems(eventId: number): Promise<LegistarEventItem[]> { return fetchJson(this.url(`events/${eventId}/eventitems`, { AgendaNote: 1, MinutesNote: 1 })) }
  votes(eventItemId: number): Promise<LegistarVote[]> { return fetchJson(this.url(`eventitems/${eventItemId}/votes`)) }

  /** Returns true when the client name resolves (a 404 body means the client does not exist). */
  async verify(): Promise<boolean> {
    try {
      const bodies = await fetchJson<unknown[]>(this.url('bodies', { $top: 1 }))
      return Array.isArray(bodies)
    } catch {
      return false
    }
  }
}
