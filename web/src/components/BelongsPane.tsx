/**
 * What belongs here: the rule that files books onto this area, and what beats
 * what when two of them want the same book.
 *
 * ## It reads and does not write, and that is a gap rather than a decision
 *
 * The drawing has a way to add another thing that must be true, a way to open
 * the rule from a book, and a "show me what would move" that lands on the plan.
 * None of the three can be built here honestly: **there is no route that reads
 * or writes a placement rule.** The rules are rows, `furnitureIn` reads them,
 * and nothing above that is reachable from a browser. Changing a rule and
 * seeing the plan is the other issue in this pair, and a button here that
 * pretended to do it would be worse than the screen not having one.
 *
 * What is left is worth having on its own, and it is the question the whole of
 * the furniture screens are for: why is this book on this plank rather than
 * that one. The answer is drawn the way the drawing draws it, in the tags a
 * person reads rather than the slugs the rule stores, and with the losing rule
 * shown beside the winning one, because the loser is the point.
 */

import { Card, Instruction } from '../design/Card'
import { TopBar, type TabName } from '../design/Chrome'
import { Must, Musts } from '../design/Furniture'
import { Place } from '../design/List'
import type { AreaDto, FixtureDto, FurnitureDto, RuleDto } from '../lib/api'
import { pieceSaid } from '../lib/furniture'
import { RoomFrame, Trouble } from './RoomFrame'

interface Props {
  room: FurnitureDto | null
  piece: FixtureDto | null
  area: AreaDto | null
  error: string
  tabs: Record<TabName, () => void>
  onBack: () => void
}

export function BelongsPane({ room, piece, area, error, tabs, onBack }: Props) {
  /**
   * Where a rule points, said the way this app says a place.
   *
   * A rule about a whole piece answers `4`, which is the label of the piece and
   * is not a thing anybody says out loud. The piece itself knows how it is
   * named, so it is asked.
   */
  const placeOf = (rule: RuleDto): string => {
    if (rule.about === 'area') return rule.place
    const standing = room?.fixtures.find((one) => one.id === rule.placeId)
    return standing ? pieceSaid(standing) : rule.place
  }

  const top = (
    <TopBar title="What belongs here" sub={area?.label} onBack={onBack} />
  )

  if (!piece || !area) {
    return (
      <RoomFrame top={top} tabs={tabs}>
        <Trouble said={error} />
      </RoomFrame>
    )
  }

  /*
   * Every rule that reaches this area, in the order that decides ties: the one
   * about the smaller place first. The area's own rule is whichever one won,
   * and the piece's is the one it beat, so a screen that showed only the winner
   * would be answering half the question somebody opened it to ask.
   */
  const reaching = [area.rule, piece.rule]
    .filter((rule): rule is RuleDto => rule !== null)
    .filter((rule, at, all) => all.findIndex((one) => one.id === rule.id) === at)
    .sort((a, b) => Number(b.about === 'area') - Number(a.about === 'area'))

  const won = area.rule

  return (
    <RoomFrame top={top} tabs={tabs}>
      <Trouble said={error} />

      <Instruction>
        {won
          ? (area.entry
            ? `${won.said} files onto ${area.label}.`
            : `${won.said} files onto ${placeOf(won)}, and runs on into ${area.label}.`)
          : `Nothing files onto ${area.label}. What stands here was put here by hand.`}
      </Instruction>

      {won && (
        <Card kind="The rule" title={won.name}>
          <Musts>
            {won.conditions.map((condition, at) => (
              <Must
                key={condition.tag + condition.operator}
                join={at === 0 ? undefined : 'and'}
                lead={condition.operator === 'under' ? 'Tagged anything under' : 'Tagged'}
                tag={condition.tag}
              />
            ))}
          </Musts>
          {won.conditions.length === 0 && (
            <p>It asks for nothing, so it claims nothing. Every line has to be true.</p>
          )}
          {!won.enabled && <p>It is turned off, so it claims no book at the moment.</p>}
        </Card>
      )}

      {reaching.length > 1 && (
        <Card
          kind="When two rules want the same book"
          title="The one about the smaller place wins"
        >
          <div className="wf-steps">
            {reaching.map((rule, at) => (
              <div className="wf-step" key={rule.id}>
                <span className="wf-step__n">{at + 1}</span>
                <span>
                  {rule.name}, <Place quiet>{placeOf(rule)}</Place>
                  {rule.about === 'fixture' ? ' and everything after it' : ''}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

    </RoomFrame>
  )
}
