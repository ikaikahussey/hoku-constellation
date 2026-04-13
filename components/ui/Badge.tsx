type BadgeVariant = 'default' | 'gold' | 'ocean' | 'success' | 'error' | 'outline'

interface BadgeProps {
  children: React.ReactNode
  variant?: BadgeVariant
  className?: string
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-white/10 text-white/80',
  gold: 'bg-gold/20 text-gold-light',
  ocean: 'bg-ocean/30 text-white/90',
  success: 'bg-success/20 text-green-300',
  error: 'bg-error/20 text-red-300',
  outline: 'border border-white/20 text-white/60',
}

export function Badge({ children, variant = 'default', className = '' }: BadgeProps) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${variantStyles[variant]} ${className}`}>
      {children}
    </span>
  )
}
