/**
 * RSS 2.0 and Atom feed parsing for the news aggregator. Pure functions, no network.
 */
import { load, type CheerioAPI } from 'cheerio'
import type { AnyNode } from 'domhandler'

export interface FeedItem {
  /** Stable id from the feed (guid / atom:id), falling back to the link. */
  guid: string
  link: string | null
  title: string
  author: string | null
  /** ISO timestamp, or null when the feed gives no parseable date. */
  published: string | null
  /** Plain-text excerpt (description / summary), whitespace-collapsed. */
  description: string | null
  /** Plain-text body when the publisher includes it (content:encoded / atom:content). */
  content: string | null
  categories: string[]
}

const MAX_EXCERPT = 1200
const MAX_BODY = 20_000

/** Strip markup from an HTML fragment and collapse whitespace. */
export function htmlToText(html: string | null | undefined): string | null {
  if (!html) return null
  const $ = load(`<div id="x">${html}</div>`)
  $('script, style, figure, iframe, noscript').remove()
  $('br').replaceWith('\n')
  $('p, div, li, h1, h2, h3, h4, blockquote').each((_, el) => { $(el).append('\n') })
  const text = $('#x').text().replace(/[ \t\f\v ]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{2,}/g, '\n').trim()
  return text || null
}

/** Remove WordPress-style trailers ("The post X appeared first on Y.", "Continue reading…"). */
function stripTrailers(text: string | null): string | null {
  if (!text) return text
  const t = text
    .replace(/\s*The post [\s\S]{1,300}? appeared first on [\s\S]{1,120}?\.?\s*$/, '')
    .replace(/\s*(?:Continue reading|Read more)\s*(?:→|»|…|\.\.\.)?\s*$/i, '')
    .replace(/\s*\[(?:…|\.\.\.|&#8230;)\]\s*$/, '…')
    .trim()
  return t || null
}

function clip(s: string | null, max: number): string | null {
  if (!s) return s
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s
}

export function toIsoTimestamp(v: string | null | undefined): string | null {
  if (!v) return null
  const d = new Date(v.trim())
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Canonical form of an article URL: https, no fragment, no tracking parameters. */
export function canonicalLink(link: string | null | undefined): string | null {
  if (!link) return null
  try {
    const u = new URL(link.trim())
    u.hash = ''
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|mc_|cmpid$)/i.test(k)) u.searchParams.delete(k)
    if (u.protocol === 'http:') u.protocol = 'https:'
    return u.toString()
  } catch {
    return null
  }
}

// Namespaced tag names need escaping in cheerio selectors.
const sel = (name: string) => name.replace(/:/g, '\\:')

function childText($: CheerioAPI, el: AnyNode, names: string[]): string | null {
  for (const n of names) {
    const v = $(el).children(sel(n)).first().text().trim()
    if (v) return v
  }
  return null
}

export function parseFeed(xml: string): FeedItem[] {
  const $ = load(xml, { xml: true })
  const items: FeedItem[] = []
  const isAtom = $('feed > entry').length > 0
  const nodes = isAtom ? $('feed > entry').toArray() : $('item').toArray()
  for (const el of nodes) {
    const title = htmlToText(childText($, el, ['title']))
    if (!title) continue
    let link: string | null
    if (isAtom) {
      const links = $(el).children('link').toArray()
      const alt = links.find(l => !$(l).attr('rel') || $(l).attr('rel') === 'alternate') ?? links[0]
      link = alt ? $(alt).attr('href') ?? null : null
    } else {
      link = childText($, el, ['link']) ?? $(el).children('guid[isPermaLink="true"]').text().trim() ?? null
    }
    link = canonicalLink(link)
    const guid = childText($, el, isAtom ? ['id'] : ['guid']) ?? link
    if (!guid) continue
    const description = clip(stripTrailers(htmlToText(childText($, el, isAtom ? ['summary'] : ['description']))), MAX_EXCERPT)
    const content = clip(stripTrailers(htmlToText(childText($, el, isAtom ? ['content'] : ['content:encoded']))), MAX_BODY)
    const author = isAtom
      ? $(el).children('author').children('name').first().text().trim() || null
      : childText($, el, ['dc:creator', 'author'])
    const published = toIsoTimestamp(childText($, el, isAtom ? ['published', 'updated'] : ['pubDate', 'dc:date']))
    const categories = [...new Set($(el).children('category').toArray()
      .map(c => ($(c).attr('term') ?? $(c).text()).trim()).filter(Boolean))]
    items.push({ guid: guid.trim(), link, title, author: author ? htmlToText(author) : null, published, description, content, categories })
  }
  return items
}
