/** Rendered as markup: the card holds no state of its own. */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Connections } from './Connections'
import { CONNECTING_GUIDE, connectionSaid } from '../lib/connectionWords'

const TODAY = new Date('2026-10-28T15:00:00')

function row(name: string, host: string, id = 'g1') {
  return connectionSaid({
    id,
    client: { id: 'c', name },
    redirectHost: host,
    connectedAt: '2026-10-27T10:00:00',
    lastUsedAt: '2026-10-28T10:00:00',
  }, TODAY)
}

describe('the connections card', () => {
  it('claims nothing about what is connected before the list has been read', () => {
    const markup = renderToStaticMarkup(<Connections rows={null} />)
    expect(markup).toContain('Reading what is connected.')
    expect(markup).not.toContain('Nothing is connected')
  })

  it('says why when the list could not be read, rather than drawing it empty', () => {
    const markup = renderToStaticMarkup(<Connections rows={null} failed="500 Internal Server Error" />)
    expect(markup).toContain('Could not read what is connected: 500 Internal Server Error')
    expect(markup).not.toContain('Nothing is connected')
  })

  it('says what a connection is when there is none, and points at the guide', () => {
    const markup = renderToStaticMarkup(<Connections rows={[]} />)
    expect(markup).toContain('Nothing is connected. A connection is Claude')
    expect(markup).toContain(`href="${CONNECTING_GUIDE}"`)
    expect(markup).toContain('>How to connect Claude</a>')
    expect(markup).not.toContain('wf-btn--danger')
  })

  it('draws a name somebody registered as text, never as markup', () => {
    const hostile = '<img src=x onerror=alert(1)>Claude'
    const markup = renderToStaticMarkup(<Connections rows={[row(hostile, 'evil.example')]} />)
    expect(markup).not.toContain('<img')
    expect(markup).toContain('&lt;img src=x onerror=alert(1)&gt;Claude')
  })

  it('draws every row with the host beside the name, and one way to disconnect it', () => {
    const markup = renderToStaticMarkup(
      <Connections rows={[row('Claude', 'claude.ai', 'a'), row('Claude', 'localhost:53682', 'b')]} />,
    )
    expect(markup).toContain('aria-label="Claude, through claude.ai"')
    expect(markup).toContain('aria-label="Claude, through localhost:53682"')
    expect(markup).toContain('<span class="wf-connection__name">Claude</span><span class="wf-connection__host">claude.ai</span>')
    expect(markup).toContain('<span class="wf-connection__name">Claude</span><span class="wf-connection__host">localhost:53682</span>')
    expect(markup.match(/wf-btn--danger/g)).toHaveLength(2)
    expect(markup).not.toContain('wf-sure')
  })

  it('asks before it disconnects, naming the host, with the safe answer beside it', () => {
    const asking = row('Claude', 'localhost:53682')
    const markup = renderToStaticMarkup(<Connections rows={[asking]} books={3} asking={asking} />)
    expect(markup).toContain('Disconnect Claude from your 3 books?')
    expect(markup).toContain('It connected through localhost:53682.')
    expect(markup).toContain('Keep it')
  })
})
