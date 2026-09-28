import { ImageResponse } from '@vercel/og'
import { NextRequest } from 'next/server'
import { WORDMARK_PATHS, WORDMARK_VIEWBOX } from '@/components/brand/wordmark-paths'

export const runtime = 'edge'

// Open Graph card: white ground, black HOKU Insider wordmark top-left, one red rule, black title.
// Colors are literal here because @vercel/og renders outside the Tailwind theme; they mirror
// app/globals.css (--color-paper, --color-ink, --color-link, --color-muted).
const PAPER = '#FFFFFF'
const INK = '#000000'
const LINK = '#CC0000'
const MUTED = '#595959'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const name = (searchParams.get('name') || 'HOKU Insider').slice(0, 120)
  const subtitle = (searchParams.get('subtitle') || '').slice(0, 160)
  const kind = (searchParams.get('type') || searchParams.get('kind') || '').toLowerCase()
  const kindLabel = { person: 'Person', org: 'Organization', organization: 'Organization', bill: 'Measure', docket: 'Docket', parcel: 'Parcel', office: 'Board or office' }[kind] ?? ''
  const [, , vw, vh] = WORDMARK_VIEWBOX.split(' ').map(Number)
  const wordmarkHeight = 40

  return new ImageResponse(
    (
      <div
        style={{
          width: '1200px', height: '630px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
          padding: '72px 80px', backgroundColor: PAPER, color: INK, fontFamily: 'Helvetica Neue, Helvetica, Arial, sans-serif',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <svg viewBox={WORDMARK_VIEWBOX} width={Math.round((wordmarkHeight * vw) / vh)} height={wordmarkHeight} fill={INK}>
            {WORDMARK_PATHS.map((d, i) => <path key={i} d={d} />)}
          </svg>
          <div style={{ display: 'flex', width: '120px', height: '6px', backgroundColor: LINK, marginTop: '28px' }} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {kindLabel && (
            <span style={{ color: MUTED, fontSize: '22px', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '16px' }}>{kindLabel}</span>
          )}
          <h1 style={{ color: INK, fontSize: name.length > 40 ? '56px' : '72px', fontWeight: 700, margin: 0, lineHeight: 1.05, maxWidth: '1040px' }}>{name}</h1>
          {subtitle && <p style={{ color: MUTED, fontSize: '28px', marginTop: '20px', fontWeight: 400, maxWidth: '1040px' }}>{subtitle}</p>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', color: MUTED, fontSize: '20px' }}>
          <span>Mapping Hawaiʻi’s power structure</span>
          <span>constellation.hoku.fm</span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  )
}
