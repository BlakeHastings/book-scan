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
      coverText=""
      captureNote=""
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
