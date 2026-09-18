/**
 * What the app knows about the collection as a whole, rather than about the book
 * in hand. Written by anything that adds, saves, deletes or checks out a book.
 *
 * The counts are re-read on every change of screen. A count is the cheapest thing
 * to be wrong about and the most obvious when it is: two people scan into one
 * catalogue, so the number on the header is stale the moment somebody else saves
 * a book. The lists are not re-read: see `READ_THE_QUEUE` below.
 *
 * `carrying` is here rather than in the first screen even though the first screen
 * is the only thing that reads it, and the reason is lifetime: leaving home and
 * coming back would otherwise drop a count out of the layout while the new answer
 * was in flight. It keeps its own guard, so it is still asked for only while the
 * first screen is up.
 */

import {
  createContext, useContext, useEffect, useState,
  type Dispatch, type ReactNode, type SetStateAction,
} from 'react'
import {
  api, type BackupWatch, type CarryItem, type Counts, type LookupStandings,
  type QueueCounts,
} from '../lib/api'
import { useNavigation, type Route } from './navigation'

/**
 * The screens that read the queue, and there are two.
 *
 * `GET /api/captures` takes no page and answers the whole queue, so a list
 * travelling with the counts below, on every navigation in the app, made the
 * app's most frequent request also one of its least bounded ones. See
 * `docs/api-review.md`. The list is asked for where it is read and nowhere else,
 * which is the same guard `carrying` below keeps for the same reason. Nothing
 * else drops: the queue screen loads its own list and hands the counts back
 * through `onCounts`, and the camera sets them from what each shutter answers.
 */
const READ_THE_QUEUE: readonly Route[] = ['home', 'shelve']

export interface Summary {
  readonly counts: Counts | null
  readonly setCounts: Dispatch<SetStateAction<Counts | null>>
  readonly queueCounts: QueueCounts | null
  readonly setQueueCounts: Dispatch<SetStateAction<QueueCounts | null>>
  /**
   * Books that are not where they now belong. Null until the read answers.
   * Flattened out of the trips, and read off the same route the carry screen
   * uses, so the number on the door and the number behind it are one answer.
   */
  readonly carrying: CarryItem[] | null
  /**
   * How many books no rule claims. Null until the read answers. The number and
   * not the list, which is the opposite way round from `carrying`: the first
   * screen draws a door and never names one of these books, and the screen that
   * does name them reads the list itself, a page at a time.
   */
  readonly unclaimed: number | null
  /**
   * Whether the collection has a backup anybody has proved restores. Null until
   * the read answers, and null again if it fails: this is the one thing on the
   * screen that exists to say something is wrong, so a request that did not come
   * back must not be able to produce a sentence. The server has its own word for
   * "I could not look", and it is not this one.
   */
  readonly backup: BackupWatch | null
  /**
   * How many books the shelf and the rules put in different places. Null until the
   * read answers, and null if it failed, which is `backup`'s arrangement kept for
   * its reason: a sentence written from a request that never came back is worth
   * less than silence.
   *
   * The number and not the books, which is `unclaimed`'s split and not
   * `carrying`'s: the first screen never names one of these.
   */
  readonly drifting: number | null
  /**
   * What each catalogue a lookup consults has been doing. Null until the read
   * answers and null if it failed, for `backup`'s reason.
   *
   * It rides along on the health read rather than having one of its own, because
   * that read already happens on every route change. Not guarded to the first
   * screen, unlike the two above it, because Settings draws the standings in full.
   */
  readonly lookups: LookupStandings | null
  /**
   * Whether either of the two reads the first screen is made of did not come
   * back.
   *
   * These two part company with the four fields above, which are set to null on a
   * failed read so the screen says nothing. Doing that here would say nothing
   * twice over, since `HomePane` draws no count while either is null; and on a
   * re-read it would drop the whole of the first screen out of the layout because
   * one read hiccuped. So the last answer stays on the screen and this says beside
   * it that the app could not check just now.
   *
   * True while the last attempt failed and false again the moment one answers.
   * Two pieces of state behind it rather than one, because they are two reads
   * against one server and either can be the one that fails.
   */
  readonly unreachable: boolean
}

const Context = createContext<Summary | null>(null)

export function SummaryProvider({ children }: { children: ReactNode }) {
  const { route } = useNavigation()
  const [counts, setCounts] = useState<Counts | null>(null)
  const [queueCounts, setQueueCounts] = useState<QueueCounts | null>(null)
  const [carrying, setCarrying] = useState<CarryItem[] | null>(null)
  const [unclaimed, setUnclaimed] = useState<number | null>(null)
  const [backup, setBackup] = useState<BackupWatch | null>(null)
  const [drifting, setDrifting] = useState<number | null>(null)
  const [lookups, setLookups] = useState<LookupStandings | null>(null)
  /**
   * Which of the two reads the first screen is made of did not come back. See
   * `unreachable` above for why they answer a failure differently from the four
   * reads below them.
   *
   * Two flags and not one. They are two requests, either can be the one that
   * fails, and a single flag written by both would be whichever of them answered
   * last rather than whether both came back.
   */
  const [countsLost, setCountsLost] = useState(false)
  const [queueLost, setQueueLost] = useState(false)

  useEffect(() => {
    let live = true
    api.health()
      .then((h) => {
        if (!live) return
        setCountsLost(false)
        setCounts(h.counts)
        // `?? null` rather than trusting the type: a server that predates the
        // standings answers without them, and the words this feeds must be able
        // to say nothing rather than read an absence as a nought.
        setLookups(h.lookups ?? null)
      })
      /*
       * The counts and the standings are left exactly as they were, and only the
       * failure is recorded. A `401` or a `403` never gets here in any useful
       * sense: `lib/api.ts` tells `whenTheGateRefuses` before it throws, so
       * `app/gate.tsx` has already replaced the whole app. What this catch is for
       * is the server not being there.
       */
      .catch(() => { if (live) setCountsLost(true) })
    return () => { live = false }
  }, [route])

  useEffect(() => {
    if (!READ_THE_QUEUE.includes(route)) return
    let live = true
    api.listCaptures()
      .then((r) => {
        if (!live) return
        setQueueLost(false)
        setQueueCounts(r.counts)
      })
      .catch(() => { if (live) setQueueLost(true) })
    return () => { live = false }
  }, [route])

  /**
   * The books the first screen says are waiting to be carried, off `api.carry()`,
   * which is the list the carry screen draws, so the count on this screen and the
   * list behind the tap are one answer rather than two computations.
   *
   * Only while the first screen is on: it is the only thing that asks. A failure
   * leaves it null rather than empty, and the screen then draws no count at all,
   * because "none to carry" and "nobody answered" are different things to say to
   * somebody deciding whether to walk to a shelf.
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
   * How many books no rule claims. On the first screen only, like `carrying`
   * above: that is the only screen that reads it, and the screen the door opens
   * asks again for itself. `total` and not the page, because the door is drawn
   * from whether there are any at all.
   *
   * A failure leaves it null and no door is drawn. That is the right silence
   * here: a row inviting somebody to go and settle a dozen books, drawn because a
   * request did not come back, is a walk to a screen that will say there is
   * nothing to do.
   */
  useEffect(() => {
    if (route !== 'home') return
    let live = true
    api.unclaimed()
      .then((found) => { if (live) setUnclaimed(found.total) })
      .catch(() => { if (live) setUnclaimed(null) })
    return () => { live = false }
  }, [route])

  /**
   * Whether anything has backed the collection up lately. On the first screen
   * only: the answer comes off a disk that is deliberately not the one the app is
   * on and may be asleep, and a request on every navigation would be spinning it
   * up all day to answer a question whose answer changes once a night.
   *
   * A failure leaves it null and the screen then says nothing at all. The server
   * distinguishes "there is no backup" from "I could not look", and a browser
   * that could not reach the server knows neither.
   */
  useEffect(() => {
    if (route !== 'home') return
    let live = true
    api.backup()
      .then((watch) => { if (live) setBackup(watch) })
      .catch(() => { if (live) setBackup(null) })
    return () => { live = false }
  }, [route])

  /**
   * Whether the shelf and the rules still agree about where every book stands. On
   * the first screen only, like `unclaimed` and `backup` above: it is two
   * placements of every shelved book, and the answer only changes when something
   * writes. `total` and not the page, for `unclaimed`'s reason.
   *
   * A failure leaves it null and the screen says nothing. That is the important
   * silence here: a card claiming somebody's books are drawn in the wrong place,
   * produced by a request that did not come back, is the false alarm that teaches
   * them to scroll past the real one.
   */
  useEffect(() => {
    if (route !== 'home') return
    let live = true
    api.drift()
      .then((found) => { if (live) setDrifting(found.total) })
      .catch(() => { if (live) setDrifting(null) })
    return () => { live = false }
  }, [route])

  return (
    <Context.Provider
      value={{
        counts, setCounts, queueCounts, setQueueCounts, carrying, unclaimed, backup,
        drifting, lookups, unreachable: countsLost || queueLost,
      }}
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
