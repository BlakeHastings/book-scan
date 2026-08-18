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
   * How many books carry it, counting the ones under it. Undefined where
   * nobody asked.
   *
   * **Zero is the state a prepared shelf is in** (#392). Somebody who clears a
   * shelf and says it is for comics before carrying a single comic to it has
   * written a rule that is waiting rather than broken, and the difference is
   * invisible without this number: the rule reads exactly like one that claims
   * forty books. Undefined rather than zero where the count was never asked
   * for, because drawing "nothing carries this" off a number nobody fetched
   * would be the screen inventing a fact.
   */
  carried?: number
}

/**
 * A rule waiting on a word nothing carries yet, said in one line or not at all.
 *
 * **The same clause the empty rule uses**, deliberately. "It asks for nothing,
 * so it claims nothing" is already this widget's way of saying that a rule is a
 * real state rather than a fault, and a rule asking for a word no book has yet
 * is the neighbouring case: it asks for something, nothing answers, and it will
 * the moment something does. A second vocabulary for that would be two ways of
 * reading the same shelf.
 *
 * It names the tags rather than counting them, because the person reading it
 * prepared the shelf and the useful fact is which of their words is still
 * waiting.
 */
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

/**
 * The other journey, named for what it does rather than for the rule it does it
 * to.
 *
 * It read "Point Fiction somewhere else", and two things were wrong with that.
 * The owner said the first: "that's not the rule we're looking for changing."
 * The second showed up the moment a rule was named from its own lines, because
 * "Point Comic books and Fiction somewhere else" is two lines of quiet button
 * saying one thing. A word that does not carry the name cannot grow with it.
 */
export const RETARGET_WORD = 'Move these books to another bookcase'

/** The two things a line can ask, as the words somebody picks between. */
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

/**
 * Choosing a tag to add, which is a search rather than a list.
 *
 * A vocabulary is as long as somebody's reading, so the answers are narrowed by
 * what has been typed rather than scrolled past. The count beside each one is
 * the reason the box is worth having: adding a tag forty books carry and adding
 * one nothing carries are different decisions and the word alone does not say
 * which is which.
 */
export interface RuleChoosing {
  /** What has been typed, which is what narrows the answers. */
  query: string
  /** The answers, already narrowed, and already without what is on the rule. */
  offering: RuleOffer[]
  /**
   * The offer to make the word up, where the collection means nothing by it yet.
   *
   * **Null is the ordinary answer and it is not a refusal** (#392). It is null
   * because something already means what was typed, or because the two genre
   * answers do, and in both of those the tag to pick is in the list above. The
   * decision is `domain/tagging/naming.ts` and it is the same one the panel on a
   * book asks, so there is one rule about what a word means and not two.
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
 * A rule being written, which is a draft and not a row.
 *
 * **Nothing here is written down.** Every line added, taken off or changed
 * lives on the screen until somebody has read what it would do and said yes,
 * which is why the way out of this is a plan and not a save. See `WouldHappen`.
 */
export interface RuleEditing {
  /**
   * The rules on this place, each one a list of lines. Empty is a real state.
   *
   * **The two words land in two different places** (#384). Adding a tag to a
   * rule is "and": all of a rule's lines have to hold. Adding a rule to the
   * place is "or": either of them files a book here. There is no third level and
   * there is not going to be one, because a group inside a group is the boolean
   * tree `domain/placement/rules.ts` refuses, and it refuses it for the reason
   * this widget exists: it is unreadable at exactly the moment somebody needs to
   * read it.
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
 * What belongs here, read on the place it is about and changed there.
 *
 * > We want to be able to assign any rules that are available. Same thing with
 * > the fixtures: we need to show the user the filter rules, like we only allow
 * > these tags or whatever [...] If they change the rule to say, in an area, I
 * > want only comic books, only books with the tag comic books and fiction,
 * > then that's what is now only allowed in that area, and we should issue
 * > moves to adjust the books to where they need to go based off these new
 * > rules.
 *
 * ## Why this widget edits when it used to be a door
 *
 * Every issue before this one said not to build a second way to change a rule,
 * and #382 was built so nothing anywhere edited a rule's conditions. That was
 * right about **retargeting**, which is pointing a stretch of books at other
 * furniture, and it is wrong about this: the thing the owner wants to change is
 * what a place *allows*, and the place is where he is standing when he wants to
 * change it.
 *
 * What survives from that instruction is the part that was really load-bearing:
 * **there is one way books actually move.** Editing here writes nothing. It
 * produces a plan, the plan is applied, and the books are carried on the screens
 * that already exist. `change` is still here and still goes to the one journey
 * that retargets, demoted to the quiet button it should always have been: the
 * owner said so in as many words, "they have the option to point Fiction
 * somewhere else. That's not what the goal is here."
 *
 * ## "And" and "or" are two different things and they are drawn as two
 *
 * > It should be possible for the user to say "this tag or that tag", as well as
 * > "this and that". Very basic rule system is what we need to have.
 *
 * **And** is another line on one rule: all of a rule's lines have to hold.
 * **Or** is another rule on the same place: either of them files a book here.
 * That is where `domain/placement/rules.ts` said alternation goes, in the same
 * sentence that refuses the boolean tree, and the refusal is untouched. There is
 * no group inside a group here and there is nowhere to put one.
 *
 * A person adding a second tag should not have to know which of the two they
 * just used, so neither is named after its mechanism. One says "add a tag" and
 * the other says "allow something else as well", and both can be taken apart
 * again one piece at a time.
 *
 * ## A rule that claims nothing is a real state
 *
 * Somebody halfway through building one has taken every line off, and that is
 * not an error: "all of no conditions hold" is true, so a rule with no lines
 * would take the whole catalogue if the model let it, and the model does not.
 * The widget says so plainly rather than refusing to draw it.
 */
export function FilterRule({
  holds,
  rules = [],
  own,
  beaten = [],
  editing,
  onEdit,
  change,
  refused,
  children,
}: {
  /** What files here, as a phrase: "Anything tagged Cookery". Never empty. */
  holds: string
  /** Every rule that files books here, joined by "or". May be empty. */
  rules?: RuleSaid[]
  /**
   * Whether any of those rules is written **on this place**, which decides the
   * word on the button.
   *
   * The two are not the same question and #391 is what treating them as one
   * cost. A plank at the end of a run holds no rule of its own and the run's
   * rule reaches it, so this card drew "Non-fiction, carrying on" and offered
   * "Change what belongs here". Pressing it opened an editor holding nothing,
   * because the editor is seeded with the rules written on the place and there
   * were none; somebody read a preview, pressed "Write it down" and was told
   * "Nothing changed about where the books belong", which was true and read as a
   * failure.
   *
   * So the word comes from this rather than from what is drawn. An area with no
   * rule of its own says **Say** what belongs here, which is what writing one
   * there would be. Defaulted from `rules` for the fixture card and every caller
   * where the two are the same question.
   */
  own?: boolean
  /** Every rule that also reaches here, nearest place first. */
  beaten?: RuleBeaten[]
  /** The rule being written, or null when nobody is writing one. */
  editing?: RuleEditing | null
  /** Open the editor. The word is "Change" only where there is a rule to change. */
  onEdit?: () => void
  /** Point the whole stretch of books elsewhere: the other journey, demoted. */
  change?: { word: string; onPress?: () => void }
  /** Why it cannot be pointed elsewhere, said in words where there is no way. */
  refused?: string
  /** Anything the page wants under it, such as the books standing here. */
  children?: ReactNode
}) {
  if (editing) return <Writing holds={holds} beaten={beaten} editing={editing} />

  return (
    <Card
      kind="What belongs here"
      title={holds}
      foot={
        <>
          {onEdit && (
            <Button tone="secondary" block onPress={onEdit}>
              {(own ?? rules.length > 0)
                ? 'Change what belongs here'
                : 'Say what belongs here'}
            </Button>
          )}
          {change && (
            <Button tone="quiet" block onPress={change.onPress}>
              {change.word}
            </Button>
          )}
        </>
      }
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
          {/* A shelf somebody prepared before the books arrived. It is waiting
              rather than broken, and without this line the two read alike. */}
          {waitingSaid(rule.lines) && <p>{waitingSaid(rule.lines)}</p>}
          {!rule.enabled && <p>It is turned off, so it claims no book at the moment.</p>}
        </div>
      ))}

      <Reaching beaten={beaten} />

      {refused && <p>{refused}</p>}
      {children}
    </Card>
  )
}

/**
 * Every rule that reaches here, in the order that settles a tie: the one about
 * the smaller place first.
 *
 * Drawn only when there is a tie to settle, because on most areas there is one
 * rule and a list of one explains nothing. It is drawn while somebody is
 * writing a rule as well as while they are reading one, which is the point:
 * narrowing what an area allows does not stop the piece's own rule reaching it,
 * and somebody who did not know that would be surprised by the plan.
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
 * way to add another.
 *
 * ## Each line is a tag and a question about it, and both are changeable
 *
 * `tag is genre/fantasy` and `tag under genre` are different questions, so the
 * two are offered side by side on the line they are about rather than as a
 * setting somewhere else. Taking a line off is on the same line for the same
 * reason: the thing being changed and the way to change it are one target.
 *
 * ## Nothing here saves
 *
 * The only way forward is to see what it would do. That is not caution about
 * the write, it is what the write **is**: a rule change is where every book in
 * the collection belongs, worked out again, and a person who pressed Save
 * without reading it would have agreed to a number nobody showed them.
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

          {/*
            Empty is a real state and it is where somebody halfway through
            building a rule is standing. "All of no conditions hold" is true, so
            a rule with nothing in it would claim the whole catalogue if the
            model allowed it; it claims nothing instead, and this says which of
            the two it is rather than leaving them to guess.
          */}
          {lines.length === 0 && (
            <p>
              It asks for nothing, so it claims nothing, and no book files here until
              it does. Every tag you add has to hold, all of them at once.
            </p>
          )}

          {/* Said while it is being written as well as after, so somebody
              preparing a shelf reads it before the plan rather than wondering
              afterwards why nothing moved. */}
          {waitingSaid(lines) && <p>{waitingSaid(lines)}</p>}

          {choosing && choosing.group === group ? (
            <Choosing choosing={choosing} />
          ) : (
            <div className="wf-writes__acts">
              <Tags>
                <AddTag onPress={() => editing.onAdd?.(group)}>Add a tag</AddTag>
              </Tags>
              {/*
                Taking one of two off has to be possible, or an "or" is a thing
                somebody can build and cannot undo half of. It is here, on the
                rule it is about, rather than in a list of rules somewhere else,
                and it is not drawn as another dashed pill: a way of removing
                something that looks exactly like the way of adding something is
                a press nobody reads before making. Found by looking at it.
              */}
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

      {/*
        "Or", said as the thing it is rather than as the word. A second rule on
        the same place is what alternation is here, and somebody pressing this
        should not have to know that: they are saying that something else is
        allowed here too, and where the app puts it is the app's business.
      */}
      <Button tone="secondary" block onPress={editing.onAlso}>
        {groups.length ? 'Allow something else as well' : 'Allow something here'}
      </Button>

      <Reaching beaten={beaten} />
    </Card>
  )
}

/**
 * The word between two ways of belonging in one place.
 *
 * Drawn as a divider rather than as a control, because there is nothing to
 * choose: the joining word between two rules on a place is always "or", the same
 * way the joining word between two lines of a rule is always "and". A dropdown
 * offering both would be offering the boolean tree this model refuses.
 */
function Or() {
  return (
    <div className="wf-or">
      <span className="wf-or__word">or</span>
    </div>
  )
}

/**
 * The tags on offer, narrowed by what has been typed into the box, and the
 * offer to make the word up where the collection means nothing by it.
 *
 * ## Why a word nobody has used yet is offered here at all
 *
 * > The comics should live on the bottom shelf of the hall bookcase, and only
 * > comics.
 *
 * That could not be said (#392). This box only ever offered tags some book
 * already carried, so preparing a shelf meant scanning a comic first and
 * tagging it by hand, which is backwards from why anybody clears a shelf: you
 * decide what goes on it **before** the books arrive.
 *
 * **It is not a second way to make a tag.** The word is decided by
 * `domain/tagging/naming.ts`, which is the same rule the panel on a book asks
 * and the one that settled the hard part: "Comic Book" and "comic books" are
 * one tag and there is no way past that. The offer is the same drawing too, so
 * a person who has made a tag on a book meets the thing they already know.
 *
 * The label under it is what the collection made of what was typed, and it is
 * only drawn where the answers do not say it themselves. A list of tags needs
 * no caption; a refusal does.
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

      {/* The word nobody has used, offered as the thing it is. It goes under
          the collection's own heading and it says so, because a tag under
          nothing is a tag no rule anybody already has can reach.

          The sentence under it is the one the panel on a book already says,
          with the half this screen adds: the shelf is prepared and it waits.
          It does not also say "nothing of yours reads like that", which the
          offer above says in three words and which was on screen twice until
          this was looked at. */}
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
 * What a rule change would do, before it is done.
 *
 * **This is the only door between editing a rule and a book moving**, and it is
 * here rather than on a screen of its own because the thing it is about is two
 * inches above it. Applying writes down where the rules now want each book and
 * carries nothing: a book moves when a person picks it up and says so, on the
 * screens that already exist for that.
 *
 * ## It never quietly drops a book
 *
 * A change that says "84 books move" having left three pinned ones out of the
 * eighty-four would be believed, and the person would come back from the
 * furniture three books short with nothing anywhere saying why. So everything
 * the rules will not touch is counted with the reason beside it, and `pinned` is
 * the one that is always there: a pin is a person overruling the rules, and it
 * beats them forever.
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
        {/*
          Drawn only when there are some. A zero on this line reads as an
          absence somebody has to work out is good news, and the answer to "how
          many books would no rule claim" being none is the ordinary case. The
          other two lines are counts of something that happens; this one is a
          count of a thing going wrong. Found by looking at a real catalogue,
          where it read "0 match no rule at all afterwards".
        */}
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

      {/*
        The one thing this app promises and keeps: writing it down records where
        the rules want each book and picks nothing up. A screen that said
        "applied" and left somebody believing their books had moved would be the
        one lie the whole ledger exists to make impossible.
      */}
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

/**
 * One of the three places an ordering can be settled.
 *
 * The whole library, the piece of furniture, and the area on it. There is no
 * fourth and this widget is not the place to grow one: what was missing was not
 * another setting but the ability to read the three that exist as one answer.
 * Whichever level `decides` is the one in force here, and every level above it
 * is what would come back if this one stopped saying anything.
 */
export interface OrderLevel {
  /** The place, as a person reads it: "The whole library", "Bookcase 2". */
  place: string
  /** What it says, in words, or what it defers to. */
  said: string
  /** Whether this is the level the answer actually comes from. */
  decides: boolean
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
  levels = [],
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
  /** The library, the piece and the area, and which of them decides. */
  levels?: OrderLevel[]
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

      {/*
        Where the answer comes from, which is a different question from what the
        answer is. An area that says nothing takes the piece, and a piece that
        says nothing takes the whole library, and nowhere until now did anybody
        get to read those three facts together: the settings screen said one of
        them, this widget said another, and the third was arithmetic somebody had
        to do in their head standing in front of a bookcase.
      */}
      {levels.length > 0 && (
        <ol className="wf-levels" aria-label="Where the order is settled">
          {levels.map((level) => (
            <li
              className={`wf-level${level.decides ? ' wf-level--on' : ''}`}
              key={level.place}
            >
              <span className="wf-level__place">{level.place}</span>
              <span className="wf-level__said">{level.said}</span>
              {level.decides && <span className="wf-level__mark">This one decides</span>}
            </li>
          ))}
        </ol>
      )}

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
