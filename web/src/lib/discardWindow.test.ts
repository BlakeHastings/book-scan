/**
 * The claim this file exists to check is a negative one: while a discard is held, no request
 * has been made, not "the request was made and then reversed", which this application cannot
 * do since a delete takes photographs off disk.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDiscardWindow, UNDO_WINDOW_MS } from './discardWindow'
import { api } from './api'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('holding a discard open', () => {
  it('deletes nothing while the window is still open', () => {
    vi.useFakeTimers()
    const deleted: number[] = []
    const window_ = createDiscardWindow((id) => deleted.push(id))

    window_.hold(4)
    vi.advanceTimersByTime(UNDO_WINDOW_MS - 1)

    expect(deleted).toEqual([])
    expect(window_.held()).toEqual([4])
  })

  it('deletes once the window closes with nobody having taken it back', () => {
    vi.useFakeTimers()
    const deleted: number[] = []
    const window_ = createDiscardWindow((id) => deleted.push(id))

    window_.hold(4)
    vi.advanceTimersByTime(UNDO_WINDOW_MS)

    expect(deleted).toEqual([4])
    expect(window_.held()).toEqual([])
  })

  it('never deletes something that was taken back', () => {
    vi.useFakeTimers()
    const deleted: number[] = []
    const window_ = createDiscardWindow((id) => deleted.push(id))

    window_.hold(4)
    vi.advanceTimersByTime(UNDO_WINDOW_MS - 1)
    expect(window_.release(4)).toBe(true)
    vi.advanceTimersByTime(UNDO_WINDOW_MS * 10)

    expect(deleted).toEqual([])
    expect(window_.held()).toEqual([])
  })

  it('says an undo did nothing when the window had already closed', () => {
    vi.useFakeTimers()
    const window_ = createDiscardWindow(() => {})

    window_.hold(4)
    vi.advanceTimersByTime(UNDO_WINDOW_MS)

    // The row is gone by then, so this is defensive rather than reachable, but the answer must be "no" or a caller would report an undo that did not happen.
    expect(window_.release(4)).toBe(false)
  })

  it('holds several at once and takes back only the one it was asked about', () => {
    vi.useFakeTimers()
    const deleted: number[] = []
    const window_ = createDiscardWindow((id) => deleted.push(id))

    window_.hold(1)
    window_.hold(2)
    window_.release(1)
    vi.advanceTimersByTime(UNDO_WINDOW_MS)

    expect(deleted).toEqual([2])
  })

  it('does not restart a window that is already running', () => {
    vi.useFakeTimers()
    const deleted: number[] = []
    const window_ = createDiscardWindow((id) => deleted.push(id))

    window_.hold(1)
    vi.advanceTimersByTime(UNDO_WINDOW_MS - 100)
    window_.hold(1)
    vi.advanceTimersByTime(100)

    expect(deleted).toEqual([1])
  })

  it('deletes nothing when the page goes away mid-window', () => {
    vi.useFakeTimers()
    const deleted: number[] = []
    const window_ = createDiscardWindow((id) => deleted.push(id))

    window_.hold(1)
    window_.hold(2)
    window_.abandon()
    vi.advanceTimersByTime(UNDO_WINDOW_MS * 10)

    expect(deleted).toEqual([])
    expect(window_.held()).toEqual([])
  })
})

describe('what actually reaches the server', () => {
  /** Every request the client made, so "none" can be asserted rather than assumed. */
  function watchFetch() {
    const calls: Array<{ path: string; method?: string }> = []
    vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
      calls.push({ path, method: init?.method })
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, counts: {}, photosRemoved: 1 }),
      })
    })
    return calls
  }

  it('sends nothing at all while a discard is undoable', async () => {
    vi.useFakeTimers()
    const calls = watchFetch()
    const window_ = createDiscardWindow((id) => { void api.deleteCapture(id) })

    window_.hold(12)
    vi.advanceTimersByTime(UNDO_WINDOW_MS - 1)
    await Promise.resolve()

    expect(calls).toEqual([])
  })

  it('sends nothing at all when the discard is undone', async () => {
    vi.useFakeTimers()
    const calls = watchFetch()
    const window_ = createDiscardWindow((id) => { void api.deleteCapture(id) })

    window_.hold(12)
    vi.advanceTimersByTime(UNDO_WINDOW_MS - 1)
    window_.release(12)
    vi.advanceTimersByTime(UNDO_WINDOW_MS * 10)
    await Promise.resolve()

    expect(calls).toEqual([])
  })

  /* Without this, the two tests above would pass just as happily against a window that never deleted anything. */
  it('sends the delete once the window has closed', async () => {
    vi.useFakeTimers()
    const calls = watchFetch()
    const window_ = createDiscardWindow((id) => { void api.deleteCapture(id) })

    window_.hold(12)
    vi.advanceTimersByTime(UNDO_WINDOW_MS)
    await Promise.resolve()

    expect(calls).toHaveLength(1)
    expect(calls[0]?.path).toBe('/api/captures/12')
    expect(calls[0]?.method).toBe('DELETE')
  })
})
