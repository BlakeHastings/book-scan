/**
 * The tags on the check-the-details screen (#372).
 *
 * Three things are pinned here and each one is a rule that would be broken by
 * somebody being helpful rather than by somebody being careless.
 *
 * The first is #304 arriving on a new screen. A genre is written only when a
 * source stated one or a person answered the two options, and this screen now
 * has a free-text box on it. The box may never produce a genre tag, which
 * `domain/tagging/naming.ts` enforces and its tests prove; what is checked here
 * is the other half, that the two options are still the two options and that a
 * tag somebody typed is drawn beside them rather than instead of one.
 *
 * The second is the pinned design rule that a tag is drawn by its label and
 * never by its slug. `design.test.tsx` checks it of every gallery screen and
 * nothing checked it of the app, where the tags come off the wire carrying both
 * halves and the slug is the one that is right there in the object.
 *
 * The third is that the way in is not drawn when there is nowhere to write to.
 *
 * Rendered as markup rather than driven in a browser, the way
 * `HomePane.test.tsx` does it: this project has no DOM in its test setup.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CaptureReview } from './CaptureReview'
import { emptyDraft, type AppliedTag, type Draft, type TagRow } from '../lib/api'
import { FICTION_SLUG } from '../../domain/tagging/catalogue-claims'
import type { TabName } from '../design/Chrome'

const tabs: Record<TabName, () => void> = {
  home: () => {}, library: () => {}, scan: () => {}, queue: () => {},
}

const applied = (slug: string, label: string): AppliedTag =>
  ({ slug, label, source: 'person', confidence: 'high' })

const known = (slug: string, label: string, books = 3): TagRow =>
  ({ slug, label, note: '', books })

function drawn(over: {
  draft?: Partial<Draft>
  tags?: AppliedTag[]
  vocabulary?: TagRow[]
  canTag?: boolean
  coverText?: string
  captureNote?: string
} = {}) {
  return renderToStaticMarkup(
    <CaptureReview
      draft={{ ...emptyDraft, title: 'Watchmen', ...over.draft }}
      lookup={null}
      photos={{}}
      derivedFiling="Moore, Alan"
      saving={false}
      relookupBusy={false}
      relookupError=""
      catalogueCover=""
      coverText={over.coverText ?? ''}
      captureNote={over.captureNote ?? ''}
      notice=""
      onDismissNotice={() => {}}
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

  /*
   * The pinned rule, reaching the app. A tag arrives here as a slug and a
   * label together, so drawing the wrong half is one property away and would
   * put `subject/comic-book` on a screen, which is showing somebody a row id.
   * The pattern is the shape of a slug rather than a list of known ones,
   * because the next slug is the one that gets rendered by accident.
   */
  it('draws a tag by its label and never by its slug', () => {
    const markup = words(drawn({
      tags: [applied('subject/comic-book', 'Comic book')],
      vocabulary: [known('subject/comic-book', 'Comic book')],
    }))

    expect(markup).not.toMatch(/\b[a-z][a-z0-9]*\/[a-z][a-z0-9-]*\b/)
  })

  /*
   * A capture is a row in `books` from its first photograph (#183), so there is
   * almost always somewhere to write a tag. Almost is not always, and a target
   * that answers 404 is worse than no target.
   */
  it('does not offer the way in when there is nothing to write a tag on', () => {
    expect(words(drawn({ canTag: false }))).not.toContain('Add a tag')
  })

  /* The panel is opened rather than being on the screen: this is the fast path
     and a screen somebody is trying to get a book off does not carry a search
     box for tags it may never need. */
  it('opens the naming panel rather than drawing one on the screen', () => {
    expect(drawn()).not.toContain('wf-name')
  })
})

/**
 * What the photographs read, on the one screen that still shows it.
 *
 * **These tests were written against the other screen and moved here** (#409).
 * `CaptureEvidence` had two callers, and the owner named it off the screen for
 * a book the catalogue already holds: "we have text underneath the images
 * coming from the OCR system. We shouldn't show those, they're very intrusive."
 * That leaves one caller, which is this screen, and it is the screen the block
 * was written for: the case the whole of #147 is about is a capture the
 * photographs read something off and no catalogue matched, so there is no
 * title, and that is precisely the book somebody has to work out by hand.
 *
 * Nothing in the claims changed in the move. The reading is shown, it says what
 * it is and how much to trust it, and it never reaches a field.
 */
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

  /*
   * The point of showing it at all is undone by pre-filling it. OCR is a
   * lossy reading of a photograph, and a guess sitting in the Title box is
   * one save away from entering the catalogue as a confirmed value.
   */
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

  /*
   * Three people work one pile and a note is how one hands the book to the
   * next, so it belongs on the screen where the next one picks it up.
   */
  it('shows the note that came with it', () => {
    expect(nameless({ captureNote: 'No ISBN confirmed. Barcode is torn.' }))
      .toContain('No ISBN confirmed. Barcode is torn.')
  })

  /* The block itself is absent rather than empty, checked on the class: this
     screen says the word "evidence" in the card that stands in for a lookup
     nothing answered, which is prose about what is underneath rather than the
     thing underneath. */
  it('quotes nothing when the photographs produced nothing', () => {
    const markup = nameless()

    expect(markup).not.toContain('The cover photo reads')
    expect(markup).not.toContain('class="evidence"')
  })

  /*
   * #156. With the guess out of the Title box this button is dead until
   * somebody names the book, and it was live before, so the page has to say
   * why rather than leave a person prodding at it. In the page and not only in
   * the button's tooltip: this runs on a phone, where nothing hovers.
   */
  it('says what would let it be shelved, rather than only refusing', () => {
    expect(nameless({ coverText: 'Song of Solomon' }))
      .toContain('Type the title off the book to shelve it')
  })

  it('stops saying it the moment there is a title', () => {
    expect(drawn({ draft: { title: 'Song of Solomon' } }))
      .not.toContain('Type the title off the book to shelve it')
  })
})
