import { ButtonHTMLAttributes, forwardRef } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
}

/** Buttons: black fill / white text, or white fill with a 1px black border. Never red. */
export const buttonStyles: Record<Variant, string> = {
  primary: 'bg-ink text-paper border border-ink hover:bg-paper hover:text-ink',
  secondary: 'bg-paper text-ink border border-ink hover:bg-ink hover:text-paper',
  ghost: 'bg-paper text-ink border border-transparent hover:border-ink',
}

export const buttonSizes: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
}

export function buttonClass(variant: Variant = 'primary', size: Size = 'md', extra = ''): string {
  return `btn inline-flex items-center justify-center font-bold transition-colors disabled:opacity-50 disabled:pointer-events-none ${buttonStyles[variant]} ${buttonSizes[size]} ${extra}`
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, className = '', disabled, children, ...props }, ref) => (
    <button ref={ref} disabled={disabled || loading} className={buttonClass(variant, size, className)} {...props}>
      {loading && <span className="mr-2 inline-block h-3 w-3 animate-spin border-2 border-current border-t-transparent" aria-hidden="true" />}
      {children}
    </button>
  )
)
Button.displayName = 'Button'
