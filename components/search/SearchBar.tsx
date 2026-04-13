'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'

interface SearchBarProps {
  size?: 'sm' | 'lg'
  placeholder?: string
}

export function SearchBar({ size = 'sm', placeholder = 'Search people, organizations, offices...' }: SearchBarProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [query, setQuery] = useState(searchParams.get('q') || '')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (query.trim()) {
      router.push(`/search?q=${encodeURIComponent(query.trim())}`)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-lg border border-white/20 bg-navy-light text-white placeholder-white/40 focus:border-gold focus:ring-2 focus:ring-gold/20 focus:outline-none transition-all ${
          size === 'lg' ? 'px-6 py-4 text-lg' : 'px-4 py-2.5 text-sm'
        }`}
      />
      <button
        type="submit"
        className={`absolute right-2 top-1/2 -translate-y-1/2 bg-gold text-navy rounded-md font-semibold hover:bg-gold-light transition-colors ${
          size === 'lg' ? 'px-5 py-2.5 text-sm' : 'px-3 py-1.5 text-xs'
        }`}
      >
        Search
      </button>
    </form>
  )
}
