import { Card, Confirmation, Nothing } from '../design/Card'
import { TopBar, type TabName } from '../design/Chrome'
import { Button, Choice } from '../design/Controls'
import { List, Place, Row } from '../design/List'
import { RoomFrame, Trouble } from './RoomFrame'
import { SKIP_WORD, plural, saidBooks, skipSaid } from '../lib/carryWords'
import { counted } from '../lib/furniture'
import type { PlanGroup, PlannedBook, RunMovePlan } from '../lib/api'

/** One bookcase this stretch of books could be sent to. */
export interface Destination {
  number: number
  /** What choosing it means, where the number alone does not say. */
  said: string
}

/** What one area of the run holds today, for the card that says where it lives. */
export interface AreaHolding {
  label: string
  books: number
}

interface Props {
  /** The books being moved, in the words a person uses: "non-fiction". */
  named: string
  /**
   * The bookcase the run lives on. Zero until the read answers, and it is the
   * server's answer rather than the bookcase the first book stands on (#500).
   */
  livesOn: number
  /**
   * What the run is cut into, empty planks included: a shelf at the top of a run
   * with nothing on it yet is a real state and this screen describes it.
   */
  areas: AreaHolding[]
  /**
   * Why this run cannot be moved anywhere, in the server's words, or empty
   * when it can. Known before a destination is offered: a rule naming one
   * plank does not describe a bookcase's worth of run to carry elsewhere,
   * and that refusal must arrive before the picker, not after somebody has
   * already chosen a bookcase.
   */
  refused: string
  /** The bookcases this move can land on, the one it is on included. */
  destinations: Destination[]
  bookcase: number
  onBookcase: (bookcase: number) => void
  /** Null until somebody asks for a plan. Drawing one is the second screen. */
  plan: RunMovePlan | null
  /**
   * Books already waiting to be carried, before this plan joins them. Null while
   * that read is in flight, and it is never guessed at.
   */
  waiting: number | null
  /** What applying wrote. Null until it has. */
  applied: { moved: number; wrote: number } | null
  busy: boolean
  error: string
  tabs: Record<TabName, () => void>
  onBack: () => void
  onPlan: () => void
  /** Back to choosing a bookcase, which is what "not yet" means here. */
  onUnplan: () => void
  onApply: () => void
  onCarry: () => void
}

// `counted` writes the number out in words, so the sentence's leading
// capital has to be added by hand.
function cut(areas: readonly AreaHolding[]): string {
  const said = `${counted(areas.length, 'area')}: `
    + `${areas.map((area) => `${area.label} with ${plural(area.books, 'book')}`).join(', ')}.`
  return said.charAt(0).toUpperCase() + said.slice(1)
}

export function MoveRunPane({
  named, livesOn, areas, refused, destinations, bookcase, onBookcase, plan, waiting, applied,
  busy, error, tabs, onBack, onPlan, onUnplan, onApply, onCarry,
}: Props) {
  if (applied) return <Applied named={named} applied={applied} tabs={tabs} onCarry={onCarry} />

  if (plan) {
    return (
      <Planned
        plan={plan}
        waiting={waiting}
        busy={busy}
        error={error}
        tabs={tabs}
        onApply={onApply}
        onUnplan={onUnplan}
      />
    )
  }

  return (
    <RoomFrame top={<TopBar title={`Move ${named}`} onBack={onBack} />} tabs={tabs}>
      <Trouble said={error} />

      {/* Nought means "not answered yet"; a screen with nothing on it says
          less than a screen claiming bookcase 0. */}
      {livesOn > 0 && (
        <Card kind="Where it lives now" title={`Bookcase ${livesOn}`}>
          {areas.length > 0 && (
            <p>
              {cut(areas)} The areas come with it, so the same books stay together.
            </p>
          )}
        </Card>
      )}

      {/* The words are the server's own, so what the screen says and what
          the write would have said are one sentence. */}
      {refused ? <Nothing said={refused} /> : livesOn > 0 && (
        <>
          <Choice
            label="Which bookcase to move it to"
            on={String(bookcase)}
            onPick={(picked) => onBookcase(Number(picked))}
            options={destinations.map((one) => ({
              value: String(one.number),
              word: `Bookcase ${one.number}`,
              sub: one.said,
            }))}
          />

          <Button tone="primary" block off={busy} onPress={onPlan}>
            {busy ? 'Working it out...' : 'Show me the plan'}
          </Button>
        </>
      )}
    </RoomFrame>
  )
}

/**
 * The plan itself, drawn.
 *
 * Split out and holding no state of its own, so what it says can be held to a
 * claim in a test rather than only looked at. That is the same reason
 * `MovesSoFar` is split out of `ShelveView`.
 */
export function Planned({
  plan, waiting, busy, error, tabs, onApply, onUnplan,
}: {
  plan: RunMovePlan
  waiting: number | null
  busy: boolean
  error: string
  tabs: Record<TabName, () => void>
  onApply: () => void
  onUnplan: () => void
}) {
  const leftAlone = plan.skipped.reduce((all, one) => all + one.books.length, 0)

  return (
    <RoomFrame
      top={
        <TopBar
          title="The plan"
          sub={`${plural(plan.moving, 'book')} to carry`}
          onBack={onUnplan}
        />
      }
      tabs={tabs}
    >
      <Trouble said={error} />

      {plan.planks.length === 0 ? (
        <Card
          weight="quiet"
          kind="Nothing would change"
          title={`It already starts on bookcase ${plan.to}`}
        />
      ) : (
        <Card
          kind="What would happen"
          title={`Bookcase ${plan.from} to bookcase ${plan.to}`}
        >
          <div className="wf-steps">
            {plan.groups.map((group, at) => (
              <Step key={`${group.from}${group.to}`} group={group} at={at + 1} />
            ))}
            {plan.groups.length === 0 && (
              <p>Every book is already where the rules would want it.</p>
            )}
          </div>
        </Card>
      )}

      <WhatMovesWithIt plan={plan} />

      {plan.staying > 0 && (
        <Card
          weight="sunk"
          kind="Staying put"
          title={`${saidBooks(plan.staying)} stay exactly where they are`}
        />
      )}

      {/* Never silently empty: every book the rules will not touch is
          named, with the reason beside it. */}
      {leftAlone > 0 && (
        <Card weight="quiet" kind="Left alone" title={saidBooks(leftAlone)}>
          <p>
            {skipSaid(plan.skipped.map(
              (one) => ({ reason: one.reason, books: one.books.length }),
            ))}
          </p>
          <List label="Books left alone">
            {plan.skipped.flatMap((one) => one.books.map((book) => (
              <Named key={book.id} book={book} meta={SKIP_WORD[one.reason]} />
            )))}
          </List>
        </Card>
      )}

      {plan.unclaimed.length > 0 && (
        <Card
          weight="quiet"
          kind="Claimed by nothing"
          title={`${saidBooks(plan.unclaimed.length)} ${
            plan.unclaimed.length === 1 ? 'matches' : 'match'} no rule at all`}
        >
          <p>
            No rule wants {plan.unclaimed.length === 1 ? 'it' : 'them'}, so there is
            nowhere for {plan.unclaimed.length === 1 ? 'it' : 'them'} to go and no plan
            will ever move {plan.unclaimed.length === 1 ? 'it' : 'them'}.
          </p>
          <List label="Books no rule claims">
            {plan.unclaimed.map((book) => <Named key={book.id} book={book} />)}
          </List>
        </Card>
      )}

      {waiting !== null && waiting > 0 && (
        <Card
          weight="quiet"
          kind="Already waiting"
          title={`${saidBooks(waiting)} ${waiting === 1 ? 'is' : 'are'} on your carry list`}
        />
      )}

      <Card weight="sunk" kind="What applying does" title="It writes down where each book belongs">
        <p>Nothing moves until you carry the books yourself and say so.</p>
      </Card>

      <Button tone="primary" block off={busy} onPress={onApply}>
        {busy ? 'Writing it down...' : 'Apply it'}
      </Button>
      <Button tone="quiet" block onPress={onUnplan}>
        Not yet
      </Button>
    </RoomFrame>
  )
}

/**
 * `wrote` and `moved` are deliberately separate counts: a second apply of
 * the same plan writes nothing but still has the same books to carry, and
 * conflating the two would report that as a plan that did nothing.
 */
function Applied({
  named, applied, tabs, onCarry,
}: {
  named: string
  applied: { moved: number; wrote: number }
  tabs: Record<TabName, () => void>
  onCarry: () => void
}) {
  return (
    <RoomFrame top={<TopBar title={`Move ${named}`} />} tabs={tabs}>
      <Confirmation
        said={`${plural(applied.wrote, 'book')} now belong somewhere else.`}
      >
        <p className="wf-said">
          {applied.moved > 0
            ? `The ${plural(applied.moved, 'book')} to carry are on your carry list, `
              + 'grouped into the trips you would walk. Say so on each one once it is '
              + 'actually there.'
            : 'Nothing needs carrying.'}
        </p>
      </Confirmation>

      <Button tone="primary" block onPress={onCarry}>
        {applied.moved > 0 ? 'Go and carry them' : 'Open the list'}
      </Button>
    </RoomFrame>
  )
}

/**
 * A piece the move would leave with nothing on it is named on its own,
 * before it happens. Nothing is deleted either way: the piece keeps
 * standing and its planks are retired, so moving the run back puts every
 * one of them, and its name, back.
 */
function WhatMovesWithIt({ plan }: { plan: RunMovePlan }) {
  if (plan.planks.length === 0) return null

  const said = `${counted(plan.planks.length, 'area')} ${
    plan.planks.length === 1 ? 'moves' : 'move'} with them`

  return (
    <Card
      kind="What else moves"
      title={said.charAt(0).toUpperCase() + said.slice(1)}
    >
      {plan.emptied.length > 0 && (
        <p>
          That leaves {plan.emptied.map((one) => one.name).join(', ')} with nothing on
          it. Nothing is thrown away: the piece keeps standing, and moving the books
          back puts every area on it, and its name, back.
        </p>
      )}

      <div className="wf-steps" role="list" aria-label="What each area becomes">
        {plan.planks.map((plank) => (
          <div className="wf-step" key={`${plank.from}${plank.to}`} role="listitem">
            <span>
              <Place>{plank.from}</Place> becomes <Place>{plank.to}</Place>
            </span>
          </div>
        ))}
      </div>
    </Card>
  )
}

/**
 * One move, as the two areas and the count.
 *
 * Two labels and the word "to", never an arrow: every arrow in Unicode lives in
 * the block this design system refuses outright, and the word reads aloud where
 * a glyph between two labels does not.
 */
function Step({ group, at }: { group: PlanGroup; at: number }) {
  return (
    <div className="wf-step">
      <span className="wf-step__n">{at}</span>
      <span>
        <Place>{group.from}</Place> to <Place>{group.to}</Place> &middot;{' '}
        {plural(group.books.length, 'book')}
      </span>
    </div>
  )
}

function Named({ book, meta }: { book: PlannedBook; meta?: string }) {
  return (
    <Row
      title={book.title}
      sub={book.authorFiling || 'unknown author'}
      meta={meta}
      onward={false}
    />
  )
}
