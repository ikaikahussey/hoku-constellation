import { TextareaHTMLAttributes, forwardRef } from 'react'
import { inputClass } from './Input'

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(({ label, error, className = '', id, ...props }, ref) => {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')
  return (
    <div className="space-y-1">
      {label && <label htmlFor={inputId} className="block text-sm font-bold">{label}</label>}
      <textarea ref={ref} id={inputId} className={`${inputClass} min-h-[100px] ${className}`} {...props} />
      {error && <p className="text-sm" role="alert">⚠ {error}</p>}
    </div>
  )
})
Textarea.displayName = 'Textarea'
