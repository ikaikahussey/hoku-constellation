/**
 * HOKU Insider wordmark. "HOKU" uppercase bold, "Insider" title case, black.
 * Rendered as SVG paths (Helvetica Bold converted to outlines) so it is identical on every platform
 * regardless of installed fonts. The <title> keeps it accessible; aria-label on the link wraps it.
 */
import { WORDMARK_PATHS, WORDMARK_VIEWBOX } from './wordmark-paths'

interface Props {
  /** Height in px; width scales with the aspect ratio. */
  height?: number
  className?: string
  title?: string
}

export function Wordmark({ height = 20, className = '', title = 'HOKU Insider' }: Props) {
  const [, , w, h] = WORDMARK_VIEWBOX.split(' ').map(Number)
  const width = Math.round((height * w) / h)
  return (
    <svg
      viewBox={WORDMARK_VIEWBOX}
      width={width}
      height={height}
      role="img"
      aria-label={title}
      className={className}
      fill="currentColor"
    >
      <title>{title}</title>
      {WORDMARK_PATHS.map((d, i) => <path key={i} d={d} />)}
    </svg>
  )
}

/** Square icon: white "H" on a black square (favicon / app icon). */
export function Mark({ size = 24, className = '' }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} role="img" aria-label="HOKU Insider" className={className}>
      <title>HOKU Insider</title>
      <rect width="64" height="64" fill="#000000" />
      <path d="M16 12h10v16h12V12h10v40H38V36H26v16H16z" fill="#FFFFFF" />
    </svg>
  )
}

export default Wordmark
