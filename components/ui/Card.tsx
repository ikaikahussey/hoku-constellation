import { HTMLAttributes, forwardRef } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: 'none' | 'sm' | 'md' | 'lg'
  hover?: boolean
}

const paddingStyles = { none: '', sm: 'p-4', md: 'p-6', lg: 'p-8' }

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ padding = 'md', hover = false, className = '', children, ...props }, ref) => (
    <div ref={ref} className={`card bg-paper border border-rule ${paddingStyles[padding]} ${hover ? 'hover:border-ink transition-colors' : ''} ${className}`} {...props}>
      {children}
    </div>
  )
)
Card.displayName = 'Card'
