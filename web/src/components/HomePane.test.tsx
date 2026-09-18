/** Rendered as a tree and read as markup rather than driven in a browser: this project has no DOM in its test setup. */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ReactElement } from 'react'
import { HomePane } from './HomePane'
import { CARRY_BOOKS, IN_HAND, SAY_WHAT } from '../design/Controls'
import { Stats } from '../design/List'
import type { Which } from './QueuePane'
import type {
  BackupWatch, CarryItem, Counts, LookupStandings, QueueCounts, SourceStanding,
} from '../lib/api'
import { noFailures } from '../../shared/captureFailure'

const counts: Counts = { total: 12, fiction: 8, nonfiction: 4, checkedOut: 0 }

function queue(over: Partial<QueueCounts> = {}): QueueCounts {
  return { pending: 0, ready: 0, failed: 0, done: 0, failures: noFailures, ...over }
}

function toCarry(over: Partial<CarryItem['book']> = {}, from = '2C', to = '3A'): CarryItem {
  return {
    book: {
      id: 7,
      title: 'Underland',
      authorFiling: 'Macfarlane, Robert',
      spine: '',
      cover: '',
      ...over,
    },
    from,
    to,
  }
}

/** What the server found where the backups are kept, with only what is drawn. */
function watched(over: Partial<BackupWatch> & Pick<BackupWatch, 'state'>): BackupWatch {
  return { where: 'E-drive', limitHours: 26, ...over }
}

/** One catalogue at nought, which is what a server nobody has scanned on reports. */
function catalogue(over: Partial<SourceStanding> & { source: string }): SourceStanding {
  return {
    asked: 0, answered: 0, silent: 0, held: 0, noRecord: 0,
    declined: 0, failed: 0, skipped: 0, lastSilentAt: '', lastSilence: '',
    ...over,
  }
}

/** The four catalogues, all answering unless a test says otherwise. */
function catalogues(
  over: Partial<Record<string, Partial<SourceStanding>>> = {},
  googleBooksKeyConfigured = true,
): LookupStandings {
  const answering = { asked: 12, answered: 12, held: 10, noRecord: 2 }
  return {
    googleBooksKeyConfigured,
    sources: ['Open Library', 'Google Books', 'Library of Congress', 'K10plus']
      .map((source) => catalogue({ source, ...answering, ...(over[source] ?? {}) })),
  }
}

function propsFor(
  over: Partial<Parameters<typeof HomePane>[0]> = {},
): Parameters<typeof HomePane>[0] {
  return {
    counts,
    queue: queue(),
    // Defaults below are all the ordinary day (nothing wrong, nothing
    // unclaimed), so a card drawn in every render would make the tests below
    // say nothing about when it is actually drawn.
    carrying: [],
    unclaimed: 0,
    backup: null,
    drifting: 0,
    lookups: catalogues(),
    unreachable: false,
    onAdd: () => {},
    onInHand: () => {},
    corner: { word: 'Your fixtures', icon: null, onPress: () => {} },
    onLibrary: () => {},
    onQueue: () => {},
    onCarry: () => {},
    onUnclaimed: () => {},
    ...over,
  }
}

function home(over: Partial<Parameters<typeof HomePane>[0]> = {}): string {
  return renderToStaticMarkup(HomePane(propsFor(over)) as ReactElement)
}

/** The screen as a tree rather than as markup, for the one thing markup cannot answer: where a press goes. */
function tree(over: Partial<Parameters<typeof HomePane>[0]> = {}): ReactElement {
  return HomePane(propsFor(over)) as ReactElement
}

/** Find the first element of a given type anywhere in an unrendered tree. */
function elementOf<P>(node: unknown, type: unknown): { props: P } | null {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = elementOf<P>(child, type)
      if (hit) return hit
    }
    return null
  }
  const element = node as { type?: unknown; props?: Record<string, unknown> }
  if (element.type === type) return element as { props: P }
  return elementOf<P>(element.props?.children, type)
}

/** The counts, as the row of targets they are. */
function pressable(over: Partial<Parameters<typeof HomePane>[0]> = {}) {
  const stats = elementOf<{ items: { word: string; onPress: () => void }[] }>(
    tree(over), Stats,
  )
  return stats!.props.items
}

/** The words on the screen, with the markup and the class names gone. */
function words(markup: string): string {
  return markup.replace(/<[^>]*>/g, ' ')
}

/** Every count on the screen, in the order somebody reads them. */
function said(markup: string): string[] {
  return [...markup.matchAll(/class="wf-stat__word">([^<]+)</g)].map((one) => one[1]!)
}

describe('the design rules that reach the app', () => {
  it('draws no count that is only a label', () => {
    const html = home({ queue: queue({ ready: 6, failed: 3 }), carrying: [toCarry()] })
    const drawn = html.match(/class="wf-stat[ "]/g) ?? []

    expect(drawn.length, 'the first screen draws no counts at all').toBeGreaterThan(2)
    expect(html, 'a count on the first screen is not a target').not.toMatch(
      /<(?!button)[a-z]+ class="wf-stat[ "]/,
    )
  })

  it('does not offer the camera that catalogues a book', () => {
    expect(words(home())).not.toMatch(/camera|photograph/i)
  })

  it('says the five counts ungrouped, in the order he named them (#361)', () => {
    const html = home({ queue: queue({ ready: 6, failed: 3 }), carrying: [toCarry()] })

    expect(html, 'the first screen has a heading on it again').not.toMatch(/wf-heading/)
    expect(said(html)).toEqual([
      'catalogued', 'checked out', 'ready to shelve', 'to carry', 'stuck',
    ])
  })

  it('keeps the cat', () => {
    expect(home(), 'the cat has gone off the first screen').toMatch(/wf-cat/)
  })

  it('sleeps on the things you can do rather than among the counts', () => {
    const html = home({ carrying: [toCarry()], unclaimed: 12 })

    expect(html, 'the cat is back in the counts grid').not.toMatch(/wf-stats__cat/)
    expect(html, 'the cat is not on the things you can do').toMatch(/wf-doors__cat/)
    expect(html.indexOf('wf-doors__cat'), 'the cat is painted over the buttons')
      .toBeLessThan(html.indexOf('wf-door--'))
  })

  it('still says five counts with him gone from the grid', () => {
    const html = home({ queue: queue({ ready: 6, failed: 3 }), carrying: [toCarry()] })

    expect(said(html)).toEqual([
      'catalogued', 'checked out', 'ready to shelve', 'to carry', 'stuck',
    ])
    expect((html.match(/class="wf-stat[ "]/g) ?? []).length, 'a sixth tile appeared').toBe(5)
  })

  it('has one door to the camera that reads a book in your hand, and one only', () => {
    const html = home()
    const doors = html.match(/class="wf-door wf-door--inhand"/g) ?? []

    expect(doors.length, `the first screen draws ${doors.length} of these`).toBe(1)
    expect(words(html)).toContain(IN_HAND)
  })

  it('offers few things to do, and nothing a tab already reaches', () => {
    const html = home({ carrying: [toCarry()], unclaimed: 12 })
    const doors = html.match(/class="wf-door[ "]/g) ?? []

    expect(doors.length, `the first screen offers ${doors.length} things to do`)
      .toBeLessThanOrEqual(3)
    expect(words(html), 'a door offers what the tab bar already opens')
      .not.toMatch(/photograph a book|the queue|your library/i)
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
    const text = words(home({ queue: queue({ ready: 2 }), carrying: [toCarry()] }))

    for (const word of ['run', 'range', 'shelf', 'plank', 'separator', 'capture', 'placement']) {
      expect(text, `the first screen says "${word}"`).not.toMatch(
        new RegExp(`\\b${word}\\b`, 'i'),
      )
    }
  })
})

describe('what the counts say', () => {
  it('groups a collection that has reached four digits', () => {
    const html = home({ counts: { ...counts, total: 1204 } })
    expect(html).toContain('1,204')
  })

  it('says how many are stuck and never what they need', () => {
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

  it('no longer says anything about what is waiting on the table', () => {
    const html = home({ queue: queue({ pending: 9, ready: 6, failed: 3 }) })

    expect(words(html)).not.toMatch(/on the table/i)
    expect(said(html)).not.toContain('waiting')
  })
})

describe('the numbers the drawing did not have to survive', () => {
  it('draws five zeros and a sleeping cat when there is nothing at all', () => {
    const html = home({ counts: { total: 0, fiction: 0, nonfiction: 0, checkedOut: 0 } })

    expect(said(html).length, 'the counts are not all drawn on an empty day').toBe(5)
    expect(html).toMatch(/wf-stats__cat/)
    expect(html, 'the cat is awake on a screen with nothing on it').toMatch(/wf-cat__shut/)
    expect(html, 'a door was offered to a room with nothing in it').not.toContain('wf-door')
  })

  it('stretches him out as soon as there is a book anywhere', () => {
    const table = home({
      counts: { total: 0, fiction: 0, nonfiction: 0, checkedOut: 0 },
      queue: queue({ pending: 2 }),
    })

    expect(table, 'the cat slept through a book arriving on the table')
      .toMatch(/wf-cat__sweep/)
    expect(table, 'the things you can do were not scooted down for him')
      .toMatch(/wf-doors--bed/)
    expect(table, 'the cat is back among the counts').not.toMatch(/wf-stats__cat/)
  })

  it('leaves him a still loaf on the evening there is nothing to lie on', () => {
    const nothing = home({ counts: { total: 0, fiction: 0, nonfiction: 0, checkedOut: 0 } })

    expect(nothing, 'a tail was drawn reaching behind doors that are not there')
      .not.toMatch(/wf-cat__sweep/)
    expect(nothing, 'a bed was made out of buttons that are not drawn')
      .not.toMatch(/wf-doors/)
    expect(nothing, 'the cat left the one screen he still closes').toMatch(/wf-stats__cat/)
  })

  it('gives him a behaviour rather than a still drawing, on the screen he lies on', () => {
    const html = home({ carrying: [toCarry()] })

    expect(html, 'the cat on the first screen is doing nothing').toMatch(/wf-cat--dozing/)
    expect(html, 'the cat dozes once and stops').toMatch(/wf-cat--loop/)
  })

  it('offers no way to find a book when there is nothing to find one against', () => {
    const empty = { total: 0, fiction: 0, nonfiction: 0, checkedOut: 0 }

    expect(home({ counts: empty })).not.toContain('wf-door--inhand')
    expect(home({ counts: { ...empty, total: 1 } })).toContain('wf-door--inhand')
  })

  it('offers it for a book on the table, with nothing catalogued at all', () => {
    const empty = { total: 0, fiction: 0, nonfiction: 0, checkedOut: 0 }

    expect(home({ counts: empty, queue: queue({ pending: 2 }) })).toContain('wf-door--inhand')
  })

  it('offers it only once the catalogue has answered', () => {
    expect(home({ counts: null })).not.toContain('wf-door')
    expect(home({ queue: null })).not.toContain('wf-door')
  })

  it('draws nothing but the frame until the first answer comes back', () => {
    for (const nothing of [home({ counts: null }), home({ queue: null })]) {
      expect(nothing).not.toContain('wf-stat')
      expect(nothing).toContain('wf-tab')
    }
  })

  it('leaves the carry count out until the review has answered', () => {
    const unanswered = home({ carrying: null })
    expect(said(unanswered)).toEqual(['catalogued', 'checked out', 'ready to shelve', 'stuck'])

    expect(said(home({ carrying: [] }))).toContain('to carry')
  })

  it('offers carrying only when there is something to carry', () => {
    expect(home({ carrying: [] })).not.toContain(CARRY_BOOKS)
    expect(words(home({ carrying: [toCarry()] }))).toContain(CARRY_BOOKS)
  })

  it('offers a way to the books nothing files, when there are any', () => {
    expect(words(home({ unclaimed: 12 }))).toContain(SAY_WHAT)
    expect(home({ unclaimed: 12 })).toContain('wf-door--saying')
  })

  it('offers it on the day there is one, which is the day it matters most', () => {
    expect(words(home({ unclaimed: 1 }))).toContain(SAY_WHAT)
  })

  it('offers nothing of the sort once every book is claimed', () => {
    expect(words(home({ unclaimed: 0 }))).not.toContain(SAY_WHAT)
  })

  it('offers nothing of the sort until the read has answered', () => {
    expect(words(home({ unclaimed: null }))).not.toContain(SAY_WHAT)
  })

  it('adds no sixth count for them, because the five are the five he named', () => {
    const html = home({ unclaimed: 12, queue: queue({ ready: 6 }), carrying: [toCarry()] })

    expect(said(html)).toEqual([
      'catalogued', 'checked out', 'ready to shelve', 'to carry', 'stuck',
    ])
    expect(html, 'the first screen names one of those books').not.toContain('wf-row')
  })

  it('counts a long carry list rather than naming three of it', () => {
    const many = Array.from({ length: 53 }, (_, at) =>
      toCarry({ id: at + 1, title: `Book ${at + 1}` }))
    const html = home({ carrying: many })

    expect(html).toContain('53')
    expect(html, 'the first screen names books again').not.toContain('wf-row')
  })

  it('says nothing about backups on an ordinary day, in either silence', () => {
    for (const state of ['fresh', 'unwatched'] as const) {
      const html = home({ backup: watched({ state }) })
      expect(html, `${state} drew a card`).not.toContain('wf-card__kind')
      expect(words(html)).not.toMatch(/backup/i)
    }
  })
})

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
    const text = words(home({ backup: watched({ state: 'unreachable', why: 'there is no such folder' }) }))

    expect(text).toContain('The backups cannot be read')
    expect(text).toContain('unplugged')
  })

  it('says a backup nobody restored is not one', () => {
    const text = words(home({ backup: watched({ state: 'unverified' }) }))

    expect(text).toContain('No backup has been proved')
    expect(text).toContain('restored')
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

    expect(html.indexOf('Nothing has been backed up')).toBeLessThan(html.indexOf('wf-stats'))
  })

  it('says it even before the catalogue has answered', () => {
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
      const text = words(home({ backup: watched({ state, ageHours: 64 }) }))
      for (const word of ['run', 'range', 'shelf', 'plank', 'separator', 'capture', 'placement', 'cut']) {
        expect(text, `the backup card says "${word}" when ${state}`).not.toMatch(
          new RegExp(`\\b${word}\\b`, 'i'),
        )
      }
    }
  })
})

describe('when the shelf and the rules disagree about where books stand', () => {
  it('says nothing on a day they agree, and nothing when nobody answered', () => {
    for (const drifting of [0, null]) {
      const html = home({ drifting })
      expect(words(html), `${drifting} drew a card`).not.toMatch(/claimed by another/)
    }
  })

  it('says how many, and where the books are named', () => {
    const text = words(home({ drifting: 12 }))

    expect(text).toContain('Twelve books are drawn in one place and claimed by another')
    expect(text).toContain('Books that are not where they should be')
  })

  it('counts one book as one book', () => {
    expect(words(home({ drifting: 1 })))
      .toContain('One book is drawn in one place and claimed by another')
  })

  it('says out loud that nothing will be repaired', () => {
    const text = words(home({ drifting: 12 }))

    expect(text).toContain('Nothing has been moved and nothing will be')
    expect(text).toContain('never repaired')
  })

  it('offers no button, because nothing on this phone fixes it', () => {
    const html = home({ drifting: 12 })
    const card = html.slice(html.indexOf('claimed by another'))

    expect(card.slice(0, card.indexOf('</section>'))).not.toContain('<button')
  })

  it('names no book, because this screen never has', () => {
    expect(home({ drifting: 12 })).not.toContain('wf-row')
  })

  it('says it even before the catalogue has answered', () => {
    const html = home({ counts: null, queue: null, drifting: 12 })

    expect(words(html)).toContain('claimed by another')
    expect(html).not.toContain('wf-stat')
  })

  it('draws both pieces of bad news when there are two', () => {
    const text = words(home({ backup: watched({ state: 'none' }), drifting: 12 }))

    expect(text).toContain('Nothing has been backed up')
    expect(text).toContain('claimed by another')
  })

  it('says no word out of the model', () => {
    const text = words(home({ drifting: 12 }))
    for (const word of ['run', 'range', 'shelf', 'plank', 'separator', 'capture', 'placement', 'cut']) {
      expect(text, `the card says "${word}"`).not.toMatch(new RegExp(`\\b${word}\\b`, 'i'))
    }
  })
})

describe('when a catalogue has described none of the books looked up', () => {
  it('says nothing while every catalogue is answering, or nobody answered', () => {
    for (const lookups of [catalogues(), null]) {
      const html = home({ lookups })
      expect(words(html), 'drew a card').not.toMatch(/described none of/)
    }
  })

  it('says nothing about a catalogue that is only having a bad afternoon', () => {
    const html = home({
      lookups: catalogues({
        'Google Books': { asked: 12, answered: 0, held: 0, noRecord: 0, silent: 12, failed: 12 },
      }),
    })

    expect(words(html)).not.toMatch(/described none of/)
  })

  it('says which catalogue and how many books, when it is being refused', () => {
    const text = words(home({
      lookups: catalogues({
        'Google Books': { asked: 12, answered: 0, held: 0, noRecord: 0, silent: 12, declined: 12 },
      }, false),
    }))

    expect(text).toContain('Google Books has described none of the 12 books')
    expect(text).toContain('Nothing you have catalogued is wrong')
    expect(text).toContain('Where your books are described from')
  })

  it('offers no button, because nothing on this phone sets a key', () => {
    const html = home({
      lookups: catalogues({
        'Google Books': { asked: 12, answered: 0, held: 0, noRecord: 0, silent: 12, declined: 12 },
      }, false),
    })
    const card = html.slice(html.indexOf('described none of'))

    expect(card.slice(0, card.indexOf('</section>'))).not.toContain('<button')
  })

  it('draws all three pieces of bad news when there are three', () => {
    const text = words(home({
      backup: watched({ state: 'none' }),
      drifting: 12,
      lookups: catalogues({
        'Google Books': { asked: 12, answered: 0, held: 0, noRecord: 0, silent: 12, declined: 12 },
      }, false),
    }))

    expect(text).toContain('Nothing has been backed up')
    expect(text).toContain('claimed by another')
    expect(text).toContain('described none of')
  })

  it('says it even before the catalogue counts have answered', () => {
    const html = home({
      counts: null,
      queue: null,
      lookups: catalogues({
        'Google Books': { asked: 12, answered: 0, held: 0, noRecord: 0, silent: 12, declined: 12 },
      }, false),
    })

    expect(words(html)).toContain('described none of')
    expect(html).not.toContain('wf-stat')
  })
})

describe('when nothing answered', () => {
  it('says so, on the screen that would otherwise be blank', () => {
    const html = home({ counts: null, queue: null, unreachable: true })

    expect(words(html)).toContain('Your books could not be counted')
    expect(html).not.toContain('wf-stat')
  })

  it('is what tells that screen apart from the one still waiting', () => {
    const waiting = home({ counts: null, queue: null })
    const nothing = home({ counts: null, queue: null, unreachable: true })

    expect(words(waiting)).not.toContain('Your books could not be counted')
    expect(nothing).not.toEqual(waiting)
  })

  it('keeps the last counts on the screen rather than emptying it', () => {
    const html = home({ queue: queue({ ready: 6 }), unreachable: true })

    expect(words(html)).toContain('Your books could not be counted')
    expect(said(html)).toContain('catalogued')
    expect(said(html)).toContain('ready to shelve')
  })

  it('says nothing at all on a day the server answered', () => {
    expect(words(home())).not.toContain('could not be counted')
    expect(words(home({ counts: null, queue: null }))).not.toContain('could not be counted')
  })

  it('is read before the news it is the reason for', () => {
    const html = home({
      counts: null,
      queue: null,
      unreachable: true,
      backup: watched({ state: 'none' }),
    })

    expect(html.indexOf('Your books could not be counted'))
      .toBeLessThan(html.indexOf('Nothing has been backed up'))
  })

  it('offers no button, because pressing one is what moving around the app does', () => {
    const html = home({ counts: null, queue: null, unreachable: true })
    const card = html.slice(html.indexOf('Your books could not be counted'))

    expect(card.slice(0, card.indexOf('</section>'))).not.toContain('<button')
  })

  it('says no word out of the model', () => {
    const text = words(home({ counts: null, queue: null, unreachable: true }))

    for (const word of ['run', 'range', 'shelf', 'plank', 'separator', 'capture', 'placement', 'cut']) {
      expect(text, `the card says "${word}"`).not.toMatch(new RegExp(`\\b${word}\\b`, 'i'))
    }
  })
})

describe('what a count opens', () => {
  const pressing = (word: string, over: Partial<Parameters<typeof HomePane>[0]> = {}) => {
    const opened: (Which | undefined)[] = []
    const items = pressable({
      queue: queue({ ready: 6, failed: 31 }),
      onQueue: (showing?: Which) => opened.push(showing),
      ...over,
    })
    items.find((one) => one.word === word)!.onPress()
    return opened
  }

  it('opens the queue on the stuck books when the stuck count is pressed', () => {
    expect(pressing('stuck')).toEqual(['stuck'])
  })

  it('opens the queue on the ready ones when the ready count is pressed', () => {
    expect(pressing('ready to shelve')).toEqual(['ready'])
  })

  it('opens the whole queue from the tab bar, which counts nothing', () => {
    const opened: (Which | undefined)[] = []
    const screen = tree({ onQueue: (showing?: Which) => opened.push(showing) })
    const tabs = (screen.props as { tabs: Record<string, () => void> }).tabs
    tabs.queue!()
    expect(opened).toEqual([undefined])
  })

  const opening = (word: string) => {
    const opened: (string | undefined)[] = []
    const items = pressable({
      counts: { ...counts, checkedOut: 2 },
      onLibrary: (showing?: string) => opened.push(showing),
    })
    items.find((one) => one.word === word)!.onPress()
    return opened
  }

  it('opens the library on the books that are out of the house', () => {
    expect(opening('checked out')).toEqual(['checked_out'])
  })

  it('opens the whole library from the count that means all of it', () => {
    expect(opening('catalogued')).toEqual([undefined])
  })

  it('opens the whole library from the tab bar, which counts nothing', () => {
    const opened: (string | undefined)[] = []
    const screen = tree({ onLibrary: (showing?: string) => opened.push(showing) })
    const tabs = (screen.props as { tabs: Record<string, () => void> }).tabs
    tabs.library!()
    expect(opened).toEqual([undefined])
  })

  it('leaves the counts that are not about the queue alone', () => {
    const went: string[] = []
    const items = pressable({
      counts: { ...counts, checkedOut: 2 },
      carrying: [toCarry()],
      onLibrary: () => went.push('library'),
      onCarry: () => went.push('carry'),
      onQueue: () => went.push('queue'),
    })
    for (const word of ['catalogued', 'checked out', 'to carry']) {
      items.find((one) => one.word === word)!.onPress()
    }
    expect(went).toEqual(['library', 'library', 'carry'])
  })
})
