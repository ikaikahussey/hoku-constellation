/**
 * Claude access for cited narratives (reports, briefings, dossiers, Ask HOKU Insider).
 * ANTHROPIC_API_KEY enables it; ANTHROPIC_MODEL selects the model (default claude-opus-5-5).
 * Output is constrained to a JSON schema of sentences with citation handles, then validated by
 * lib/ai/citations.ts. The model only ever sees facts assembled from the database.
 */
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { assignHandles, validateCitedSentences, type CitedSentence, type Fact, type ValidationResult } from './citations'

export interface NarrativeRequest {
  /** What to write, e.g. "a 3–6 sentence summary of this client's week". */
  task: string
  facts: Fact[]
  /** Extra constraints appended to the system prompt. */
  rules?: string[]
  maxSentences?: number
}

export interface NarrativeModel {
  readonly name: string
  generate(system: string, user: string): Promise<{ sentences: CitedSentence[]; insufficient?: boolean }>
}

const OutputSchema = z.object({
  insufficient: z.boolean(),
  sentences: z.array(z.object({ text: z.string(), cites: z.array(z.string()) })),
})

const JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['insufficient', 'sentences'],
  properties: {
    insufficient: { type: 'boolean', description: 'true when the facts do not support an answer' },
    sentences: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['text', 'cites'],
        properties: {
          text: { type: 'string', description: 'Exactly one sentence, no citation markers.' },
          cites: { type: 'array', items: { type: 'string' }, description: 'Handles (D1, D2, …) of the facts this sentence states.' },
        },
      },
    },
  },
} as const

export class AnthropicNarrativeModel implements NarrativeModel {
  readonly name: string
  private client: Anthropic
  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey })
    this.name = model
  }
  async generate(system: string, user: string) {
    const response = await this.client.beta.messages.create({
      model: this.name,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: JSON_SCHEMA as unknown as Record<string, unknown> } },
      system,
      messages: [{ role: 'user', content: user }],
    })
    if (response.stop_reason === 'refusal') throw new Error('model declined the request')
    if (response.stop_reason === 'max_tokens') throw new Error('model output was truncated')
    const text = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map(b => b.text).join('')
    return OutputSchema.parse(JSON.parse(text))
  }
}

let override: NarrativeModel | null | undefined
export function setNarrativeModelForTests(m: NarrativeModel | null | undefined) { override = m }

/** The configured model, or null when ANTHROPIC_API_KEY is not set (callers fall back to facts-only). */
export function getNarrativeModel(): NarrativeModel | null {
  if (override !== undefined) return override
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return null
  return new AnthropicNarrativeModel(key, (process.env.ANTHROPIC_MODEL || 'claude-opus-5-5').trim())
}

const SYSTEM = `You write for HOKU Insider, a research service on Hawaiʻi government and influence.
Use only the facts provided. Each fact has a handle like D1.
Write plain, neutral, declarative sentences. No speculation, predictions, adjectives of judgment, or advice.
Every sentence must state something found in the cited facts and list those facts' handles in "cites".
Put exactly one sentence in each "text"; never put citation markers in the text.
If the facts do not support what is asked, set "insufficient" to true and return a single sentence saying so, citing the closest fact if any exists; otherwise return an empty list.`

export function buildPrompt(req: NarrativeRequest): { system: string; user: string; byHandle: Map<string, string>; handled: Fact[] } {
  const { facts, byHandle } = assignHandles(req.facts)
  const system = [SYSTEM, ...(req.rules ?? [])].join('\n')
  const lines = facts.map(f => `${f.handle}${f.date ? ` (${f.date})` : ''}${f.kind ? ` [${f.kind}]` : ''}: ${f.text}`)
  const user = `Task: ${req.task}${req.maxSentences ? ` Use at most ${req.maxSentences} sentences.` : ''}\n\nFacts:\n${lines.join('\n')}`
  return { system, user, byHandle, handled: facts }
}

export interface NarrativeResult {
  source: 'model' | 'facts_only'
  sentences: Array<{ text: string; documentIds: string[] }>
  insufficient: boolean
  attempts: number
  errors: string[]
  model: string | null
}

/**
 * Generate a cited narrative: model → validate → one retry with the validator's errors → facts-only
 * fallback (one sentence per fact, each citing its own document).
 */
export async function generateCitedNarrative(req: NarrativeRequest, model = getNarrativeModel()): Promise<NarrativeResult> {
  const { system, user, byHandle, handled } = buildPrompt(req)
  const errors: string[] = []
  let attempts = 0
  if (model && handled.length) {
    let prompt = user
    for (let i = 0; i < 2; i++) {
      attempts++
      try {
        const out = await model.generate(system, prompt)
        const v: ValidationResult = validateCitedSentences(out.sentences, byHandle)
        if (out.insufficient && out.sentences.length === 0) {
          return { source: 'model', sentences: [], insufficient: true, attempts, errors, model: model.name }
        }
        if (v.ok && (!req.maxSentences || v.sentences.length <= req.maxSentences)) {
          return { source: 'model', sentences: v.sentences, insufficient: !!out.insufficient, attempts, errors, model: model.name }
        }
        const problems = v.ok ? [`too many sentences (${v.sentences.length} > ${req.maxSentences})`] : v.errors
        errors.push(...problems)
        prompt = `${user}\n\nYour previous answer was rejected: ${problems.join('; ')}. Every sentence needs at least one valid handle.`
      } catch (e) {
        errors.push((e as Error).message)
      }
    }
  }
  return { source: 'facts_only', sentences: factsOnly(handled, req.maxSentences), insufficient: handled.length === 0, attempts, errors, model: model?.name ?? null }
}

export function factsOnly(facts: Fact[], max?: number): Array<{ text: string; documentIds: string[] }> {
  const list = facts.map(f => ({ text: /[.!?]$/.test(f.text) ? f.text : `${f.text}.`, documentIds: [f.documentId] }))
  return max ? list.slice(0, Math.max(max, 1) * 3) : list
}
