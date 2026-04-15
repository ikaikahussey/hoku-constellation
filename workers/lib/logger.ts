export function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`)
}
export function logError(msg: string, err?: unknown) {
  console.error(
    `[${new Date().toISOString()}] ERROR: ${msg}`,
    err instanceof Error ? err.message : err ?? ''
  )
}
