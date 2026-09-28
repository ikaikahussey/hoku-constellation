import { notFound, redirect } from 'next/navigation'
import { getServiceDb } from '@/lib/db/service'
import { getEntity } from '@/lib/db/queries'
import { OrgForm } from '@/components/admin/OrgForm'

export const dynamic = 'force-dynamic'

export default async function EditOrgPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = await getServiceDb()
  const org = await getEntity(db, id)
  if (!org) notFound()
  if (org.kind !== 'org') redirect(org.kind === 'person' ? `/admin/person/${org.id}/edit` : `/admin/entity/${org.id}`)
  if (org.id !== id) redirect(`/admin/org/${org.id}/edit`)

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Edit: {org.name}</h1>
      <OrgForm org={org} />
    </div>
  )
}
