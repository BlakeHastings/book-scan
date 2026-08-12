import { useCallback, useEffect, useState } from 'react'
import {
  api, type PlanGroup, type RunMovePlan, type ShelfGroupDto, type SkipReason,
} from '../lib/api'
import type { ShelfRange } from '../../shared/shelving'

interface Props {
  range: ShelfRange
  onBack: () => void
  /** Where the books to carry are listed, which is where this screen ends. */
  onLibrary: () => void
}

const RUN_NAME: Record<ShelfRange, string> = {
  fiction: 'fiction',
  nonfiction: 'non-fiction',
}

/**
 * Why a book is being left alone, said as a reason rather than as a count with
 * no explanation.
 *
 * A plan that says "50 books move" having quietly dropped three pinned ones is
 * lying by omission, and a plan that says "3 skipped" without saying why is
 * only slightly better: the person cannot tell whether that is expected.
 */
const SKIP_SAID: Record<SkipReason, string> = {
  pinned: 'pinned to where they are, which beats every rule',
  'checked-out': 'checked out, so they are not on a bookcase to carry off one',
  withdrawn: 'withdrawn from the collection',
  'never-placed': 'never confirmed onto a bookcase, so there is nowhere to carry them from',
}

/**
 * Move a whole run onto another bookcase: say where it should live, see every
 * book that has to be carried, then record it.
 *
 * ## Plan and apply are one screen because they are one idea
 *
 * A plan nobody can act on is a report, and an apply with no preview is a leap
 * on somebody's actual shelves. So the button that writes appears only under a
 * plan that has been drawn, and it says how many books it is about.
 *
 * ## Nothing here moves a book
 *
 * Applying records where the rules want each book. The books move when a person
 * carries them and says so, and **the list of what is still outstanding already
 * exists**: it is the needs-attention list in the library, which is an
 * assignment disagreeing with where the book was last seen. This screen ends by
 * pointing at it rather than by growing a second one.
 *
 * ## A plan is not a flat list
 *
 * 187 moves on a 414 pixel screen is not something anybody reads standing in
 * front of a bookcase. The summary is one line per pair of planks, which is what
 * somebody acts on; the books are folded away underneath, which is what they
 * open when a number looks wrong. `details` rather than a hand-rolled accordion:
 * it is a touch target the browser already gets right.
 */
export function MoveRunView({ range, onBack, onLibrary }: Props) {
  const [groups, setGroups] = useState<ShelfGroupDto[]>([])
  const [bookcase, setBookcase] = useState(0)
  const [plan, setPlan] = useState<RunMovePlan | null>(null)
  const [applied, setApplied] = useState<{ moved: number; wrote: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  /*
   * Where the run stands, read off the same layout the library draws. The
   * number in the stepper starts there, so the first tap is a decision rather
   * than a correction.
   */
  const load = useCallback(() => {
    setPlan(null)
    setApplied(null)
    api.shelves(range)
      .then((shelves) => {
        setGroups(shelves.groups)
        setBookcase(shelves.groups[0]?.shelf ?? 1)
      })
      .catch((caught) => setError((caught as Error).message))
  }, [range])

  useEffect(() => { load() }, [load])

  const livesOn = groups[0]?.shelf ?? 0

  const run = async (what: 'plan' | 'apply') => {
    setBusy(true)
    setError('')
    try {
      if (what === 'plan') {
        setPlan(await api.planRunMove(range, bookcase))
        setApplied(null)
        return
      }
      const result = await api.applyRunMove(range, bookcase)
      setApplied({ moved: result.plan.moving, wrote: result.wrote.assigned })
      setPlan(result.plan)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="main">
      <button className="btn btn--ghost runmove__back" onClick={onBack}>Back to the library</button>

      <h2 className="runmove__head">Move the {RUN_NAME[range]} run</h2>

      {error && <div className="error" onClick={() => setError('')}>{error}</div>}

      {groups.length === 0
        ? <p className="hint">Nothing is shelved in this run yet, so there is nothing to move.</p>
        : (
          <p className="hint">
            It lives on bookcase {livesOn}: {groups.map((group) =>
              `${group.label} (${group.books.length})`).join(', ')}.
            The planks come with it, so the same books stay together.
          </p>
        )}

      <div className="runmove__pick">
        <span className="runmove__pick-label">Move it to bookcase</span>
        <div className="runmove__stepper">
          <button
            className="btn btn--ghost"
            aria-label="Lower bookcase number"
            disabled={bookcase <= 1 || busy}
            onClick={() => { setBookcase((at) => Math.max(1, at - 1)); setPlan(null) }}
          >
            &minus;
          </button>
          <span className="runmove__number" aria-live="polite">{bookcase}</span>
          <button
            className="btn btn--ghost"
            aria-label="Higher bookcase number"
            disabled={busy}
            onClick={() => { setBookcase((at) => at + 1); setPlan(null) }}
          >
            +
          </button>
        </div>
      </div>

      <button
        className="btn btn--primary runmove__go"
        disabled={busy || groups.length === 0}
        onClick={() => run('plan')}
      >
        {busy ? 'Working...' : 'Plan the move'}
      </button>

      {/* Said out loud rather than left as an empty plan. */}
      {plan && plan.planks.length === 0 && !applied && (
        <p className="hint">
          The {RUN_NAME[range]} run already starts on bookcase {plan.to}.
        </p>
      )}

      {plan && <RunPlanPanel plan={plan} />}

      {plan && !applied && (
        <>
          <p className="hint">
            Applying writes down where each book belongs. It does not move anything:
            the books move when you carry them and say so.
          </p>
          <button
            className="btn btn--primary runmove__go"
            disabled={busy}
            onClick={() => run('apply')}
          >
            {busy ? 'Working...' : `Apply, and go and carry ${plan.moving}`}
          </button>
        </>
      )}

      {applied && (
        <section className="runmove__done">
          <h3>Done.</h3>
          <p>
            {applied.wrote} book{applied.wrote === 1 ? '' : 's'} now recorded as belonging
            somewhere else. {applied.moved > 0
              ? `The ${applied.moved} to carry are in Needs attention, in the library.`
              : 'Nothing needs carrying.'}
            {' '}Tap "Moved it" on each once it is actually there.
          </p>
          <button className="btn btn--primary runmove__go" onClick={onLibrary}>
            Open the list
          </button>
        </section>
      )}
    </main>
  )
}

/**
 * The plan itself, drawn.
 *
 * Split out and holding no state of its own, so what it says can be held to a
 * claim in a test rather than only looked at. That is the same reason
 * `MovesSoFar` is split out of `ShelveView`.
 *
 * **Every book the rules will not touch is on this panel**, with the reason. A
 * plan that reported 50 moves having quietly left three pinned books out would
 * be believed, and the person would come back from the shelf three books short
 * with no idea why.
 */
export function RunPlanPanel({ plan }: { plan: RunMovePlan }) {
  return (
    <section className="runmove__plan">
      {plan.planks.length > 0 && (
        <p className="runmove__planks">
          {plan.planks.map((plank) => `${plank.from} → ${plank.to}`).join(', ')}
        </p>
      )}

      <h3 className="runmove__count">
        {plan.moving} book{plan.moving === 1 ? '' : 's'} to carry
      </h3>

      {plan.groups.map((group) => <Group key={`${group.from}${group.to}`} group={group} />)}

      {plan.staying > 0 && (
        <p className="hint">
          {plan.staying} book{plan.staying === 1 ? ' stays' : 's stay'} exactly where
          {plan.staying === 1 ? ' it is' : ' they are'}.
        </p>
      )}

      {plan.skipped.map((skipped) => (
        <details className="runmove__group" key={skipped.reason}>
          <summary>
            {skipped.books.length} left alone: {SKIP_SAID[skipped.reason]}
          </summary>
          <Books books={skipped.books} />
        </details>
      ))}

      {plan.unclaimed.length > 0 && (
        <details className="runmove__group">
          <summary>
            {plan.unclaimed.length} that no rule claims, so the rules have nowhere
            to put {plan.unclaimed.length === 1 ? 'it' : 'them'}
          </summary>
          <Books books={plan.unclaimed} />
        </details>
      )}
    </section>
  )
}

function Group({ group }: { group: PlanGroup }) {
  return (
    <details className="runmove__group">
      <summary>
        <strong>{group.books.length}</strong>
        {' '}
        book{group.books.length === 1 ? '' : 's'} · {group.from} →{' '}
        <strong>{group.to}</strong>
      </summary>
      <Books books={group.books} />
    </details>
  )
}

function Books({ books }: { books: { id: number; title: string; authorFiling: string }[] }) {
  return (
    <ul className="runmove__books">
      {books.map((book) => (
        <li key={book.id}>
          {book.title}
          <span className="runmove__author">{book.authorFiling || 'unknown author'}</span>
        </li>
      ))}
    </ul>
  )
}
