import { useState } from 'react'
import { api, type Move, type PlacementResponse } from '../lib/api'
import {
  asking, confirm, depth, emptyCascade, pushCarry, pushFrame, repropose,
  started, whereYouAre, type Cascade, type Proposal,
} from '../lib/cascade'
import { PlacementView, ShelfStrip } from './ShelfStrip'
import { Button } from '../design/Controls'
import type { ShelfRange } from '../../shared/shelving'

interface Props {
  placement: PlacementResponse | null
  /**
   * True while the placement on screen is known to be out of date: a reload
   * is either in flight or about to be. An out of date placement names a real
   * plank, so it cannot be told apart from a current one by looking at it,
   * and every answer here is an answer about the plank it names.
   */
  stale: boolean
  range: ShelfRange
  title: string
  saving: boolean
  /** Called with the shelf the person has just said the book fits on. */
  onShelved: (shelvedAt: string) => void
  onBack: () => void
  /** Re-read placement after a move, so the strip shows the shelf as it is now. */
  onRefresh: () => Promise<unknown>
}

/**
 * Putting the book on the shelf, kept separate from confirming what the book
 * is. They are different jobs: one happens looking at a screen, the other
 * standing at the shelf with a book in your hand.
 *
 * Nothing here predicts whether a shelf has room, because nothing can:
 * capacity depends on the thickness of whatever is already on it. So the
 * person is the sensor, and the screen only ever asks one question at a time.
 *
 * On a full bookcase that becomes a stack of books in the air, and it is
 * walked in both directions:
 *
 *   down  each "no" takes one book off the end of the plank the last one was
 *         going on, and asks about that book instead, as deep as it needs to.
 *   up    each "yes" carries out one move, records where that book went, and
 *         hands the question back to the book underneath, which has not been
 *         asked about since the plank it is going on changed. A "no" there
 *         descends again from that point, by the route the first "no" took.
 *
 * The unwind is #110. It used to settle the entire chain on one yes at the
 * bottom, on the reasoning that every rung above was only waiting for room
 * below. Books are different thicknesses, so that is not true of a real
 * shelf, and the person is the only one who can say.
 *
 * Three things this screen used to run together, now kept apart:
 *
 *   showing    every level draws the plank it is about, with the gap where
 *              the book goes, on the same component the placing preview uses
 *              (#112). A sentence is harder to act on than a picture.
 *   applying   a proposal changes nothing. The boundary moves when somebody
 *              says they carried the book, one frame at a time (#111).
 *   recording  where a book physically ended up, written as it is confirmed,
 *              so an abandoned chain leaves behind what really happened.
 *
 * The stack itself lives in `lib/cascade.ts`, pure and tested away from here.
 */
export function ShelveView({
  placement, stale, range, title, saving, onShelved, onBack, onRefresh,
}: Props) {
  const [cascade, setCascade] = useState(emptyCascade)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  /** The frame awaiting a yes or no. Null means the question is about the book. */
  const pending = asking(cascade)

  // The derived shelf, not suggestedLocation: that belongs to the old
  // per-book scheme and names shelves the layout has never heard of.
  const shelfLabel = placement?.derivedLocation ?? ''

  /**
   * Whether the app yet knows which plank it is talking about.
   *
   * Every answer on this screen is an answer about a named plank, so none of
   * them can be given before there is one. Until #79 the placement was always
   * already loaded by the time anybody got here, because you arrived from the
   * review pane which had spent a while working it out. A boundary move opens
   * this screen directly, and a fast tap then answered "it fits" about no
   * plank at all: the save carried an empty label, the location write was
   * skipped, and the book stayed recorded where it had been. That is the same
   * silent loss as #61, reached a different way.
   *
   * A stale placement is the same question with a worse answer, and it is
   * #105: a boundary move changes the shelves, so the placement that was on
   * screen a moment ago names the plank the book has just come from. Empty
   * was caught and stale was not, and a stale label is indistinguishable from
   * a current one here, so it has to be said from outside. Answering against
   * it wrote the old plank into `location`, which is worse than answering
   * about nothing: the catalogue ends up confidently wrong rather than
   * silent, and nothing reports it, because the recorded location is exactly
   * what misfile detection compares against.
   *
   * The same hazard exists at every frame of a cascade, since every frame now
   * shows a placement too. It is answered there by redrawing the frame from
   * the shelves each time it becomes the question, and by the server refusing
   * to apply a move against a plank that no longer ends with the book the
   * person was told to carry.
   */
  const known = Boolean(shelfLabel) && !stale

  /**
   * Nothing on this shelf sorts after the book in your hand.
   *
   * Which makes it the one that moves when the shelf is full, so the button
   * says so. The server decides this for itself from the layout; this only
   * chooses the wording, because a button offering to shuffle a book that is
   * not going to be shuffled is the complaint in #77 restated on screen.
   */
  const atEndOfShelf =
    !!placement?.strip && placement.strip.gapIndex === placement.strip.books.length

  /**
   * "There is no room here." The one route for that answer, wherever it came
   * from.
   *
   * The no that starts a cascade and the no given to a frame on the way back
   * up are the same physical event: somebody at a plank saying it will not
   * take the book they are holding. Two paths for one question drift, which
   * is how several bugs here happened, so both arrive at this and both push a
   * frame the same way.
   *
   * Nothing on the shelves changes. What comes back is a proposal and a
   * picture of it, and the plank keeps every book it has until somebody says
   * they moved one (#111).
   */
  const overflowFrom = async (label: string, kind: 'shelf' | 'area') => {
    if (!label || busy) return
    setBusy(true)
    setError('')
    try {
      const plan = await api.planOverflow(range, label, kind, placement?.sortKey)

      /*
       * The book in your hand goes on instead, and nothing already shelved
       * moves, so there is nothing to put to anybody and this is applied at
       * once. It is not a cascade step: no book is displaced, so #111 has
       * nothing to hold back. The placing question is re-asked against the
       * plank it now goes on, once the refresh below has landed.
       */
      if (plan.carry) {
        const applied = await api.overflowShelf(range, label, kind, placement?.sortKey)
        const carry = applied.carry ?? plan.carry
        setCascade((now) => pushCarry(now, {
          id: 0, title, from: carry.from, to: carry.to,
        }))
        await onRefresh()
        return
      }

      if (!plan.step) {
        setError(`Nothing on ${label} can move along, so there is no gap to open.`)
        return
      }

      setCascade((now) => pushFrame(now, {
        from: label,
        kind,
        proposal: {
          id: plan.step!.id,
          title: plan.step!.title || 'the last book',
          authorFiling: plan.step!.authorFiling,
          to: plan.step!.to,
          strip: plan.strip,
        },
      }))
      // No refresh: nothing has moved, so the shelf on screen is still true.
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /**
   * The person says they have carried that one and it went in.
   *
   * Three statements, in this order, because that is the order the room made
   * them true. The furniture moves first, since the plank the book is now on
   * is a plank the layout does not put it on until the boundary has shifted;
   * then where the book physically is gets written down, which is the only
   * thing allowed to change a recorded location and the reason a shuffle does
   * not turn round and report itself as still outstanding; then the frame
   * comes off the stack.
   *
   * Doing both as the answer is given, rather than at the end, is what lets
   * somebody walk away four books deep and leave the catalogue honest: the
   * books they carried are on the shelves and recorded there, and the ones
   * still in the air were never claimed to have moved at all.
   *
   * Then exactly one frame comes off, and whatever is underneath is redrawn
   * before it is asked, because the moves just made were made on the plank it
   * is about.
   */
  const confirmPlaced = async () => {
    const frame = asking(cascade)
    if (!frame || busy) return

    setBusy(true)
    setError('')
    try {
      const applied = await api.overflowShelf(
        range, frame.from, frame.kind, placement?.sortKey, frame.proposal.id,
      )

      /*
       * The plank the server just put the book on, not the one drawn a moment
       * ago. They agree unless the shelves changed underneath, and when they
       * do it is the write that is right: recording against the older of the
       * two is exactly the stale answer #106 fixed.
       */
      const to = applied.step?.to || frame.proposal.to
      if (frame.proposal.id && to) await api.setLocation(frame.proposal.id, to)

      const settled = confirm(cascade, {
        id: frame.proposal.id, title: frame.proposal.title, from: frame.from, to,
      })

      const under = asking(settled)
      setCascade(under ? repropose(settled, await redraw(under.from, under.kind)) : settled)

      // Books have moved, so the drawn shelf is a lie until placement is
      // asked again. Awaited, or the next tap acts on the old shelf label.
      await onRefresh()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /** The frame under the one just confirmed, as the shelves now stand. */
  const redraw = async (from: string, kind: 'shelf' | 'area'): Promise<Proposal> => {
    const plan = await api.planOverflow(range, from, kind, placement?.sortKey)
    if (!plan.step) throw new Error(`There is nothing left on ${from} to move along.`)
    return {
      id: plan.step.id,
      title: plan.step.title || 'the last book',
      authorFiling: plan.step.authorFiling,
      to: plan.step.to,
      strip: plan.strip,
    }
  }

  return (
    <>
      {error && <div className="warn" onClick={() => setError('')}>{error}</div>}

      {/* One picture, of the question being asked. Four drawn strips stacked
          up do not fit a phone, and three of them would be about books
          nobody is holding yet. */}
      {pending ? (
        <div className={busy ? 'placement--stale' : ''}>
          <p className="placement-view__instruction">
            {pending.proposal.title}: end of {pending.from} to start of{' '}
            {pending.proposal.to}
          </p>
          {pending.proposal.strip ? (
            <div className="wf-bleed">
              <ShelfStrip
                strip={pending.proposal.strip}
                authorFiling={pending.proposal.authorFiling}
              />
            </div>
          ) : (
            <p className="hint">
              {pending.proposal.to} has nothing on it yet, so this book starts it.
            </p>
          )}
        </div>
      ) : (
        <div className="wf-bleed">
          <PlacementView placement={placement} pending={busy || stale} />
        </div>
      )}

      <MovesSoFar cascade={cascade} />

      <div className="shelve__ask">
        {pending ? (
          /* One plank along the chain. Answering yes carries the move out and
             hands the question to the one under it; answering no goes one
             plank further, from here. */
          <>
            <p className="shelve__where">{whereYouAre(cascade, title)}</p>

            <p>
              Take <strong>{pending.proposal.title}</strong> off the end of {pending.from}{' '}
              and put it at the start of <strong>{pending.proposal.to}</strong>. Did it
              fit there?
            </p>

            <div className="wf-answers">
              <Button
                tone="primary"
                block
                off={busy}
                onPress={() => void confirmPlaced()}
              >
                {busy ? 'Saving...' : 'Yes, it fit'}
              </Button>
              <Button
                block
                off={busy}
                onPress={() => overflowFrom(pending.proposal.to, 'area')}
              >
                {busy ? '...' : `No, ${pending.proposal.to} is full too`}
              </Button>
            </div>

            <p className="hint">
              {depth(cascade) > 1
                ? `Yes moves ${pending.proposal.title} to ${pending.proposal.to}, writes ` +
                  'it down, and asks about the book under it, which is still in your ' +
                  `hand. No takes the last book off ${pending.proposal.to} instead and ` +
                  'goes one deeper again.'
                : `Nothing has moved on the bookcase yet. Yes makes this move and ` +
                  `writes it down; no takes the last book off ${pending.proposal.to} as ` +
                  'well and asks about the plank after that. The chain can run as far ' +
                  'as it needs to, and every book on it is asked about again on the ' +
                  'way back.'}
            </p>
          </>
        ) : (
          <>
            <p>
              {known ? (
                <>
                  Put <strong>{title}</strong> in the gap at <strong>{shelfLabel}</strong>.
                  Does it fit{started(cascade) ? ' now' : ''}?
                </>
              ) : (
                <>Working out where <strong>{title}</strong> goes...</>
              )}
            </p>

            <div className="wf-answers">
              {/* The label the sentence above just named, handed on so the
                  answer to "does it fit here" is what gets recorded. Every
                  answer here is about a named plank, so none of them can be
                  given before there is one. */}
              <Button
                tone="primary"
                block
                off={saving || busy || !known}
                onPress={() => onShelved(shelfLabel)}
              >
                {saving ? 'Saving...' : 'It fits, save'}
              </Button>

              {/*
                Two answers where the drawing has one, and both are kept.
                "{area} is full" is one physical fact with two answers to it,
                because the next place a book can go is either the plank below
                or a bookcase that does not exist yet, and only the person
                standing there knows which.
              */}
              <Button
                block
                off={busy || saving || !known}
                onPress={() => overflowFrom(shelfLabel, 'area')}
              >
                {busy
                  ? '...'
                  : atEndOfShelf
                    ? 'No room, put it on the next area'
                    : started(cascade) ? 'Still no room' : 'No room, move one along'}
              </Button>
              <Button
                block
                off={busy || saving || !known}
                onPress={() => overflowFrom(shelfLabel, 'shelf')}
              >
                No room, start a new bookcase
              </Button>
            </div>

            <p className="hint">
              {atEndOfShelf
                ? `Nothing on ${shelfLabel || 'this area'} goes after this book, so ` +
                  'it is the one that moves. Everything already on the bookcase ' +
                  'stays where it is.'
                : `Each time you say there is no room, you are shown one more book ` +
                  `coming off the end of ${shelfLabel || 'the bookcase'}, and nothing ` +
                  'moves until you say you have moved it.'}
            </p>
          </>
        )}
      </div>

      <Button tone="quiet" block off={saving || busy} onPress={onBack}>
        Back to book details
      </Button>
    </>
  )
}

/**
 * Everything that has happened to the shelves so far, one line per move.
 *
 * There used to be a plank-to-plank summary above this list, `1B → 2A → 1A`
 * under a heading promising the order it happened. It is gone (#149): see
 * `cascade.ts` for why no single arrow line can be true of a cascade, and note
 * that it was wrong in front of somebody holding the books while the correct
 * version sat directly underneath it.
 *
 * Split out of `ShelveView` so what it draws can be read by a test. The pane
 * around it owns the network and the stack, and a false statement about the
 * shuffle had no way of being caught while it was welded to those.
 */
export function MovesSoFar({ cascade }: { cascade: Cascade }) {
  if (!started(cascade)) return null

  return (
    <div className="moves">
      {/* "Shuffle" is a lie when the only thing that moved is the book
          still in your hand, and nothing on the bookcase was touched. */}
      <strong>
        {cascade.done.every((step) => step.inHand) && !cascade.stack.length
          ? 'Where it went instead'
          : 'Shuffle, in the order it happened'}
      </strong>
      <ol>
        {cascade.done.map((step, i) => (
          <li key={`done-${i}`} className={step.inHand ? 'moves__carried' : 'moves__placed'}>
            {step.inHand ? (
              <>
                <strong>{step.title}</strong>: {step.from} was full, so it goes
                on to <strong>{step.to}</strong>. Nothing else moves.
              </>
            ) : (
              <>
                <strong>{step.title}</strong>: end of {step.from} to start of{' '}
                <strong>{step.to}</strong>
                <span className="moves__state"> · moved and written down</span>
              </>
            )}
          </li>
        ))}
        {cascade.stack.map((frame, i) => (
          <li
            key={`open-${i}`}
            className={i === cascade.stack.length - 1 ? 'moves__asking' : 'moves__waiting'}
          >
            <strong>{frame.proposal.title}</strong>: end of {frame.from} to start of{' '}
            <strong>{frame.proposal.to}</strong>
            <span className="moves__state">
              {i === cascade.stack.length - 1
                ? ' · in your hand now'
                : ' · still to check'}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

export type { Move }
