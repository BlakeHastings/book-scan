/** Rendered as markup: this project has no DOM in its test setup, and this screen holds no state. */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ReactElement } from 'react'
import { SayingPane } from './SayingPane'
import { FICTION_SLUG, NON_FICTION_SLUG } from '../../domain/tagging/catalogue-claims'
import type { AppliedTag, BookRow, TagRow, UnclaimedBook } from '../lib/api'

const tabs = { home: () => {}, library: () => {}, scan: () => {}, queue: () => {} }

/** The words on the screen, with the markup and the class names gone. */
const words = (markup: string) => markup.replace(/<[^>]*>/g, ' ')

const book = (over: Partial<UnclaimedBook> = {}): UnclaimedBook => ({
  id: 13,
  title: 'The Peregrine',
  authorFiling: 'Baker, J. A.',
  standing: { areaId: 4, label: '4A' },
  tags: [],
  why: 'untagged',
  ...over,
})

const record = (over: Partial<BookRow> = {}): BookRow => ({
  publisher: 'Collins', published: '1967', pages: '191',
  ...over,
} as BookRow)

const vocabulary: TagRow[] = [
  { slug: FICTION_SLUG, label: 'Fiction', note: '', books: 19, ruled: false },
  { slug: NON_FICTION_SLUG, label: 'Non-fiction', note: '', books: 8, ruled: false },
  { slug: 'subject/crime', label: 'Crime', note: '', books: 9, ruled: false },
]

const applied = (slug: string, label: string): AppliedTag =>
  ({ slug, label, source: 'person', confidence: 'high' })

function drawn(over: Partial<Parameters<typeof SayingPane>[0]> = {}): string {
  return renderToStaticMarkup(SayingPane({
    book: book(),
    record: record(),
    tags: [],
    carried: [],
    vocabulary,
    busy: false,
    error: '',
    naming: false,
    tabs,
    onBack: () => {},
    onSay: () => {},
    onUnsay: () => {},
    onOpenNaming: () => {},
    onCloseNaming: () => {},
    ...over,
  }) as ReactElement)
}

describe('saying what one book is', () => {
  it('chooses nothing, and offers no button that a default would enable', () => {
    const html = drawn()

    expect(html, 'an answer is chosen before anybody said anything').not.toMatch(
      /wf-(choice__opt|seg__opt|tag)--on|aria-pressed="true"/,
    )
    expect(html, 'a save button arrived, and a default with it')
      .not.toMatch(/wf-btn--primary/)
    expect(words(html)).toContain('No catalogue said, and this app does not guess')
  })

  it('offers the two answers a rule about a bookcase asks', () => {
    const said = words(drawn())

    expect(said).toContain('Fiction')
    expect(said).toContain('Non-fiction')
    expect(said).toContain('Add a tag')
  })

  it('reads those two out of the collection rather than writing the words here', () => {
    const said = words(drawn({
      vocabulary: [{ slug: FICTION_SLUG, label: 'Made up', note: '', books: 3, ruled: false }],
    }))

    expect(said).toContain('Made up')
  })

  it('draws a tag that is on as on, so pressing it again takes it off', () => {
    const html = drawn({
      carried: [NON_FICTION_SLUG],
      tags: [applied(NON_FICTION_SLUG, 'Non-fiction')],
    })

    expect(html).toMatch(/wf-tag--on/)
    expect(words(html)).not.toContain('Nothing is chosen')
  })

  it('draws a tag nobody has a rule for beside the two, once and not twice', () => {
    const said = words(drawn({
      book: book({ why: 'unmatched', tags: ['Crime'] }),
      carried: ['subject/crime'],
      tags: [applied('subject/crime', 'Crime')],
    }))

    expect(said).toContain('Crime')
    expect(said.match(/Crime/g) ?? []).toHaveLength(1)
  })

  it('shows what the catalogue holds, because nothing else answers the question', () => {
    const said = words(drawn())

    expect(said).toContain('Baker, J. A.')
    expect(said).toContain('Collins')
    expect(said).toContain('191 pages')
    expect(said).toContain('It stands on 4A')
  })

  it('says what it does know while the rest of the record is still coming', () => {
    const said = words(drawn({ record: null }))

    expect(said).toContain('The Peregrine')
    expect(said).toContain('Baker, J. A.')
  })

  it('says which of the two states this book is in', () => {
    expect(words(drawn())).toContain('Nothing knows what this book is')
    expect(words(drawn({
      book: book({ why: 'unmatched', tags: ['Crime'] }),
      carried: ['subject/crime'],
    }))).toContain('No rule asks for what this book carries')
  })

  it('stops saying that the moment somebody answers, and not before', () => {
    const arrived = words(drawn({
      book: book({ why: 'unmatched', tags: ['Crime'] }),
      carried: ['subject/crime'],
    }))
    expect(arrived).not.toContain('What you say is on the book already')
    expect(arrived).toContain('Leave it for now')

    const answered = words(drawn({
      book: book({ why: 'unmatched', tags: ['Crime'] }),
      carried: ['subject/crime', NON_FICTION_SLUG],
    }))
    expect(answered).toContain('What you say is on the book already')
    expect(answered).toContain('Done with this one')
  })

  it('draws the naming panel over the screen only while it is open', () => {
    expect(drawn()).not.toContain('wf-name')
    expect(drawn({ naming: true })).toContain('wf-name')
  })

  it('says no word out of the model', () => {
    const said = words(drawn())

    for (const word of [
      'run', 'range', 'shelf', 'plank', 'separator', 'capture', 'placement', 'cut',
    ]) {
      expect(said, `the screen says "${word}"`).not.toMatch(new RegExp(`\\b${word}\\b`, 'i'))
    }
  })

  it('leaves a way out that changes nothing', () => {
    expect(words(drawn())).toContain('Leave it for now')
  })
})
