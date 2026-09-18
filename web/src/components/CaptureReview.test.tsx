/** Rendered as markup rather than driven in a browser: this project has no DOM in its test setup. */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CaptureReview } from './CaptureReview'
import {
  emptyDraft, type AppliedTag, type CataloguedBook, type Draft, type TagRow,
} from '../lib/api'
import { FICTION_SLUG } from '../../domain/tagging/catalogue-claims'
import type { TabName } from '../design/Chrome'

const tabs: Record<TabName, () => void> = {
  home: () => {}, library: () => {}, scan: () => {}, queue: () => {},
}

const applied = (slug: string, label: string): AppliedTag =>
  ({ slug, label, source: 'person', confidence: 'high' })

const known = (slug: string, label: string, books = 3): TagRow =>
  ({ slug, label, note: '', books, ruled: false })

function drawn(over: {
  draft?: Partial<Draft>
  tags?: AppliedTag[]
  vocabulary?: TagRow[]
  canTag?: boolean
  coverText?: string
  captureNote?: string
  catalogued?: CataloguedBook | null
} = {}) {
  return renderToStaticMarkup(
    <CaptureReview
      draft={{ ...emptyDraft, title: 'Watchmen', ...over.draft }}
      // Deliberately null: the warning below is drawn from `catalogued`,
      // never from `lookup`, so a test that needs it sets `catalogued` directly.
      lookup={null}
      catalogued={over.catalogued ?? null}
      photos={{}}
      derivedFiling="Moore, Alan"
      saving={false}
      relookupBusy={false}
      relookupError=""
      catalogueCover=""
      coverText={over.coverText ?? ''}
      captureNote={over.captureNote ?? ''}
      notice=""
      error=""
      onDismissError={() => {}}
      onChange={() => {}}
      onRelookup={() => {}}
      onClearRelookupError={() => {}}
      onRetake={() => {}}
      onShelve={() => {}}
      onLeave={() => {}}
      tabs={tabs}
      tags={over.tags ?? []}
      vocabulary={over.vocabulary ?? []}
      taggingBusy={false}
      taggingError=""
      onAddTag={() => {}}
      onRemoveTag={() => {}}
      canTag={over.canTag ?? true}
    />,
  )
}

/** The words on the screen, with the markup and therefore the class names gone. */
const words = (markup: string) => markup.replace(/<[^>]*>/g, ' ')

describe('the tags on the check-the-details screen', () => {
  it('offers the two genre answers and a way to say anything else', () => {
    const markup = words(drawn())

    expect(markup).toContain('Fiction')
    expect(markup).toContain('Non-fiction')
    expect(markup).toContain('Add a tag')
  })

  it('draws what somebody said beside the two rather than instead of one', () => {
    const markup = words(drawn({
      draft: { genre: FICTION_SLUG },
      tags: [applied('subject/comic-book', 'Comic book')],
    }))

    expect(markup).toContain('Fiction')
    expect(markup).toContain('Non-fiction')
    expect(markup).toContain('Comic book')
  })

  // Matches the shape of a slug generically, rather than checking for known
  // slugs by name, so a future tag does not slip through unmatched.
  it('draws a tag by its label and never by its slug', () => {
    const markup = words(drawn({
      tags: [applied('subject/comic-book', 'Comic book')],
      vocabulary: [known('subject/comic-book', 'Comic book')],
    }))

    expect(markup).not.toMatch(/\b[a-z][a-z0-9]*\/[a-z][a-z0-9-]*\b/)
  })

  it('does not offer the way in when there is nothing to write a tag on', () => {
    expect(words(drawn({ canTag: false }))).not.toContain('Add a tag')
  })

  it('opens the naming panel rather than drawing one on the screen', () => {
    expect(drawn()).not.toContain('wf-name')
  })
})

describe('a queued capture with cover text and no title', () => {
  const nameless = (over: Parameters<typeof drawn>[0] = {}) =>
    drawn({ ...over, draft: { title: '', ...over.draft } })

  it('shows what the cover photo read', () => {
    const markup = nameless({ coverText: 'Song of Solomon\nToni Morrison' })

    expect(markup).toContain('Song of Solomon')
    expect(markup).toContain('Toni Morrison')
  })

  it('says it was read off the photograph by a machine', () => {
    const markup = nameless({ coverText: 'Song of Solomon' })

    expect(markup).toContain('The cover photo reads')
    expect(markup).toContain('often wrong')
  })

  // Deliberately not pre-filled: OCR is a lossy reading, and a guess sitting
  // in the Title box is one save away from becoming a confirmed value.
  it('leaves the Title box empty rather than filling it with the reading', () => {
    const markup = nameless({ coverText: 'Song of Solomon' })

    expect(markup).not.toContain('value="Song of Solomon"')
    expect(markup).toContain('Nothing here has been filled in for you')
  })

  it('offers nothing that copies the reading into a field', () => {
    const markup = nameless({ coverText: 'Song of Solomon' }).toLowerCase()

    expect(markup).not.toContain('use this')
    expect(markup).not.toContain('use as title')
  })

  it('shows the note that came with it', () => {
    expect(nameless({ captureNote: 'No ISBN confirmed. Barcode is torn.' }))
      .toContain('No ISBN confirmed. Barcode is torn.')
  })

  it('quotes nothing when the photographs produced nothing', () => {
    const markup = nameless()

    expect(markup).not.toContain('The cover photo reads')
    expect(markup).not.toContain('class="evidence"')
  })

  // The reason is in the page rather than a tooltip: this runs on a phone,
  // where nothing hovers.
  it('says what would let it be shelved, rather than only refusing', () => {
    expect(nameless({ coverText: 'Song of Solomon' }))
      .toContain('Type the title off the book to shelve it')
  })

  it('stops saying it the moment there is a title', () => {
    expect(drawn({ draft: { title: 'Song of Solomon' } }))
      .not.toContain('Type the title off the book to shelve it')
  })
})

describe('a book the catalogue already holds', () => {
  const shelved: CataloguedBook = { id: 45, title: 'Song of Solomon', location: '1B' }

  it('names it with no lookup behind it at all', () => {
    const markup = words(drawn({ catalogued: shelved }))

    expect(markup).toContain('Already catalogued as #45 (Song of Solomon) at 1B.')
    expect(markup).toContain('Saving adds a second copy')
  })

  it('leaves the location out rather than saying nowhere', () => {
    expect(words(drawn({ catalogued: { ...shelved, location: '' } })))
      .toContain('Already catalogued as #45 (Song of Solomon).')
  })

  it('says nothing about a book the catalogue does not hold', () => {
    expect(words(drawn())).not.toContain('Already catalogued')
  })

  it('does not refuse the save, because two copies genuinely turn up', () => {
    expect(drawn({ catalogued: shelved, draft: { title: 'Song of Solomon' } }))
      .not.toContain('Type the title off the book to shelve it')
  })
})
