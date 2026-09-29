import { requireWorkspace } from '@/lib/workspace'
import { SOURCE_REGISTRY } from '@/lib/import/source-registry'
import { AskPanel } from '@/components/workspace/AskPanel'
import { UpgradeNotice } from '@/components/workspace/Upgrade'

export const metadata = { title: 'Ask HOKU Insider' }

export default async function AskPage() {
  const ws = await requireWorkspace('/workspace/ask')
  if (!ws.features.qa) return <UpgradeNotice feature="Ask HOKU Insider" tier={ws.features.tier} />
  return (
    <div className="space-y-6 max-w-3xl">
      <header><h1 className="text-3xl font-bold">Ask HOKU Insider</h1>
        <p className="text-sm text-muted mt-1">Questions are answered from public records in HOKU Insider: filings, votes, testimony, contracts, and agendas. Each sentence links to its source. The answer says so when the records do not support one.</p></header>
      <AskPanel sources={SOURCE_REGISTRY.filter(s => s.status === 'live').map(s => ({ key: s.key, name: s.name }))} limit={ws.features.qa_daily_limit} />
    </div>
  )
}
