/**
 * Plain black-and-white email layout (B2): Helvetica stack, black text on white, red links only,
 * one rule under the wordmark. Every message has a text part.
 */
import { TOKENS, FONT_STACK } from '@/lib/brand-tokens'

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export interface EmailBlock { heading?: string; lines: Array<{ text: string; href?: string; meta?: string }> }

export interface LayoutInput {
  title: string
  intro?: string
  blocks: EmailBlock[]
  footer: Array<{ text: string; href?: string }>
  /** 1x1 open-tracking pixel URL. */
  pixelUrl?: string
  brand?: string
}

const link = (text: string, href: string) => `<a href="${esc(href)}" style="color:${TOKENS.link};text-decoration:underline">${esc(text)}</a>`

export function renderEmail(input: LayoutInput): { html: string; text: string } {
  const brand = input.brand ?? 'HOKU Insider'
  const blocks = input.blocks.map(b => `
    ${b.heading ? `<h2 style="font-size:15px;font-weight:700;margin:24px 0 8px;color:${TOKENS.ink}">${esc(b.heading)}</h2>` : ''}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
      ${b.lines.map(l => `<tr><td style="padding:8px 0;border-bottom:1px solid ${TOKENS.rule};font-size:15px;line-height:1.45;color:${TOKENS.ink}">
        ${l.href ? link(l.text, l.href) : esc(l.text)}${l.meta ? `<div style="font-size:12px;color:${TOKENS.muted};margin-top:2px">${esc(l.meta)}</div>` : ''}
      </td></tr>`).join('')}
    </table>`).join('')
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(input.title)}</title></head>
<body style="margin:0;padding:0;background:${TOKENS.paper};color:${TOKENS.ink};font-family:${FONT_STACK}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${TOKENS.paper}"><tr><td align="center" style="padding:24px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
<tr><td style="font-size:18px;font-weight:700;letter-spacing:0.02em;padding-bottom:12px;border-bottom:2px solid ${TOKENS.ink};color:${TOKENS.ink}">${esc(brand)}</td></tr>
<tr><td style="padding-top:16px">
<h1 style="font-size:20px;font-weight:700;margin:0 0 8px;color:${TOKENS.ink}">${esc(input.title)}</h1>
${input.intro ? `<p style="font-size:15px;line-height:1.5;margin:0 0 8px;color:${TOKENS.ink}">${esc(input.intro)}</p>` : ''}
${blocks}
</td></tr>
<tr><td style="padding-top:24px;font-size:12px;line-height:1.5;color:${TOKENS.muted}">
${input.footer.map(f => f.href ? link(f.text, f.href) : esc(f.text)).join(' &middot; ')}
</td></tr>
</table></td></tr></table>
${input.pixelUrl ? `<img src="${esc(input.pixelUrl)}" width="1" height="1" alt="" style="display:block;border:0">` : ''}
</body></html>`
  const text = [
    brand, '', input.title, input.intro ?? '',
    ...input.blocks.flatMap(b => [b.heading ? `\n${b.heading}` : '', ...b.lines.map(l => `- ${l.text}${l.href ? ` <${l.href}>` : ''}${l.meta ? ` (${l.meta})` : ''}`)]),
    '', ...input.footer.map(f => f.href ? `${f.text}: ${f.href}` : f.text),
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n')
  return { html, text }
}
