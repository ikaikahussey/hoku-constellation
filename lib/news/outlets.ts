/**
 * Hawaiʻi news outlets read by the `news` importer (lib/import/sources/news.ts).
 *
 * Inclusion: outlets that publish original reporting about Hawaiʻi and offer a public RSS/Atom feed.
 * Only the feed is fetched. Article pages are never requested, so paywalls and per-article terms are
 * not touched; the feed's own title, excerpt and (when the publisher includes it) body are stored, and
 * readers follow the link to the outlet for the full story.
 *
 * `enabled: false` keeps an outlet listed (for coverage reporting) without fetching it. Use it for
 * outlets whose terms forbid automated access or that have no public feed. Feed URLs are checked live
 * by scripts/import/verify-sources.ts through the source registry entry `news`.
 */

export type NewsRegion = 'statewide' | 'oahu' | 'maui' | 'hawaii' | 'kauai' | 'molokai' | 'lanai'

export interface NewsOutlet {
  key: string
  name: string
  homepage: string
  feeds: string[]
  region: NewsRegion
  enabled: boolean
  notes?: string
}

export const NEWS_OUTLETS: NewsOutlet[] = [
  // ------------------------------------------------------------ statewide / Oʻahu
  { key: 'civil_beat', name: 'Honolulu Civil Beat', homepage: 'https://www.civilbeat.org', feeds: ['https://www.civilbeat.org/feed/'], region: 'statewide', enabled: true },
  { key: 'star_advertiser', name: 'Honolulu Star-Advertiser', homepage: 'https://www.staradvertiser.com', feeds: ['https://www.staradvertiser.com/feed/'], region: 'statewide', enabled: true,
    notes: 'Metered paywall on article pages; the feed is public. Only the feed is read.' },
  { key: 'hawaii_news_now', name: 'Hawaii News Now', homepage: 'https://www.hawaiinewsnow.com', feeds: ['https://www.hawaiinewsnow.com/arc/outboundfeeds/rss/?outputType=xml'], region: 'statewide', enabled: true },
  { key: 'khon2', name: 'KHON2', homepage: 'https://www.khon2.com', feeds: ['https://www.khon2.com/feed/'], region: 'statewide', enabled: true },
  { key: 'kitv', name: 'KITV Island News', homepage: 'https://www.kitv.com', feeds: ['https://www.kitv.com/search/?f=rss&t=article&l=50&s=start_time&sd=desc'], region: 'statewide', enabled: true },
  { key: 'hpr', name: 'Hawaiʻi Public Radio', homepage: 'https://www.hawaiipublicradio.org', feeds: ['https://www.hawaiipublicradio.org/local-news.rss'], region: 'statewide', enabled: true },
  { key: 'hawaii_business', name: 'Hawaii Business Magazine', homepage: 'https://www.hawaiibusiness.com', feeds: ['https://www.hawaiibusiness.com/feed/'], region: 'statewide', enabled: true },
  { key: 'honolulu_magazine', name: 'HONOLULU Magazine', homepage: 'https://www.honolulumagazine.com', feeds: ['https://www.honolulumagazine.com/feed/'], region: 'oahu', enabled: true },
  { key: 'ka_wai_ola', name: 'Ka Wai Ola', homepage: 'https://kawaiola.news', feeds: ['https://kawaiola.news/feed/'], region: 'statewide', enabled: true,
    notes: 'Published by the Office of Hawaiian Affairs.' },
  { key: 'hawaii_herald', name: 'The Hawaiʻi Herald', homepage: 'https://www.thehawaiiherald.com', feeds: ['https://www.thehawaiiherald.com/feed/'], region: 'statewide', enabled: true },
  { key: 'pacific_business_news', name: 'Pacific Business News', homepage: 'https://www.bizjournals.com/pacific', feeds: ['https://feeds.bizjournals.com/bizj_pacific'], region: 'statewide', enabled: false,
    notes: 'American City Business Journals terms restrict automated access. Listed for coverage only.' },
  // ------------------------------------------------------------ Maui County
  { key: 'maui_news', name: 'The Maui News', homepage: 'https://www.mauinews.com', feeds: ['https://www.mauinews.com/feed/'], region: 'maui', enabled: true },
  { key: 'maui_now', name: 'Maui Now', homepage: 'https://mauinow.com', feeds: ['https://mauinow.com/feed/'], region: 'maui', enabled: true },
  { key: 'lahaina_news', name: 'Lahaina News', homepage: 'https://www.lahainanews.com', feeds: ['https://www.lahainanews.com/feed/'], region: 'maui', enabled: true },
  { key: 'molokai_dispatch', name: 'The Molokai Dispatch', homepage: 'https://themolokaidispatch.com', feeds: ['https://themolokaidispatch.com/feed/'], region: 'molokai', enabled: true },
  // ------------------------------------------------------------ Hawaiʻi Island
  { key: 'west_hawaii_today', name: 'West Hawaii Today', homepage: 'https://www.westhawaiitoday.com', feeds: ['https://www.westhawaiitoday.com/feed/'], region: 'hawaii', enabled: true },
  { key: 'tribune_herald', name: 'Hawaii Tribune-Herald', homepage: 'https://www.hawaiitribune-herald.com', feeds: ['https://www.hawaiitribune-herald.com/feed/'], region: 'hawaii', enabled: true },
  { key: 'big_island_now', name: 'Big Island Now', homepage: 'https://bigislandnow.com', feeds: ['https://bigislandnow.com/feed/'], region: 'hawaii', enabled: true },
  // ------------------------------------------------------------ Kauaʻi
  { key: 'garden_island', name: 'The Garden Island', homepage: 'https://www.thegardenisland.com', feeds: ['https://www.thegardenisland.com/feed/'], region: 'kauai', enabled: true },
  { key: 'kauai_now', name: 'Kauaʻi Now', homepage: 'https://kauainownews.com', feeds: ['https://kauainownews.com/feed/'], region: 'kauai', enabled: true },
]

export function getOutlet(key: string): NewsOutlet | undefined {
  return NEWS_OUTLETS.find(o => o.key === key)
}

/**
 * Enabled outlets, optionally restricted to a comma-separated list of keys (`--outlet=civil_beat,khon2`).
 * Disabled outlets are never returned, even when named.
 */
export function activeOutlets(only?: string): NewsOutlet[] {
  const keys = only?.split(',').map(s => s.trim()).filter(Boolean)
  return NEWS_OUTLETS.filter(o => o.enabled && (!keys?.length || keys.includes(o.key)))
}
