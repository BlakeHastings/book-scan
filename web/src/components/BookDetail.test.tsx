/**
 * What the book's own page says about a book that is not where it belongs.
 *
 * Rendered to static markup rather than into a DOM: this project has no
 * browser environment in its test setup, and everything asserted here is what
 * the page says on arrival, which server rendering produces exactly. The one
 * thing that needs a tap, "Moved it", is reached through MisfileNotice
 * directly, which holds no state and so is callable as the plain function it
 * is.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import { BookDetail, MisfileNotice } from './BookDetail'
import { emptyDraft, type Misfile } from '../lib/api'
import { recordMoved } from '../lib/misfile'

const misfile: Misfile = {
  book: {
    id: 7,
    title: 'Dune',
    authorFiling: 'Herbert, Frank',
    location: 'A1',
    derivedLocation: 'B2',
    sortKey: 'herbert frank dune',
    checkedOut: false,
  },
  from: 'A1',
  to: 'B2',
  instruction: 'Move Dune from A1 to B2',
}

/** A catalogued book, opened to look at rather than to correct. */
function detail(overrides: Partial<Parameters<typeof BookDetail>[0]> = {}) {
  return renderToStaticMarkup(
    <BookDetail
      draft={{ ...emptyDraft, title: 'Dune', authors: 'Frank Herbert' }}
      lookup={null}
      photos={{}}
      derivedFiling="Herbert, Frank"
      saving={false}
      relookupBusy={false}
      relookupError=""
      saved
      onChange={() => {}}
      onRelookup={() => {}}
      onClearRelookupError={() => {}}
      onShelve={() => {}}
      onSaveEdits={async () => true}
      onDiscard={() => {}}
      {...overrides}
    />,
  )
}

describe('BookDetail, for a book the shelving review has flagged', () => {
  it('says so, and names both places', () => {
    const html = detail({ misfile, onMisfileMoved: () => {} })
    expect(html).toContain('Needs attention')
    // Where the catalogue last saw it, and where the order now puts it. One
    // without the other is not something you can act on at the bookcase.
    expect(html).toContain('A1')
    expect(html).toContain('B2')
  })

  it('offers the library\'s confirmation, in the library\'s words', () => {
    expect(detail({ misfile, onMisfileMoved: () => {} })).toContain('Moved it')
  })

  /*
   * The button means a person carried the book. Anything that reads as
   * "make this warning go away" invites writing a location nobody has been to,
   * which destroys the only record of where the book actually is, so no such
   * wording is offered next to it.
   */
  it('offers no way to dismiss the flag without moving the book', () => {
    const html = detail({ misfile, onMisfileMoved: () => {} }).toLowerCase()
    expect(html).not.toContain('dismiss')
    expect(html).not.toContain('ignore')
    expect(html).not.toContain('clear flag')
  })
})

describe('BookDetail, for a book that is where it belongs', () => {
  it('adds nothing at all, not even an all-clear', () => {
    const html = detail()
    expect(html).not.toContain('Needs attention')
    expect(html).not.toContain('Moved it')
  })

  it('stays quiet while the review is still being fetched', () => {
    expect(detail({ misfile: null, onMisfileMoved: () => {} }))
      .not.toContain('Needs attention')
  })
})

/** Find a button by its label in an unrendered element tree. */
function buttonIn(node: unknown, label: string): { onClick?: () => void } | null {
  if (!node || typeof node !== 'object') return null
  const element = node as ReactElement & { props: Record<string, unknown> }
  const children = element.props?.children
  const list = Array.isArray(children) ? children : [children]
  if (element.type === 'button' && list.some((child) => child === label)) {
    return element.props as { onClick?: () => void }
  }
  for (const child of list) {
    const found = buttonIn(child, label)
    if (found) return found
  }
  return null
}

describe('confirming from the detail view', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  /*
   * The whole point of the issue: the tap has to reach the one call that
   * changes a recorded location, from this page, without going back to the
   * library to do it.
   */
  it('calls through to the location write', async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = []
    vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
      calls.push({ path, init })
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ book: {} }) })
    })

    const tree = MisfileNotice({
      misfile,
      moving: false,
      onMoved: () => { void recordMoved(misfile) },
    })
    buttonIn(tree, 'Moved it')?.onClick?.()
    await Promise.resolve()

    const [call] = calls
    expect(calls).toHaveLength(1)
    expect(call?.path).toBe('/api/books/7/location')
    expect(JSON.parse(String(call?.init?.body))).toEqual({ location: 'B2' })
  })

  it('cannot be tapped twice while the write is in flight', () => {
    const tree = MisfileNotice({ misfile, moving: true, onMoved: () => {} })
    const button = buttonIn(tree, '...') as { disabled?: boolean } | null
    expect(button?.disabled).toBe(true)
  })
})
