/**
 * The two questions every place in this library answers, as two widgets.
 *
 * > It's hard to see how things sort, or why they sort, like the rules involved
 * > with the fixture or an area. Whenever we're in the detailed view of a
 * > fixture or an area, we need to be able to very easily see and change the
 * > current sort rule and the current filter rule. Maybe we rally around
 * > widgets that are associated with those.
 *
 * A place is a piece of furniture or an area of one, and both answer the same
 * two questions: **what belongs here**, and **how is it ordered**. They used to
 * be answered on four screens between them, two of which existed to explain
 * rather than to do, and the owner walked that and said what was wrong with it:
 * "instead of 'see what belongs here' we should just show what belongs there,
 * and then have the ability to edit it if the user clicks it."
 *
 * So they live here, once, and the fixture's page and the area's page both draw
 * them. That is the rule this design system already runs on: a component copied
 * into a second screen is two components that agree until one of them is edited.
 *
 * ## What a fixture and an area do not answer the same way
 *
 * Both are drawn by one component and neither is flattened into the other.
 *
 * **What it inherits from is different.** An area with no ordering of its own
 * takes the piece it stands on; a piece with none takes the whole library. The
 * caller says what the fallback is called, so neither has a sentence written
 * about it here that is true of only one of them.
 *
 * **Only an area stops taking overflow.** An area with an ordering of its own is
 * a place of its own: nothing flows into it from the area before, because books
 * only flow along a stretch that is ordered one way throughout. That is a real
 * consequence of the change rather than a note about it, so it is said where the
 * change is made, and a piece of furniture is given nothing to say because
 * nothing of the sort happens to one.
 *
 * ## Why the books are drawn under the ordering
 *
 * "It's hard to see *why* they sort" is a question a name cannot answer. The
 * books can: the first few of them, in the order the ordering puts them, with
 * the thing being ordered by shown against each one. Choosing a different
 * ordering reorders that list in front of somebody before anything is written,
 * so the widget is the explanation and the warning in the same drawing.
 */

import type { ReactNode } from 'react'
import { Card } from './Card'
import { Button, Choice } from './Controls'
import { Must, Musts } from './Furniture'
import { Place } from './List'

/** One line of a rule: a thing that has to be true of a book. */
export interface RuleLine {
  /** As the model has it. The words a person reads are written here. */
  operator: 'is' | 'under'
  /** A tag as a person reads it, never as it is stored. */
  tag: string
}

/** A rule, said the way a widget needs it and not the way a row stores it. */
export interface RuleSaid {
  name: string
  lines: RuleLine[]
  /** A rule can be off, and then it claims nothing and the widget says so. */
  enabled: boolean
}

/** A rule that also reaches here and lost, with the place it is about. */
export interface RuleBeaten {
  id: number
  name: string
  place: string
  /** Whether it is about a whole piece, which reaches everything after it. */
  wide: boolean
}

const LEAD: Record<RuleLine['operator'], string> = {
  is: 'Tagged',
  under: 'Tagged anything under',
}

/**
 * What belongs here, and the way to change it.
 *
 * `change` is deliberately a door rather than an editor. **Changing a rule is
 * what makes books need carrying**, and this app has one journey for that: say
 * where the books should live, see every book that would move, apply it. A
 * second way to change a rule from a page somebody is only reading would be two
 * answers to where the books go, so this widget is the door to the one that
 * exists and not a rival to it.
 *
 * A rule this app cannot point anywhere yet gets `refused` instead: a sentence
 * saying so, where somebody is looking, rather than a button that says no.
 */
export function FilterRule({
  holds,
  rule,
  beaten = [],
  change,
  refused,
  children,
}: {
  /** What files here, as a phrase: "Anything tagged Cookery". Never empty. */
  holds: string
  /** The rule that won, or null where nothing files here at all. */
  rule: RuleSaid | null
  /** Every rule that also reaches here, nearest place first. */
  beaten?: RuleBeaten[]
  /** The one way to change it, or null when there is not one. */
  change?: { word: string; onPress?: () => void }
  /** Why it cannot be changed, said in words where there is no way to. */
  refused?: string
  /** Anything the page wants under it, such as the books standing here. */
  children?: ReactNode
}) {
  return (
    <Card
      kind="What belongs here"
      title={holds}
      foot={change && (
        <Button tone="secondary" block onPress={change.onPress}>
          {change.word}
        </Button>
      )}
    >
      {rule && rule.lines.length > 0 && (
        <Musts>
          {rule.lines.map((line, at) => (
            <Must
              key={line.tag + line.operator}
              join={at === 0 ? undefined : 'and'}
              lead={LEAD[line.operator]}
              tag={line.tag}
            />
          ))}
        </Musts>
      )}
      {rule && rule.lines.length === 0 && (
        <p>It asks for nothing, so it claims nothing. Every line has to be true.</p>
      )}
      {rule && !rule.enabled && (
        <p>It is turned off, so it claims no book at the moment.</p>
      )}

      {/*
        Every rule that reaches here, in the order that settles a tie: the one
        about the smaller place first. Drawn only when there is a tie to settle,
        because on most areas there is one rule and a list of one explains
        nothing.
      */}
      {beaten.length > 1 && (
        <>
          <p className="wf-rule__tie">When two rules want the same book, the one about
            the smaller place wins.</p>
          <div className="wf-steps">
            {beaten.map((one, at) => (
              <div className="wf-step" key={one.id}>
                <span className="wf-step__n">{at + 1}</span>
                <span>
                  {one.name}, <Place quiet>{one.place}</Place>
                  {one.wide ? ' and everything after it' : ''}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {refused && <p>{refused}</p>}
      {children}
    </Card>
  )
}

/**
 * One book in the sample, said the way the ordering being looked at files it.
 *
 * Two facts and they are never the same fact. `by` is what the ordering reads,
 * and reading down that column is the whole of what the sample says; `said` is
 * whatever identifies the book once `by` has been spent. Ordering by the title
 * therefore leaves `said` as the author rather than printing the title twice,
 * which is what it did before this was looked at.
 */
export interface SampleBook {
  id: number
  /** What this ordering files it under: a surname, a title, a year, a tag. */
  by: string
  /** The book, said by whatever `by` is not. */
  said: string
}

/** One way of ordering, as the widget offers it. */
export interface SortOption {
  value: string
  word: string
  /** What choosing it means, where the word does not say. */
  sub?: string
  /** Drawn, and not choosable yet. */
  off?: boolean
}

/**
 * How this place is ordered, why it reads that way, and the way to change it.
 *
 * **The change happens here rather than on a screen of its own.** It is the
 * same note the owner gave about what belongs here: a page that names a setting
 * and sends you somewhere to change it is two screens saying one thing. Pressing
 * opens the answers underneath, in place, with the books reordering as they are
 * picked; nothing is written until the change is saved.
 */
export function SortRule({
  said,
  note,
  sample,
  more = 0,
  open = false,
  options = [],
  chosen,
  effect,
  busy = false,
  onOpen,
  onChoose,
  onSave,
  onClose,
}: {
  /** How it is ordered today, in words: "By the author". Never empty. */
  said: string
  /** What that means here, where there is something to say. */
  note?: string
  /** The books, in the order this ordering puts them. May be empty. */
  sample: SampleBook[]
  /** How many more there are behind the sample. */
  more?: number
  open?: boolean
  options?: SortOption[]
  chosen?: string
  /**
   * What the change does, once something has said. Drawn above the answer so
   * that agreeing to it is a second press rather than the same one.
   */
  effect?: string
  busy?: boolean
  onOpen?: () => void
  onChoose?: (value: string) => void
  onSave?: () => void
  onClose?: () => void
}) {
  return (
    <Card
      kind="Sort rule"
      title={said}
      foot={open
        ? (
          <>
            <Button tone="primary" block onPress={busy ? undefined : onSave}>
              {busy ? 'Saving' : effect ? 'Order it that way' : 'Save'}
            </Button>
            <Button tone="quiet" block onPress={onClose}>
              Leave it as it is
            </Button>
          </>
        )
        : (
          <Button tone="secondary" block onPress={onOpen}>
            Change the sort rule
          </Button>
        )}
    >
      {note && <p>{note}</p>}

      {open && (
        <Choice
          label="How the books here should be ordered"
          on={chosen ?? ''}
          onPick={onChoose}
          options={options}
        />
      )}

      {/*
        The answer to "why do they read in that order", which is the books
        themselves. While the answers are open this list is what choosing one
        does, drawn before anything is written: the same books, in the order
        that choice would put them.
      */}
      {sample.length > 0 && (
        <ol className="wf-sample" aria-label={open ? 'The books in the order you have picked' : 'The books in the order they are in'}>
          {sample.map((book) => (
            <li className="wf-sample__book" key={book.id}>
              <span className="wf-sample__by">{book.by}</span>
              <span className="wf-sample__title">{book.said}</span>
            </li>
          ))}
          {more > 0 && (
            <li className="wf-sample__more">and {more} more, in that order</li>
          )}
        </ol>
      )}

      {effect && <p className="wf-rule__effect">{effect}</p>}
    </Card>
  )
}
