import { createClient } from '@/lib/supabase/server'
import { PersonForm } from '@/components/admin/PersonForm'
import { notFound } from 'next/navigation'

export default async function EditPersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: person } = await supabase.from('person').select('*').eq('id', id).single()

  if (!person) notFound()

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-6">Edit: {person.full_name}</h1>
      <PersonForm person={person} />
    </div>
  )
}
