/**
 * Changing what belongs where: point a rule at other furniture, see every book
 * that would move, apply it.
 *
 * **There is one of these and this is it.** #244 built it, reached from the
 * library, because the stretch of books somebody wants to move is the one they
 * are looking at. #323 gave the rule itself a way here, because somebody
 * standing in front of a bookcase looks at the rule rather than at the library.
 * Both are the same journey and there is deliberately no second screen for the
 * second way in: a rule change is a plan and an apply, and building a second one
 * beside this would be two answers to where the books go.
 *
 * Backing out lands on whichever screen offered the change, which is
 * `leaveArranging`. From the library that is the library's own return anchor, so
 * it lands on the stretch of books this screen was about: landing on Fiction
 * after moving non-fiction reads as the apply having done nothing.
 *
 * **Applying lands on the carry flow instead**, since #314 built it. Applying
 * writes down where the rules want each book and moves nothing, so the honest
 * next thing is the trips somebody would walk.
 *
 * ## The state is here and the drawing is in the pane
 *
 * #326 converted the screen to the design system, and the split is the one every
 * converted screen makes: this file owns the two requests and the four pieces of
 * state, `MoveRunPane` owns what is drawn, and the pane holds nothing so what it
 * says can be held to a claim in a test.
 *
 * ## Two reads before anything is planned, and neither is a guess
 *
 * What this run is comes from the server, as `runMoveOffer`: where it lives,
 * what it is cut into, and whether a move may pick it up at all. Which bookcases
 * it can be sent to comes from the furniture, because a destination that already
 * has areas on it is refused by the server and offering it would be a button
 * that exists to say no.
 *
 * **It used to ask the books all three questions and it was wrong about two of
 * them.** Where a run lives was the bookcase of the first group of books, which
 * is where the first book happens to be standing rather than where the rule
 * points, and those are two bookcases the moment the leading one is empty
 * (#500). Whether the run could be moved was not asked at all until somebody had
 * chosen a destination, so the screen described a run, offered three bookcases
 * and refused whichever was picked (#486). Both are one read now.
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
 * Every number a piece of furniture already stands on, plus the first free one
 * after the highest, minus the ones that have areas on them and are not this
 * stretch's own: a bookcase holds one stretch of books, and the server refuses a
 * destination with areas already on it rather than merging two.
 *
 * **A piece with books still standing on it is taken too**, even with nothing on
 * its face (#401). That is exactly the bookcase a stretch of books was moved off
 * and nobody has carried yet: its areas are gone and forty-six books are on it,
 * and offering it as "Nothing on it yet" would send a second stretch of books to
 * a bookcase that is full.
 *
 * The one it is on now is offered, and is where the picker starts. Choosing it
 * is a real answer, and the plan says so in words rather than the screen hiding
 * the option and leaving somebody to wonder where it went.
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
         * The picker *starts* where the run lives, and "starts" is the whole of
         * it.
         *
         * This read and the room's are two requests, and the destinations are
         * drawn from the room's, so the buttons are pressable while this one is
         * still in the air. Written flat, a late answer took back a choice
         * somebody had already made and the screen then planned a move to the
         * bookcase the books were already on. Found by a browser journey losing
         * a press to it, twice, on the step that presses and then checks the
         * choice stuck (#433).
         *
         * Zero is the value nobody can choose, so it is the one that means
         * nobody has.
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
         * What is already outstanding, so the number this screen reports and the
         * number the next one shows can be read together. Asked for beside the
         * plan rather than with it: a plan is the answer this screen is for, and
         * it should not wait on a second request to be drawn.
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
