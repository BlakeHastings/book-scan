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
import { recordMoved, takeMoveBack } from '../lib/misfile'

const misfile: Misfile = {
  book: {
    id: 7,
    title: 'Dune',
    authorFiling: 'Herbert, Frank',
    authors: 'Frank Herbert',
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

/**
 * A queued capture, opened to correct rather than to look at. `saved` false
 * is the difference: it is what puts the editable fields on screen, and the
 * fields are what the OCR text must be shown beside without getting into.
 */
function capture(overrides: Partial<Parameters<typeof BookDetail>[0]> = {}) {
  return renderToStaticMarkup(
    <BookDetail
      draft={emptyDraft}
      lookup={null}
      photos={{}}
      derivedFiling=""
      saving={false}
      relookupBusy={false}
      relookupError=""
      saved={false}
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

/*
 * The case the whole issue is about: the photographs read something, no
 * catalogue matched it, and so there is no title. That capture is precisely
 * the one somebody has to work out by hand, and the reading was on the
 * previous screen.
 */
describe('a queued capture with cover text and no title', () => {
  it('shows what the cover photo read', () => {
    const html = capture({ coverText: 'Song of Solomon\nToni Morrison' })
    expect(html).toContain('Song of Solomon')
    expect(html).toContain('Toni Morrison')
  })

  it('says it was read off the photograph by a machine', () => {
    const html = capture({ coverText: 'Song of Solomon' })
    expect(html).toContain('The cover photo reads')
    expect(html).toContain('often wrong')
  })

  /*
   * The point of showing it at all is undone by pre-filling it. OCR is a
   * lossy reading of a photograph, and a guess sitting in the Title box is
   * one save away from entering the catalogue as a confirmed value.
   */
  it('leaves the Title box empty rather than filling it with the reading', () => {
    const html = capture({ coverText: 'Song of Solomon' })
    expect(html).not.toContain('value="Song of Solomon"')
    expect(html).toContain('Nothing here has been filled in for you')
  })

  it('offers nothing that copies the reading into a field', () => {
    const html = capture({ coverText: 'Song of Solomon' }).toLowerCase()
    expect(html).not.toContain('use this')
    expect(html).not.toContain('use as title')
  })

  /*
   * Three people work one pile and a note is how one hands the book to the
   * next, so it belongs on the screen where the next one picks it up.
   */
  it('shows the note that came with it', () => {
    const html = capture({ captureNote: 'No ISBN confirmed. Barcode is torn.' })
    expect(html).toContain('No ISBN confirmed. Barcode is torn.')
  })

  it('quotes nothing when the photographs produced nothing', () => {
    const html = capture()
    expect(html).not.toContain('The cover photo reads')
    expect(html).not.toContain('evidence')
  })

  /*
   * #156. With the guess out of the Title box this button is dead until
   * somebody names the book, and it was live before, so the page has to say
   * why rather than leave a person prodding at it. In the page and not only in
   * the button's tooltip: this runs on a phone, where nothing hovers.
   */
  it('says what would let it be shelved, rather than only refusing', () => {
    const html = capture({ coverText: 'Song of Solomon' })
    expect(html).toContain('Type the title off the book to shelve it')
  })

  it('stops saying it the moment there is a title', () => {
    const html = capture({ draft: { ...emptyDraft, title: 'Song of Solomon' } })
    expect(html).not.toContain('Type the title off the book to shelve it')
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

/**
 * The other way out, for a move nobody acted on (#196).
 *
 * The page has to keep the two apart. "Moved it" is a statement about the room
 * and writes a location; taking the move back withdraws something this app did
 * and writes none, so it must not reach that endpoint at all.
 */
describe('taking a move back from the detail view', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('is absent unless the server says a move is outstanding', () => {
    const html = detail({ misfile, onMisfileMoved: () => {} })
    expect(html).toContain('Moved it')
    expect(html).not.toContain('Undo the move')
  })

  it('is offered beside "Moved it" when there is one', () => {
    const html = detail({
      misfile, onMisfileMoved: () => {}, onMisfileTakenBack: () => {},
    })
    expect(html).toContain('Moved it')
    expect(html).toContain('Undo the move')
  })

  it('reaches the retraction and never the location write', async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = []
    vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
      calls.push({ path, init })
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ move: null }) })
    })

    const tree = MisfileNotice({
      misfile,
      moving: false,
      onMoved: () => {},
      onTakeBack: () => { void takeMoveBack('fiction', misfile.book.id) },
    })
    buttonIn(tree, 'Undo the move')?.onClick?.()
    await Promise.resolve()

    expect(calls.map((call) => call.path)).toEqual(['/api/shelves/retract'])
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ range: 'fiction', id: 7 })
  })
})
