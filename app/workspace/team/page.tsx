import { requireWorkspace } from '@/lib/workspace'
import { isoString } from '@/lib/format'
import { listMembers, seatsUsed } from '@/lib/teams'
import { ActionForm } from '@/components/workspace/ActionForm'
import { Badge } from '@/components/ui/Badge'
import { inputClass } from '@/components/ui/Input'
import { createTeamAction, inviteAction, removeMemberAction, renameTeamAction, revokeInvitationAction, setRoleAction, slackWebhookAction, transferOwnershipAction, uploadLogoAction } from '../actions'

export const metadata = { title: 'Team' }

export default async function TeamPage() {
  const ws = await requireWorkspace('/workspace/team')
  const [members, used, invites] = await Promise.all([
    listMembers(ws.db, ws.team.id), seatsUsed(ws.db, ws.team.id),
    ws.db.many<{ id: string; email: string; role: string; expires_at: string }>(
      `select id, email, role, expires_at::text from app.invitation where team_id = $1 and accepted_at is null and revoked_at is null and expires_at > now() order by created_at`, [ws.team.id]),
  ])
  const active = members.filter(m => m.joined_at)
  return (
    <div className="space-y-8">
      <header><h1 className="text-3xl font-bold">{ws.team.name}</h1>
        <p className="text-sm text-muted mt-1">{used} of {ws.team.seat_count} seat{ws.team.seat_count === 1 ? '' : 's'} in use (members and pending invitations). You are {ws.team.role === 'owner' ? 'the owner' : `an ${ws.team.role}`}.</p></header>

      <section aria-labelledby="members">
        <h2 id="members" className="text-xl font-bold mb-3">Members</h2>
        <table className="w-full text-sm">
          <thead className="border-b border-ink text-left"><tr><th className="py-2">Member</th><th className="py-2">Role</th><th className="py-2">Joined</th><th className="py-2"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{active.map(m => (
            <tr key={m.user_id} className="border-b border-rule">
              <td className="py-2" data-ph-mask>{m.email ?? m.user_id}{m.user_id === ws.user.id && ' (you)'}</td>
              <td className="py-2"><Badge variant={m.role === 'owner' ? 'solid' : 'outline'}>{m.role}</Badge></td>
              <td className="py-2 tabular">{isoString(m.joined_at).slice(0, 10)}</td>
              <td className="py-2">
                {ws.isAdmin && m.role !== 'owner' && m.user_id !== ws.user.id && (
                  <span className="flex gap-3 justify-end">
                    <form action={setRoleAction}><input type="hidden" name="user_id" value={m.user_id} /><input type="hidden" name="role" value={m.role === 'admin' ? 'member' : 'admin'} /><button className="underline">{m.role === 'admin' ? 'Make member' : 'Make admin'}</button></form>
                    {ws.team.role === 'owner' && <form action={transferOwnershipAction}><input type="hidden" name="user_id" value={m.user_id} /><button className="underline">Transfer ownership</button></form>}
                    <form action={removeMemberAction}><input type="hidden" name="user_id" value={m.user_id} /><button className="underline">Remove</button></form>
                  </span>
                )}
                {m.user_id === ws.user.id && m.role !== 'owner' && <form action={removeMemberAction} className="text-right"><input type="hidden" name="user_id" value={m.user_id} /><button className="underline">Leave team</button></form>}
              </td>
            </tr>))}
          </tbody>
        </table>
        <p className="text-xs text-muted mt-2">Removed members lose access immediately. Their notes, reports, and watchlists stay with the team.</p>
      </section>

      {ws.isAdmin && !ws.team.is_personal && (
        <section aria-labelledby="invite" className="border border-rule p-5">
          <h2 id="invite" className="text-lg font-bold mb-3">Invite a member</h2>
          {invites.length > 0 && (
            <ul className="text-sm mb-4 divide-y divide-rule border-y border-rule">{invites.map(i => (
              <li key={i.id} className="py-2 flex justify-between"><span data-ph-mask>{i.email} · {i.role} · expires {i.expires_at.slice(0, 10)}</span>
                <form action={revokeInvitationAction}><input type="hidden" name="invitation_id" value={i.id} /><button className="underline">Revoke</button></form></li>))}</ul>
          )}
          <ActionForm action={inviteAction} submit="Send invitation" showLink>
            <div className="grid sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2"><label htmlFor="inv-email" className="block text-sm font-bold mb-1">Email</label><input id="inv-email" name="email" type="email" required className={inputClass} /></div>
              <div><label htmlFor="inv-role" className="block text-sm font-bold mb-1">Role</label><select id="inv-role" name="role" className={inputClass}><option value="member">Member</option><option value="admin">Admin</option></select></div>
            </div>
          </ActionForm>
        </section>
      )}
      {ws.team.is_personal && (
        <section className="border border-rule p-5">
          <h2 className="text-lg font-bold mb-2">Create a team</h2>
          <p className="text-sm mb-3">Your personal workspace is for one person. Create a team to invite colleagues, share watchlists and clients, and bill by seat.</p>
          <ActionForm action={createTeamAction} submit="Create team"><label htmlFor="team-name" className="block text-sm font-bold mb-1">Organization name</label><input id="team-name" name="name" required className={inputClass} /></ActionForm>
        </section>
      )}

      {ws.isAdmin && (
        <>
          <section className="border border-rule p-5">
            <h2 className="text-lg font-bold mb-3">Name and report sender</h2>
            <ActionForm action={renameTeamAction} submit="Save" variant="secondary">
              <div className="grid sm:grid-cols-2 gap-3">
                <div><label htmlFor="tn" className="block text-sm font-bold mb-1">Team name</label><input id="tn" name="name" defaultValue={ws.team.name} required className={inputClass} /></div>
                <div><label htmlFor="sn" className="block text-sm font-bold mb-1">Sender name on client reports</label><input id="sn" name="sender_name" defaultValue={ws.team.sender_name ?? ''} placeholder={ws.team.name} className={inputClass} /></div>
              </div>
            </ActionForm>
          </section>
          <section id="slack" className="border border-rule p-5">
            <h2 className="text-lg font-bold mb-2">Slack</h2>
            <p className="text-sm mb-3">{ws.team.slack_webhook_enc ? 'Connected. Alerts with the Slack channel post to this webhook.' : 'Paste an incoming-webhook URL from your Slack workspace. It is stored encrypted.'}</p>
            <ActionForm action={slackWebhookAction} submit={ws.team.slack_webhook_enc ? 'Replace or disconnect' : 'Connect Slack'} variant="secondary">
              <label htmlFor="wh" className="block text-sm font-bold mb-1">Incoming webhook URL {ws.team.slack_webhook_enc && '(leave empty to disconnect)'}</label>
              <input id="wh" name="webhook_url" type="url" className={inputClass} placeholder="https://hooks.slack.com/services/…" autoComplete="off" />
            </ActionForm>
          </section>
          <section className="border border-rule p-5">
            <h2 className="text-lg font-bold mb-2">Logo and letterhead</h2>
            <p className="text-sm mb-3">Shown at the top of client reports (PDF and Word). PNG or JPEG, under 1 MB.{!ws.features.custom_letterhead && ' A full custom letterhead is included in the Organization plan; the logo works on every plan with reports.'}</p>
            <ActionForm action={uploadLogoAction} submit="Upload" variant="secondary" encType="multipart/form-data">
              <input type="hidden" name="kind" value={ws.features.custom_letterhead ? 'letterhead' : 'logo'} />
              <label htmlFor="logo" className="block text-sm font-bold mb-1">{ws.features.custom_letterhead ? 'Letterhead image' : 'Logo'} {(ws.team.logo_key || ws.team.letterhead_key) && '(replaces the current file)'}</label>
              <input id="logo" name="logo" type="file" accept="image/png,image/jpeg" className="text-sm" />
            </ActionForm>
          </section>
        </>
      )}
    </div>
  )
}
