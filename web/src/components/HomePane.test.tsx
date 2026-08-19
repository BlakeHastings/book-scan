/**
 * The first screen, now drawn with the design system (#303).
 *
 * Two things are checked here and they are different in kind.
 *
 * The first is the design rules that reach this screen, which `design.test.tsx`
 * pins for the gallery and nothing pinned for the app: every count is a target,
 * the five counts are ungrouped and in the order the owner named them (#361),
 * and the camera that catalogues a book is not offered here.
 *
 * The second is what the drawing did not have to survive, because it was drawn
 * with numbers somebody chose: nothing catalogued, nothing waiting, a count
 * that has not come back yet, and four digits. A wireframe never sees any of
 * those.
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
import { CARRY_BOOKS, IN_HAND, SAY_WHAT } from '../design/Controls'
import { Stats } from '../design/List'
import type { Which } from './QueuePane'
import type { BackupWatch, CarryItem, Counts, QueueCounts } from '../lib/api'
import { noFailures } from '../../shared/captureFailure'

const counts: Counts = { total: 12, fiction: 8, nonfiction: 4, checkedOut: 0 }

function queue(over: Partial<QueueCounts> = {}): QueueCounts {
  return { pending: 0, ready: 0, failed: 0, done: 0, failures: noFailures, ...over }
}

/**
 * One book still to be carried, as the carry list answers one.
 *
 * The pictures are on it because every book on the wire carries them now
 * (#386), and this screen is the one place a carried book is counted rather
 * than drawn: it wants the shape, not the photograph.
 */
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

function propsFor(
  over: Partial<Parameters<typeof HomePane>[0]> = {},
): Parameters<typeof HomePane>[0] {
  return {
    counts,
    queue: queue(),
    carrying: [],
    /* Nothing unfiled is the ordinary day, so it is the default here: a door
       drawn in every one of these renders would make the tests below say
       nothing about when it is drawn. */
    unclaimed: 0,
    backup: null,
    onAdd: () => {},
    onInHand: () => {},
    /* The corner (#350). `RoomMenu` decides what it says and what it opens;
       this screen is handed one, so this is a stand-in of the same shape. */
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

/**
 * The screen as a tree rather than as markup, for the one thing markup cannot
 * answer: where a press goes.
 *
 * Every count on this screen is a button, and rendering one tells you it is a
 * button and nothing about what it opens. #436 is exactly that gap: the counts
 * were targets, they went to the right screen, and two of them showed the wrong
 * books when they got there.
 */
function tree(over: Partial<Parameters<typeof HomePane>[0]> = {}): ReactElement {
  // The same props `home` renders, taken before they are rendered.
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
    // "We still should have the cat icon on this screen though, because it's
    // cute." Where he is, on a day there are things to do, is #427's whole
    // subject and is checked below.
    expect(home(), 'the cat has gone off the first screen').toMatch(/wf-cat/)
  })

  /*
   * #427, and the fault it closes is the one no rendered tree caught: the cat
   * was drawn correctly, animated correctly, and in the wrong place.
   *
   * > This is the cat. It is supposed to be sleeping on the actions, not as
   * > part of the metrics grid.
   *
   * Markup can answer which block he is in, and that is what is asked here.
   * Whether he then *looks* like he is lying on the buttons is a fact about
   * pixels and is answered by measuring him against the first one in a browser:
   * `e2e/features/the-cat-is-alive.feature`.
   */
  it('sleeps on the things you can do rather than among the counts', () => {
    const html = home({ carrying: [toCarry()], unclaimed: 12 })

    expect(html, 'the cat is back in the counts grid').not.toMatch(/wf-stats__cat/)
    expect(html, 'the cat is not on the things you can do').toMatch(/wf-doors__cat/)
    // Before the first button in the markup, which is the half of "behind" that
    // is not a stylesheet: the buttons are painted after him and over him.
    expect(html.indexOf('wf-doors__cat'), 'the cat is painted over the buttons')
      .toBeLessThan(html.indexOf('wf-door--'))
  })

  it('still says five counts with him gone from the grid', () => {
    // The hole this was not allowed to leave. Five counts across two rows is
    // what round eight settled, and the cell after the last one is empty the
    // way it is empty whenever a count has not answered.
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
    // The ceiling rather than the count, for the reason the gallery's copy of
    // this rule gives: the fault is a screen of buttons, which is the thing
    // this round was called to fix said another way. Asked on the busiest day
    // this screen has, which since #341 is three doors: something to find,
    // something to carry, and something to say what it is.
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

  it('no longer says anything about what is waiting on the table', () => {
    // #361, and the one thing that genuinely left with that sentence: a book
    // still being looked up is neither ready nor stuck, so no count here holds
    // it. It is on the queue, one press away, and it stops being pending on its
    // own. What is checked is that the sentence has not been rewritten shorter
    // somewhere else on the screen.
    const html = home({ queue: queue({ pending: 9, ready: 6, failed: 3 }) })

    expect(words(html)).not.toMatch(/on the table/i)
    expect(said(html)).not.toContain('waiting')
  })
})

describe('the numbers the drawing did not have to survive', () => {
  it('draws five zeros and a sleeping cat when there is nothing at all', () => {
    // Not "nothing is catalogued yet" over a tile that reads nought
    // catalogued: that is the same fact twice, which is what this round took
    // off the screen everywhere else. The cat says it and costs no line.
    const html = home({ counts: { total: 0, fiction: 0, nonfiction: 0, checkedOut: 0 } })

    expect(said(html).length, 'the counts are not all drawn on an empty day').toBe(5)
    expect(html).toMatch(/wf-stats__cat/)
    expect(html, 'the cat is awake on a screen with nothing on it').toMatch(/wf-cat__shut/)
    expect(html, 'a door was offered to a room with nothing in it').not.toContain('wf-door')
  })

  it('stretches him out as soon as there is a book anywhere', () => {
    /*
     * Round eight's distinction, redrawn by #410 and moved by #427 rather than
     * dropped. He used to sit up on a screen with something on it and sleep on
     * an empty one; what separates the two days now is where he is. A book on
     * the table is a screen with a door on it, so it is a screen he lies on,
     * and the scoot that makes room for him is that block's own margin.
     */
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
    // The empty screen has no doors at all, so there is nothing to sleep on
    // and no button for a tail to go behind. He keeps the cell after the last
    // count, still and curled, which is where he has been since round eight.
    const nothing = home({ counts: { total: 0, fiction: 0, nonfiction: 0, checkedOut: 0 } })

    expect(nothing, 'a tail was drawn reaching behind doors that are not there')
      .not.toMatch(/wf-cat__sweep/)
    expect(nothing, 'a bed was made out of buttons that are not drawn')
      .not.toMatch(/wf-doors/)
    expect(nothing, 'the cat left the one screen he still closes').toMatch(/wf-stats__cat/)
  })

  it('gives him a behaviour rather than a still drawing, on the screen he lies on', () => {
    /*
     * #410, and the half of it a rendered tree can answer. That the tail
     * actually moves is a claim about frames, and it is checked by watching
     * frames: `e2e/features/the-cat-is-alive.feature`. What is pinned here is
     * that the drawing asks for a behaviour at all, because a component that
     * quietly stopped passing one would leave that browser scenario the only
     * thing standing between this screen and a still cat.
     */
    const html = home({ carrying: [toCarry()] })

    expect(html, 'the cat on the first screen is doing nothing').toMatch(/wf-cat--dozing/)
    expect(html, 'the cat dozes once and stops').toMatch(/wf-cat--loop/)
  })

  it('offers no way to find a book when there is nothing to find one against', () => {
    // A door to an empty room, on the screen whose whole argument is that
    // everything on it earns its place. The wireframe draws a library of
    // 1,204 and never sees this (#355).
    const empty = { total: 0, fiction: 0, nonfiction: 0, checkedOut: 0 }

    expect(home({ counts: empty })).not.toContain('wf-door--inhand')
    expect(home({ counts: { ...empty, total: 1 } })).toContain('wf-door--inhand')
  })

  it('offers it for a book on the table, with nothing catalogued at all', () => {
    // #122's journey: somebody else photographed this book an hour ago and the
    // way to find that out is to hold it up. A collection can be entirely on
    // the table on its first evening, and that is the evening two people are
    // most likely to photograph one book twice.
    const empty = { total: 0, fiction: 0, nonfiction: 0, checkedOut: 0 }

    expect(home({ counts: empty, queue: queue({ pending: 2 }) })).toContain('wf-door--inhand')
  })

  it('offers it only once the catalogue has answered', () => {
    // The same reason the counts wait: a door drawn against a number that has
    // not arrived is a guess about somebody's collection.
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
    // The count is how many and the door is the invitation, so the count is
    // drawn at nought and the door is not: a walk to a bookcase for nothing is
    // the door-to-an-empty-room fault wearing the other camera's clothes.
    expect(home({ carrying: [] })).not.toContain(CARRY_BOOKS)
    expect(words(home({ carrying: [toCarry()] }))).toContain(CARRY_BOOKS)
  })

  /*
   * #341, and the whole of what this screen says about those books.
   *
   * The issue's complaint is that a book no rule claims appears in no listing,
   * in neither review, in none of these five counts and on no area's card, so
   * the books most in need of a person are the ones the app mentions least. The
   * five counts are the five the owner named and both suites pin that list, so
   * the only thing that can carry this is the row that says what to do about it.
   */
  it('offers a way to the books nothing files, when there are any', () => {
    expect(words(home({ unclaimed: 12 }))).toContain(SAY_WHAT)
    expect(home({ unclaimed: 12 })).toContain('wf-door--saying')
  })

  it('offers it on the day there is one, which is the day it matters most', () => {
    // Twelve is the drawing's number and one is the state a collection reaches
    // on the way to none. A door that only turned up for a crowd would leave
    // the last book unfindable, which is the whole failure this closes.
    expect(words(home({ unclaimed: 1 }))).toContain(SAY_WHAT)
  })

  it('offers nothing of the sort once every book is claimed', () => {
    // The door-to-an-empty-room fault, which is what took the camera card off
    // this screen and is what keeps the carry door off it on a settled day.
    expect(words(home({ unclaimed: 0 }))).not.toContain(SAY_WHAT)
  })

  it('offers nothing of the sort until the read has answered', () => {
    // Null is "nobody answered", not "none". A row inviting somebody to settle a
    // dozen books, drawn because a request did not come back, is a walk to a
    // screen that will say there is nothing to do.
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
    // The card that named three of them went in #361, for saying a third time
    // what the count says. What is left is the count and the door.
    const many = Array.from({ length: 53 }, (_, at) =>
      toCarry({ id: at + 1, title: `Book ${at + 1}` }))
    const html = home({ carrying: many })

    expect(html).toContain('53')
    expect(html, 'the first screen names books again').not.toContain('wf-row')
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
    // Above the counts rather than among them, which is the arrangement #311
    // chose and the headings going does not change: this is news, and the
    // counts are work somebody can walk over and do.
    const html = home({
      queue: queue({ ready: 6 }),
      backup: watched({ state: 'none' }),
    })

    expect(html.indexOf('Nothing has been backed up')).toBeLessThan(html.indexOf('wf-stats'))
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
      const text = words(home({ backup: watched({ state, ageHours: 64 }) }))
      for (const word of ['run', 'range', 'shelf', 'plank', 'separator', 'capture', 'placement', 'cut']) {
        expect(text, `the backup card says "${word}" when ${state}`).not.toMatch(
          new RegExp(`\\b${word}\\b`, 'i'),
        )
      }
    }
  })
})

/**
 * A count is a promise about what you will see (#436).
 *
 * Both of the queue's counts opened the queue on the whole queue. Pressing "31
 * stuck" produced a list headed "All 39", so the number that sent somebody
 * there was contradicted by the first thing they read when they arrived, and
 * the thirty-one had to be found again by hand.
 *
 * Which books each one opens is the only thing checked, because it is the only
 * thing that was wrong: they were already targets and they already went to the
 * right screen.
 */
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

  /* The tab is the one way in that claims nothing, so it is the one way in that
     filters nothing: somebody working through a pile wants the pile. */
  it('opens the whole queue from the tab bar, which counts nothing', () => {
    const opened: (Which | undefined)[] = []
    const screen = tree({ onQueue: (showing?: Which) => opened.push(showing) })
    const tabs = (screen.props as { tabs: Record<string, () => void> }).tabs
    tabs.queue!()
    expect(opened).toEqual([undefined])
  })

  /* The other three are about books that are not in the queue at all, and this
     is here so that a later hand wiring a filter through does not wire one
     through these by accident. */
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
