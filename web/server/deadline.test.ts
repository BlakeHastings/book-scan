/**
 * Giving up on work that has not come back (#299).
 *
 * Small enough to look obviously right and worth pinning anyway, because two
 * of its properties are not visible in what it returns. A deadline that leaks
 * an unhandled rejection ends the process, which is the failure `AGENTS.md`
 * describes under `inTheBackground` and which this repository has been taken
 * down by twice. A deadline whose timer is still refed keeps the process alive
 * past the work it was watching, which turns a bound of a minute into a server
 * that will not shut down for one.
 */

import { describe, expect, it, vi } from 'vitest'
import { ReadingTimedOut, withDeadline } from './deadline'

const never = () => new Promise<string>(() => {})
const soon = <T>(value: T, ms = 1) =>
  new Promise<T>((resolve) => { setTimeout(() => resolve(value), ms) })

describe('withDeadline', () => {
  it('hands back what the work produced when it finishes in time', async () => {
    await expect(withDeadline(soon('read'), 5_000, 'A reading')).resolves.toBe('read')
  })

  it('gives up on work that does not come back', async () => {
    await expect(withDeadline(never(), 5, 'A reading'))
      .rejects.toBeInstanceOf(ReadingTimedOut)
  })

  it('says what was given up on and after how long', async () => {
    // The message reaches a person: it becomes the note on a stuck capture and
    // the body of a 504. "Something went wrong" is what it exists not to say.
    await expect(withDeadline(never(), 2_000, 'Reading this photograph'))
      .rejects.toThrow('Reading this photograph did not finish within 2 seconds.')
  })

  it('carries the bound it gave up at, so a caller can say it in its own words', async () => {
    const caught = await withDeadline(never(), 30, 'A reading').catch((e: unknown) => e)
    expect(caught).toBeInstanceOf(ReadingTimedOut)
    expect((caught as ReadingTimedOut).ms).toBe(30)
  })

  it('tells the caller to reclaim what the abandoned work is holding', async () => {
    // The only lever there is. WASM has no cancel, so a pool slot is given back
    // by whoever gave up on the job, not by the job.
    const reclaim = vi.fn()
    await withDeadline(never(), 5, 'An OCR pass', reclaim).catch(() => {})
    expect(reclaim).toHaveBeenCalledOnce()
  })

  it('passes a real failure through as itself rather than as a timeout', async () => {
    const broke = new Error('decoder crashed')
    await expect(withDeadline(Promise.reject(broke), 5_000, 'A reading'))
      .rejects.toBe(broke)
  })

  it('owns the failure of work it has already given up on', async () => {
    /*
     * The property that is invisible in the return value. Abandoned work can
     * still fail later, and a rejection nobody is listening to is a process
     * this repository has already lost twice. The handler is attached whatever
     * the deadline did, so there is nobody left to be surprised.
     */
    const unowned = vi.fn()
    process.on('unhandledRejection', unowned)
    try {
      let fail: (error: Error) => void = () => {}
      const work = new Promise<string>((_, reject) => { fail = reject })
      await expect(withDeadline(work, 5, 'A reading')).rejects.toBeInstanceOf(ReadingTimedOut)
      fail(new Error('and then it broke'))
      // Two turns: one for the rejection to settle, one for node to decide
      // whether anybody owned it.
      await new Promise((resolve) => setImmediate(resolve))
      await new Promise((resolve) => setImmediate(resolve))
      expect(unowned).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unowned)
    }
  })

  it('does not hold the process open for a bound nothing is waiting out', async () => {
    // A refed timer for the reading bound would keep node alive for a minute
    // after the last request, which is a server that will not stop rather than
    // a bug anybody would connect to this file.
    const timers: { unref: unknown }[] = []
    const real = globalThis.setTimeout
    const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      fn: () => void, ms?: number,
    ) => {
      const timer = real(fn, ms)
      timers.push(timer as unknown as { unref: unknown })
      return timer
    }) as typeof setTimeout)
    try {
      await withDeadline(Promise.resolve('read'), 5_000, 'A reading')
    } finally {
      spy.mockRestore()
    }
    expect(timers).toHaveLength(1)
    // node's Timeout carries `hasRef()`; an unrefed one answers false.
    expect((timers[0] as unknown as { hasRef(): boolean }).hasRef()).toBe(false)
  })
})
