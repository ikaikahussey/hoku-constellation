import { notFound, redirect } from 'next/navigation'
import { getServiceDb } from '@/lib/db/service'
import { getEntity } from '@/lib/db/queries'
import { PersonForm } from '@/components/admin/PersonForm'

export const dynamic = 'force-dynamic'

export default async function EditPersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = await getServiceDb()
  const person = await getEntity(db, id)
  if (!person) notFound()
  if (person.kind !== 'person') redirect(`/admin/entity/${person.id}`)
  if (person.id !== id) redirect(`/admin/person/${person.id}/edit`)

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Edit: {person.name}</h1>
      <PersonForm person={person} />
    </div>
  )
}
