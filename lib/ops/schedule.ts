/** Monday 07:00–07:59 HST: weekly auto-drafts and the partner usage summary. */
export function isWeeklySlot(now: Date): boolean {
  const hst = new Date(now.getTime() - 36e6)
  return hst.getUTCDay() === 1 && hst.getUTCHours() === 7
}
