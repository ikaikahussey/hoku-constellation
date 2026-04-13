import { HTMLAttributes, forwardRef } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: 'none' | 'sm' | 'md' | 'lg'
  hover?: boolean
}

const paddingStyles = {
  none: '',
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-8',
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ padding = 'md', hover = false, className = '', children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={`bg-navy-light rounded-lg border border-white/10 ${paddingStyles[padding]} ${hover ? 'hover:border-gold/30 transition-colors cursor-pointer' : ''} ${className}`}
        {...props}
      >
        {children}
      </div>
    )
  }
)
Card.displayName = 'Card'
