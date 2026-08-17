/**
 * The things you press and the things you type into.
 *
 * Everything here is at least 44px tall, which is the iOS minimum and the
 * only size that survives being used one-handed on a landing while holding a
 * book. The segmented control is 38px inside a 44px row of its own for the
 * same reason: the row is the target, the pill is the drawing.
 */

import type { ReactNode } from 'react'
import { IconCarry, IconInHand, IconOnward, IconSaying } from './Icons'

export function Button({
  children,
  tone = 'secondary',
  block = false,
  small = false,
  off = false,
  onPress,
}: {
  children: ReactNode
  /**
   * `primary` is the one thing this screen is for, and a screen has at most
   * one. `danger` is outlined rather than filled: a filled red button invites
   * the press it is warning about.
   */
  tone?: 'primary' | 'secondary' | 'quiet' | 'danger'
  block?: boolean
  small?: boolean
  /**
   * Drawn and not pressable. No gallery screen sets it: a wireframe answers
   * "what does this screen offer", and the app answers "and can it be done
   * yet", which is a fact about a request in flight or a field nobody has
   * filled in. Whichever screen sets it says why in words beside it, because
   * a phone has no hover and a `title` attribute is never read on one.
   */
  off?: boolean
  onPress?: () => void
}) {
  const className = [
    'wf-btn',
    `wf-btn--${tone}`,
    block ? 'wf-btn--block' : '',
    small ? 'wf-btn--small' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button type="button" className={className} onClick={onPress} disabled={off}>
      {children}
    </button>
  )
}

/**
 * Two or three answers to one question, all visible at once.
 *
 * Three is the limit at 414 wide: a fourth option puts a word like
 * "Non-fiction" into 80px and it either truncates or wraps, and both were
 * seen before this comment was written.
 */
export function Segmented<T extends string>({
  options,
  on,
  onPick,
  label,
}: {
  options: { value: T; word: string }[]
  on: T
  onPick?: (value: T) => void
  label: string
}) {
  return (
    <div className="wf-seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`wf-seg__opt${option.value === on ? ' wf-seg__opt--on' : ''}`}
          aria-pressed={option.value === on}
          onClick={() => onPick?.(option.value)}
        >
          {option.word}
        </button>
      ))}
    </div>
  )
}

/**
 * One small round button that steps through a short list of answers.
 *
 * The owner asked for it by shape, on the three ways of looking at the
 * library:
 *
 * > We put it there as a little circle that when clicked changes between
 * > covers, list and spines, and we should use icons to represent those [...]
 * > That way you don't take up all this space for choosing between those
 * > different views.
 *
 * ## It shows what you would get, not where you are
 *
 * A cycling button can only say one of two things and they are opposites, so
 * this is the decision rather than an accident of the drawing: **the icon is
 * the next state, and the name is the sentence for pressing it.**
 *
 * The reason is that the screen underneath already answers the other question,
 * louder than any 44px circle could. Somebody looking at a wall of covers can
 * see they are looking at covers; what they cannot see is what happens if they
 * press this. Drawing the current view would spend the one glyph there is on
 * the fact the whole screen is already shouting, and leave the button with no
 * way to say what it does.
 *
 * It also keeps the button honest as a button. Everything else you press in
 * this app is named for its outcome, and `aria-label` here is a sentence in
 * that same voice, so what is announced and what is drawn agree. A control
 * showing the current state would have to be announced as a state, which is
 * what `aria-pressed` on `Segmented` is for and is not what this is.
 *
 * The cost is real and it is named in the pull request: with three states you
 * cannot see the third until you land on it, and reaching a particular one
 * takes up to two presses.
 */
export function Cycle({
  name,
  icon,
  onPress,
}: {
  /**
   * What pressing it does, as a sentence. This target carries no word, so this
   * is the whole of what it says: it is the accessible name, and it names the
   * state being moved to, which is the state the icon draws.
   */
  name: string
  icon: ReactNode
  onPress?: () => void
}) {
  return (
    <button type="button" className="wf-cycle" aria-label={name} title={name} onClick={onPress}>
      {icon}
    </button>
  )
}

/**
 * A round target with a glyph in it, which goes somewhere rather than cycling.
 *
 * The same 44px circle `Cycle` wears, and it is a second component rather than
 * a flag on that one because they are not the same control: a cycle steps
 * through a short list and draws the state it would move you to, and this one
 * opens something. Sharing a name would have made "the way of looking at the
 * books is one button" a rule about two different things, which is how a
 * pinned rule stops meaning anything.
 *
 * It carries no word, so `name` is the whole of what it says.
 */
export function Round({
  name,
  icon,
  onPress,
}: {
  /** What pressing it does. The accessible name, and there is nothing else. */
  name: string
  icon: ReactNode
  onPress?: () => void
}) {
  return (
    <button type="button" className="wf-round" aria-label={name} title={name} onClick={onPress}>
      {icon}
    </button>
  )
}

/**
 * One answer out of more than three, all visible at once.
 *
 * A segmented control stops working at four options and these questions have
 * five, so the answers stack instead. Every one is a full-width row with room
 * for a second line, because the second line is where a choice says what it
 * actually means, and the chosen one is marked with a word rather than a tick:
 * this app's language is words, and there is room for one here.
 *
 * An option can be present and unchoosable, which is not the same as absent.
 * A way of ordering books that exists but cannot be offered yet should say so
 * where somebody is looking for it, rather than turn up later as a surprise.
 */
export function Choice<T extends string>({
  options,
  on,
  onPick,
  label,
}: {
  options: {
    value: T
    word: string
    /** What choosing it means, where that is not obvious from the word. */
    sub?: string
    /** Drawn, and not choosable yet. */
    off?: boolean
  }[]
  on: T
  onPick?: (value: T) => void
  label: string
}) {
  return (
    <div className="wf-choice" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={[
            'wf-choice__opt',
            option.value === on ? 'wf-choice__opt--on' : '',
            option.off ? 'wf-choice__opt--off' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-pressed={option.value === on}
          aria-disabled={option.off || undefined}
          onClick={() => onPick?.(option.value)}
        >
          <span className="wf-choice__text">
            <span className="wf-choice__word">{option.word}</span>
            {option.sub && <span className="wf-choice__sub">{option.sub}</span>}
          </span>
          {option.value === on && <span className="wf-choice__mark">Chosen</span>}
        </button>
      ))}
    </div>
  )
}

/**
 * A field. The label sits above rather than inside, because a placeholder that
 * disappears when you type is a label you cannot check your answer against.
 *
 * ## Drawn in the gallery, typed into in the app
 *
 * With no `onChange` this is a drawing, which is all a wireframe needs and all
 * every gallery screen passes. The app hands it one, and then the value is an
 * input rather than a span. One component either way: a second "but editable"
 * field would be the same box drawn twice, agreeing until one of them is
 * edited, which is the fault `Shots.tsx` was made to end.
 *
 * ## The second way to fill one in
 *
 * Some fields have an answer a keyboard is the worst way to give. Thirteen
 * digits off the back of a book is the clearest of them, and the owner said
 * where the way out of typing belongs:
 *
 * > On the ISBN, on the right side of it, we should show like a camera icon
 * > for them to change the ISBN. They can click on that and it opens up to
 * > scan the ISBN in the back of the book, like our current flow.
 *
 * So `action` is a target inside the box, at the end of it, carrying an icon
 * and an accessible name and no word: there is no room for one beside a value
 * and the box it sits in already says which field this is. It is deliberately
 * general rather than a camera: the field does not know what scanning is, only
 * that there is another way to answer it.
 */
export function Field({
  label,
  value,
  placeholder,
  action,
  onChange,
  inputMode,
}: {
  label: string
  value?: string
  placeholder?: string
  /** Another way to fill this in, drawn at the end of the box. */
  action?: {
    /** What pressing it does. This target carries no word, so it needs one. */
    name: string
    icon: ReactNode
    onPress?: () => void
  }
  /**
   * Given one, the box holds a real input rather than a drawing of one.
   *
   * The gallery draws every field and types into none of them, which is what
   * the paragraph above is about; the app has to be typed into. Both are the
   * same field with the same label above it, and it is one component so that
   * they cannot drift into two: the box, the empty state and the action at the
   * end are decided once, here, whether or not there is a keyboard behind it.
   */
  onChange?: (value: string) => void
  /** Which keyboard a phone offers. A page count is digits and a title is not. */
  inputMode?: 'text' | 'numeric'
}) {
  const marks = [
    'wf-field__box',
    value ? '' : 'wf-field__box--empty',
    action ? 'wf-field__box--acts' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    /* A `div` and not a `label`: the box can hold a second control, and a label
       wrapping two of them is a label that points at neither. The input carries
       its own accessible name instead. */
    <div className="wf-field">
      <span className="wf-field__label">{label}</span>
      <div className={marks}>
        {onChange ? (
          <input
            className="wf-field__value wf-field__input"
            value={value ?? ''}
            placeholder={placeholder}
            aria-label={label}
            inputMode={inputMode}
            autoComplete="off"
            autoCapitalize="words"
            spellCheck={false}
            onChange={(event) => onChange(event.target.value)}
          />
        ) : (
          <span className="wf-field__value">{value || placeholder}</span>
        )}
        {action && (
          <button
            type="button"
            className="wf-field__act"
            aria-label={action.name}
            onClick={action.onPress}
          >
            {action.icon}
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * One thing you can do, drawn so that it plainly can be done.
 *
 * ## Why it stopped being a row of words
 *
 * This was a hairline row with a sentence in it and a chevron at the end, and
 * the owner read it and said what was wrong with it (#361):
 *
 * > I don't like the "find the book in your hand" button that we have there.
 * > It doesn't look like a button, it doesn't look like an action that they can
 * > take.
 *
 * So a door now carries three things rather than one: a glyph in a chip at the
 * front, the sentence, and the chevron. The glyph is what makes it read as a
 * target from across the room, and the chip is what makes the glyph a mark
 * rather than a decoration floating in the row. It is raised paper with a
 * shadow under it, where the counts above it are sunk into the page, so the
 * actions lift off the screen the numbers sit in.
 *
 * **It is still not a filled button.** The one filled button in this system is
 * the thing a screen is *for*, and a screen has at most one; the first screen
 * has two doors and neither of them outranks the other.
 *
 * ## Why the words live here and not where they are used
 *
 * Every door is drawn twice, once by the gallery and once by the app, and the
 * only part of a door that says which room it opens is its sentence. Written
 * out in both places they are two doors that agree until one is edited, and
 * for `IN_HAND` that disagreement has a price attached: it is one of this
 * app's two cameras, and landing on the other one is somebody photographing a
 * book they already own into a second record. So each sentence is a constant
 * here, next to the component that draws it.
 */
export function Doors({ children }: { children: ReactNode }) {
  return <div className="wf-doors">{children}</div>
}

export function Door({
  word,
  icon,
  mark,
  onPress,
}: {
  /** What pressing it does, written across the row. */
  word: string
  icon: ReactNode
  /**
   * A name for this particular door, so a rule can be written about one of
   * them. There is exactly one way to the camera that reads a book you already
   * own, and that is checked rather than described (#355).
   */
  mark?: string
  onPress?: () => void
}) {
  return (
    <button
      type="button"
      className={`wf-door${mark ? ` wf-door--${mark}` : ''}`}
      onClick={onPress}
    >
      <span className="wf-door__mark" aria-hidden="true">{icon}</span>
      <span className="wf-door__word">{word}</span>
      <IconOnward size={18} />
    </button>
  )
}

/**
 * The way to the camera that reads a book you are already holding.
 *
 * ## There are two doors to it and there have to be
 *
 * The screen about finding a book has one in its corner, and the first screen
 * has this. Both take `IN_HAND` and both wear `IconInHand`, so the sentence and
 * the glyph are each decided once: what they have to agree about is **which of
 * this app's two cameras this is**, and that is the whole of what either says.
 *
 * ## What it costs the screen it is on
 *
 * One row, under the counts. The card that used to offer the *other* camera
 * here was taken off for eating the middle of the screen somebody opens most
 * often, and that argument survives this: a door to a room the tab bar already
 * opens is still not allowed, and no tab opens this one.
 */
export const IN_HAND = 'Find the book in your hand'

export function InHand({ onPress }: { onPress?: () => void }) {
  return <Door word={IN_HAND} icon={<IconInHand size={20} />} mark="inhand" onPress={onPress} />
}

/**
 * The way to the books that are not where they now belong.
 *
 * The second action on the first screen, and the argument for it being there is
 * that nothing else reaches it: the tab bar opens four rooms and this is not
 * one of them, and a rule change can displace fifty books in an afternoon
 * without anybody touching a shelf. The count above it says how many; this says
 * what to do about them, in the words somebody would use for the job.
 *
 * **It is drawn only when there is something to carry.** A door to an empty
 * room is the fault the first screen keeps being defended against, and this one
 * would be a walk to a bookcase for nothing.
 */
export const CARRY_BOOKS = 'Carry books where they belong'

export function CarryBooks({ onPress }: { onPress?: () => void }) {
  return <Door word={CARRY_BOOKS} icon={<IconCarry size={20} />} mark="carry" onPress={onPress} />
}

/**
 * The way to the books no rule claims, which is #341 and the third door.
 *
 * **This screen is where the app finally mentions them.** A book nothing files
 * is the honest outcome whenever no catalogue states a genre, which is #304, and
 * until now it appeared in no listing, no review and no count: the books most in
 * need of a person were the ones the app said least about. It stands exactly
 * where somebody left it and no plan will ever move it, so nothing else on this
 * screen was ever going to raise it.
 *
 * **Not a sixth count**, and that is a decision rather than a shortage of room.
 * The five counts are the five the owner named, in his order, and both suites
 * pin the list; a sixth tile would also put "nothing files them" into a third of
 * 414px. What the design system already has for a job with a flow of its own and
 * no tab is a door, which is what carrying got in the same round.
 *
 * **It is drawn only when there is something to say**, like the door beside it.
 * A collection with enough rules lives with none of these, and a walk to a list
 * of nothing is the door-to-an-empty-room fault the first screen keeps being
 * defended against.
 */
export const SAY_WHAT = 'Say what the books nothing files are'

export function SayWhat({ onPress }: { onPress?: () => void }) {
  return <Door word={SAY_WHAT} icon={<IconSaying size={20} />} mark="saying" onPress={onPress} />
}
