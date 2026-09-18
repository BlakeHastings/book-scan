/**
 * Lives here rather than in `design/` because it reads a `Writing`, which is
 * state; what it draws (`WouldHappen`, `Confirmation`) is in the design
 * system. Applying a plan writes down where books belong and moves none of
 * them: carrying them is a separate, later act.
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

/** Separate from the page's own error: that is about the room, this is about the rule under a thumb, and a refusal at the top of a screen somebody has scrolled past goes unread. */
export function Refusing({ said }: { said: string }) {
  if (!said) return null
  return <Card weight="quiet" kind="It would not take that" title={said} />
}
