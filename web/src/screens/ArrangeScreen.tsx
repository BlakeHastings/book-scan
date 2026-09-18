/**
 * Changing what belongs where: point a rule at other furniture, see every
 * book that would move, apply it.
 *
 * One screen, reached both from the library (about the stretch of books
 * being looked at) and from a rule itself (about the furniture being stood
 * in front of): a rule change is a plan and an apply, and a second screen
 * for the second way in would be a second answer to where the books go.
 *
 * Backing out lands on whichever screen offered the change (`leaveArranging`),
 * so it returns to the stretch of books this screen was about. Applying
 * lands on the carry flow instead, since applying writes down where the
 * rules want each book and moves nothing.
 *
 * This file owns the two requests and the state; `MoveRunPane` owns what is
 * drawn and holds nothing itself.
 *
 * What the run is (where it lives, what it is cut into, whether it may be
 * moved at all) comes from the server, as `runMoveOffer`. Which bookcases it
 * can be sent to comes from the furniture: a destination that already has
 * areas on it is refused by the server, so offering it would be a button
 * that exists to say no.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { MoveRunPane, type Destination } from '../components/MoveRunPane'
import { useNavigation } from '../app/navigation'
import { useDesignPage, useRoom, useRoomTabs } from '../app/room'
import { api, type RunMoveOffer, type RunMovePlan } from '../lib/api'
import type { ShelfRange } from '../../shared/shelving'

/** What each stretch of books is called on screen. No word out of the model. */
const NAMED: Record<ShelfRange, string> = {
  fiction: 'fiction',
  nonfiction: 'non-fiction',
}

/**
 * The bookcases this move could land on.
 *
 * Every number a piece of furniture already stands on, plus the first free
 * one after the highest, minus the ones that already have areas or books on
 * them and are not this stretch's own: a bookcase holds one stretch of
 * books, and the server refuses a destination with areas already on it.
 *
 * A piece with books still standing on it counts as taken too, even with
 * no areas on its face: that is exactly the bookcase a stretch of books was
 * moved off and nobody has carried yet.
 *
 * The one it is on now is always offered, and is where the picker starts.
 */
export function destinationsFor(
  pieces: readonly { position: number; areas: readonly unknown[]; books: number }[],
  livesOn: number,
): Destination[] {
  const taken = new Set(
    pieces
      .filter((piece) => piece.areas.length > 0 || piece.books > 0)
      .map((piece) => piece.position),
  )
  const standing = new Set(pieces.map((piece) => piece.position))
  const highest = pieces.reduce((most, piece) => Math.max(most, piece.position), 0)

  const numbers = new Set<number>([livesOn, highest + 1])
  for (let at = 1; at <= highest; at += 1) if (!taken.has(at)) numbers.add(at)

  return [...numbers]
    .filter((number) => number > 0 && (number === livesOn || !taken.has(number)))
    .sort((a, b) => a - b)
    .map((number) => ({
      number,
      said: number === livesOn
        ? 'Where it lives now'
        : standing.has(number) ? 'Nothing on it yet' : 'A bookcase you do not have yet',
    }))
}

export function ArrangeScreen() {
  const { arranging, leaveArranging, setRoute } = useNavigation()
  const { room, error, setError } = useRoom()
  const tabs = useRoomTabs()
  useDesignPage()

  const [offer, setOffer] = useState<RunMoveOffer | null>(null)
  const [bookcase, setBookcase] = useState(0)
  const [plan, setPlan] = useState<RunMovePlan | null>(null)
  const [waiting, setWaiting] = useState<number | null>(null)
  const [applied, setApplied] = useState<{ moved: number; wrote: number } | null>(null)
  const [busy, setBusy] = useState(false)

  /*
   * What this run is, asked of the thing that decides it. The picker starts
   * where the run lives, so the first tap is a decision rather than a
   * correction.
   */
  const load = useCallback(() => {
    setPlan(null)
    setApplied(null)
    api.runMoveOffer(arranging)
      .then((answer) => {
        setOffer(answer)
        /*
         * The picker starts where the run lives, and only starts: this
         * read and the room's are two separate requests, so a late answer
         * here must not overwrite a choice already made. Zero is the value
         * nobody can choose, so it is the one that means nobody has.
         */
        setBookcase((chosen) => chosen || answer.from || 1)
      })
      .catch((caught) => setError((caught as Error).message))
  }, [arranging, setError])

  useEffect(() => { load() }, [load])

  /* Zero until the read answers, which is the value no bookcase has. */
  const livesOn = offer?.from ?? 0
  const destinations = useMemo(
    () => destinationsFor(room?.fixtures ?? [], livesOn),
    [room, livesOn],
  )

  const run = async (what: 'plan' | 'apply') => {
    setBusy(true)
    setError('')
    try {
      if (what === 'plan') {
        setPlan(await api.planRunMove(arranging, bookcase))
        setApplied(null)
        /*
         * What is already outstanding, fetched beside the plan rather than
         * with it, so the plan does not wait on a second request to be
         * drawn.
         */
        api.carry()
          .then((work) => setWaiting(work.moving))
          .catch(() => setWaiting(null))
        return
      }
      const result = await api.applyRunMove(arranging, bookcase)
      setApplied({ moved: result.plan.moving, wrote: result.wrote.assigned })
      setPlan(result.plan)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <MoveRunPane
      named={NAMED[arranging]}
      livesOn={livesOn}
      areas={offer?.planks ?? []}
      refused={offer?.why ?? ''}
      destinations={destinations}
      bookcase={bookcase}
      onBookcase={(picked) => { setBookcase(picked); setPlan(null) }}
      plan={plan}
      waiting={waiting}
      applied={applied}
      busy={busy}
      error={error}
      tabs={tabs}
      onBack={leaveArranging}
      onPlan={() => { void run('plan') }}
      onUnplan={() => setPlan(null)}
      onApply={() => { void run('apply') }}
      onCarry={() => setRoute('carry')}
    />
  )
}
