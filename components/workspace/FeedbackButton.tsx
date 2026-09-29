'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { ActionForm } from './ActionForm'
import { feedbackAction } from '@/app/workspace/actions'

/** In-app feedback (E9): goes to the owner by email and records a count-only PostHog event. */
export function FeedbackButton({ isDesignPartner }: { isDesignPartner: boolean }) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  return (
    <div className="border-t border-rule pt-4">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="text-sm font-bold underline">
        {isDesignPartner ? 'Design partner feedback' : 'Send feedback'}
      </button>
      {open && (
        <ActionForm action={feedbackAction} submit="Send" className="mt-2">
          <input type="hidden" name="page" value={pathname} />
          <label htmlFor="feedback" className="sr-only">Feedback</label>
          <textarea id="feedback" name="feedback" rows={4} required className="block w-full border border-ink p-2 text-sm" placeholder="What worked, what didn’t, what’s missing?" />
        </ActionForm>
      )}
    </div>
  )
}
