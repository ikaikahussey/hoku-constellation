'use client'
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from 'recharts'
import type { ScoreBreakdown } from '@/lib/analytics/types'

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
    <div className="card bg-paper border border-rule p-4">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-sm font-bold uppercase tracking-wide">Influence score</h3>
        <span className="text-2xl font-bold tabular">{score.composite.toFixed(1)}</span>
      </div>
      <div style={{ width: '100%', height: 280 }}>
        <ResponsiveContainer>
          <RadarChart data={data}>
            <PolarGrid stroke="var(--color-rule)" />
            <PolarAngleAxis dataKey="dim" tick={{ fill: 'var(--color-ink)', fontSize: 12 }} />
            <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: 'var(--color-muted)', fontSize: 10 }} stroke="var(--color-rule)" />
            <Radar name="Score" dataKey="value" stroke="var(--color-ink)" strokeWidth={1.5} fill="var(--color-gray-300)" fillOpacity={0.6} isAnimationActive={false} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
      <table className="w-full text-sm tabular mt-2">
        <caption className="sr-only">Score by dimension</caption>
        <tbody>
          {data.map(d => (
            <tr key={d.dim} className="border-t border-rule">
              <th scope="row" className="py-1 text-left font-normal text-muted">{d.dim}</th>
              <td className="py-1 text-right">{d.value.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default InfluenceScoreCard
