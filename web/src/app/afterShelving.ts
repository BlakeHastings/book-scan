/**
 * What the button after "Shelved" says, and where it goes. It names the
 * place, because the same press used to land on the camera for one book and
 * the queue for the next, depending on where each was picked up.
 */

import { deviceWord } from '../components/QueuePane'
import { draftFromCapture, type Capture } from '../lib/api'
import { newestFirst } from '../lib/queueOrder'
import type { Route } from './navigation'

export type AfterShelving =
  /** Straight into the next book waiting in the queue. `index` is where it sits in the queue listing. */
  | { word: string; capture: Capture; index: number }
  | { word: string; route: Route }

/** The other ways back, named. Only the camera and the queue end on "Shelved" today. */
const BACK_TO: Partial<Record<Route, string>> = {
  capture: 'Scan another book',
  queue: 'Back to the queue',
  library: 'Back to the library',
  scan: 'Find another book',
}

/**
 * The next book on the table somebody could shelve now: read, and not open on
 * another phone. Taken from where the shelved one sat in the listing, so
 * working down the queue carries on down it rather than jumping to the top.
 */
export function nextOffTheTable(
  captures: Capture[],
  shelved: number | null,
  from: number,
  me: string,
  now: number = Date.now(),
): { capture: Capture; index: number } | null {
  const listed = newestFirst(captures)
  const ready = listed
    .map((capture, index) => ({ capture, index }))
    .filter(({ capture }) =>
      capture.id !== shelved
      && capture.status === 'ready'
      && deviceWord(capture, me, now) === '')
  return ready.find(({ index }) => index >= from) ?? ready[0] ?? null
}

/**
 * `landing` is where finishing with the book leads; `table` is what the queue
 * listed, or null when it was not asked or did not answer.
 */
export function afterShelving(
  landing: Route,
  table: { capture: Capture; index: number } | null,
  waiting: number | null,
): AfterShelving {
  if (landing === 'queue') {
    if (table) {
      const title = draftFromCapture(table.capture).title.trim()
      return { word: title ? `Shelve ${title} next` : 'Shelve the next book', ...table }
    }
    // An empty queue is nowhere to be sent back to.
    if (waiting === 0) return { word: 'Scan another book', route: 'capture' }
  }
  return { word: BACK_TO[landing] ?? 'Back to the start', route: landing }
}
