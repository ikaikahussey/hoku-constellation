import { requireWorkspace } from '@/lib/workspace'
import { ActionForm } from '@/components/workspace/ActionForm'
import { rotateCalendarAction } from '../actions'

export const metadata = { title: 'Calendar & settings' }

export default async function SettingsPage() {
  const ws = await requireWorkspace('/workspace/settings')
  const pref = await ws.db.one<{ ics_rotated_at: string | null }>(`select ics_rotated_at::text from app.user_pref where user_id = $1`, [ws.user.id])
  return (
    <div className="space-y-8 max-w-3xl">
      <header><h1 className="text-3xl font-bold">Calendar &amp; settings</h1></header>
      <section className="border border-rule p-5">
        <h2 className="text-lg font-bold mb-2">Hearings and deadlines calendar</h2>
        <p className="text-sm mb-3">Subscribe in Google Calendar, Outlook, or Apple Calendar to see hearings and testimony deadlines for every bill on your team’s watchlists. The link is private: anyone who has it can see your watched bills. Create a new link to turn off the old one.</p>
        {pref?.ics_rotated_at && <p className="text-sm text-muted mb-2">Current link created {pref.ics_rotated_at.slice(0, 16).replace('T', ' ')} UTC. For security, the link itself is shown only once.</p>}
        <ActionForm action={rotateCalendarAction} submit={pref?.ics_rotated_at ? 'Create a new link (turns off the old one)' : 'Create calendar link'} variant="secondary" showLink />
      </section>
      <section className="border border-rule p-5">
        <h2 className="text-lg font-bold mb-2">Account</h2>
        <p className="text-sm">Signed in as <span data-ph-mask>{ws.user.email}</span>. Manage your password and sign out from <a href="/account">your account</a>.</p>
      </section>
    </div>
  )
}
