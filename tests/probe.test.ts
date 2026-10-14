import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sniff, discoverLinks, sitemapLocs, probeTargets, DEFAULT_PROBE_SOURCES } from '@/lib/import/probe'
import { cachedMeasureList } from '@/lib/import/sources/capitol-measures'
import { createTestDb, type TestDb } from './helpers/pglite'

describe('source probe helpers', () => {
  it('sniffs feeds, sitemaps, json and html', () => {
    expect(sniff('<?xml version="1.0"?><rss version="2.0"><channel><item></item><item></item></channel></rss>', 'application/xml')).toEqual({ kind: 'rss', items: 2 })
    expect(sniff('<feed xmlns="http://www.w3.org/2005/Atom"><entry></entry></feed>', null)).toEqual({ kind: 'atom', items: 1 })
    expect(sniff('<urlset><url><loc>a</loc></url></urlset>', null)).toEqual({ kind: 'sitemap', items: 1 })
    expect(sniff('{"ok":true}', 'application/json')).toEqual({ kind: 'json', items: null })
    expect(sniff('<!DOCTYPE html><html></html>', 'text/html').kind).toBe('html')
  })

  it('discovers feed and relevant same-site links', () => {
    const html = `<html><head><link rel="alternate" type="application/rss+xml" href="/feed/"></head><body>
      <a href="/boards-and-commissions/">Boards</a><a href="https://other.example/rss">x</a><a href="/about">About</a></body></html>`
    expect(discoverLinks(html, 'https://boards.hawaii.gov/')).toEqual([
      'https://boards.hawaii.gov/feed/', 'https://boards.hawaii.gov/boards-and-commissions/', 'https://other.example/rss',
      'https://boards.hawaii.gov/about', // other same-host links follow the relevant ones
    ])
    expect(sitemapLocs('<urlset><url><loc>https://a.gov/x/?a=1&amp;b=2</loc></url><url><loc> https://a.gov/y/ </loc></url></urlset>'))
      .toEqual(['https://a.gov/x/?a=1&b=2', 'https://a.gov/y/'])
  })

  it('targets the failing sources and the news feeds by default', () => {
    const t = probeTargets(DEFAULT_PROBE_SOURCES)
    const keys = t.map(x => x.source)
    for (const k of ['boards', 'puc', 'ethics_lobbyists', 'csc', 'capitol_measures', 'news']) expect(keys).toContain(k)
    // News feeds report their own status; the probe checks only repair candidates for news.
    const news = t.find(x => x.source === 'news')!
    expect(news.urls).not.toContain('https://www.civilbeat.org/feed/')
    for (const x of t) expect(new Set(x.urls).size).toBe(x.urls.length)
  })
})

describe('measure list cache', () => {
  let db: TestDb
  beforeAll(async () => { db = await createTestDb() })
  afterAll(async () => { await db.end() })

  it('returns a fresh cached list for the session without fetching', async () => {
    const list = { session: '2026', at: new Date().toISOString(), measures: ['HB1', 'SB2'] }
    await db.query(`insert into import_cursor(source, metadata) values ('capitol_measures', jsonb_build_object('measure_list', $1::jsonb))`, [JSON.stringify(list)])
    expect(await cachedMeasureList(db, 'capitol_measures', '2026')).toEqual(['HB1', 'SB2'])
  })
})
