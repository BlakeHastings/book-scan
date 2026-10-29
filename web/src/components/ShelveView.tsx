import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { api, type AtAPlace, type FixtureDto, type Move, type PlacementResponse } from '../lib/api'
import {
  asking, confirm, pushCarry, pushFrame, repropose,
  started, whereYouAre, type Cascade, type Proposal,
} from '../lib/cascade'
import { PlacementView, ShelfStrip } from './ShelfStrip'
import { whereItGoes } from '../lib/whereWords'
import { Trouble } from './RoomFrame'
import { Card, Instruction, Said } from '../design/Card'
import { Button } from '../design/Controls'
import type { ShelfRange } from '../../shared/shelving'

interface Props {
  placement: PlacementResponse | null
  /**
   * True while the placement on screen may be out of date. A stale placement
   * still names a real plank and looks identical to a current one, so
   * answering against it here would record the wrong location.
   */
  stale: boolean
  /**
   * Null when no genre tag claims this book. Every question here is about a
   * plank in one of the two runs, so a book in neither cannot be asked about.
   */
  range: ShelfRange | null
  title: string
  saving: boolean
  /**
   * The plank's id, not its label: only the id says which place it is, since
   * a label is derived and can differ between screens.
   */
  onShelved: (shelvedAt: number) => void
  onBack: () => void
  /**
   * Two ways into this screen: a book newly scanned, and one carried off a
   * bookcase after a rule change displaced it. "Back to book details" is
   * only true of the first.
   */
  backSaid?: string
  /**
   * Owned by the caller, not local state: a screen unmounts when the route
   * changes, which would lose the record of books already carried, and this
   * component does not unmount between two books of one armful, which would
   * leak the previous book's shuffle into the next.
   */
  cascade: Cascade
  setCascade: Dispatch<SetStateAction<Cascade>>
  /** Re-read placement after a move, so the strip shows the shelf as it is now. */
  onRefresh: () => Promise<unknown>
  /**
   * Only for a catalogued book: a book not yet saved is placed by its insert,
   * which takes no plank, so offering it a choice would write nothing.
   */
  byHand?: boolean
  /**
   * Where the rules want a catalogued book, from its claim. The run's gap above
   * comes from sort order alone, so a plank's rule for one subject can want the
   * book somewhere else; null when no rule claims it or nobody has asked.
   */
  wanted?: AtAPlace | null
  /**
   * Answers the one question a book with no genre needs before it has a
   * shelf. Without it the screen can only send somebody back to say.
   */
  onGenre?: (range: ShelfRange) => void
  /** The catalogued book this one is a second copy of, when it is one. */
  otherCopy?: number | null
}

/**
 * Nothing here predicts whether a shelf has room, because nothing can:
 * capacity depends on the thickness of whatever is already on it. So the
 * person is the sensor, and the screen only ever asks one question at a time.
 *
 * This is a cascade of yes/no answers, walked in both directions: each "no"
 * asks about the book that would now need to move; each "yes" applies the
 * move, records it, and hands the question back to the book underneath,
 * which is re-asked since the plank it is going on has just changed. The
 * stack unwinds step by step rather than being resolved from the bottom in
 * one go, because books are different thicknesses and only the person at the
 * shelf can say whether one fits.
 *
 * The stack itself lives in `lib/cascade.ts`, pure and tested away from here.
 */
export function ShelveView({
  placement, stale, range, title, saving, onShelved, onBack,
  backSaid = 'Back to book details', cascade, setCascade, onRefresh, byHand = false,
  wanted = null, onGenre, otherCopy = null,
}: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  /** The frame awaiting a yes or no. Null means the question is about the book. */
  const pending = asking(cascade)

  // Not `suggestedLocation`: that belongs to the old per-book scheme and
  // names shelves the layout no longer knows about.
  const shelfLabel = placement?.derivedLocation ?? ''
  // The same plank as `shelfLabel`, but the id: what gets written down, not
  // what is displayed.
  const shelfAreaId = placement?.derivedAreaId ?? null

  // True only once there is a real plank id and a non-stale placement to
  // answer about; answering against a missing or stale plank would either
  // skip the write or silently record the wrong location.
  const known = shelfAreaId !== null && Boolean(shelfLabel) && !stale

  // `known` is also false while a placement is loading or stale, both of
  // which end on their own; this one does not, since nothing is coming
  // until somebody writes a rule, so it must not be drawn as a wait.
  const nowhere = placement?.kind === 'range-has-no-start'

  const choosing = byHand && (range === null || nowhere)

  // Which book moves when the shelf is full: the server decides this from
  // the layout, and this only chooses the button's wording.
  const atEndOfShelf =
    !!placement?.strip && placement.strip.gapIndex === placement.strip.books.length

  // The no that starts a cascade and the no given partway back up are the
  // same event (somebody at a plank saying it will not take the book), so
  // both funnel through here rather than duplicating the push. Nothing on
  // the shelves actually changes until somebody says they moved a book.
  const overflowFrom = async (areaId: number | null, kind: 'shelf' | 'area') => {
    if (busy || range === null) return
    if (areaId === null) {
      setError('That shelf does not exist yet, so there is nothing on it to move along.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const plan = await api.planOverflow(range, areaId, kind, placement?.sortKey)

      // Applied at once, not as a cascade step: the book in hand goes on
      // instead and nothing already shelved is displaced, so there is
      // nothing to ask anybody about.
      if (plan.carry) {
        const applied = await api.overflowShelf(range, areaId, kind, placement?.sortKey)
        const carry = applied.carry ?? plan.carry
        setCascade((now) => pushCarry(now, {
          id: 0, title, from: carry.from, to: carry.to,
        }))
        await onRefresh()
        return
      }

      if (!plan.step) {
        setError('Nothing on this shelf can move along, so there is no gap to open.')
        return
      }

      setCascade((now) => pushFrame(now, {
        fromAreaId: areaId,
        from: plan.step!.from,
        kind,
        proposal: {
          id: plan.step!.id,
          title: plan.step!.title || 'the last book',
          authorFiling: plan.step!.authorFiling,
          to: plan.step!.to,
          toAreaId: plan.step!.toAreaId,
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
   * Order matters: the furniture moves first (the layout will not place the
   * book on the new plank until the boundary has shifted), then the physical
   * location is recorded, then the frame comes off the stack. Doing both
   * writes as each answer is given, rather than at the end, is what lets
   * somebody walk away mid-cascade and leave the catalogue honest: books
   * already carried are recorded, and the ones still in the air were never
   * claimed to have moved.
   */
  const confirmPlaced = async () => {
    const frame = asking(cascade)
    if (!frame || busy || range === null) return

    setBusy(true)
    setError('')
    try {
      const applied = await api.overflowShelf(
        range, frame.fromAreaId, frame.kind, placement?.sortKey, frame.proposal.id,
      )

      // The plank the server actually put the book on, not the one drawn a
      // moment ago: they can differ if the shelves changed underneath, and
      // the server's answer is the one to record.
      const to = applied.step?.to || frame.proposal.to
      const toAreaId = applied.step?.toAreaId ?? frame.proposal.toAreaId
      if (frame.proposal.id && toAreaId !== null) {
        await api.setLocationIn(frame.proposal.id, toAreaId)
      }

      const settled = confirm(cascade, {
        id: frame.proposal.id, title: frame.proposal.title, from: frame.from, to,
      })

      const under = asking(settled)
      setCascade(
        under ? repropose(settled, await redraw(under.fromAreaId, under.kind)) : settled,
      )

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
  const redraw = async (fromAreaId: number, kind: 'shelf' | 'area'): Promise<Proposal> => {
    if (range === null) throw new Error('Nothing files this book, so there is no shelf to redraw.')
    const plan = await api.planOverflow(range, fromAreaId, kind, placement?.sortKey)
    if (!plan.step) throw new Error('There is nothing left on that shelf to move along.')
    return {
      id: plan.step.id,
      title: plan.step.title || 'the last book',
      authorFiling: plan.step.authorFiling,
      to: plan.step.to,
      toAreaId: plan.step.toAreaId,
      strip: plan.strip,
    }
  }

  return (
    <>
      <Trouble said={error} />

      {/* One picture, of the question being asked. Four drawn strips stacked
          up do not fit a phone, and three of them would be about books
          nobody is holding yet. */}
      {pending ? (
        <div className={busy ? 'placement--stale' : ''}>
          <Instruction>
            {pending.proposal.title}: end of {pending.from} to start of{' '}
            {pending.proposal.to}
          </Instruction>
          {pending.proposal.strip ? (
            <div className="wf-bleed">
              <ShelfStrip
                strip={pending.proposal.strip}
                inHand={pending.proposal.title}
              />
            </div>
          ) : (
            <Said>
              {pending.proposal.to} has nothing on it yet, so this book starts it.
            </Said>
          )}
        </div>
      ) : placement && range !== null ? (
        // The sentence sits outside the bleed so it keeps the page's margins;
        // only the drawn shelf runs edge to edge.
        <div className={busy || stale ? 'placement--stale' : ''}>
          {!nowhere && <Instruction>{whereItGoes(placement, title, otherCopy)}</Instruction>}
          <div className="wf-bleed">
            <PlacementView placement={placement} pending={false} instruction={false} />
          </div>
        </div>
      ) : null}

      <MovesSoFar cascade={cascade} />

      {wanted && !pending && !started(cascade) && wanted.areaId !== shelfAreaId && (
        <Card title={`The rules put it on ${wanted.label}`}>
          <Said>
            A rule claims {title} for {wanted.label}. Put it there and say so, or
            answer about the gap below instead.
          </Said>
          <Button
            tone="primary"
            block
            off={saving || busy}
            onPress={() => onShelved(wanted.areaId)}
          >
            {saving ? 'Saving...' : `It is on ${wanted.label}, save`}
          </Button>
        </Card>
      )}

      {/* A hook and nothing else: `Card` has no way of being named from
          outside, and browser tests refer to this as "the question". */}
      <div className="shelve__ask">
        <Card>
          {pending ? (
            <>
              <Said>{whereYouAre(cascade, title)}</Said>

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
                  onPress={() => overflowFrom(pending.proposal.toAreaId, 'area')}
                >
                  {busy ? '...' : `No, ${pending.proposal.to} is full too`}
                </Button>
              </div>
            </>
          ) : range === null ? (
            onGenre ? (
              // Every rule starts from fiction or non-fiction, so this is the
              // one thing a book needs before it has a shelf. Asked here, where
              // somebody is standing with it, rather than two screens back.
              <>
                <p>
                  Is <strong>{title}</strong> fiction or non-fiction?
                </p>
                <div className="wf-answers">
                  <Button tone="primary" block off={saving || busy} onPress={() => onGenre('fiction')}>
                    Fiction
                  </Button>
                  <Button tone="primary" block off={saving || busy} onPress={() => onGenre('nonfiction')}>
                    Non-fiction
                  </Button>
                </div>
                {choosing && <Said>Or choose a shelf for it below.</Said>}
              </>
            ) : (
              <p>
                Nothing says whether <strong>{title}</strong> is fiction or
                non-fiction, so there is no shelf to put it on. Go back and say
                which it is{choosing ? ', or choose a shelf for it below' : ''}.
              </p>
            )
          ) : (
            <>
              <p>
                {nowhere ? (
                  // A different absence from a book with no genre: this book
                  // has a range, but no rule says where the range itself begins.
                  <>
                    Nothing says where {range === 'fiction' ? 'fiction' : 'non-fiction'}
                    {' '}begins, so there is nowhere
                    to put <strong>{title}</strong> yet. Say what belongs on a
                    bookcase or a shelf first, and this book has a place
                    {choosing ? ', or choose a shelf for it below' : ''}.
                  </>
                ) : known ? (
                  <>
                    Put <strong>{title}</strong> in the gap at <strong>{shelfLabel}</strong>.
                    Does it fit{started(cascade) ? ' now' : ''}?
                  </>
                ) : (
                  <>Working out where <strong>{title}</strong> goes...</>
                )}
              </p>

              <div className="wf-answers">
                {/* Handed on as the plank id, not its name: the name is a
                    rendering, and what gets written down is a place. */}
                <Button
                  tone="primary"
                  block
                  off={saving || busy || !known}
                  onPress={() => shelfAreaId !== null && onShelved(shelfAreaId)}
                >
                  {saving ? 'Saving...' : 'It fits, save'}
                </Button>

                {/* One physical fact, two answers: the next place is either
                    the next plank or a new bookcase, and only the person
                    there knows which. */}
                <Button
                  block
                  off={busy || saving || !known}
                  onPress={() => overflowFrom(shelfAreaId, 'area')}
                >
                  {busy
                    ? '...'
                    : atEndOfShelf
                      ? 'No room, put it on the next shelf'
                      : started(cascade) ? 'Still no room' : 'No room, move one along'}
                </Button>
                <Button
                  block
                  off={busy || saving || !known}
                  onPress={() => overflowFrom(shelfAreaId, 'shelf')}
                >
                  No room, start a new bookcase
                </Button>
              </div>

              {nowhere && (
                <Said>
                  Where a range begins is whatever your rules say, and no rule
                  says this one. Nothing has been changed and nothing is lost:
                  the book is where you are holding it and the run fills back in
                  as soon as a rule points it at a piece of furniture.
                </Said>
              )}
            </>
          )}
        </Card>
      </div>

      {choosing && !pending && (
        <ChooseAPlank
          title={title}
          off={saving || busy}
          onChosen={(areaId) => onShelved(areaId)}
        />
      )}

      <Button tone="quiet" block off={saving || busy} onPress={onBack}>
        {backSaid}
      </Button>
    </>
  )
}

function ChooseAPlank({
  title, off, onChosen,
}: { title: string; off: boolean; onChosen: (areaId: number) => void }) {
  const [fixtures, setFixtures] = useState<FixtureDto[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    api.furniture()
      .then((room) => { if (live) setFixtures(room.fixtures) })
      .catch((caught) => { if (live) setError((caught as Error).message) })
    return () => { live = false }
  }, [])

  return (
    <>
      <Trouble said={error} />
      <PlankChoice title={title} fixtures={fixtures} off={off} onChosen={onChosen} />
    </>
  )
}

/** Retired planks are in `fixture.gone`, not `areas`, so they are never offered. */
export function PlankChoice({
  title, fixtures, off, onChosen,
}: {
  title: string
  /** Null while the room is being read. */
  fixtures: FixtureDto[] | null
  off: boolean
  onChosen: (areaId: number) => void
}) {
  const pieces = (fixtures ?? []).filter((fixture) => fixture.areas.length > 0)

  return (
    <Card title="Put it somewhere yourself">
      {fixtures === null ? (
        <Said>Reading the room...</Said>
      ) : pieces.length === 0 ? (
        <Said>
          There is no furniture to put {title} on yet. Add a bookcase under Your
          fixtures, then come back to this book.
        </Said>
      ) : (
        <>
          <Said>Choose the shelf you put {title} on, and it is written down there.</Said>
          {pieces.map((fixture) => (
            <div
              key={fixture.id}
              className="shelve__by-hand"
              role="group"
              aria-label={fixture.name || fixture.label}
            >
              <span className="wf-card__kind">{fixture.name || fixture.label}</span>
              <div className="wf-answers">
                {fixture.areas.map((area) => (
                  <Button key={area.id} block off={off} onPress={() => onChosen(area.id)}>
                    {`On ${area.label}`}
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </Card>
  )
}

/**
 * Split out of `ShelveView` so what it draws can be tested directly, without
 * the network calls and stack it otherwise sits inside.
 */
export function MovesSoFar({ cascade }: { cascade: Cascade }) {
  if (!started(cascade)) return null

  return (
    <Card
      title={
        // "Shuffle" would be wrong when only the book in hand moved and
        // nothing on the bookcase did.
        cascade.done.every((step) => step.inHand) && !cascade.stack.length
          ? 'Where it went instead'
          : 'Shuffle, in the order it happened'
      }
    >
      <div className="wf-steps">
        {cascade.done.map((step, i) => (
          <div className="wf-step" key={`done-${i}`}>
            <span className="wf-step__n">{i + 1}</span>
            <span>
              {step.inHand ? (
                <>
                  <strong>{step.title}</strong>: {step.from} was full, so it goes
                  on to <strong>{step.to}</strong>. Nothing else moves.
                </>
              ) : (
                <>
                  <strong>{step.title}</strong>: end of {step.from} to start of{' '}
                  <strong>{step.to}</strong> · moved and written down
                </>
              )}
            </span>
          </div>
        ))}
        {cascade.stack.map((frame, i) => (
          <div className="wf-step" key={`open-${i}`}>
            <span className="wf-step__n">{cascade.done.length + i + 1}</span>
            <span>
              <strong>{frame.proposal.title}</strong>: end of {frame.from} to start of{' '}
              <strong>{frame.proposal.to}</strong>
              {i === cascade.stack.length - 1
                ? ' · in your hand now'
                : ' · still to check'}
            </span>
          </div>
        ))}
      </div>
    </Card>
  )
}

export type { Move }
