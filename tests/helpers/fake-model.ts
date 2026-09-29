/**
 * Deterministic stand-ins for the Claude narrative model. They read the fact lines the real prompt
 * sends ("D1 (2027-02-20) [kind]: text") and answer from them, so golden files are stable.
 */
import type { NarrativeModel } from '@/lib/ai/claude'
import type { CitedSentence } from '@/lib/ai/citations'

export function factLines(user: string): Array<{ handle: string; text: string }> {
  return [...user.matchAll(/^(D\d+)(?: \([^)]*\))?(?: \[[^\]]*\])?: (.+)$/gm)].map(m => ({ handle: m[1], text: m[2] }))
}

/** Cites every sentence correctly: one sentence per fact (first `max`). */
export class EchoModel implements NarrativeModel {
  readonly name = 'fake-echo'
  calls = 0
  constructor(private max = 4) {}
  async generate(_system: string, user: string) {
    this.calls++
    const lines = factLines(user).slice(0, this.max)
    const sentences: CitedSentence[] = lines.map(l => ({ text: `The record shows: ${l.text.replace(/[.!?]+$/, '').replace(/\. /g, '; ')}.`, cites: [l.handle] }))
    return { sentences, insufficient: false }
  }
}

/** Returns an uncited sentence the first `badCalls` times, then behaves like EchoModel. */
export class FlakyCitationModel extends EchoModel {
  constructor(private badCalls = 1) { super() }
  async generate(system: string, user: string) {
    if (this.calls < this.badCalls) {
      this.calls++
      return { sentences: [{ text: 'This bill is likely to pass.', cites: [] }], insufficient: false }
    }
    return super.generate(system, user)
  }
}

/** Always invents a citation handle that was never supplied. */
export class FabricatingModel implements NarrativeModel {
  readonly name = 'fake-fabricating'
  calls = 0
  async generate() { this.calls++; return { sentences: [{ text: 'A committee approved it.', cites: ['D999'] }], insufficient: false } }
}

/** Says the facts do not support an answer. */
export class InsufficientModel implements NarrativeModel {
  readonly name = 'fake-insufficient'
  async generate() { return { sentences: [], insufficient: true } }
}
