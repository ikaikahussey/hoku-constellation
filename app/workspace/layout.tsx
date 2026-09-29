import type { Metadata } from 'next'
import { requireWorkspace } from '@/lib/workspace'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { WorkspaceNav } from '@/components/workspace/WorkspaceNav'
import { FeedbackButton } from '@/components/workspace/FeedbackButton'
import { switchTeam } from './actions'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: { default: 'Workspace', template: '%s — Workspace — HOKU Insider' }, robots: { index: false } }

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const ws = await requireWorkspace()
  return (
    <>
      <Header signedIn />
      <div className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 flex flex-col md:flex-row gap-8">
        <aside className="md:w-56 flex-shrink-0 space-y-4" data-team-id={ws.team.id}>
          <form action={switchTeam} className="space-y-1">
            <label htmlFor="team-switch" className="block text-xs font-bold uppercase tracking-wide">Team</label>
            <select id="team-switch" name="team_id" defaultValue={ws.team.id} className="block w-full border border-ink bg-paper px-2 py-1 text-sm">
              {ws.teams.map(t => <option key={t.id} value={t.id}>{t.name}{t.is_personal ? ' (personal)' : ''} · {t.tier}</option>)}
            </select>
            {ws.teams.length > 1 && <button type="submit" className="text-xs underline">Switch team</button>}
          </form>
          <WorkspaceNav />
          <FeedbackButton isDesignPartner={ws.team.is_design_partner} />
        </aside>
        <main className="flex-1 min-w-0">{children}</main>
      </div>
      <Footer />
    </>
  )
}
