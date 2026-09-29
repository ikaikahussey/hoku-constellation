'use client'

import { useActionState } from 'react'
import type { ActionState } from '@/app/workspace/actions'
import { buttonClass } from '@/components/ui/Button'

interface Props {
  action: (state: ActionState, fd: FormData) => Promise<ActionState>
  submit: string
  children?: React.ReactNode
  className?: string
  variant?: 'primary' | 'secondary' | 'ghost'
  /** Render data.link / data.url from the result as a copyable field. */
  showLink?: boolean
  encType?: 'multipart/form-data'
}

/** Server-action form with pending state and an accessible result line. */
export function ActionForm({ action, submit, children, className = '', variant = 'primary', showLink, encType }: Props) {
  const [state, formAction, pending] = useActionState(action, null)
  const link = (state?.data?.link ?? state?.data?.url) as string | undefined
  return (
    <form action={formAction} className={className} encType={encType}>
      {children}
      <div className="flex items-center gap-3 mt-3 flex-wrap">
        <button type="submit" disabled={pending} className={buttonClass(variant, 'sm')}>{pending ? 'Working…' : submit}</button>
        <p role="status" aria-live="polite" className="text-sm">
          {state?.error && <span>⚠ {state.error}</span>}
          {state?.ok && state.message && <span>{state.message}</span>}
        </p>
      </div>
      {showLink && link && (
        <input readOnly value={link} aria-label="Link" onFocus={e => e.currentTarget.select()} className="mt-2 block w-full border border-rule px-2 py-1 text-sm font-mono" />
      )}
    </form>
  )
}
