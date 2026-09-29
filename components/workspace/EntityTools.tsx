import Link from 'next/link'
import { getWorkspace } from '@/lib/workspace'
import { ActionForm } from './ActionForm'
import { addNoteAction, addWatchItemAction } from '@/app/workspace/actions'

interface Props { entityId?: string; documentId?: string; kind?: string; path: string; name: string }

/**
 * Workspace tools on public pages: watch, briefing/dossier, team-private notes, and "Report an error".
 * Signed-out visitors see only the error link (which asks them to sign in).
 */
export async function EntityTools({ entityId, documentId, kind, path, name }: Props) {
  const ws = await getWorkspace().catch(() => null)
  const errorHref = `/corrections/new?${new URLSearchParams({ ...(entityId ? { entity: entityId } : {}), ...(documentId ? { document: documentId } : {}), page: path }).toString()}`
  if (!ws) return <p className="text-sm mt-6"><Link href={errorHref}>Report an error</Link></p>
  const [lists, notes] = await Promise.all([
    entityId ? ws.db.many<{ id: string; name: string; has: boolean }>(
      `select w.id, w.name, exists (select 1 from app.watchlist_item i where i.watchlist_id = w.id and i.entity_id = $2) has
         from app.watchlist w where w.team_id = $1 order by w.is_default desc, w.created_at`, [ws.team.id, entityId]) : Promise.resolve([]),
    ws.db.many<{ id: string; body: string; author_user_id: string; created_at: string; email: string | null }>(
      `select n.id, n.body, n.author_user_id, n.created_at::text, (select m.email from app.team_member m where m.team_id = n.team_id and m.user_id = n.author_user_id) email
         from app.note n where n.team_id = $1 and (n.entity_id = $2 or n.document_id = $3) order by n.created_at desc limit 50`, [ws.team.id, entityId ?? null, documentId ?? null]),
  ])
  const watchedIn = lists.filter(l => l.has)
  const briefable = entityId && ['bill', 'person', 'org'].includes(kind ?? '')
  return (
    <aside aria-label="Workspace tools" className="border border-ink p-5 my-8 space-y-5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span className="text-xs font-bold uppercase tracking-wide">{ws.team.name}</span>
        {briefable && (ws.features.briefings
          ? <Link href={`/briefings/${entityId}`}>{kind === 'bill' ? 'Bill briefing' : 'Dossier'}</Link>
          : <span className="text-muted">{kind === 'bill' ? 'Bill briefings' : 'Dossiers'} are in <Link href="/pricing">Pro</Link></span>)}
        {kind === 'bill' && ws.features.exports && <><a href={`/api/export/votes?bill=${entityId}`}>Votes CSV</a><a href={`/api/export/testimony?bill=${entityId}`}>Testimony CSV</a></>}
        {kind !== 'bill' && entityId && ws.features.exports && <a href={`/api/export/contributions?entity=${entityId}`}>Contributions CSV</a>}
        <Link href={errorHref}>Report an error</Link>
      </div>
      {entityId && lists.length > 0 && (
        <div>
          {watchedIn.length > 0 && <p className="text-sm mb-2">On {watchedIn.map(l => l.name).join(', ')}.</p>}
          <ActionForm action={addWatchItemAction} submit="Watch" variant="secondary" className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="type" value="entity" /><input type="hidden" name="value" value={entityId} />
            <div><label htmlFor="watch-list" className="block text-xs font-bold mb-1">Add {name} to</label>
              <select id="watch-list" name="watchlist_id" className="border border-ink px-2 py-1 text-sm">{lists.map(l => <option key={l.id} value={l.id}>{l.name}{l.has ? ' ✓' : ''}</option>)}</select></div>
            {kind === 'bill' && <div><label htmlFor="watch-pos" className="block text-xs font-bold mb-1">Position</label>
              <select id="watch-pos" name="position" className="border border-ink px-2 py-1 text-sm"><option value="">—</option><option value="support">Support</option><option value="oppose">Oppose</option><option value="monitor">Monitor</option></select></div>}
          </ActionForm>
        </div>
      )}
      <div>
        <h2 className="text-xs font-bold uppercase tracking-wide mb-2">Team notes <span className="font-normal text-muted normal-case">(visible only to {ws.team.name})</span></h2>
        {notes.length > 0 && <ul className="space-y-2 mb-3">{notes.map(n => <li key={n.id} className="text-sm border-l-2 border-rule pl-3"><p className="whitespace-pre-wrap">{n.body}</p><p className="text-xs text-muted" data-ph-mask>{n.email ?? 'Former member'} · {n.created_at.slice(0, 10)}</p></li>)}</ul>}
        <ActionForm action={addNoteAction} submit="Add note" variant="secondary">
          <input type="hidden" name="path" value={path} />
          {entityId && <input type="hidden" name="entity_id" value={entityId} />}
          {documentId && <input type="hidden" name="document_id" value={documentId} />}
          <label htmlFor="note-body" className="sr-only">Note</label>
          <textarea id="note-body" name="body" rows={2} className="block w-full border border-rule p-2 text-sm" placeholder="Private note for your team" />
        </ActionForm>
      </div>
    </aside>
  )
}
