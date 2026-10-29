import { describe, expect, it } from 'vitest'

import { Refusal } from './api'
import { BookUploads, worthAskingAgain, type Send } from './photoUploads'
import type { Slot } from './scanner'

interface Answer { capture: { id: number } }

/** A server that hands out capture ids and remembers what it was sent. */
function aServer(refusals: unknown[] = []) {
  const sent: { slot: Slot; captureId: number | null }[] = []
  const pending: (() => void)[] = []
  let next = 1
  let held = false
  const send: Send<Answer> = async (_image, slot, captureId) => {
    if (held) await new Promise<void>((resolve) => pending.push(resolve))
    sent.push({ slot, captureId })
    const refusal = refusals.shift()
    if (refusal) throw refusal
    return { capture: { id: captureId ?? next++ } }
  }
  return {
    send,
    sent,
    hold: () => { held = true },
    let: () => { held = false; pending.splice(0).forEach((go) => go()) },
  }
}

const noWait = async () => {}
const badGateway = () => new Refusal('502 Bad Gateway', 502, undefined)

describe('a book photographed faster than the server answers', () => {
  it('sends the second photograph to the capture the first one made', async () => {
    const server = aServer()
    server.hold()
    const uploads = new BookUploads<Answer>(null, server.send, noWait)

    const back = uploads.add('b', 'back', null)
    const front = uploads.add('f', 'front', null)
    server.let()

    expect((await back).capture.id).toBe(1)
    expect((await front).capture.id).toBe(1)
    expect(server.sent).toEqual([
      { slot: 'back', captureId: null },
      { slot: 'front', captureId: 1 },
    ])
  })

  it('names the capture on screen for a book brought back to the camera', async () => {
    const server = aServer()
    const uploads = new BookUploads<Answer>(null, server.send, noWait)
    await uploads.add('s', 'edge', 7)
    expect(server.sent).toEqual([{ slot: 'edge', captureId: 7 }])
  })

  it('goes on to the next photograph after one that failed', async () => {
    const server = aServer([new Refusal('Expected an image data URL.', 400, undefined)])
    const uploads = new BookUploads<Answer>(null, server.send, noWait)

    await expect(uploads.add('b', 'back', null)).rejects.toThrow('Expected an image')
    expect((await uploads.add('f', 'front', null)).capture.id).toBe(1)
  })
})

describe('a server that is restarting', () => {
  it('is asked again, and the photograph is sent once it answers', async () => {
    const server = aServer([badGateway(), new TypeError('Failed to fetch')])
    const waited: number[] = []
    const uploads = new BookUploads<Answer>(
      null, server.send, async (ms) => { waited.push(ms) }, [10, 20],
    )

    expect((await uploads.add('b', 'back', null)).capture.id).toBe(1)
    expect(waited).toEqual([10, 20])
    expect(server.sent).toHaveLength(3)
  })

  it('is given up on after the last try, saying what the last one said', async () => {
    const server = aServer([badGateway(), badGateway(), badGateway()])
    const uploads = new BookUploads<Answer>(null, server.send, noWait, [1, 1])
    await expect(uploads.add('b', 'back', null)).rejects.toMatchObject({ status: 502 })
    expect(server.sent).toHaveLength(3)
  })

  it('is not asked again about a photograph it refused', async () => {
    const server = aServer([new Refusal('Expected slot to be front, back or edge', 400, undefined)])
    const uploads = new BookUploads<Answer>(null, server.send, noWait)
    await expect(uploads.add('b', 'back', null)).rejects.toMatchObject({ status: 400 })
    expect(server.sent).toHaveLength(1)
  })
})

describe('worthAskingAgain', () => {
  it('is what a proxy or the network says, and not what the app says', () => {
    expect(worthAskingAgain(badGateway())).toBe(true)
    expect(worthAskingAgain(new Refusal('', 503, undefined))).toBe(true)
    expect(worthAskingAgain(new Refusal('', 504, undefined))).toBe(true)
    expect(worthAskingAgain(new TypeError('Load failed'))).toBe(true)
    expect(worthAskingAgain(new Refusal('', 500, undefined))).toBe(false)
    expect(worthAskingAgain(new Refusal('', 401, undefined))).toBe(false)
    expect(worthAskingAgain(new Error('anything else'))).toBe(false)
  })
})
