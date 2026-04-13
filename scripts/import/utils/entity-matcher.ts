import { createClient } from '@supabase/supabase-js'

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function levenshtein(a: string, b: string): number {
  const matrix: number[][] = []
  for (let i = 0; i <= b.length; i++) matrix[i] = [i]
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        )
      }
    }
  }
  return matrix[b.length][a.length]
}

export interface MatchResult {
  id: string
  confidence: number
  status: 'auto_matched' | 'review' | 'unmatched'
}

export class EntityMatcher {
  private people: { id: string; full_name: string; aliases: string[] }[] = []
  private orgs: { id: string; name: string; aliases: string[] }[] = []

  async load(supabase: ReturnType<typeof createClient>) {
    const { data: people } = await supabase.from('person').select('id, full_name, aliases')
    const { data: orgs } = await supabase.from('organization').select('id, name, aliases')
    this.people = people || []
    this.orgs = orgs || []
    console.log(`EntityMatcher loaded: ${this.people.length} people, ${this.orgs.length} orgs`)
  }

  matchPerson(rawName: string): MatchResult | null {
    return this.match(rawName, this.people.map(p => ({ id: p.id, names: [p.full_name, ...(p.aliases || [])] })))
  }

  matchOrg(rawName: string): MatchResult | null {
    return this.match(rawName, this.orgs.map(o => ({ id: o.id, names: [o.name, ...(o.aliases || [])] })))
  }

  matchAny(rawName: string): (MatchResult & { type: 'person' | 'organization' }) | null {
    const personMatch = this.matchPerson(rawName)
    const orgMatch = this.matchOrg(rawName)

    if (!personMatch && !orgMatch) return null
    if (personMatch && !orgMatch) return { ...personMatch, type: 'person' }
    if (!personMatch && orgMatch) return { ...orgMatch, type: 'organization' }

    return personMatch!.confidence >= orgMatch!.confidence
      ? { ...personMatch!, type: 'person' }
      : { ...orgMatch!, type: 'organization' }
  }

  private match(rawName: string, candidates: { id: string; names: string[] }[]): MatchResult | null {
    const normalized = normalize(rawName)
    let bestId = ''
    let bestConfidence = 0

    for (const candidate of candidates) {
      for (const name of candidate.names) {
        const normalizedCandidate = normalize(name)

        if (normalized === normalizedCandidate) {
          return { id: candidate.id, confidence: 1.0, status: 'auto_matched' }
        }

        const maxLen = Math.max(normalized.length, normalizedCandidate.length)
        if (maxLen === 0) continue
        const distance = levenshtein(normalized, normalizedCandidate)
        const similarity = 1 - distance / maxLen

        if (similarity > bestConfidence) {
          bestConfidence = similarity
          bestId = candidate.id
        }
      }
    }

    if (bestConfidence < 0.7) return null

    return {
      id: bestId,
      confidence: Math.round(bestConfidence * 100) / 100,
      status: bestConfidence >= 0.95 ? 'auto_matched' : 'review',
    }
  }
}
