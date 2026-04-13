import { ImageResponse } from '@vercel/og'
import { NextRequest } from 'next/server'

export const runtime = 'edge'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const name = searchParams.get('name') || 'Hoku Constellation'
  const subtitle = searchParams.get('subtitle') || ''
  const type = searchParams.get('type') || 'person'

  return new ImageResponse(
    (
      <div
        style={{
          width: '1200px',
          height: '630px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'flex-start',
          padding: '80px',
          backgroundColor: '#0B1D3A',
          fontFamily: 'Helvetica Neue, Helvetica, Arial, sans-serif',
        }}
      >
        {/* Constellation dots */}
        <div style={{ position: 'absolute', top: 0, right: 0, width: '400px', height: '400px', display: 'flex', opacity: 0.15 }}>
          <svg viewBox="0 0 400 400" width="400" height="400">
            <circle cx="100" cy="80" r="4" fill="#D4A843" />
            <circle cx="200" cy="150" r="3" fill="#D4A843" />
            <circle cx="300" cy="100" r="5" fill="#D4A843" />
            <circle cx="250" cy="250" r="3" fill="#0E4D6B" />
            <circle cx="350" cy="200" r="4" fill="#D4A843" />
            <line x1="100" y1="80" x2="200" y2="150" stroke="#D4A843" strokeWidth="1" />
            <line x1="200" y1="150" x2="300" y2="100" stroke="#D4A843" strokeWidth="1" />
            <line x1="300" y1="100" x2="350" y2="200" stroke="#D4A843" strokeWidth="1" />
            <line x1="200" y1="150" x2="250" y2="250" stroke="#0E4D6B" strokeWidth="1" />
          </svg>
        </div>

        {/* Type indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
          <div
            style={{
              width: '16px',
              height: '16px',
              borderRadius: '50%',
              backgroundColor: type === 'person' ? '#D4A843' : '#0E4D6B',
            }}
          />
          <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '20px', textTransform: 'uppercase', letterSpacing: '2px' }}>
            {type === 'person' ? 'Person' : 'Organization'}
          </span>
        </div>

        {/* Name */}
        <h1 style={{ color: '#FFFFFF', fontSize: '64px', fontWeight: 700, margin: 0, lineHeight: 1.1, maxWidth: '900px' }}>
          {name}
        </h1>

        {/* Subtitle */}
        {subtitle && (
          <p style={{ color: '#D4A843', fontSize: '28px', marginTop: '16px', fontWeight: 400 }}>
            {subtitle}
          </p>
        )}

        {/* Footer */}
        <div style={{ position: 'absolute', bottom: '60px', left: '80px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: '#FFFFFF', fontSize: '20px', fontWeight: 700 }}>HOKU</span>
          <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '20px', fontWeight: 300, letterSpacing: '3px' }}>CONSTELLATION</span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  )
}
