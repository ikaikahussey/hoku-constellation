'use client'
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from 'recharts'
import type { ScoreBreakdown } from '@/lib/analytics'

export function InfluenceScoreCard({ score }: { score: ScoreBreakdown }) {
  const data = [
    { dim: 'Political $', value: score.political_money },
    { dim: 'Position', value: score.institutional_position },
    { dim: 'Lobbying', value: score.lobbying },
    { dim: 'Economic', value: score.economic_footprint },
    { dim: 'Network', value: score.network_centrality },
    { dim: 'Visibility', value: score.public_visibility },
  ]
  return (
    <div className="rounded border p-4">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-sm font-semibold">Influence Score</h3>
        <span className="text-2xl font-bold">{score.composite.toFixed(1)}</span>
      </div>
      <div style={{ width: '100%', height: 280 }}>
        <ResponsiveContainer>
          <RadarChart data={data}>
            <PolarGrid />
            <PolarAngleAxis dataKey="dim" />
            <PolarRadiusAxis angle={30} domain={[0, 100]} />
            <Radar name="Score" dataKey="value" stroke="#2563eb" fill="#2563eb" fillOpacity={0.4} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export default InfluenceScoreCard
