import { InputHTMLAttributes, forwardRef } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export const inputClass = 'block w-full border border-ink bg-paper px-3 py-2 text-ink placeholder:text-muted focus:outline-none'

export const Input = forwardRef<HTMLInputElement, InputProps>(({ label, error, className = '', id, ...props }, ref) => {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')
  return (
    <div className="space-y-1">
      {label && <label htmlFor={inputId} className="block text-sm font-bold">{label}</label>}
      <input ref={ref} id={inputId} aria-invalid={!!error} className={`${inputClass} ${className}`} {...props} />
      {error && <p className="text-sm" role="alert">⚠ {error}</p>}
    </div>
  )
})
Input.displayName = 'Input'
