/**
 * The first screen, now drawn with the design system (#303).
 *
 * Two things are checked here and they are different in kind.
 *
 * The first is the design rules that reach this screen, which `design.test.tsx`
 * pins for the gallery and nothing pinned for the app: every count is a target,
 * the collection comes above what is asking for attention (#283), and the
 * camera is not offered here.
 *
 * The second is what the drawing did not have to survive, because it was drawn
 * with numbers somebody chose: nothing catalogued, nothing waiting, a count
 * that has not come back yet, one book rather than several, and four digits.
 * A wireframe never sees any of those.
 *
 * #148 is why this file existed before. It said "9 need an ISBN by hand" when
 * five of those nine already had a valid ISBN off a barcode, so the sentence is
 * gone and the count is not: this screen says how many are stuck and the queue
 * says what each one needs. The check that the old wording cannot come back is
 * still here.
 *
 * Rendered as a tree and read as markup rather than driven in a browser, the
 * way `QueuePane.test.tsx` does it: this project has no DOM in its test setup,
 * and `HomePane` holds no state, so it stays callable as a plain function.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ReactElement } from 'react'
import { HomePane } from './HomePane'
import type { BackupWatch, Capture, Counts, Misfile, QueueCounts } from '../lib/api'
import { noFailures } from '../../shared/captureFailure'

const counts: Counts = { total: 12, fiction: 8, nonfiction: 4, checkedOut: 0 }

function queue(over: Partial<QueueCounts> = {}): QueueCounts {
  return { pending: 0, ready: 0, failed: 0, done: 0, failures: noFailures, ...over }
}

/** A queued book, with only the fields this screen reads filled in. */
function capture(over: Partial<Capture> = {}): Capture {
  return {
    id: 1, status: 'ready', front_image: '', back_image: '', edge_image: '',
    isbn13: '', isbn10: '', isbn_source: '', title_guess: '', cover_text: '',
    analysed: '', draft_json: '', edit_json: '', edited_by: '', edited_at: null,
    note: '', claimed_by: '', claimed_at: null, book_id: null,
    created_at: '', processed_at: null,
    front_crop: '', back_crop: '', edge_crop: '', cropped: '',
    ...over,
  }
}

/** A book that is not where it belongs, as the shelving review answers one. */
function misfile(over: Partial<Misfile['book']> = {}, from = '2C', to = '3A'): Misfile {
  return {
    book: {
      id: 7, title: 'Underland', authorFiling: 'Macfarlane, Robert',
      authors: 'Robert Macfarlane', location: from, derivedLocation: to,
      sortKey: 'macfarlane robert|underland', checkedOut: false,
      ...over,
    },
    from,
    to,
    instruction: `Move Underland from ${from} to ${to}`,
  }
}

/** What the server found where the backups are kept, with only what is drawn. */
function watched(over: Partial<BackupWatch> & Pick<BackupWatch, 'state'>): BackupWatch {
  return { where: 'E-drive', limitHours: 26, ...over }
}

function home(over: Partial<Parameters<typeof HomePane>[0]> = {}): string {
  return renderToStaticMarkup(HomePane({
    counts,
    queue: queue(),
    queued: [],
    carrying: [],
    backup: null,
    onAdd: () => {},
    onScan: () => {},
    onLibrary: () => {},
    onQueue: () => {},
    onCarry: () => {},
    onOpenReady: () => {},
    ...over,
  }) as ReactElement)
}

/** The words on the screen, with the markup and the class names gone. */
function words(markup: string): string {
  return markup.replace(/<[^>]*>/g, ' ')
}

describe('the design rules that reach the app', () => {
  it('draws no count that is only a label', () => {
    const html = home({ queue: queue({ ready: 6, failed: 3 }), carrying: [misfile()] })
    const drawn = html.match(/class="wf-stat[ "]/g) ?? []

    expect(drawn.length, 'the first screen draws no counts at all').toBeGreaterThan(2)
    expect(html, 'a count on the first screen is not a target').not.toMatch(
      /<(?!button)[a-z]+ class="wf-stat[ "]/,
    )
  })

  it('does not offer the camera', () => {
    expect(words(home())).not.toMatch(/camera|photograph/i)
  })

  it('puts the collection above the things asking for attention (#283)', () => {
    const html = home()
    expect(html.indexOf('The collection')).toBeGreaterThan(-1)
    expect(html.indexOf('The collection')).toBeLessThan(html.indexOf('Needs you'))
  })

  it('draws the four places in the tab bar and no fifth', () => {
    expect((home().match(/class="wf-tab(?: |")/g) ?? []).length).toBe(4)
  })

  it('names the one action in the corner, which carries no word', () => {
    const corner = home().match(/<button[^>]*wf-top__action[^>]*>/)
    expect(corner, 'the corner action is gone').not.toBeNull()
    expect(corner![0]).toMatch(/aria-label="[^"]+"/)
  })

  it('says no word out of the model', () => {
    const said = words(home({
      queue: queue({ ready: 2 }),
      queued: [capture({ title_guess: 'Underland' })],
      carrying: [misfile()],
    }))

    for (const word of ['run', 'range', 'shelf', 'plank', 'separator', 'capture', 'placement']) {
      expect(said, `the first screen says "${word}"`).not.toMatch(
        new RegExp(`\\b${word}\\b`, 'i'),
      )
    }
  })
})

describe('what the counts say', () => {
  it('counts the whole queue on the table, not one part of it', () => {
    const html = home({ queue: queue({ pending: 9, ready: 6, failed: 3 }) })
    expect(html).toContain('18 books are waiting on the table.')
  })

  it('says one book rather than 1 books', () => {
    expect(home({ queue: queue({ ready: 1 }) })).toContain('One book is waiting on the table.')
  })

  it('groups a collection that has reached four digits', () => {
    const html = home({ counts: { ...counts, total: 1204 } })
    expect(html).toContain('1,204')
  })

  it('says how many are stuck and never what they need', () => {
    // #148: the sentence that sent somebody to retype an ISBN that was already
    // correct. The count stays, the diagnosis lives on the queue.
    const html = home({
      queue: queue({
        failed: 9,
        failures: { noIsbn: 4, uncatalogued: 5, errored: 0, timedOut: 0 },
      }),
    })
    expect(html).toContain('stuck')
    expect(html).not.toContain('need an ISBN')
    expect(html).not.toContain('need details by hand')
  })
})

describe('the numbers the drawing did not have to survive', () => {
  it('says nothing is catalogued rather than drawing a screen of zeros', () => {
    const html = home({ counts: { total: 0, fiction: 0, nonfiction: 0, checkedOut: 0 } })
    expect(html).toContain('Nothing is catalogued yet.')
    expect(html).not.toContain('waiting on the table')
  })

  it('still says what is on the table when the collection is empty', () => {
    const html = home({
      counts: { total: 0, fiction: 0, nonfiction: 0, checkedOut: 0 },
      queue: queue({ pending: 2 }),
    })
    expect(html).toContain('2 books are waiting on the table.')
    expect(html).not.toContain('Nothing is catalogued yet.')
  })

  it('draws nothing but the frame until the first answer comes back', () => {
    for (const nothing of [home({ counts: null }), home({ queue: null })]) {
      expect(nothing).not.toContain('wf-stat')
      expect(nothing).toContain('wf-tab')
    }
  })

  it('leaves the carry count out until the review has answered', () => {
    const unanswered = home({ carrying: null })
    expect(unanswered).not.toContain('to carry')
    expect(unanswered).toContain('ready to shelve')
    expect(unanswered).toContain('stuck')

    expect(home({ carrying: [] })).toContain('to carry')
  })

  it('shows the first three of a long carry list and a way to the rest', () => {
    const many = Array.from({ length: 53 }, (_, at) =>
      misfile({ id: at + 1, title: `Book ${at + 1}` }))
    const html = home({ carrying: many })

    expect((html.match(/class="wf-row"/g) ?? []).length).toBe(3)
    expect(html).toContain('All 53')
    expect(html).toContain('Book 3')
    expect(html).not.toContain('Book 4<')
  })

  it('draws no card for a list with nothing in it', () => {
    const html = home()
    expect(html).not.toContain('Ready to shelve')
    expect(html).not.toContain('Books to carry')
  })

  it('names a queued book that no catalogue has answered for', () => {
    const html = home({
      queue: queue({ ready: 1 }),
      queued: [capture({ id: 4, status: 'ready' })],
    })
    expect(html).toContain('Book #4')
  })

  it('says nothing about backups on an ordinary day, in either silence', () => {
    // Fine, and not watched at all, both draw nothing, and they have to: a
    // reassuring line about a directory nobody read is the failure this whole
    // card exists to end, printed the other way round (#311).
    for (const state of ['fresh', 'unwatched'] as const) {
      const html = home({ backup: watched({ state }) })
      expect(html, `${state} drew a card`).not.toContain('wf-card__kind')
      expect(words(html)).not.toMatch(/backup/i)
    }
  })
})

/*
 * The other half of #311. The check itself is `server/backup-watch.test.ts`;
 * what is here is that each answer reaches the screen as words somebody would
 * act on, and that the two answers meaning "nothing to say" say nothing.
 */
describe('when the collection has stopped being backed up', () => {
  it('says how old the last proved one is, and when it was taken', () => {
    const html = home({
      backup: watched({
        state: 'stale',
        verified: { dump: 'bookscan-20260811T154741Z.dump', takenAt: '2026-08-11T15:47:41Z' },
        ageHours: 64,
      }),
    })

    expect(words(html)).toContain('The last proved backup is two days old')
    expect(words(html)).toContain('11 Aug')
  })

  it('says a disk it could not read is a disk it could not read', () => {
    // Never "everything is fine", and never "there are no backups" either: the
    // dumps are on a second physical disk on purpose, and a disk with its cable
    // out is a thing nobody knows the answer about.
    const said = words(home({ backup: watched({ state: 'unreachable', why: 'there is no such folder' }) }))

    expect(said).toContain('The backups cannot be read')
    expect(said).toContain('unplugged')
  })

  it('says a backup nobody restored is not one', () => {
    const said = words(home({ backup: watched({ state: 'unverified' }) }))

    expect(said).toContain('No backup has been proved')
    expect(said).toContain('restored')
  })

  it('says an empty directory plainly', () => {
    expect(words(home({ backup: watched({ state: 'none' }) })))
      .toContain('Nothing has been backed up')
  })

  it('draws it above everything else on the screen', () => {
    const html = home({
      queue: queue({ ready: 6 }),
      backup: watched({ state: 'none' }),
    })

    expect(html.indexOf('Nothing has been backed up'))
      .toBeLessThan(html.indexOf('The collection'))
  })

  it('says it even before the catalogue has answered', () => {
    // The morning after the worst kind of night is the one where the database
    // is slow as well, and that must not be the morning this stays quiet.
    const html = home({ counts: null, queue: null, backup: watched({ state: 'none' }) })

    expect(words(html)).toContain('Nothing has been backed up')
    expect(html).not.toContain('wf-stat')
  })

  it('offers no button, because nothing on this phone fixes it', () => {
    const html = home({ backup: watched({ state: 'none' }) })
    const card = html.slice(html.indexOf('Nothing has been backed up'))

    expect(card.slice(0, card.indexOf('</section>'))).not.toContain('<button')
  })

  it('says no word out of the model, in any of its four states', () => {
    for (const state of ['unreachable', 'none', 'unverified', 'stale'] as const) {
      const said = words(home({ backup: watched({ state, ageHours: 64 }) }))
      for (const word of ['run', 'range', 'shelf', 'plank', 'separator', 'capture', 'placement', 'cut']) {
        expect(said, `the backup card says "${word}" when ${state}`).not.toMatch(
          new RegExp(`\\b${word}\\b`, 'i'),
        )
      }
    }
  })
})

describe('the queue on the first screen', () => {
  it('lists only the ones that are ready, not the whole queue', () => {
    const html = home({
      queue: queue({ pending: 1, ready: 1 }),
      queued: [
        capture({ id: 1, status: 'pending', title_guess: 'Still reading' }),
        capture({ id: 2, status: 'ready', title_guess: 'Piranesi' }),
      ],
    })
    expect(html).toContain('Piranesi')
    expect(html).not.toContain('Still reading')
  })
})
