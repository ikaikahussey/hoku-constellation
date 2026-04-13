'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Article {
  id: string
  title: string
  url: string
  published_at: string | null
  source: string
  author: string | null
  summary: string | null
}

export default function AdminArticles() {
  const [articles, setArticles] = useState<Article[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState({
    title: '', url: '', published_at: '', source: 'hoku_fm', author: '', summary: '', tags: '',
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadArticles()
  }, [])

  async function loadArticles() {
    const supabase = createClient()
    const { data } = await supabase
      .from('article')
      .select('*')
      .order('published_at', { ascending: false })
      .limit(50)
    setArticles(data || [])
    setLoading(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const supabase = createClient()
    const { error } = await supabase.from('article').insert({
      ...formData,
      published_at: formData.published_at || null,
      tags: formData.tags.split(',').map(t => t.trim()).filter(Boolean),
    })
    if (!error) {
      setShowForm(false)
      setFormData({ title: '', url: '', published_at: '', source: 'hoku_fm', author: '', summary: '', tags: '' })
      loadArticles()
    }
    setSaving(false)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">Articles</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-gold text-navy px-4 py-2 rounded-md text-sm font-semibold hover:bg-gold-light transition-colors"
        >
          {showForm ? 'Cancel' : '+ Add Article'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-navy-light rounded-lg border border-white/10 p-6 mb-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-white/70 mb-1">Title *</label>
              <input required value={formData.title} onChange={(e) => setFormData(p => ({ ...p, title: e.target.value }))} className="block w-full rounded-md border border-white/20 bg-navy px-3 py-2 text-white focus:border-gold focus:outline-none" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-white/70 mb-1">URL *</label>
              <input required value={formData.url} onChange={(e) => setFormData(p => ({ ...p, url: e.target.value }))} className="block w-full rounded-md border border-white/20 bg-navy px-3 py-2 text-white focus:border-gold focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-white/70 mb-1">Source</label>
              <select value={formData.source} onChange={(e) => setFormData(p => ({ ...p, source: e.target.value }))} className="block w-full rounded-md border border-white/20 bg-navy px-3 py-2 text-white focus:border-gold focus:outline-none">
                <option value="hoku_fm">Hoku.fm</option>
                <option value="hawaii_independent">Hawaii Independent</option>
                <option value="external">External</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-white/70 mb-1">Published Date</label>
              <input type="date" value={formData.published_at} onChange={(e) => setFormData(p => ({ ...p, published_at: e.target.value }))} className="block w-full rounded-md border border-white/20 bg-navy px-3 py-2 text-white focus:border-gold focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-white/70 mb-1">Author</label>
              <input value={formData.author} onChange={(e) => setFormData(p => ({ ...p, author: e.target.value }))} className="block w-full rounded-md border border-white/20 bg-navy px-3 py-2 text-white focus:border-gold focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-white/70 mb-1">Tags (comma-separated)</label>
              <input value={formData.tags} onChange={(e) => setFormData(p => ({ ...p, tags: e.target.value }))} className="block w-full rounded-md border border-white/20 bg-navy px-3 py-2 text-white focus:border-gold focus:outline-none" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-white/70 mb-1">Summary</label>
              <textarea value={formData.summary} onChange={(e) => setFormData(p => ({ ...p, summary: e.target.value }))} rows={3} className="block w-full rounded-md border border-white/20 bg-navy px-3 py-2 text-white focus:border-gold focus:outline-none" />
            </div>
          </div>
          <button type="submit" disabled={saving} className="bg-gold text-navy px-4 py-2 rounded-md text-sm font-semibold hover:bg-gold-light disabled:opacity-50">
            {saving ? 'Saving...' : 'Add Article'}
          </button>
        </form>
      )}

      <div className="bg-navy-light rounded-lg border border-white/10 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10">
              <th className="text-left py-3 px-4 text-white/50 font-medium">Title</th>
              <th className="text-left py-3 px-4 text-white/50 font-medium">Source</th>
              <th className="text-left py-3 px-4 text-white/50 font-medium">Author</th>
              <th className="text-left py-3 px-4 text-white/50 font-medium">Published</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="py-12 text-center text-white/40">Loading...</td></tr>
            ) : articles.length === 0 ? (
              <tr><td colSpan={4} className="py-12 text-center text-white/40">No articles yet.</td></tr>
            ) : (
              articles.map((article) => (
                <tr key={article.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="py-3 px-4">
                    <a href={article.url} target="_blank" rel="noopener noreferrer" className="text-white hover:text-gold transition-colors">
                      {article.title}
                    </a>
                  </td>
                  <td className="py-3 px-4 text-white/60">{article.source.replace(/_/g, ' ')}</td>
                  <td className="py-3 px-4 text-white/60">{article.author || '—'}</td>
                  <td className="py-3 px-4 text-white/40 text-xs">{article.published_at ? new Date(article.published_at).toLocaleDateString() : '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
