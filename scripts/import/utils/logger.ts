export class ImportLogger {
  private inserted = 0
  private skipped = 0
  private matched = 0
  private unmatched = 0
  private errors: string[] = []

  constructor(private name: string) {
    console.log(`\n[${name}] Starting import...`)
  }

  recordInsert() { this.inserted++ }
  recordSkip() { this.skipped++ }
  recordMatch() { this.matched++ }
  recordUnmatched() { this.unmatched++ }
  recordError(msg: string) { this.errors.push(msg) }

  summary() {
    console.log(`\n[${this.name}] Import complete:`)
    console.log(`  Inserted: ${this.inserted}`)
    console.log(`  Skipped:  ${this.skipped}`)
    console.log(`  Matched:  ${this.matched}`)
    console.log(`  Unmatched: ${this.unmatched}`)
    if (this.errors.length > 0) {
      console.log(`  Errors: ${this.errors.length}`)
      this.errors.slice(0, 5).forEach(e => console.log(`    - ${e}`))
    }
    return {
      inserted: this.inserted,
      skipped: this.skipped,
      matched: this.matched,
      unmatched: this.unmatched,
    }
  }
}
