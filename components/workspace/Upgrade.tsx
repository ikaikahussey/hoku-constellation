import Link from 'next/link'

export function UpgradeNotice({ feature, tier }: { feature: string; tier: string }) {
  return (
    <div className="border border-ink p-6">
      <h2 className="text-lg font-bold mb-2">{feature} is part of HOKU Insider Pro</h2>
      <p className="text-sm mb-3">Your team is on the {tier} plan. Pro adds client reports, bill briefings and dossiers, Ask HOKU Insider, unlimited watchlists, and exports.</p>
      <Link href="/workspace/billing">Upgrade this team</Link>
    </div>
  )
}
