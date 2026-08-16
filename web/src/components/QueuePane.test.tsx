/**
 * What a queue row does when it is tapped.
 *
 * The row is the control now, which is the point of #120 and also its sharpest
 * edge: the whole of a book's line is a target, so the cases where a tap must
 * do nothing have to be held down by a test rather than by a `disabled`
 * attribute, since the row deliberately does not use one (the swipe is made of
 * the pointer events a disabled button swallows).
 *
 * Rendered as a tree and walked rather than driven in a browser: this project
 * has no DOM in its test setup, and `QueueRow` holds no state precisely so it
 * stays callable as the plain function it is, the same way `MisfileNotice`
 * does in `BookDetail.test.tsx`.
 */

import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ReactElement } from 'react'
import {
  canShelve, lookOf, photoCount, photoOf, QueueRow, readableAgain, SHOWING,
  statusLine, type RowGesture, type Which,
} from './QueuePane'
import { QUEUE_PHOTOS } from '../lib/queuePhoto'
import type { Capture, CaptureStatus } from '../lib/api'

/** This screen's own source, for the two rules that are about what is not on it. */
const PANE = readFileSync(
  new URL('./QueuePane.tsx', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  'utf8',
)

const gesture: RowGesture = {
  onPointerDown: () => {},
  onPointerMove: () => {},
  onPointerUp: () => {},
  onPointerCancel: () => {},
}

function capture(over: Partial<Capture> = {}): Capture {
  return {
    id: 3,
    status: 'ready',
    front_image: 'front.jpg',
    back_image: 'back.jpg',
    edge_image: 'edge.jpg',
    isbn13: '',
    isbn10: '',
    isbn_source: '',
    title_guess: 'Dune',
    cover_text: '',
    analysed: '',
    draft_json: '',
    edit_json: '',
    edited_by: '',
    edited_at: null,
    note: '',
    claimed_by: '',
    claimed_at: null,
    book_id: null,
    created_at: '',
    processed_at: null,
    front_crop: '',
    back_crop: '',
    edge_crop: '',
    cropped: '',
    ...over,
  }
}

interface Row {
  opened: Capture[]
  undone: number[]
  tree: ReactElement
}

function row(over: Partial<Capture> = {}, held = false): Row {
  const opened: Capture[] = []
  const undone: number[] = []
  const tree = QueueRow({
    capture: capture(over),
    photo: 'front',
    me: 'device-aaaa',
    held,
    onOpen: (c) => opened.push(c),
    onUndo: (id) => undone.push(id),
    gesture,
    registerRow: () => {},
  })
  return { opened, undone, tree: tree as ReactElement }
}

/** Find an element in an unrendered tree by class name. */
function find(
  node: unknown,
  className: string,
): (Record<string, unknown>) | null {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find(child, className)
      if (found) return found
    }
    return null
  }
  const element = node as ReactElement & { props?: Record<string, unknown> }
  const props = element.props ?? {}
  if (String(props.className ?? '').split(' ').includes(className)) return props
  return find(props.children, className)
}

describe('canShelve', () => {
  it('says no while the photographs are still being read', () => {
    expect(canShelve(capture({ status: 'pending' }))).toBe(false)
  })

  it('says yes for everything the person can actually act on', () => {
    for (const status of ['ready', 'failed', 'done'] as CaptureStatus[]) {
      expect(canShelve(capture({ status }))).toBe(true)
    }
  })
})

describe('tapping a row', () => {
  it('starts shelving the book that was tapped', () => {
    const { opened, tree } = row()
    const open = find(tree, 'queue__open')
    ;(open?.onClick as (() => void) | undefined)?.()
    expect(opened.map((c) => c.id)).toEqual([3])
  })

  /*
   * The case the issue calls out. A pending capture has nothing to confirm,
   * correct or place, and the row used to be protected by the "Shelve" button
   * being disabled. The button is gone, so this is the protection.
   */
  it('starts nothing on a book that is still being read', () => {
    const { opened, tree } = row({ status: 'pending' })
    const open = find(tree, 'queue__open')
    ;(open?.onClick as (() => void) | undefined)?.()
    expect(opened).toEqual([])
  })

  it('says a pending row is not available, without swallowing its pointers', () => {
    const open = find(row({ status: 'pending' }).tree, 'queue__open')
    // Marked up as unavailable, but not `disabled`: a disabled button receives
    // no pointer events, and those are what the swipe is made of. A capture
    // whose photographs came out unusable is exactly one somebody wants rid of
    // before the worker has finished with it.
    expect(open?.['aria-disabled']).toBe(true)
    expect(open?.disabled).toBeUndefined()
  })

  it('leaves a resolved row plainly available', () => {
    expect(find(row().tree, 'queue__open')?.['aria-disabled']).toBe(false)
  })
})

describe('what a row says', () => {
  it('draws the front photograph, not the spine', () => {
    const html = renderToStaticMarkup(row().tree)
    expect(html).toContain('front.jpg')
    expect(html).not.toContain('edge.jpg')
  })

  it('draws the spine when that is what was asked for', () => {
    const tree = QueueRow({
      capture: capture(),
      photo: 'spine',
      me: 'device-aaaa',
      held: false,
      onOpen: () => {},
      onUndo: () => {},
      gesture,
      registerRow: () => {},
    })
    const html = renderToStaticMarkup(tree as ReactElement)
    expect(html).toContain('edge.jpg')
    expect(html).not.toContain('front.jpg')
  })

  /* A capture is not a book: no catalogue id, and no title until a lookup
     resolves. The number it was given at the camera has to stand in. */
  it('names a book with no title by its capture number', () => {
    const html = renderToStaticMarkup(row({ title_guess: '' }).tree)
    expect(html).toContain('Book #3')
  })

  /*
   * #156, both halves of it. The row still has to say which book it is, or a
   * stack of unresolved captures is unworkable; and the name it uses to do
   * that is a machine's reading of a photograph, so it cannot be drawn as
   * though somebody had confirmed it.
   */
  it('still names a capture whose only title is what OCR read', () => {
    const html = renderToStaticMarkup(row({ title_guess: 'S0NG 0F SOLOMQN' }).tree)
    expect(html).toContain('S0NG 0F SOLOMQN')
    expect(html).not.toContain('Book #3')
  })

  it('marks that name as a guess, in words and not only in styling', () => {
    const html = renderToStaticMarkup(row({ title_guess: 'S0NG 0F SOLOMQN' }).tree)
    expect(html).toContain('OCR guess')
    expect(find(row({ title_guess: 'S0NG 0F SOLOMQN' }).tree, 'queue__title')?.className)
      .toContain('queue__title--guess')
  })

  it('leaves a title somebody stated unmarked', () => {
    const stated = { edit_json: JSON.stringify({ title: 'Song of Solomon' }) }
    const html = renderToStaticMarkup(row(stated).tree)
    expect(html).toContain('Song of Solomon')
    expect(html).not.toContain('OCR guess')
    expect(find(row(stated).tree, 'queue__title')?.className)
      .not.toContain('queue__title--guess')
  })

  it('offers what the gesture is going to do before the finger lifts', () => {
    expect(renderToStaticMarkup(row().tree)).toContain('Discard')
  })
})

/**
 * #148. "needs you" was the same three words for three different jobs, and
 * Home guessed a fourth thing from the same status. The row and Home now read
 * one helper, so they cannot say different things about the same capture.
 */
describe('what a failed row says is wrong', () => {
  const failed = (over: Partial<Capture>) =>
    statusLine(capture({ status: 'failed', ...over }))

  it('asks for an ISBN only when there is no ISBN', () => {
    expect(failed({ note: 'No ISBN could be read from these photos.' }))
      .toBe('needs an ISBN')
  })

  it('says the catalogue is the problem when the ISBN itself read fine', () => {
    expect(failed({
      isbn13: '9781234567897',
      note: 'Barcode on the back reads 9781234567897, but no catalogue has it.',
    })).toBe('no catalogue has its ISBN')
  })

  it('says the read broke when it broke', () => {
    expect(failed({ note: 'Could not process these photos: out of memory' }))
      .toBe('could not be read')
  })

  /* Not "could not be read", which is the line above and would be a lie here:
     nothing read this book's photographs, so nothing found them wanting. */
  it('says the reader stopped rather than blaming the photographs', () => {
    expect(failed({
      note: 'Reading these photos timed out: the back was given up on after 60 seconds.',
    })).toBe('reading it took too long')
  })

  it('leaves every other status alone', () => {
    expect(statusLine(capture({ status: 'pending' }))).toBe('reading photos')
    expect(statusLine(capture({ status: 'ready' }))).toBe('identified')
    expect(statusLine(capture({ status: 'done' }))).toBe('shelved')
  })

  it('draws it on the row rather than only in the helper', () => {
    const html = renderToStaticMarkup(row({
      status: 'failed',
      isbn13: '9781234567897',
      note: 'Barcode on the back reads 9781234567897, but no catalogue has it.',
    }).tree)
    expect(html).toContain('no catalogue has its ISBN')
    expect(html).not.toContain('needs you')
  })
})

/**
 * #148's other half, which is the half this screen owns.
 *
 * The rule the issue left behind is that **the count belongs on the first
 * screen and the diagnosis belongs on the queue**, because "9 need an ISBN by
 * hand" sent somebody to retype five ISBNs that were already correct.
 *
 * Every test below was written against a card above the list that said it once
 * for the pile. #349 took that card off, and the owner said why: "we don't need
 * that section that says how many are stuck, they already know, it's in the top
 * right underneath the stuck." The count is his already, twice over; what he
 * has nowhere else is which of these books is which. **So none of these went
 * with the card. Each one is the case it always was, asked of the row that
 * carries the diagnosis now**, and the last of them is the removal itself.
 *
 * The block above asks `statusLine` four of the same questions, and this one
 * asks the drawn row, deliberately: a helper that gets the words right while
 * the row prints none of them is the exact state taking a summary off could
 * leave behind, and it would pass every test up there.
 */
describe('what the queue says a stuck book needs', () => {
  const noIsbn = { status: 'failed', note: 'No ISBN could be read from these photos.' } as const
  const uncatalogued = {
    status: 'failed',
    isbn13: '9781234567897',
    note: 'Barcode on the back reads 9781234567897, but no catalogue has it.',
  } as const
  const errored = {
    status: 'failed', note: 'Could not process these photos: out of memory',
  } as const
  const timedOut = {
    status: 'failed',
    note: 'Reading these photos timed out: the back was given up on after 60 seconds.',
  } as const

  /** The book, as somebody standing over the table reads it. */
  const said = (over: Partial<Capture>) => renderToStaticMarkup(row(over).tree)

  it('asks for an ISBN by hand only on a book with no ISBN', () => {
    expect(said(noIsbn)).toContain('needs an ISBN')
  })

  /* The exact case #148 was reported for. This book's ISBN is present and
     correct, so anything telling anybody to type one in is the defect. */
  it('sends nobody to retype an ISBN that read perfectly well', () => {
    const html = said(uncatalogued)
    expect(html).toContain('no catalogue has its ISBN')
    expect(html).not.toContain('needs an ISBN')
    expect(html).not.toContain('need an ISBN by hand')
  })

  it('says a read that broke is a read that broke', () => {
    expect(said(errored)).toContain('could not be read')
  })

  /* #299. The same mistake #148 was about, from the other end: this book's
     photographs were never looked at, so telling somebody to handle it would be
     sending them to a book that may need nothing. */
  it('does not blame the photographs of a book nothing read', () => {
    const html = said(timedOut)
    expect(html).toContain('reading it took too long')
    expect(html).not.toContain('could not be read')
  })

  /* Four books, four different jobs, and the screen has to separate them rather
     than saying one thing about all of them the way the status alone would. */
  it('keeps the four apart when all four are on the table', () => {
    const table = [
      [noIsbn, 'needs an ISBN'],
      [uncatalogued, 'no catalogue has its ISBN'],
      [errored, 'could not be read'],
      [timedOut, 'reading it took too long'],
    ] as const

    const drawn = table.map(([one]) => said(one))

    table.forEach(([, line], at) => {
      expect(drawn[at], `a stuck book never says "${line}"`).toContain(line)
      drawn.forEach((html, other) => {
        if (other !== at) expect(html, `two of the four say "${line}"`).not.toContain(line)
      })
    })
  })

  /* This was "counts the ones that need the same thing together", which is what
     a summary did with two books wanting one job. The books do it themselves
     now, and the point of the case is unchanged: two of them, each saying it. */
  it('says it on every book that needs it rather than once for the pile', () => {
    expect(said(noIsbn)).toContain('needs an ISBN')

    const second = said({ ...noIsbn, id: 4, title_guess: 'Piranesi' })
    expect(second).toContain('needs an ISBN')
    expect(second).toContain('Piranesi')
  })

  /* Nothing at all, rather than "0 need an ISBN by hand": a book with nothing
     wrong with it must not carry a word about ISBNs, and a zero anywhere on
     this screen is the kind of number that gets acted on. */
  it('says nothing of the sort on a book with nothing wrong with it', () => {
    for (const status of ['ready', 'pending', 'done'] as CaptureStatus[]) {
      const html = said({ status })
      expect(html, `a ${status} book is told it needs something`)
        .not.toContain('needs an ISBN')
      expect(html).not.toContain('ISBN by hand')
      expect(html).not.toContain('could not be read')
    }
  })

  /*
   * This was "says nothing about an empty queue", which was the summary
   * declining to draw itself. There is no summary to decline now, so the case
   * is the removal: the way it comes back is somebody putting a helpful count
   * back over the list, one card at a time, which is a thing no rendered row
   * can notice. Pinned on the screen's own source, the way `design.test.tsx`
   * pins the drawings that must not return.
   */
  it('says it on the books and never in a summary above them', () => {
    expect(PANE, 'the summary above the list is back').not.toMatch(/need a hand/)
    expect(PANE, 'something is wording a summary again')
      .not.toMatch(/whatTheyNeed|failureLines/)
  })
})

/**
 * The two controls above the books, which #349 made one control and one row.
 *
 * > We shouldn't do the spine versus cover selector there, and the way that we
 * > have it. We should do it the same way we did on the library page, where we
 * > just have the icon next to the search system that switches between spine or
 * > cover.
 *
 * There were two segmented controls on this screen and the one that survives is
 * the one that chooses which books you are looking at. Which photograph they are
 * drawn by is the library's round button at the end of the library's row, which
 * is the same component and not a copy of it: a second switcher spelling out its
 * own two words for the same two pictures is what the pinned rule about two
 * things sharing a name is there to stop.
 *
 * The shape is checked on this screen's source, because the pane cannot be
 * rendered here (it reads storage and asks the server the moment it mounts) and
 * because what actually comes back is a helpful edit reaching for `Segmented`
 * again when a third photograph turns up.
 */
describe('the controls above the books', () => {
  it('switches the photograph with the row the library uses', () => {
    expect(PANE, 'the queue draws a switcher of its own again').toMatch(/<Filter\b/)
    expect(PANE).toMatch(/from '\.\.\/design\/Finding'/)
  })

  it('keeps one segmented control, and it is the one that chooses which books', () => {
    expect((PANE.match(/<Segmented\b/g) ?? []).length).toBe(1)
    expect(PANE).toMatch(/label="Which ones"/)
  })

  it('offers the two photographs a queued book has and no third', () => {
    // A capture has a front and a spine worth recognising a book by, so the
    // button steps between two of the library's three ways of looking. Both
    // directions, because a mapping that lost one would leave one press of a
    // two-press cycle doing nothing at all.
    expect(lookOf('front')).toBe('covers')
    expect(lookOf('spine')).toBe('spines')
    for (const photo of QUEUE_PHOTOS) expect(photoOf(lookOf(photo))).toBe(photo)
  })
})

/**
 * The control across the top, which claims four things about a stack of books.
 *
 * Every claim is a filter somebody acts on: tapping "Stuck 2" and being shown a
 * book that is merely still being read is the same class of mistake as the
 * wording above, one screen further on. So each word is checked against the
 * statuses it says it holds, and the three besides "all" are checked for not
 * overlapping, because the counts beside them are drawn from these and are
 * meant to add up.
 */
describe('what each answer on the filter shows', () => {
  const all: Capture[] = [
    capture({ id: 1, status: 'ready' }),
    capture({ id: 2, status: 'pending' }),
    capture({ id: 3, status: 'failed' }),
    capture({ id: 4, status: 'done' }),
  ]

  const ids = (which: Which) => all.filter(SHOWING[which]).map((one) => one.id)

  it('shows every book under "all"', () => {
    expect(ids('all')).toEqual([1, 2, 3, 4])
  })

  /* A shelved book's row has not gone yet and there is nothing wrong with it,
     so it sits with the ones somebody can act on rather than under "stuck". */
  it('shows the ones somebody can act on under "ready"', () => {
    expect(ids('ready')).toEqual([1, 4])
  })

  it('shows only the ones still being read under "reading"', () => {
    expect(ids('processing')).toEqual([2])
  })

  it('shows only the ones that failed under "stuck"', () => {
    expect(ids('stuck')).toEqual([3])
  })

  /* The counts beside the words are these three, and the top bar's is the
     whole queue, so a status falling under two of them or under none would put
     a number on screen that does not add up to the one above it. */
  it('puts every book under exactly one of the three', () => {
    for (const one of all) {
      const under = (['ready', 'processing', 'stuck'] as Which[])
        .filter((which) => SHOWING[which](one))
      expect(under, `a ${one.status} book is under ${under.join(' and ')}`)
        .toHaveLength(1)
    }
  })
})

describe('a discard that has not happened yet', () => {
  it('stays on screen with a way back, rather than vanishing', () => {
    const html = renderToStaticMarkup(row({}, true).tree)
    expect(html).toContain('Undo')
    // Said out loud, because the whole guarantee is that the swipe has not
    // destroyed anything yet.
    expect(html).toContain('Nothing has been deleted yet')
  })

  it('says how much would go, in photographs', () => {
    expect(photoCount(capture())).toBe(3)
    expect(renderToStaticMarkup(row({}, true).tree)).toContain('3 photos')
  })

  it('takes the discard back when the way back is taken', () => {
    const { undone, tree } = row({}, true)
    const undo = find(tree, 'queue__undo-btn')
    ;(undo?.onClick as (() => void) | undefined)?.()
    expect(undone).toEqual([3])
  })

  /* Nothing on a held row starts shelving: the row is on its way out, and a
     stray tap on it should not open a book that is about to be deleted. */
  it('offers no way to open a book that is on its way out', () => {
    const { tree } = row({}, true)
    expect(find(tree, 'queue__open')).toBeNull()
  })
})

/**
 * Which stuck books the queue offers to read again (#299).
 *
 * The control this decides is the only way back from a reader that stopped
 * without going and finding the books. Offering it too widely is worse than
 * not offering it: a second reading of a book whose ISBN read perfectly well
 * and which no catalogue has produces the very same answer, so the button
 * would be one somebody presses and waits on for nothing.
 */
describe('which stuck books are worth reading again', () => {
  const timedOut = capture({
    id: 1,
    status: 'failed',
    note: 'Reading these photos timed out: the back was given up on after 60 seconds.',
  })
  const errored = capture({
    id: 2, status: 'failed', note: 'Could not process these photos: out of memory',
  })
  const noIsbn = capture({
    id: 3, status: 'failed', note: 'No ISBN could be read from these photos.',
  })
  const uncatalogued = capture({
    id: 4,
    status: 'failed',
    isbn13: '9781234567897',
    note: 'Barcode on the back reads 9781234567897, but no catalogue has it.',
  })

  it('offers the ones nothing ever read', () => {
    expect(readableAgain([timedOut, errored]).map((c) => c.id)).toEqual([1, 2])
  })

  it('leaves out the ones that want a person and a book in their hands', () => {
    expect(readableAgain([noIsbn, uncatalogued])).toEqual([])
  })

  it('picks the readable ones out of a queue holding all four', () => {
    expect(readableAgain([noIsbn, timedOut, uncatalogued, errored]).map((c) => c.id))
      .toEqual([1, 2])
  })

  it('leaves out the ones nothing is wrong with', () => {
    expect(readableAgain([
      capture({ id: 5, status: 'ready' }),
      capture({ id: 6, status: 'pending' }),
      capture({ id: 7, status: 'done' }),
    ])).toEqual([])
  })
})
