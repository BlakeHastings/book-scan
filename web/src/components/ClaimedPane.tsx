/**
 * Why this book is here: which rule claimed it, which ones lost, and what would
 * happen if the winner changed.
 *
 * **The one screen that makes the rules legible to somebody who did not write
 * them**, which is the whole household except the owner. Two screen groups reach
 * it, the furniture and the book page, and it is one component so that the two
 * cannot drift into two explanations of one decision.
 *
 * ## The losers are the point
 *
 * A book that lands somewhere surprising is the moment the whole idea either
 * explains itself or turns into magic, and the explanation is always the same
 * two sentences: which rules asked for this book, and why that one beat this
 * one. So every rule that wanted it is drawn, in the order the decision was
 * made, and the ones that lost say why.
 *
 * ## A book no rule claims
 *
 * A real state since #304 and the first thing this screen has to survive:
 * nothing states a genre, no tag is written, no rule matches. There is no
 * winner, no loser, and nowhere the rules would put it. That is said plainly and
 * the way out is said with it, because a book in that state stands exactly where
 * somebody left it and no plan will ever move it.
 *
 * **And since #341 the way out is a button rather than a sentence.** That issue
 * named this screen by name: it explained an unclaimed book and offered it no
 * action at all, on the one screen somebody reaches while holding the book and
 * wondering. It offers #377's panel now, which is the one way this app adds a
 * tag by hand, and it is the same panel the list of these books opens. Nothing
 * here writes a tag by itself, which is #304 and was the owner's explicit
 * instruction.
 *
 * ## Where it is and where the rules want it are two facts
 *
 * They disagree exactly when the book is waiting to be carried, and that
 * disagreement is the carry list rather than something this screen reconciles.
 * Saying both is how somebody sees that for themselves.
 *
 * **`pinned` beats every rule, forever**, so a pinned book still names the rule
 * that would otherwise have claimed it. Hiding it would leave nobody able to see
 * what the pin is overruling.
 */

import { Card, Instruction } from '../design/Card'
import { TopBar, type TabName } from '../design/Chrome'
import { Button } from '../design/Controls'
import { Claim } from '../design/Furniture'
import { Place, Tag, Tags } from '../design/List'
import type { BookClaim, FurnitureDto, RuleDto } from '../lib/api'
import { rulePlace } from '../lib/furniture'
import { RoomFrame, Trouble } from './RoomFrame'

interface Props {
  claim: BookClaim | null
  /**
   * The room, so a rule about a whole piece can be named the way a person names
   * one.
   *
   * A rule carries `place`, and for a piece that is its **label**, which is the
   * bare number `4`. Nobody says "the rule about 4". The piece knows it is
   * called Bookcase 4, or By the window, so it is asked: `rulePlace`.
   */
  room: FurnitureDto | null
  error: string
  tabs: Record<TabName, () => void>
  onBack: () => void
  /**
   * Open a rule, which is the screen it can be changed from.
   *
   * The whole rule rather than its id, because where a rule is drawn is decided
   * by the place it points at, and this screen has that already. Handing over an
   * id would make somebody look it up again.
   */
  onRule: (rule: RuleDto) => void
  /**
   * Say what this book is, for the state that used to offer nothing (#341).
   *
   * A book no rule claims is the one state on this screen with no way out drawn
   * on it: every other one has a rule to open or a pin to make, and this one
   * explained itself and stopped, on the screen somebody arrives at holding the
   * book and wondering.
   *
   * It opens the screen the list of these books opens, rather than a panel of
   * its own. Two screens reaching one way of saying what a book is, the way two
   * screens already reach this one.
   */
  onSay: () => void
}

/** Where the rules want it, said against where it actually is. */
function wanted(claim: BookClaim) {
  const here = claim.standing?.label ?? ''
  const there = claim.wanted?.label ?? ''

  if (claim.withdrawn) return 'It has left the collection, so no rule places it.'
  if (claim.checkedOut) return 'It is checked out, so it is nowhere to be found just now.'
  if (claim.pinned) {
    return here
      ? `You pinned it to ${here}, and a pin beats every rule, for good.`
      : 'You pinned it where it is, and a pin beats every rule, for good.'
  }
  if (!there) return ''
  if (!here) return `The rules want it on ${there}. Nobody has said where it actually is yet.`
  if (here === there) return `It is on ${there}, which is where the rules want it.`
  return `The rules want it on ${there}, and it was last seen on ${here}. `
    + 'That is why it is on your carry list.'
}

export function ClaimedPane({ claim, room, error, tabs, onBack, onRule, onSay }: Props) {
  const top = (
    <TopBar title="Why it is here" sub={claim?.book.title} onBack={onBack} />
  )

  if (!claim) {
    return (
      <RoomFrame top={top} tabs={tabs}>
        <Trouble said={error} />
      </RoomFrame>
    )
  }

  const won = claim.claims.find((one) => one.won) ?? null
  const said = wanted(claim)

  /*
   * Whether saying something more about this book is work worth offering.
   *
   * Not for a withdrawn book: it has left the collection and no rule places it
   * by design, which the sentence above already says, and inviting somebody to
   * classify a book they no longer own is the count that trains people to
   * ignore a screen. A checked-out book is still owned and still needs filing
   * when it comes back, so it is offered.
   */
  const unclaimed = !won && !claim.withdrawn

  return (
    <RoomFrame top={top} tabs={tabs}>
      <Trouble said={error} />

      <Instruction>
        {won
          ? (claim.standing
            ? `It is on ${claim.standing.label} because of the rule called ${won.rule.name}.`
            : `The rule called ${won.rule.name} claims it.`)
          : 'No rule claims this book, so the rules have nowhere to put it.'}
      </Instruction>

      {said && <p className="wf-said">{said}</p>}

      {claim.claims.length > 0 && (
        <Card
          kind={claim.claims.length === 1 ? 'One rule wanted it' : 'More than one rule wanted it'}
          title={won ? `The one about ${rulePlace(room, won.rule)} won` : 'None of them claims it'}
        >
          <div className="wf-claims">
            {claim.claims.map((one) => (
              <Claim
                key={one.rule.id}
                name={one.rule.name}
                about={one.rule.about === 'area'
                  ? `About ${one.rule.place}`
                  : `About the whole of ${rulePlace(room, one.rule)} and everything after it`}
                won={one.won}
                why={one.why}
                onPress={() => onRule(one.rule)}
              />
            ))}
          </div>
        </Card>
      )}

      <Card
        kind="What the book carries"
        title={claim.tags.length === 0 ? 'No tags at all' : undefined}
      >
        {claim.tags.length > 0
          ? (
            <>
              <Tags>
                {claim.tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}
              </Tags>
              <p>
                {claim.claims.length > 0
                  ? 'A rule asks about the tags a book carries, which is why these are what decided it.'
                  : 'None of these is a tag any rule asks about, so nothing claims it.'}
              </p>
            </>
          )
          : (
            <p>
              Every rule asks about a tag, so a book carrying none matches nothing. It
              stays exactly where somebody last put it, and no plan will move it.
            </p>
          )}
      </Card>

      {claim.standing && (
        <Card weight="sunk" kind="Where it is" title={claim.standing.label}>
          <p>
            That is where somebody last said it stands.{' '}
            {claim.wanted && claim.wanted.areaId !== claim.standing.areaId && !claim.pinned && (
              <>The rules want it on <Place quiet>{claim.wanted.label}</Place>.</>
            )}
          </p>
        </Card>
      )}

      {won && (
        <Card
          weight="quiet"
          kind="If that is wrong"
          title="Change the rule, or pin it where it is"
          foot={
            <Button tone="secondary" block onPress={() => onRule(won.rule)}>
              Open {won.rule.name}
            </Button>
          }
        >
          <p>
            Change the rule so it stops asking for this book, or pin the book where it
            is. A pinned book is left alone by every rule, for good.
          </p>
        </Card>
      )}

      {/*
        The state that used to end here (#341). Every other one on this screen
        offers something and this one said the true thing and stopped, on the
        screen somebody arrives at while holding the book.

        One button and not the two the drawing has. The other one there writes a
        rule that asks for the tag the book already carries, and it is the better
        answer for a household that reads crime: one rule takes all nine at once
        rather than nine books being told they are also Fiction. Nothing in this
        app creates a rule, so it is said as the fact it is rather than drawn as
        a button that would have nowhere to go.

        The one button opens the screen the list of these books opens, so there
        is one way of saying what a book is however somebody arrived at it.
      */}
      {unclaimed && (
        <Card
          weight="quiet"
          kind="What you can do about it"
          /* The title carries the thought and the button carries the act. They
             both read "Say what it is" until this was looked at, which is the
             instruction written twice in two sizes. */
          title={claim.tags.length > 0
            ? `A rule about ${claim.tags[0]} would take them all`
            : 'Nobody has said anything about it'}
          foot={
            <Button tone="primary" block onPress={onSay}>
              Say what it is
            </Button>
          }
        >
          <p>
            {claim.tags.length > 0
              ? 'Say what else this book is, and the rule that asks for that takes it. '
                + 'That settles one book; a rule settles every book like it.'
              : 'Every rule asks about a tag, so there is nothing for any of them to '
                + 'match. Say what it is and the rule that asks for that will take it.'}
          </p>
        </Card>
      )}
    </RoomFrame>
  )
}
