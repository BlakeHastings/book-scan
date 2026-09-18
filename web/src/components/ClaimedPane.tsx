/**
 * Where a book is and where the rules want it are two separate facts: they
 * disagree only while the book is waiting to be carried, which the carry list
 * resolves rather than this screen. A pinned book still names the rule it
 * would otherwise have followed, so it stays visible what the pin overrules.
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
  /** A rule about a piece carries its bare number as `place`; `rulePlace` looks up what the piece is actually called, since nobody says "the rule about 4". */
  room: FurnitureDto | null
  error: string
  tabs: Record<TabName, () => void>
  onBack: () => void
  /** Takes the whole rule rather than an id: where a rule is drawn depends on the place it points at, which this screen already has. */
  onRule: (rule: RuleDto) => void
  /** Opens the same screen the unclaimed list opens, rather than its own panel. */
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

  // Excludes withdrawn books (already excluded from the rules by design) but
  // includes checked-out ones, since those still need filing when they return.
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

      {/* Only one button, not two: nothing in this app creates a rule directly, so that option is said as a fact rather than drawn as a button with nowhere to go. */}
      {unclaimed && (
        <Card
          weight="quiet"
          kind="What you can do about it"
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
