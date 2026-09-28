import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { AdminNav } from '@/components/layout/AdminNav'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  if (!user) redirect('/auth/login?next=/admin')
  if (!user.isStaff) redirect('/')

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-paper text-ink">
      <AdminNav />
      <main className="flex-1 min-w-0 overflow-auto">
        <div className="p-4 sm:p-6 lg:p-8">{children}</div>
      </main>
    </div>
  )
}
