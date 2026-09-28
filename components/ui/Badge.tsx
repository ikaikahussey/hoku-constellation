type BadgeVariant = 'default' | 'solid' | 'outline' | 'muted'

interface BadgeProps {
  children: React.ReactNode
  variant?: BadgeVariant
  className?: string
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'border border-rule text-ink',
  solid: 'bg-ink text-paper border border-ink',
  outline: 'border border-ink text-ink',
  muted: 'border border-rule text-muted',
}

export function Badge({ children, variant = 'default', className = '' }: BadgeProps) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${variantStyles[variant]} ${className}`}>
      {children}
    </span>
  )
}
