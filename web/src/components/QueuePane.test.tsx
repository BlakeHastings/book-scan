/** Rendered as a tree and walked rather than driven in a browser: this project has no DOM in its test setup. */

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

/** `reading` defaults to this capture's own id, so the row is "being read" unless overridden. */
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

/** Finds a button by its visible word rather than a class, since `Button` carries no class of its own. */
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

  it('starts nothing on a book that is still being read', () => {
    const { opened, tree } = row({ status: 'pending' })
    const open = find(tree, 'queue__open')
    ;(open?.onClick as (() => void) | undefined)?.()
    expect(opened).toEqual([])
  })

  it('says a pending row is not available, without swallowing its pointers', () => {
    const open = find(row({ status: 'pending' }).tree, 'queue__open')
    // `disabled` would swallow the pointer events the swipe needs;
    // `aria-disabled` does not.
    expect(open?.['aria-disabled']).toBe(true)
    expect(open?.disabled).toBeUndefined()
  })

  it('leaves a resolved row plainly available', () => {
    expect(find(row().tree, 'queue__open')?.['aria-disabled']).toBe(false)
  })
})

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

  it('leaves a spine nobody has photographed as the empty shape of one', () => {
    const shots = shotsOf(capture({ edge_image: '', edge_crop: '' }))
    expect(shots.map((shot) => shot.word)).toEqual(['Spine', 'Front'])
    expect(shots[0]?.sliver).toBe(true)
    expect(shots[0]?.photo).toBeUndefined()
    expect(shots[1]?.photo).toBeTruthy()
  })

  it('draws the back where that is the only cover there is, and names it', () => {
    const shots = shotsOf(capture({ front_image: '', front_crop: '' }))
    expect(shots[1]?.word).toBe('Back')
    expect(shots[1]?.photo).toContain('back.jpg')
  })
})

describe('what a row says', () => {
  it('names a book with no title by its capture number', () => {
    const html = renderToStaticMarkup(row({ title_guess: '' }).tree)
    expect(html).toContain('Book #3')
  })

  it('still names a capture whose only title is what OCR read', () => {
    const html = renderToStaticMarkup(row({ title_guess: 'S0NG 0F SOLOMQN' }).tree)
    expect(html).toContain('S0NG 0F SOLOMQN')
    expect(html).not.toContain('Book #3')
  })

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

  it('says the reader stopped rather than blaming the photographs', () => {
    expect(failed({
      note: 'Reading these photos timed out: the back was given up on after 60 seconds.',
    })).toBe('reading it took too long')
  })

  it('leaves every other status alone', () => {
    for (const status of ['pending', 'ready', 'done'] as CaptureStatus[]) {
      expect(whatItNeeds(capture({ status }))).toBe('')
    }
  })

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

  it('sends nobody to retype an ISBN that read perfectly well', () => {
    const html = said(uncatalogued)
    expect(html).toContain('no catalogue has its ISBN')
    expect(html).not.toContain('needs an ISBN')
    expect(html).not.toContain('need an ISBN by hand')
  })

  it('says a read that broke is a read that broke', () => {
    expect(said(errored)).toContain('could not be read')
  })

  it('does not blame the photographs of a book nothing read', () => {
    const html = said(timedOut)
    expect(html).toContain('reading it took too long')
    expect(html).not.toContain('could not be read')
  })

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

  it('says it on every book that needs it rather than once for the pile', () => {
    expect(said(noIsbn)).toContain('needs an ISBN')

    const second = said({ ...noIsbn, id: 4, title_guess: 'Piranesi' })
    expect(second).toContain('needs an ISBN')
    expect(second).toContain('Piranesi')
  })

  it('says nothing of the sort on a book with nothing wrong with it', () => {
    for (const status of ['ready', 'pending', 'done'] as CaptureStatus[]) {
      const html = said({ status })
      expect(html, `a ${status} book is told it needs something`)
        .not.toContain('needs an ISBN')
      expect(html).not.toContain('ISBN by hand')
      expect(html).not.toContain('could not be read')
    }
  })

  // Checked against the screen's own source: there is no summary component
  // left to render and assert against.
  it('says it on the books and never in a summary above them', () => {
    expect(PANE, 'the summary above the list is back').not.toMatch(/need a hand/)
    expect(PANE, 'something is wording a summary again')
      .not.toMatch(/whatTheyNeed|failureLines/)
  })

  it('carries it on a pill of its own rather than in a sentence', () => {
    const html = said(uncatalogued)
    const pill = html.match(/<span class="wf-tag wf-tag--wants">([^<]+)<\/span>/)

    expect(pill, 'the diagnosis is not on a pill').not.toBeNull()
    expect(pill?.[1], 'the pill does not say which kind of stuck it is')
      .toBe('no catalogue has its ISBN')
  })

  it('draws exactly one of them on a book, and none on a book that is fine', () => {
    expect((said(noIsbn).match(/wf-tag--wants/g) ?? []).length).toBe(1)
    expect(said({ status: 'ready' })).not.toContain('wf-tag--wants')
  })
})

describe('the pills on a row', () => {
  const said = (over: Partial<Capture>) => renderToStaticMarkup(row(over).tree)

  it('wears the state as a pill rather than as a line under the title', () => {
    expect(said({ status: 'ready' })).toContain('<span class="wf-tag">Identified</span>')
    expect(said({ status: 'pending' })).toContain('Reading photos')
  })

  it('names the device that has it, with no words round the name', () => {
    const html = said({ claimed_by: 'device-8f21' })
    expect(html).toContain('<span class="wf-tag">device-8f21</span>')
    expect(html).not.toContain('with device-8f21')
    expect(html).not.toContain('checked by')
    expect(html).not.toContain('worked on')
  })

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

  it('never prints what OCR read off the cover', () => {
    const html = said({ cover_text: 'ORWELL\nNINETEEN EIGHTY-FOUR\nPENGUIN' })
    expect(html).not.toContain('Cover reads')
    expect(html).not.toContain('NINETEEN EIGHTY-FOUR')
  })

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

// Checked against the screen's own source rather than by rendering, since
// the pane asks the server the moment it mounts.
describe('the controls above the books', () => {
  it('wears the row the library wears, led by its own search box', () => {
    expect(PANE, 'the queue draws a row of its own again').toMatch(/<Filter\b/)
    expect(PANE).toMatch(/from '\.\.\/design\/Finding'/)
    expect(PANE, 'the row lost the box that narrows the list').toMatch(/<SearchField\b/)
    expect(PANE, 'the queue built its own search box again')
      .not.toMatch(/queue__search-input/)
  })

  it('keeps one segmented control, and it is the one that chooses which books', () => {
    expect((PANE.match(/<Segmented\b/g) ?? []).length).toBe(1)
    expect(PANE).toMatch(/label="Which ones"/)
  })

  it('asks nobody which photograph to draw, because it draws them all', () => {
    expect(PANE, 'the photograph switcher is back').not.toMatch(/onLook|QUEUE_LOOKS/)
    expect(PANE, 'something is remembering a choice of photograph again')
      .not.toMatch(/rememberPhoto|rememberedPhoto/)
  })
})

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

  it('shows the ones somebody can act on under "ready"', () => {
    expect(ids('ready')).toEqual([1, 4])
  })

  it('shows only the ones still being read under "reading"', () => {
    expect(ids('processing')).toEqual([2])
  })

  it('shows only the ones that failed under "stuck"', () => {
    expect(ids('stuck')).toEqual([3])
  })

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

  it('offers no way to open a book that is on its way out', () => {
    const { tree } = row({}, true)
    expect(find(tree, 'queue__open')).toBeNull()
  })
})

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

describe('a book being read and a book waiting to be', () => {
  const waiting = capture({ id: 7, status: 'pending' })

  it('says a book is being read only when the worker is holding it', () => {
    expect(stateWord(waiting, 7)).toBe('Reading photos')
  })

  it('says a book behind it is waiting rather than being read', () => {
    expect(stateWord(waiting, 4)).toBe('Waiting to be read')
  })

  it('says every book is waiting when nothing is being read at all', () => {
    expect(stateWord(waiting, null)).toBe('Waiting to be read')
    expect(stateWord(waiting)).toBe('Waiting to be read')
  })

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

  it('never dresses a waiting book as one that could not be read', () => {
    const html = renderToStaticMarkup(row({ status: 'pending' }, false, null).tree)
    expect(html).not.toContain('Stuck')
    expect(html).not.toContain('needs an ISBN')
    expect(html).not.toContain('could not be read')
    expect(whatItNeeds({ ...waiting })).toBe('')
  })
})

describe('which books the queue opens on', () => {
  it('opens on the whole queue when nothing said otherwise', () => {
    expect(PANE).toMatch(/useState<Which>\(showing \?\? 'all'\)/)
  })

  // Pinned on the source, since the pane cannot be rendered here. What would
  // break this is `showing` becoming a prop the filter is held to, which
  // would leave a person who came in on "Stuck" unable to see the rest of
  // their queue.
  it('lets the control above the list take it from there', () => {
    expect(PANE).toMatch(/onPick=\{setWhich\}/)
    expect(PANE, 'the filter is held to what opened the screen')
      .not.toMatch(/SHOWING\[showing/)
  })
})
