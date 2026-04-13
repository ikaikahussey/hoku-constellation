import { createClient } from '@/lib/supabase/server'
import { OrgForm } from '@/components/admin/OrgForm'
import { notFound } from 'next/navigation'

export default async function EditOrgPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: org } = await supabase.from('organization').select('*').eq('id', id).single()

  if (!org) notFound()

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-6">Edit: {org.name}</h1>
      <OrgForm org={org} />
    </div>
  )
}
