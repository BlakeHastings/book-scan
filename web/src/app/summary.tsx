/**
 * What the app knows about the collection as a whole, rather than about the
 * book in hand.
 *
 * Genuinely shared: the header prints the catalogue counts on every scrolling
 * page, the first screen sorts the work by all four of these, and the camera
 * wears the queue's total as a badge. Written by anything that adds, saves,
 * deletes or checks out a book.
 *
 * The counts are re-read on every change of screen, which is what they always
 * did. A count is the cheapest thing to be wrong about and the most obvious
 * when it is: two people scan into one catalogue, so the number on the header
 * is stale the moment somebody else saves a book. **The lists are not**, since
 * #332: see `READ_THE_QUEUE` below.
 *
 * The two lists are here rather than in the first screen even though the first
 * screen is the only thing that draws them, and the reason is lifetime: they
 * outlived that screen in the component this came out of, so leaving home and
 * coming back drew the previous answer while the new one was in flight rather
 * than dropping a whole row out of the layout for a moment. `carrying` keeps
 * its own guard, so it is still asked for only while the first screen is up.
 */

import {
  createContext, useContext, useEffect, useState,
  type Dispatch, type ReactNode, type SetStateAction,
} from 'react'
import {
  api, type BackupWatch, type CarryItem, type Capture, type Counts, type QueueCounts,
} from '../lib/api'
import { useNavigation, type Route } from './navigation'

/**
 * The screens that read the queue, and there are two (#332).
 *
 * The counts below are re-read on every change of screen and should be: they
 * are four integers, the header prints them everywhere, and being stale about
 * them is the cheapest thing to be wrong about and the most obvious when it is.
 * **The queue itself was travelling with them**, on every navigation in the
 * app, whatever the navigation was: opening a book, opening the camera,
 * changing a filter. `GET /api/captures` takes no page and answers the whole
 * queue, so the app's most frequent request was also one of its least bounded
 * ones (`docs/api-review.md`, findings 4 and 5).
 *
 * So the list is asked for where it is read and nowhere else, which is the same
 * guard `carrying` below already keeps for the same reason. Nothing else drops:
 * the queue screen loads its own list and hands the counts back through
 * `onCounts`, and the camera sets them from what each shutter answers, so a
 * screen that changes the queue still corrects the badge without this asking
 * again.
 */
const READ_THE_QUEUE: readonly Route[] = ['home', 'shelve']

export interface Summary {
  readonly counts: Counts | null
  readonly setCounts: Dispatch<SetStateAction<Counts | null>>
  readonly queueCounts: QueueCounts | null
  readonly setQueueCounts: Dispatch<SetStateAction<QueueCounts | null>>
  /**
   * The queue itself, kept off the same read the counts come from.
   *
   * The first screen names the books that are ready to shelve rather than only
   * counting them, and this is the list they come out of. No second request:
   * `listCaptures` already answered both.
   */
  readonly queued: Capture[]
  /**
   * Books that are not where they now belong. Null until the read answers.
   *
   * Flattened out of the trips, because the first screen names three books and
   * counts the rest; the trips themselves are the carry screen's job. Reading
   * the same route it does is the point: the number on the door and the number
   * behind it are one answer, worked out once.
   */
  readonly carrying: CarryItem[] | null
  /**
   * Whether the collection has a backup anybody has proved restores (#311).
   *
   * Null until the read answers, and null again if it fails, which is the same
   * arrangement `carrying` keeps and is more important here: this is the one
   * thing on the screen that exists to say something is wrong, so a request
   * that did not come back must not be able to produce a sentence. The server
   * has its own word for "I could not look", and it is not this one.
   */
  readonly backup: BackupWatch | null
}


const Context = createContext<Summary | null>(null)

export function SummaryProvider({ children }: { children: ReactNode }) {
  const { route } = useNavigation()
  const [counts, setCounts] = useState<Counts | null>(null)
  const [queueCounts, setQueueCounts] = useState<QueueCounts | null>(null)
  const [queued, setQueued] = useState<Capture[]>([])
  const [carrying, setCarrying] = useState<CarryItem[] | null>(null)
  const [backup, setBackup] = useState<BackupWatch | null>(null)

  useEffect(() => {
    let live = true
    api.health()
      .then((h) => { if (live) setCounts(h.counts) })
      .catch(() => {})
    return () => { live = false }
  }, [route])

  useEffect(() => {
    if (!READ_THE_QUEUE.includes(route)) return
    let live = true
    api.listCaptures()
      .then((r) => {
        if (!live) return
        setQueueCounts(r.counts)
        setQueued(r.captures)
      })
      .catch(() => {})
    return () => { live = false }
  }, [route])

  /**
   * The books the first screen says are waiting to be carried.
   *
   * `api.carry()`, which is the list the carry screen draws, so the count on
   * this screen and the list behind the tap are one answer rather than two
   * computations of two different things. It was two requests to
   * `api.misfiles`, one per run, which asked a different question: a recorded
   * label against one derived from the sort order, which cannot see a rule
   * change at all.
   *
   * Only while the first screen is on: it is the only thing that asks, and a
   * request on every change of screen would be a request nobody is looking at.
   *
   * A failure leaves it null rather than empty, and the screen then draws no
   * count at all: "none to carry" and "nobody answered" are different things
   * to say to somebody deciding whether to walk to a shelf.
   */
  useEffect(() => {
    if (route !== 'home') return
    let live = true
    api.carry()
      .then((work) => {
        if (!live) return
        setCarrying(work.trips.flatMap((trip) => trip.books.map((book) => ({
          book, from: trip.from, to: trip.to,
        }))))
      })
      .catch(() => { if (live) setCarrying(null) })
    return () => { live = false }
  }, [route])

  /**
   * Whether anything has backed the collection up lately.
   *
   * On the first screen only, like `carrying` above, and for a second reason
   * as well as that one: the answer comes off a disk that is deliberately not
   * the one the app is on and may be asleep, and a request on every navigation
   * would be spinning it up all day to answer a question whose answer changes
   * once a night.
   *
   * A failure leaves it null and the screen then says nothing at all. That is
   * the right silence: the server distinguishes "there is no backup" from "I
   * could not look", and a browser that could not reach the server knows
   * neither.
   */
  useEffect(() => {
    if (route !== 'home') return
    let live = true
    api.backup()
      .then((watch) => { if (live) setBackup(watch) })
      .catch(() => { if (live) setBackup(null) })
    return () => { live = false }
  }, [route])

  return (
    <Context.Provider
      value={{ counts, setCounts, queueCounts, setQueueCounts, queued, carrying, backup }}
    >
      {children}
    </Context.Provider>
  )
}

export function useSummary(): Summary {
  const found = useContext(Context)
  if (!found) throw new Error('useSummary was called outside SummaryProvider')
  return found
}
