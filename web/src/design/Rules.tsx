/**
 * The two widgets a place answers with: what belongs here, and how it is ordered.
 * A fixture and an area share both components rather than each drawing their own.
 *
 * An area with no ordering or rule of its own inherits from the piece it stands
 * on; a piece with none inherits from the whole library, so the caller supplies
 * the fallback label. Only an area with a rule or ordering of its own stops
 * taking overflow from the area before it.
 */

import type { ReactNode } from 'react'
import { Card, Said } from './Card'
import { Button, Choice, Field, Segmented } from './Controls'
import { Must, Musts } from './Furniture'
import { Make } from './Naming'
import { AddTag, Place, Tag, Tags } from './List'

/** One line of a rule: a thing that has to be true of a book. */
export interface RuleLine {
  /** As the model has it. The words a person reads are written here. */
  operator: 'is' | 'under'
  /** A tag as a person reads it, never as it is stored. */
  tag: string
  /**
   * How many books carry it, counting the ones under it. Zero means a shelf was
   * prepared for this tag before any book arrived, not that the rule is broken.
   * Undefined means the count was never asked for.
   */
  carried?: number
}

/** Names the tags with carried 0: waiting for their first book, not broken. */
export function waitingSaid(lines: readonly RuleLine[]): string {
  const waiting = lines.filter((line) => line.carried === 0).map((line) => line.tag)
  if (!waiting.length) return ''

  const named = waiting.length === 1
    ? waiting[0]!
    : `${waiting.slice(0, -1).join(', ')} or ${waiting[waiting.length - 1]!}`
  return `Nothing carries ${named} yet, so it claims nothing until something does.`
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

export const RETARGET_WORD = 'Move these books to another bookcase'

const ASKS: { value: RuleLine['operator']; word: string }[] = [
  { value: 'is', word: 'That tag' },
  { value: 'under', word: 'That and under it' },
]

/** One tag somebody could add to a rule, with what choosing it would reach. */
export interface RuleOffer {
  tag: string
  /** How many books carry it, counting the ones under it. */
  books: number
}

export interface RuleChoosing {
  /** What has been typed, which is what narrows the answers. */
  query: string
  /** The answers, already narrowed, and already without what is on the rule. */
  offering: RuleOffer[]
  /**
   * The offer to make the word up. Null is the ordinary answer, not a refusal:
   * it means the tag to pick is already in `offering`, decided the same way
   * `domain/tagging/naming.ts` decides it for the panel on a book.
   */
  make?: RuleMake | null
  /** What the box made of what was typed, where that is worth a line. */
  said?: string
  onQuery?: (query: string) => void
  onPick?: (tag: string) => void
  onClose?: () => void
}

/** A word the collection has never used, and where it would go if made. */
export interface RuleMake {
  /** What the tag would be called: what was typed, tidied. */
  name: string
  /** What it would sit under, as a label: "Subject". Never a slug. */
  where: string
  onPress?: () => void
}

/**
 * A rule being written, which is a draft and not a row. Nothing here is
 * written down until a plan is generated and applied; see `WouldHappen`.
 */
export interface RuleEditing {
  /**
   * The rules on this place, each one a list of lines. Empty is a real state.
   * A line added to a group is "and"; a group added to `groups` is "or". There
   * is no nesting: `domain/placement/rules.ts` refuses a boolean tree.
   */
  groups: RuleLine[][]
  /** Which rule the tag being chosen is for, or null when none is. */
  choosing: (RuleChoosing & { group: number }) | null
  busy?: boolean
  onAsk?: (group: number, at: number, operator: RuleLine['operator']) => void
  onTakeOff?: (group: number, at: number) => void
  onAdd?: (group: number) => void
  /** Another rule on the same place, which is the whole of "or". */
  onAlso?: () => void
  /** One of them off, which must be possible or "or" is a trap. */
  onDrop?: (group: number) => void
  /** The one way out that leads anywhere: see what it would do. */
  onPlan?: () => void
  onClose?: () => void
}

/**
 * What belongs here, read on the place it is about and changed there. Editing
 * writes nothing directly: it produces a plan, which is applied, and books are
 * then carried on the screens that already exist for that. Moving a stretch of
 * books to other furniture is a separate act and lives under the books; see
 * `MoveBooks`.
 *
 * "And" is another line on one rule: all of a rule's lines have to hold. "Or"
 * is another rule on the same place: either files a book here. There is no
 * nesting of one inside the other. A rule with every line taken off claims
 * nothing rather than the whole catalogue, and the widget says so rather than
 * refusing to draw it.
 */
export function FilterRule({
  holds,
  rules = [],
  own,
  beaten = [],
  editing,
  onEdit,
  children,
}: {
  /** What files here, as a phrase: "Anything tagged Cookery". Never empty. */
  holds: string
  /** Every rule that files books here, joined by "or". May be empty. */
  rules?: RuleSaid[]
  /**
   * Whether any of those rules is written on this place, which decides the
   * word on the button ("Change" vs "Say"). This is not the same question as
   * `rules.length > 0`: a place can show a rule inherited from elsewhere while
   * holding none of its own, and the editor only ever seeds from rules written
   * on the place itself. Defaults to `rules.length > 0` where the two coincide.
   */
  own?: boolean
  /** Every rule that also reaches here, nearest place first. */
  beaten?: RuleBeaten[]
  /** The rule being written, or null when nobody is writing one. */
  editing?: RuleEditing | null
  /** Open the editor. The word is "Change" only where there is a rule to change. */
  onEdit?: () => void
  /** Anything the page wants under it, such as the books standing here. */
  children?: ReactNode
}) {
  if (editing) return <Writing holds={holds} beaten={beaten} editing={editing} />

  return (
    <Card
      kind="What belongs here"
      title={holds}
      foot={onEdit && (
        <Button tone="secondary" block onPress={onEdit}>
          {(own ?? rules.length > 0)
            ? 'Change what belongs here'
            : 'Say what belongs here'}
        </Button>
      )}
    >
      {rules.map((rule, group) => (
        <div key={`${rule.name}${group}`}>
          {group > 0 && <Or />}
          {rule.lines.length > 0 && (
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
          {rule.lines.length === 0 && (
            <p>It asks for nothing, so it claims nothing. Every line has to be true.</p>
          )}
          {waitingSaid(rule.lines) && <p>{waitingSaid(rule.lines)}</p>}
          {!rule.enabled && <p>It is turned off, so it claims no book at the moment.</p>}
        </div>
      ))}

      <Reaching beaten={beaten} />

      {children}
    </Card>
  )
}

/**
 * Every rule that reaches here, in the order that settles a tie: the one about
 * the smaller place first. Drawn only when there is a tie to settle.
 */
function Reaching({ beaten }: { beaten: RuleBeaten[] }) {
  if (beaten.length < 2) return null

  return (
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
  )
}

/**
 * The rule under a thumb: the lines it has, the way to change each one, and the
 * way to add another. Nothing here saves; the only way forward is to see what
 * it would do, since a rule change recomputes where every book belongs.
 */
function Writing({
  holds,
  beaten,
  editing,
}: {
  holds: string
  beaten: RuleBeaten[]
  editing: RuleEditing
}) {
  const { groups, choosing, busy = false } = editing

  return (
    <Card
      kind="What belongs here"
      title={holds}
      foot={
        <>
          <Button tone="primary" block off={busy} onPress={editing.onPlan}>
            {busy ? 'Working it out...' : 'Show me what would move'}
          </Button>
          <Button tone="quiet" block onPress={editing.onClose}>
            Leave it as it is
          </Button>
        </>
      }
    >
      {groups.map((lines, group) => (
        // eslint-disable-next-line react/no-array-index-key
        <div key={group}>
          {group > 0 && <Or />}
          <div
            className="wf-writes"
            role="group"
            aria-label={groups.length > 1
              ? `The ${group + 1} of ${groups.length} ways a book can belong here`
              : 'What a book has to be to belong here'}
          >
            {lines.map((line, at) => (
              <div className="wf-write" key={`${line.tag}${at}`}>
                <span className="wf-write__head">
                  {at > 0 && <span className="wf-must__join">and</span>}
                  <span className="wf-tag">{line.tag}</span>
                  <button
                    type="button"
                    className="wf-write__off"
                    onClick={() => editing.onTakeOff?.(group, at)}
                  >
                    Take it off
                  </button>
                </span>
                <Segmented
                  label={`What ${line.tag} has to mean`}
                  on={line.operator}
                  options={ASKS}
                  onPick={(operator) => editing.onAsk?.(group, at, operator)}
                />
              </div>
            ))}
          </div>

          {lines.length === 0 && (
            <p>
              It asks for nothing, so it claims nothing, and no book files here until
              it does. Every tag you add has to hold, all of them at once.
            </p>
          )}

          {waitingSaid(lines) && <p>{waitingSaid(lines)}</p>}

          {choosing && choosing.group === group ? (
            <Choosing choosing={choosing} />
          ) : (
            <div className="wf-writes__acts">
              <Tags>
                <AddTag onPress={() => editing.onAdd?.(group)}>Add a tag</AddTag>
              </Tags>
              <button
                type="button"
                className="wf-write__off"
                onClick={() => editing.onDrop?.(group)}
              >
                {groups.length > 1 ? 'Take this one off' : 'Have no rule here'}
              </button>
            </div>
          )}

          {lines.length > 1 && (
            <p className="wf-rule__tie">
              A book has to be all of these at once.
            </p>
          )}
        </div>
      ))}

      {groups.length === 0 && (
        <p>
          Nothing files here by rule, so this is filled by hand. Anything you allow
          below will be what belongs here from then on.
        </p>
      )}

      <Button tone="secondary" block onPress={editing.onAlso}>
        {groups.length ? 'Allow something else as well' : 'Allow something here'}
      </Button>

      <Reaching beaten={beaten} />
    </Card>
  )
}

/** The word between two ways of belonging in one place. Always "or"; not a control. */
function Or() {
  return (
    <div className="wf-or">
      <span className="wf-or__word">or</span>
    </div>
  )
}

/**
 * The tags on offer, narrowed by what has been typed into the box, and the
 * offer to make the word up where the collection means nothing by it. The new
 * word is decided by `domain/tagging/naming.ts`, the same rule the panel on a
 * book asks, so this is not a second way to make a tag.
 */
function Choosing({ choosing }: { choosing: RuleChoosing }) {
  return (
    <div className="wf-choosing">
      <Field
        label="Which tag has to be on a book"
        placeholder="Type a word"
        value={choosing.query}
        onChange={choosing.onQuery}
      />
      {choosing.said && <p className="wf-rule__tie">{choosing.said}</p>}
      {choosing.offering.length > 0 && (
        <Tags>
          {choosing.offering.map((one) => (
            <Tag key={one.tag} onPress={() => choosing.onPick?.(one.tag)}>
              {one.tag} · {one.books}
            </Tag>
          ))}
        </Tags>
      )}

      {choosing.make && (
        <>
          <Make
            name={choosing.make.name}
            where={choosing.make.where}
            onPress={choosing.make.onPress}
          />
          <p>
            A new one goes under {choosing.make.where}, where your catalogue&rsquo;s own
            words go, so a rule can ask for it. Nothing carries it yet, so this waits
            rather than files.
          </p>
        </>
      )}

      {choosing.offering.length === 0 && !choosing.make && (
        <p>Nothing else of yours reads like that.</p>
      )}

      <Button tone="quiet" block onPress={choosing.onClose}>
        Not another one
      </Button>
    </div>
  )
}

/** One move a change would cause: books off one place and onto another. */
export interface WouldMove {
  from: string
  to: string
  books: number
}

/** Books a change leaves exactly where they are, and the reason it does. */
export interface WouldLeave {
  /** The reason in words: "pinned where they are, which beats every rule". */
  said: string
  books: number
}

/**
 * What a rule change would do, before it is done. Applying writes down where
 * the rules now want each book and carries nothing; a book moves only when a
 * person picks it up and says so elsewhere. Every book the rules will not
 * touch is counted with the reason beside it, so a total never quietly drops one.
 */
export function WouldHappen({
  holds,
  moving,
  more = 0,
  carrying,
  staying,
  leaving = [],
  unclaimed,
  note,
  busy = false,
  onApply,
  onNotYet,
}: {
  /** What the place would allow, in the same phrase the rule reads as. */
  holds: string
  /** The moves, biggest place first. May be empty, which is a real answer. */
  moving: WouldMove[]
  /** How many moves are behind the ones drawn. */
  more?: number
  /** How many books would have to be carried in total. */
  carrying: number
  staying: number
  leaving?: WouldLeave[]
  /** How many books no rule would claim afterwards. */
  unclaimed: number
  /** Anything else true of the change, such as an area that stops taking overflow. */
  note?: string
  busy?: boolean
  onApply?: () => void
  onNotYet?: () => void
}) {
  return (
    <Card
      kind="What would happen"
      title={carrying === 0
        ? 'No book would have to be carried'
        : `${carrying} ${carrying === 1 ? 'book' : 'books'} to carry`}
      foot={
        <>
          <Button tone="primary" block off={busy} onPress={onApply}>
            {busy ? 'Writing it down...' : 'Write it down'}
          </Button>
          <Button tone="quiet" block onPress={onNotYet}>
            Not yet
          </Button>
        </>
      }
    >
      <p>{holds} would be what files here.</p>
      {note && <p>{note}</p>}

      {moving.length > 0 && (
        <div className="wf-steps">
          {moving.map((one, at) => (
            <div className="wf-step" key={`${one.from}${one.to}`}>
              <span className="wf-step__n">{at + 1}</span>
              <span>
                <Place>{one.from}</Place> to <Place>{one.to}</Place> &middot;{' '}
                {one.books} {one.books === 1 ? 'book' : 'books'}
              </span>
            </div>
          ))}
          {more > 0 && <p className="wf-sample__more">and {more} more, like those</p>}
        </div>
      )}

      <ul className="wf-would" aria-label="What the change comes to">
        <li>
          <span className="wf-would__n">{staying}</span>
          <span>stay exactly where they are</span>
        </li>
        {leaving.map((one) => (
          <li key={one.said}>
            <span className="wf-would__n">{one.books}</span>
            <span>{one.said}</span>
          </li>
        ))}
        {unclaimed > 0 && (
          <li>
            <span className="wf-would__n">{unclaimed}</span>
            <span>
              {unclaimed === 1 ? 'matches' : 'match'} no rule at all afterwards, so nothing
              would ever move {unclaimed === 1 ? 'it' : 'them'}
            </span>
          </li>
        )}
      </ul>

      <p>
        {carrying > 0
          ? 'Writing it down says where each book belongs. Nothing moves until you '
            + 'carry the books yourself and say so.'
          : 'Writing it down says where each book belongs, and none of them ends up '
            + 'anywhere other than where it already is.'}
      </p>
    </Card>
  )
}

/**
 * One book in the sample, said the way the ordering being looked at files it.
 * `by` is what the ordering reads; `said` identifies the book by whatever `by`
 * is not, so ordering by title leaves `said` as the author rather than
 * repeating the title.
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
 * The two ends of an ordering. The word between them is "to", not an arrow:
 * this design system refuses arrow glyphs outright.
 */
export interface OrderEnds {
  first: string
  last: string
}

/**
 * How this place is ordered, why it reads that way, and the way to change it.
 * The title always names a real ordering, never a level or a deferral. `where`
 * names the one place the ordering is actually set, as a single clause rather
 * than a chain: an area following a piece that follows the library is told
 * "Set for the whole library". The caller writes `where` because a piece of
 * furniture and an area do not inherit from the same thing.
 */
export function SortRule({
  said,
  ends,
  where,
  note,
  sample,
  more = 0,
  open = false,
  options = [],
  chosen,
  warn,
  effect,
  busy = false,
  onOpen,
  onChoose,
  onSave,
  onClose,
}: {
  /**
   * The ordering in force, in words: "By the author". Never empty and never a
   * deferral: a place that follows another place is still ordered some way, and
   * that way is what this says.
   */
  said: string
  /** The two ends of the books, as this ordering files them. */
  ends?: OrderEnds
  /** Where the ordering is actually set, in one sentence. */
  where?: string
  /** What that means for the books flowing into this place, where it does. */
  note?: string
  /** The books, in the order the ordering under a thumb puts them. */
  sample: SampleBook[]
  /** How many more there are behind the sample. */
  more?: number
  open?: boolean
  options?: SortOption[]
  chosen?: string
  /** What picking this would do here, said before anything is pressed. */
  warn?: string
  /**
   * What the change does, as the server said it, once it has refused once.
   * Drawn above the answer so that agreeing to it is a second press.
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
      {!open && ends && <Ends ends={ends} />}
      {!open && where && <p>{where}</p>}
      {!open && note && <p>{note}</p>}

      {open && (
        <>
          <Choice
            label="How the books here should be ordered"
            on={chosen ?? ''}
            onPick={onChoose}
            options={options}
          />

          {(ends || sample.length > 0) && (
            <p className="wf-order__head">How they would stand</p>
          )}
          {ends && <Ends ends={ends} />}
          {sample.length > 0 && (
            <ol className="wf-sample" aria-label="The books in the order you have picked">
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

          {warn && <p className="wf-rule__effect">{warn}</p>}
          {effect && <p className="wf-rule__effect">{effect}</p>}
        </>
      )}
    </Card>
  )
}

/** The first book and the last, with the word "to" between them. */
function Ends({ ends }: { ends: OrderEnds }) {
  return (
    <p className="wf-ends">
      <span className="wf-ends__end">{ends.first}</span>
      <span className="wf-ends__to">to</span>
      <span className="wf-ends__end">{ends.last}</span>
    </p>
  )
}

/**
 * Points a stretch of books at other furniture. Stands under the books rather
 * than on the rule card, since it acts on books rather than defining a place.
 * Where it cannot be offered (a rule about one area alone has no stretch of
 * books to point), it says why instead, with no heading or box.
 */
export function MoveBooks({
  onPress,
  refused,
}: {
  onPress?: () => void
  /** Why there is nothing to point elsewhere, where there is not. */
  refused?: string
}) {
  if (refused) return <Said>{refused}</Said>

  if (!onPress) return null

  return (
    <Button tone="quiet" block onPress={onPress}>
      {RETARGET_WORD}
    </Button>
  )
}
