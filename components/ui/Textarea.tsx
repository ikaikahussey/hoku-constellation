import { TextareaHTMLAttributes, forwardRef } from 'react'

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, className = '', id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')
    return (
      <div className="space-y-1">
        {label && (
          <label htmlFor={inputId} className="block text-sm font-medium text-white/70">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={inputId}
          className={`block w-full rounded-md border border-white/20 bg-navy px-3 py-2 text-white placeholder-white/40 focus:border-gold focus:ring-1 focus:ring-gold focus:outline-none transition-colors min-h-[100px] ${error ? 'border-error' : ''} ${className}`}
          {...props}
        />
        {error && <p className="text-sm text-error">{error}</p>}
      </div>
    )
  }
)
Textarea.displayName = 'Textarea'
