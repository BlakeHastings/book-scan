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

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ReactElement } from 'react'
import { canShelve, photoCount, QueueRow, statusLine, type RowGesture } from './QueuePane'
import type { Capture, CaptureStatus } from '../lib/api'

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
