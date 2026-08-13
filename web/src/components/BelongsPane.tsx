/**
 * What belongs here: the rule that files books onto this area, what beats what
 * when two of them want the same book, and the way to point it somewhere else.
 *
 * ## It reaches the change rather than being a second way to make it
 *
 * #313 built this read-only because nothing in the app could change a rule.
 * Something can now, and it is not new: `MoveRunView` retargets a rule, plans
 * the change and applies it, and the carry flow reads what that produces. So the
 * button here **goes there**. That is the honest answer #323 asked for out loud,
 * and it is the difference between one journey with two ways in and two journeys
 * that agree until somebody changes one.
 *
 * What that costs is that a rule the app cannot retarget gets no button. A rule
 * carries the stretch of books it is the rule for, or a null, and the null is
 * said in words rather than drawn as a target that would refuse.
 *
 * ## The books, and the ones nothing claims
 *
 * "Why is this book on this plank rather than that one" is the question the
 * whole of the furniture screens are for, and it is asked of a book. So the
 * books standing here are listed and each one opens the answer. The list is read
 * by identity, from the area's own route, rather than by matching a label.
 *
 * **A book no rule claims is said out loud.** It is a real state since #304:
 * nothing states a genre, no tag is written, no rule matches it. It stands
 * exactly where somebody put it and no plan will ever move it, which is
 * invisible from the counts and is the thing somebody would otherwise find out
 * by a book never appearing on a carry list.
 */

import { Card, Instruction } from '../design/Card'
import { TopBar, type TabName } from '../design/Chrome'
import { Button } from '../design/Controls'
import { Must, Musts } from '../design/Furniture'
import { List, Place, Row } from '../design/List'
import type { AreaBook, AreaDto, FixtureDto, FurnitureDto, RuleDto } from '../lib/api'
import type { Cloth } from '../design/Shelf'
import { counted, rulePlace } from '../lib/furniture'
import { RoomFrame, Trouble } from './RoomFrame'

interface Props {
  room: FurnitureDto | null
  piece: FixtureDto | null
  area: AreaDto | null
  /** What is standing here, in the order it stands. Empty while it loads. */
  books: AreaBook[]
  error: string
  tabs: Record<TabName, () => void>
  onBack: () => void
  /** Point the rule at other furniture: #244's screen, and there is one of it. */
  onChange: () => void
  /** Why one book is here, which is the screen both this and a book reach. */
  onClaimed: (bookId: number) => void
}

const CLOTHS: Cloth[] = ['moss', 'plum', 'sky', 'sun', 'wood', 'wood2']
const clothFor = (id: number): Cloth => CLOTHS[Math.abs(id) % CLOTHS.length]!

export function BelongsPane({
  room, piece, area, books, error, tabs, onBack, onChange, onClaimed,
}: Props) {
  /** Where a rule points, said the way this app says a place. See `rulePlace`. */
  const placeOf = (rule: RuleDto): string => rulePlace(room, rule)

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
  const orphans = books.filter((book) => book.claimedBy === null)
  // A card title is a sentence and starts like one. `counted` writes the number
  // out in words, so its first character is the one that has to be lifted.
  const orphansSaid = counted(orphans.length, 'book')
  const orphansTitle = `${orphansSaid.charAt(0).toUpperCase()}${orphansSaid.slice(1)} here `
    + `${orphans.length === 1 ? 'matches' : 'match'} no rule at all`

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

      {/*
        The books, each one a way into why it is here. Not folded away: this is
        the screen somebody opens when a book turned up somewhere surprising,
        and the book they came about is in this list.
      */}
      {books.length > 0 && (
        <>
          <p className="wf-heading wf-heading--flush">Standing on {area.label}</p>
          <List label={`Books on ${area.label}`}>
            {books.map((book) => (
              <Row
                key={book.id}
                title={book.title}
                sub={book.authorFiling}
                cloth={clothFor(book.id)}
                meta={book.claimedBy === null ? 'No rule claims it' : undefined}
                onPress={() => onClaimed(book.id)}
              />
            ))}
          </List>
        </>
      )}

      {orphans.length > 0 && (
        <Card
          weight="quiet"
          kind="Claimed by nothing"
          title={orphansTitle}
        >
          <p>
            Nothing says what {orphans.length === 1 ? 'it is' : 'they are'} about, so no
            rule wants {orphans.length === 1 ? 'it' : 'them'} and no plan will ever move{' '}
            {orphans.length === 1 ? 'it' : 'them'}. Tagging{' '}
            {orphans.length === 1 ? 'it' : 'them'} is what settles that.
          </p>
        </Card>
      )}

      {won && (won.range
        ? (
          <Button tone="primary" block onPress={onChange}>
            Point {won.name} somewhere else
          </Button>
        )
        : (
          <Card
            weight="quiet"
            kind="Changing it"
            title={`${won.name} cannot be pointed somewhere else yet`}
          >
            <p>
              What can be moved is a whole stretch of books that begins on a piece of
              furniture. This one is about a single area, and there is nothing here
              that would move it honestly.
            </p>
          </Card>
        ))}
    </RoomFrame>
  )
}
