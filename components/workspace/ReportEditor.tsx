'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import type { RichBlock } from '@/lib/reports'
import { saveReportAction } from '@/app/workspace/actions'
import { buttonClass } from '@/components/ui/Button'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function toHtml(blocks: RichBlock[], nums: Record<string, number>): string {
  const runs = (b: RichBlock) => b.runs.map(r => {
    let t = esc(r.text)
    if (r.bold) t = `<strong>${t}</strong>`
    if (r.italic) t = `<em>${t}</em>`
    if (r.cites?.length) t += `<sup contenteditable="false" data-cites="${r.cites.join(',')}" title="Source citation">[${r.cites.map(c => nums[c] ?? '?').join(',')}]</sup> `
    return t
  }).join('')
  let html = '', inList = false
  for (const b of blocks) {
    if (b.type === 'li' && !inList) { html += '<ul>'; inList = true }
    if (b.type !== 'li' && inList) { html += '</ul>'; inList = false }
    html += b.type === 'li' ? `<li>${runs(b)}</li>` : `<p>${runs(b)}</p>`
  }
  return inList ? html + '</ul>' : html || '<p></p>'
}

/** DOM → RichBlock[]: paragraphs and list items; bold/italic runs; citation chips attach to the preceding run. */
export function fromDom(root: HTMLElement): RichBlock[] {
  const blocks: RichBlock[] = []
  const walk = (node: Node, block: RichBlock, bold: boolean, italic: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? '').replace(/\s+/g, ' ')
      if (text) block.runs.push({ text, bold: bold || undefined, italic: italic || undefined })
      return
    }
    if (!(node instanceof HTMLElement)) return
    if (node.tagName === 'SUP' && node.dataset.cites) {
      const cites = node.dataset.cites.split(',').filter(Boolean)
      const last = block.runs[block.runs.length - 1]
      if (last && !last.cites) last.cites = cites
      else block.runs.push({ text: '', cites })
      return
    }
    if (node.tagName === 'BR') { block.runs.push({ text: ' ' }); return }
    const b = bold || ['B', 'STRONG'].includes(node.tagName) || node.style.fontWeight === 'bold'
    const i = italic || ['I', 'EM'].includes(node.tagName) || node.style.fontStyle === 'italic'
    node.childNodes.forEach(c => walk(c, block, b, i))
  }
  const addBlock = (type: 'p' | 'li', el: Node) => {
    const block: RichBlock = { type, runs: [] }
    el.childNodes.forEach(c => walk(c, block, false, false))
    if (block.runs.some(r => r.text.trim() || r.cites?.length)) blocks.push(block)
  }
  root.childNodes.forEach(n => {
    if (n instanceof HTMLElement && (n.tagName === 'UL' || n.tagName === 'OL')) n.querySelectorAll(':scope > li').forEach(li => addBlock('li', li))
    else if (n instanceof HTMLElement && n.tagName === 'LI') addBlock('li', n)
    else if (n.nodeType === Node.TEXT_NODE) { if (n.textContent?.trim()) addBlock('p', Object.assign(document.createElement('p'), { textContent: n.textContent })) }
    else addBlock('p', n)
  })
  return blocks
}

interface Props { reportId: string; blocks: RichBlock[]; recipients: string[]; numbers: Record<string, number>; locked: boolean }

export function ReportEditor({ reportId, blocks, recipients, numbers, locked }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [to, setTo] = useState(recipients.join(', '))
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()
  useEffect(() => { if (ref.current) ref.current.innerHTML = toHtml(blocks, numbers) }, [blocks, numbers])
  const cmd = (c: string) => { document.execCommand(c); ref.current?.focus() }
  const save = () => start(async () => {
    const r = await saveReportAction(reportId, fromDom(ref.current!), to.split(/[\s,;]+/).filter(Boolean))
    setMsg(r?.ok ? r.message ?? 'Saved' : `⚠ ${r?.error ?? 'Save failed'}`)
  })
  return (
    <div className="space-y-3">
      {!locked && (
        <div role="toolbar" aria-label="Formatting" className="flex gap-2">
          <button type="button" onClick={() => cmd('bold')} className={buttonClass('ghost', 'sm')} aria-label="Bold"><strong>B</strong></button>
          <button type="button" onClick={() => cmd('italic')} className={buttonClass('ghost', 'sm')} aria-label="Italic"><em>I</em></button>
          <button type="button" onClick={() => cmd('insertUnorderedList')} className={buttonClass('ghost', 'sm')}>• List</button>
        </div>
      )}
      <div ref={ref} contentEditable={!locked} suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label="Report summary"
        className="prose max-w-none border border-ink p-4 min-h-40 focus:outline-none [&_sup]:text-link [&_sup]:cursor-default" />
      <p className="text-xs text-muted">Bracketed numbers are citations to the sources listed below; they cannot be edited. Sentences you add without a citation are flagged before approval.</p>
      <div>
        <label htmlFor="recipients" className="block text-sm font-bold mb-1">Recipients</label>
        <input id="recipients" value={to} onChange={e => setTo(e.target.value)} disabled={locked} className="block w-full border border-ink px-3 py-2" />
      </div>
      {!locked && (
        <div className="flex items-center gap-3">
          <button type="button" onClick={save} disabled={pending} className={buttonClass('primary', 'sm')}>{pending ? 'Saving…' : 'Save draft'}</button>
          <p role="status" aria-live="polite" className="text-sm">{msg}</p>
        </div>
      )}
    </div>
  )
}
