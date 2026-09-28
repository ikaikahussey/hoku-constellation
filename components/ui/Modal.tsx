'use client'

import { useEffect, useRef } from 'react'

interface ModalProps { open: boolean; onClose: () => void; title?: string; children: React.ReactNode }

export function Modal({ open, onClose, title, children }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])
  return (
    <dialog ref={dialogRef} onClose={onClose} className="backdrop:bg-ink/60 bg-paper border border-ink p-0 max-w-lg w-full text-ink">
      <div className="p-6">
        {title && (
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">{title}</h2>
            <button onClick={onClose} className="btn text-sm font-bold" aria-label="Close">✕</button>
          </div>
        )}
        {children}
      </div>
    </dialog>
  )
}
