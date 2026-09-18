/**
 * There is no browser in this project's test setup, so the listener is registered against an
 * EventTarget the test owns, which is also the only way to prove the teardown actually stops it.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { putDownCapture, putDownOnPageHide, type HeldCapture } from './leaveCapture'

interface Call {
  path: string
  init?: RequestInit
}

/** Collect the requests a leaving path makes, without a server to answer. */
function watchFetch(ok = true): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    calls.push({ path, init })
    return Promise.resolve({
      ok,
      json: () => Promise.resolve(ok ? { capture: {}, released: true } : { error: 'gone' }),
    })
  })
  return calls
}

function bodyOf(call: Call | undefined): Record<string, unknown> {
  return JSON.parse(String(call?.init?.body)) as Record<string, unknown>
}

const held: HeldCapture = {
  id: 7,
  who: 'alex',
  edit: { title: 'Song of Solomon', notes: 'spine is split' },
}

describe('putting a capture down', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  /* One request, not two: the order between an edit and a release cannot be got wrong if there is no order. */
  it('writes what was typed and hands the claim back in one request', async () => {
    const calls = watchFetch()

    await putDownCapture(held)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.path).toBe('/api/captures/7')
    expect(calls[0]?.init?.method).toBe('PATCH')
    expect(bodyOf(calls[0])).toEqual({
      who: 'alex',
      title: 'Song of Solomon',
      notes: 'spine is split',
      release: true,
    })
  })

  /* The claim is not conditional on there being anything to say: an empty body still records that the claim was let go of. */
  it('hands the claim back when nothing was typed', async () => {
    const calls = watchFetch()

    await putDownCapture({ id: 7, who: 'alex', edit: {} })

    expect(bodyOf(calls[0])).toEqual({ who: 'alex', release: true })
  })

  /* Every caller is already on their way out of the screen, so a rejection here would land as an unhandled one. */
  it('does not reject when the write is refused', async () => {
    watchFetch(false)

    await expect(putDownCapture(held)).resolves.toBeUndefined()
  })

  it('asks for keepalive only when the page is going away', async () => {
    const calls = watchFetch()

    await putDownCapture(held)
    await putDownCapture(held, true)

    expect(calls[0]?.init?.keepalive).toBeFalsy()
    expect(calls[1]?.init?.keepalive).toBe(true)
  })
})

describe('the page going away', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  /* The browser's back button out of the app, the tab closing, and the phone putting the page away all arrive here. */
  it('hands back whatever is in hand, and says the page is going', () => {
    const calls = watchFetch()
    const target = new EventTarget()

    putDownOnPageHide(() => held, target)
    target.dispatchEvent(new Event('pagehide'))

    expect(calls).toHaveLength(1)
    expect(calls[0]?.init?.keepalive).toBe(true)
    expect(bodyOf(calls[0]).release).toBe(true)
  })

  it('sends nothing when no capture is in hand', () => {
    const calls = watchFetch()
    const target = new EventTarget()

    putDownOnPageHide(() => null, target)
    target.dispatchEvent(new Event('pagehide'))

    expect(calls).toHaveLength(0)
  })

  /* Asked at the moment of leaving rather than captured when the listener was registered, since the listener is registered once. */
  it('reads what is in hand at the moment of leaving', () => {
    const calls = watchFetch()
    const target = new EventTarget()
    let current: HeldCapture | null = null

    putDownOnPageHide(() => current, target)
    current = { id: 12, who: 'sam', edit: {} }
    target.dispatchEvent(new Event('pagehide'))

    expect(calls[0]?.path).toBe('/api/captures/12')
  })

  it('stops once it has been torn down', () => {
    const calls = watchFetch()
    const target = new EventTarget()

    const stop = putDownOnPageHide(() => held, target)
    stop()
    target.dispatchEvent(new Event('pagehide'))

    expect(calls).toHaveLength(0)
  })
})
