'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { buttonClass } from '@/components/ui/Button'

interface SearchBarProps {
  size?: 'sm' | 'lg'
  placeholder?: string
}

export function SearchBar({ size = 'sm', placeholder = 'Search people, organizations, bills…' }: SearchBarProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [query, setQuery] = useState(searchParams.get('q') || '')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    const params = new URLSearchParams(searchParams.toString())
    params.set('q', q)
    params.delete('page')
    router.push(`/search?${params.toString()}`)
  }

  return (
    <form onSubmit={handleSubmit} role="search" className="flex">
      <label htmlFor="site-search" className="sr-only">Search</label>
      <input
        id="site-search"
        type="search"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={placeholder}
        className={`flex-1 min-w-0 border border-ink border-r-0 bg-paper text-ink placeholder:text-muted focus:outline-none ${
          size === 'lg' ? 'px-5 py-3 text-lg' : 'px-3 py-2 text-sm'
        }`}
      />
      <button type="submit" className={buttonClass('primary', size === 'lg' ? 'lg' : 'md')}>Search</button>
    </form>
  )
}
