/**
 * One book's photographs on their way to the queue.
 *
 * The first photograph of a book is what creates its capture, and every later
 * one names that capture. So they go one at a time: a second photograph sent
 * before the first has answered has no capture to name, and would start a
 * second book. And the capture they name is kept here rather than read off the
 * screen, because the screen moves on to the next book while a photograph of
 * this one is still travelling.
 */

import { Refusal } from './api'
import type { Slot } from './scanner'

export interface Sent {
  readonly capture: { readonly id: number }
}

export type Send<Answer extends Sent> = (
  image: string,
  slot: Slot,
  captureId: number | null,
) => Promise<Answer>

/**
 * What a proxy answers while the server behind it is restarting or out of
 * workers, and what `fetch` throws when the network itself gave up. Each says
 * nothing about the photograph, so asking again is the right answer to it.
 */
export function worthAskingAgain(error: unknown): boolean {
  if (error instanceof Refusal) return error.status === 502 || error.status === 503 || error.status === 504
  return error instanceof TypeError
}

/** How long to wait before each further try. Two more, about four seconds in all. */
export const RETRY_DELAYS_MS: readonly number[] = [1000, 3000]

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export class BookUploads<Answer extends Sent> {
  private known: number | null
  private pending = 0
  private chain: Promise<unknown> = Promise.resolve()

  constructor(
    captureId: number | null,
    private readonly send: Send<Answer>,
    private readonly wait: (ms: number) => Promise<void> = sleep,
    private readonly delays: readonly number[] = RETRY_DELAYS_MS,
  ) {
    this.known = captureId
  }

  /** The capture this book's photographs go to, once one has answered. */
  get captureId(): number | null {
    return this.known
  }

  /**
   * Send one photograph after every one before it has settled. `onScreen` is
   * the capture the screen holds, taken only while nothing is travelling: it is
   * how a book picked up from the queue and brought back to the camera names
   * its capture, and while something is travelling this knows better.
   */
  add(image: string, slot: Slot, onScreen: number | null): Promise<Answer> {
    if (this.pending === 0 && onScreen !== null) this.known = onScreen
    this.pending += 1
    const turn = this.chain.then(() => this.attempt(image, slot))
    this.chain = turn.catch(() => {}).finally(() => { this.pending -= 1 })
    return turn
  }

  private async attempt(image: string, slot: Slot): Promise<Answer> {
    for (let tried = 0; ; tried += 1) {
      try {
        const answer = await this.send(image, slot, this.known)
        this.known = answer.capture.id
        return answer
      } catch (caught) {
        const delay = this.delays[tried]
        if (delay === undefined || !worthAskingAgain(caught)) throw caught
        await this.wait(delay)
      }
    }
  }
}
