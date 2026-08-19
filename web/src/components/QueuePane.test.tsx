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
  canShelve, deviceOn, photoCount, QueueRow, readableAgain, SHOWING,
  stateWord, whatItNeeds, type RowGesture, type Which,
} from './QueuePane'
import { shotsOf } from '../lib/queuePhoto'
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

/**
 * One row, drawn as the queue draws it.
 *
 * `reading` is which capture the server says its worker is holding, and the
 * default is that it is holding this one: every assertion below that predates
 * #436 was written about a row whose photographs were actually being read, and
 * the ones that are about a row nobody has reached say so by naming a different
 * id.
 */
function row(over: Partial<Capture> = {}, held = false, reading?: number | null): Row {
  const opened: Capture[] = []
  const undone: number[] = []
  const one = capture(over)
  const tree = QueueRow({
    capture: one,
    held,
    reading: reading === undefined ? one.id : reading,
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

/**
 * Find a control by the word on it rather than by a class.
 *
 * The undo is `Button` out of the design system since #387, and a component
 * carries no class of its own for the walker above to catch. The word is the
 * better hold anyway: what this test is really about is that the way back says
 * "Undo" and takes the discard back when it is pressed.
 */
function pressed(node: unknown, word: string): (Record<string, unknown>) | null {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = pressed(child, word)
      if (found) return found
    }
    return null
  }
  const element = node as ReactElement & { props?: Record<string, unknown> }
  const props = element.props ?? {}
  if (props.children === word && typeof props.onPress === 'function') return props
  return pressed(props.children, word)
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

/**
 * The book, drawn by the component a book's own page draws itself with (#363).
 *
 * > The book display that we have here, we should show the books larger than
 * > what they are now. I would say the same component that we're using to show
 * > the book and the spine of the book whenever you select a book, like the book
 * > detail view, is what we should use here.
 *
 * Called and not copied, which is the half of that sentence a test can hold.
 * What comes back if it is ever copied is a second arrangement of a spine
 * against a front that agrees with this one until one of them is edited, so
 * what is checked is the marker classes `Shots` emits in `mode="book"` rather
 * than anything about how they look.
 */
describe('the book a row draws', () => {
  it('draws it as the book, which is the spine standing against the front', () => {
    const html = renderToStaticMarkup(row().tree)

    expect(html, 'the row draws something other than the book').toContain('wf-shots--book')
    expect(html, 'the row draws the book at the size a whole page gives it')
      .toContain('wf-shots--book-small')
    expect(html, 'the spine is drawn in the shape of a cover').toContain('wf-shot--sliver')
  })

  it('shows both photographs at once, which is what took the switcher off', () => {
    const html = renderToStaticMarkup(row().tree)
    expect(html).toContain('front.jpg')
    expect(html).toContain('edge.jpg')
  })

  /* Each slot on its own. Standing the front in for a spine nobody has
     photographed would draw one photograph twice and claim a spine exists;
     an empty box is how `Shots` says a kind is missing. */
  it('leaves a spine nobody has photographed as the empty shape of one', () => {
    const shots = shotsOf(capture({ edge_image: '', edge_crop: '' }))
    expect(shots.map((shot) => shot.word)).toEqual(['Spine', 'Front'])
    expect(shots[0]?.sliver).toBe(true)
    expect(shots[0]?.photo).toBeUndefined()
    expect(shots[1]?.photo).toBeTruthy()
  })

  /* A book photographed back-first is a real thing in a pile, and the row says
     which photograph it fell back to rather than calling a back a front. */
  it('draws the back where that is the only cover there is, and names it', () => {
    const shots = shotsOf(capture({ front_image: '', front_crop: '' }))
    expect(shots[1]?.word).toBe('Back')
    expect(shots[1]?.photo).toContain('back.jpg')
  })
})

describe('what a row says', () => {
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

  /* Asked of the rendered markup rather than of the tree, since #363: what
     draws a row is `Queued`, so the class is inside a component rather than on
     an element this file's own walker can reach. The fact being pinned has not
     moved, and neither has the word. */
  it('marks that name as a guess, in words and not only in styling', () => {
    const html = renderToStaticMarkup(row({ title_guess: 'S0NG 0F SOLOMQN' }).tree)
    expect(html).toContain('OCR guess')
    expect(html).toContain('wf-queued__name--guess')
  })

  it('leaves a title somebody stated unmarked', () => {
    const stated = { edit_json: JSON.stringify({ title: 'Song of Solomon' }) }
    const html = renderToStaticMarkup(row(stated).tree)
    expect(html).toContain('Song of Solomon')
    expect(html).not.toContain('OCR guess')
    expect(html).not.toContain('wf-queued__name--guess')
  })

  it('offers what the gesture is going to do before the finger lifts', () => {
    expect(renderToStaticMarkup(row().tree)).toContain('Discard')
  })
})

/**
 * #148. "needs you" was the same three words for three different jobs, and
 * Home guessed a fourth thing from the same status. The row and Home now read
 * one helper, so they cannot say different things about the same capture.
 *
 * **These were asked of `statusLine`, which is gone** (#363). It answered one
 * string for two different questions: what state a book is in, and, where the
 * state was `failed`, what is wrong with it. Those are two pills now, so they
 * are two functions, and every case below is the case it always was asked of
 * the one that carries the diagnosis. The four words themselves are untouched.
 */
describe('what a failed row says is wrong', () => {
  const failed = (over: Partial<Capture>) =>
    whatItNeeds(capture({ status: 'failed', ...over }))

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

  /* Nothing at all, rather than a word about ISBNs on a book that has one.
     This pill is only ever drawn where there is something wrong, which is what
     keeps a row that is merely being read from carrying a diagnosis. */
  it('leaves every other status alone', () => {
    for (const status of ['pending', 'ready', 'done'] as CaptureStatus[]) {
      expect(whatItNeeds(capture({ status }))).toBe('')
    }
  })

  /* The other question, which used to share this answer. One word each, and
     they are the words the control above the list filters by, so a book found
     under "Stuck" says "Stuck" on itself. `pending` takes the id of the book
     the worker is holding, which is the one thing the status cannot say; see
     the block below. */
  it('says the state separately, in the words the filter uses', () => {
    expect(stateWord(capture({ id: 3, status: 'pending' }), 3)).toBe('Reading photos')
    expect(stateWord(capture({ status: 'ready' }))).toBe('Identified')
    expect(stateWord(capture({ status: 'done' }))).toBe('Shelved')
    expect(stateWord(capture({ status: 'failed' }))).toBe('Stuck')
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
 * The block above asks `whatItNeeds` four of the same questions, and this one
 * asks the drawn row, deliberately: a helper that gets the words right while
 * the row prints none of them is the exact state taking a summary off could
 * leave behind, and it would pass every test up there.
 *
 * **#363 made it a pill and the cases did not move.** The owner asked for the
 * diagnosis to be a tag rather than a sentence, so what carries these words is
 * `wf-tag--wants` instead of a line of prose. Every case below is asked of the
 * drawn row, which is what makes them indifferent to that: they were pointed at
 * the book rather than at any particular drawing of it, and the last of them
 * still refuses the summary above the list.
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

  /*
   * And it is a pill, which is what #363 asked for and is the shape it is now
   * kept in. Checked as a marked pill rather than as loose text: the way this
   * comes apart is somebody rendering the same four words back into the line of
   * prose they came out of, which every case above would still pass.
   */
  it('carries it on a pill of its own rather than in a sentence', () => {
    const html = said(uncatalogued)
    const pill = html.match(/<span class="wf-tag wf-tag--wants">([^<]+)<\/span>/)

    expect(pill, 'the diagnosis is not on a pill').not.toBeNull()
    expect(pill?.[1], 'the pill does not say which kind of stuck it is')
      .toBe('no catalogue has its ISBN')
  })

  /* One pill, not one per kind: a row wearing "needs an ISBN" beside "no
     catalogue has its ISBN" is the sentence #148 was about, wearing pills. */
  it('draws exactly one of them on a book, and none on a book that is fine', () => {
    expect((said(noIsbn).match(/wf-tag--wants/g) ?? []).length).toBe(1)
    expect(said({ status: 'ready' })).not.toContain('wf-tag--wants')
  })
})

/**
 * What a row says, now that it says it in pills (#363).
 *
 * > The books that we have in the queue, we're putting way too much information
 * > here. "Needs an ISBN" should be like a tag, it should be like a pill there.
 * > "Identified" should be a pill. Instead of "checked by" and then the device,
 * > just have the device there as a pill. And instead of "cover reads" and then
 * > listing it there, we don't need that.
 *
 * Three pills and no prose. The diagnosis has a block of its own above, because
 * it is #148 and it is the one anybody acts on; these are the other two and the
 * two things that went.
 */
describe('the pills on a row', () => {
  const said = (over: Partial<Capture>) => renderToStaticMarkup(row(over).tree)

  it('wears the state as a pill rather than as a line under the title', () => {
    expect(said({ status: 'ready' })).toContain('<span class="wf-tag">Identified</span>')
    expect(said({ status: 'pending' })).toContain('Reading photos')
  })

  /* Somebody has this book on their phone. The name and nothing wrapped round
     it: it was "· with device-8f21 · checked by device-8f21", which is two
     clauses of prose for one fact. */
  it('names the device that has it, with no words round the name', () => {
    const html = said({ claimed_by: 'device-8f21' })
    expect(html).toContain('<span class="wf-tag">device-8f21</span>')
    expect(html).not.toContain('with device-8f21')
    expect(html).not.toContain('checked by')
    expect(html).not.toContain('worked on')
  })

  /* The claim first, because a claim is somebody working on this book now and
     an edit is somebody who was. One pill either way. */
  it('falls back to whoever last worked on it, and never draws two', () => {
    expect(deviceOn(capture({ claimed_by: 'device-a', edited_by: 'device-b' })))
      .toBe('device-a')
    expect(deviceOn(capture({ edited_by: 'device-b' }))).toBe('device-b')
    expect(deviceOn(capture())).toBe('')
    expect((said({ claimed_by: 'device-a', edited_by: 'device-b' })
      .match(/class="wf-tag"/g) ?? []).length).toBe(2)
  })

  it('says nothing about a device nobody has touched', () => {
    expect((said({}).match(/class="wf-tag"/g) ?? []).length).toBe(1)
  })

  /* Asked for outright: "instead of 'cover reads' and then listing it there,
     we don't need that". It was the longest thing on the row and it was a
     machine's reading of a photograph, printed under a name taken from the
     same reading. */
  it('never prints what OCR read off the cover', () => {
    const html = said({ cover_text: 'ORWELL\nNINETEEN EIGHTY-FOUR\nPENGUIN' })
    expect(html).not.toContain('Cover reads')
    expect(html).not.toContain('NINETEEN EIGHTY-FOUR')
  })

  /* The worker's note said which photograph and which digits, which is a
     paragraph on a row. It is not lost: opening the book is what shows it. */
  it('leaves the note the reader wrote to the screen behind the row', () => {
    const html = said({
      status: 'failed',
      isbn13: '9781234567897',
      note: 'Barcode on the back reads 9781234567897, but no catalogue has it.',
    })
    expect(html).toContain('no catalogue has its ISBN')
    expect(html).not.toContain('Barcode on the back reads')
  })
})

/**
 * The controls above the books, which #349 made one control and one row, and
 * #363 took a circle off.
 *
 * > We shouldn't do the spine versus cover selector there, and the way that we
 * > have it. We should do it the same way we did on the library page, where we
 * > just have the icon next to the search system that switches between spine or
 * > cover.
 *
 * That switcher chose between the front and the spine because a row drew one
 * small photograph of a book and somebody had to say which. A row draws the
 * book now, spine standing against the front, so both of its answers produce
 * one picture. **The row it sat on did not go anywhere**, which is the part
 * worth pinning: it is still `Filter`, still the library's, still led by this
 * screen's search box. What went is a circle whose two presses drew the same
 * books, and `Finding.tsx` carries the argument.
 *
 * The shape is checked on this screen's source, because the pane cannot be
 * rendered here (it asks the server the moment it mounts) and because what
 * actually comes back is a helpful edit reaching for `Segmented` again when a
 * third photograph turns up.
 */
describe('the controls above the books', () => {
  it('wears the row the library wears, led by its own search box', () => {
    expect(PANE, 'the queue draws a row of its own again').toMatch(/<Filter\b/)
    expect(PANE).toMatch(/from '\.\.\/design\/Finding'/)
    /* The box itself is the design system's since #387, which is the same
       `SearchField` the gallery leads this row with. A box built here again is
       a second field that agrees with the drawing until one is edited. */
    expect(PANE, 'the row lost the box that narrows the list').toMatch(/<SearchField\b/)
    expect(PANE, 'the queue built its own search box again')
      .not.toMatch(/queue__search-input/)
  })

  it('keeps one segmented control, and it is the one that chooses which books', () => {
    expect((PANE.match(/<Segmented\b/g) ?? []).length).toBe(1)
    expect(PANE).toMatch(/label="Which ones"/)
  })

  /* The way this comes back is somebody restoring a preference for which
     photograph a row draws, which is a control with one outcome. The row draws
     both photographs; there is nothing left to ask. */
  it('asks nobody which photograph to draw, because it draws them all', () => {
    expect(PANE, 'the photograph switcher is back').not.toMatch(/onLook|QUEUE_LOOKS/)
    expect(PANE, 'something is remembering a choice of photograph again')
      .not.toMatch(/rememberPhoto|rememberedPhoto/)
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
    const undo = pressed(tree, 'Undo')
    ;(undo?.onPress as (() => void) | undefined)?.()
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

/**
 * A book being read, and a book waiting to be (#436).
 *
 * Eight captures said "Reading photos" for five minutes with nothing reading
 * any of them, because `pending` was one word over two situations and the
 * screen had no way to tell them apart. It has one now, and it is not a column:
 * the server says which capture its worker is holding, for the seconds one
 * reading takes.
 *
 * **The waiting word is not a failure and must never read like one.** A capture
 * that could not be read already has its own word, its own diagnosis pill and
 * its own retry (#299, #339). A capture nobody has reached yet is a different
 * fact about a book whose photographs are perfectly fine, and dressing it as
 * the first would send somebody to fetch a book that never needed them.
 */
describe('a book being read and a book waiting to be', () => {
  const waiting = capture({ id: 7, status: 'pending' })

  it('says a book is being read only when the worker is holding it', () => {
    expect(stateWord(waiting, 7)).toBe('Reading photos')
  })

  it('says a book behind it is waiting rather than being read', () => {
    expect(stateWord(waiting, 4)).toBe('Waiting to be read')
  })

  /* The whole queue at once, which is what a stopped queue looks like: nothing
     at the front of it claiming to be read. That is the state five minutes of
     "Reading photos" was hiding. */
  it('says every book is waiting when nothing is being read at all', () => {
    expect(stateWord(waiting, null)).toBe('Waiting to be read')
    expect(stateWord(waiting)).toBe('Waiting to be read')
  })

  /* It says nothing about the other three: whether the worker is holding a
     book is only a question about a book it could be holding. */
  it('changes nothing about a book that is not waiting for the reader', () => {
    for (const status of ['ready', 'failed', 'done'] as CaptureStatus[]) {
      expect(stateWord(capture({ id: 7, status }), null))
        .toBe(stateWord(capture({ id: 7, status }), 7))
    }
  })

  it('draws the two words on the row rather than only in the helper', () => {
    expect(renderToStaticMarkup(row({ status: 'pending' }).tree))
      .toContain('Reading photos')
    expect(renderToStaticMarkup(row({ status: 'pending' }, false, null).tree))
      .toContain('Waiting to be read')
  })

  /* Not a diagnosis, and this is the line that keeps it from becoming one. A
     waiting book carries no "wants" pill, so nothing on it tells anybody to go
     and find the book. */
  it('never dresses a waiting book as one that could not be read', () => {
    const html = renderToStaticMarkup(row({ status: 'pending' }, false, null).tree)
    expect(html).not.toContain('Stuck')
    expect(html).not.toContain('needs an ISBN')
    expect(html).not.toContain('could not be read')
    expect(whatItNeeds({ ...waiting })).toBe('')
  })
})

/**
 * Where the screen opens, which is whatever sent somebody to it (#436).
 *
 * "31 stuck" on the first screen opened this one on "All 39". The right screen,
 * showing the wrong thing, and **a count is a promise about what you will see**.
 * The pane takes the answer as the state it opens on rather than as a filter it
 * is held to, so the control above the list still works normally afterwards.
 */
describe('which books the queue opens on', () => {
  it('opens on the whole queue when nothing said otherwise', () => {
    expect(PANE).toMatch(/useState<Which>\(showing \?\? 'all'\)/)
  })

  /* Pinned on the source for the reason the block above the search box is: the
     pane asks the server the moment it mounts, so it cannot be rendered here.
     What would break this is somebody making `showing` a prop the filter is
     held to, which would leave a person who came in on "Stuck" unable to see
     the rest of their queue. */
  it('lets the control above the list take it from there', () => {
    expect(PANE).toMatch(/onPick=\{setWhich\}/)
    expect(PANE, 'the filter is held to what opened the screen')
      .not.toMatch(/SHOWING\[showing/)
  })
})
