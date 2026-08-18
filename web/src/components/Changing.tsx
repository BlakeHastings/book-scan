/**
 * What a rule change would do, and what it did, drawn under the rule itself.
 *
 * **One definition, two callers**, which is the rule this app runs on: an
 * area's page and a piece's page both draw it, so the two cannot drift. It is
 * here rather than in `design/` because it reads a `Writing`, which is state,
 * and the design system holds none; what it draws is `WouldHappen` and
 * `Confirmation`, both of which are in the design system and are drawn in the
 * gallery.
 *
 * ## Three states and the middle one is the point
 *
 * Nothing, then the plan, then what the write did. **The plan is the only door
 * between editing a rule and a book moving**, and it is where every count that
 * matters is said out loud, pinned books included. The last state does not
 * report success and stop: it hands over the books, because applying wrote down
 * where they belong and moved none of them.
 */

import { Card, Confirmation } from '../design/Card'
import { Button } from '../design/Controls'
import { WouldHappen } from '../design/Rules'
import type { Writing } from '../app/writing'
import { leaving, movesOf, noteOf, wroteSaid } from '../lib/ruleWriting'
import { plural } from '../lib/furniture'

export function Changing({
  writing,
  onCarry,
}: {
  writing: Writing
  /** Where the books go from here, which is the list this app already keeps. */
  onCarry: () => void
}) {
  if (writing.applied) {
    const { wrote, carrying } = writing.applied
    return (
      <>
        <Confirmation said={wroteSaid(wrote)}>
          <p className="wf-said">
            {carrying > 0
              ? `The ${plural(carrying, 'book')} to carry are on your list, grouped into `
                + 'the trips you would walk. Say so on each one once it is actually there.'
              : 'No book has to be carried anywhere.'}
          </p>
        </Confirmation>
        <Button tone="primary" block onPress={onCarry}>
          {carrying > 0 ? 'Go and carry them' : 'Open the list'}
        </Button>
      </>
    )
  }

  if (!writing.plan) return null

  const { moving, more } = movesOf(writing.plan)
  return (
    <WouldHappen
      holds={writing.plan.holds}
      moving={moving}
      more={more}
      carrying={writing.plan.moving}
      staying={writing.plan.staying}
      leaving={leaving(writing.plan.skipped)}
      unclaimed={writing.plan.unclaimed.length}
      note={noteOf(writing.plan)}
      busy={writing.busy}
      onApply={() => { void writing.apply() }}
      onNotYet={() => writing.stop()}
    />
  )
}

/**
 * Whatever refused the change, where somebody is looking at it.
 *
 * Its own line rather than the page's error, because the page's error is about
 * the room and this is about the rule under a thumb: a refusal drawn at the top
 * of a screen somebody has scrolled past is a refusal nobody reads.
 */
export function Refusing({ said }: { said: string }) {
  if (!said) return null
  return <Card weight="quiet" kind="It would not take that" title={said} />
}
