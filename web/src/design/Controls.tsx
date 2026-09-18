/**
 * The things you press and the things you type into.
 *
 * Everything here is at least 44px tall, the iOS minimum tap target. The
 * segmented control is 38px inside a 44px row of its own for the same reason.
 */

import { useEffect, useRef, type ReactNode } from 'react'
import { Cat } from './Cat'
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
   * `primary` marks the one thing a screen is for; a screen has at most one.
   * `danger` is outlined rather than filled, so it does not invite the press
   * it is warning about.
   */
  tone?: 'primary' | 'secondary' | 'quiet' | 'danger'
  block?: boolean
  small?: boolean
  /**
   * Drawn but not pressable. Whichever screen sets it must say why in visible
   * text beside it, since a phone has no hover and never reads `title`.
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
 * Two or three answers to one question, all visible at once. Three is the
 * limit at 414px wide; a fourth option's word truncates or wraps.
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
 * The icon shown is deliberately the next state, not the current one: the
 * screen underneath already shows the current view, so the one glyph here is
 * spent on what pressing it does instead. `aria-label` names that same
 * outcome, unlike `aria-pressed` on `Segmented`, which announces a state.
 */
export function Cycle({
  name,
  icon,
  onPress,
}: {
  /** What pressing it does, as a sentence: the accessible name, naming the state the icon draws. */
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
 * A separate component from `Cycle` because the two are not the same control:
 * a cycle draws the state it would move you to, and this opens something.
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
 * One answer out of more than three, all visible at once, stacked as
 * full-width rows rather than a segmented control. An option can be present
 * and unchoosable, which is not the same as absent.
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
 * With no `onChange` this draws as read-only, which is all a wireframe needs.
 * `action` is a target inside the box carrying an icon and no word, deliberately
 * general rather than tied to any one alternate input: the field does not know
 * what it does, only that there is another way to answer it.
 */
export function Field({
  label,
  value,
  placeholder,
  action,
  onChange,
  onEnter,
  focus = false,
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
  /** Given one, the box holds a real input rather than a drawing of one. */
  onChange?: (value: string) => void
  /**
   * The key that means "that is my answer". Only set it for a field alone in
   * a dialog; a form of several fields has a button and Enter would guess
   * which field was the point.
   */
  onEnter?: () => void
  /**
   * Take the keyboard on arrival, and select what is already in the box. Off
   * by default: opening the keyboard on arrival covers most of a phone screen.
   */
  focus?: boolean
  /** Which keyboard a phone offers. A page count is digits and a title is not. */
  inputMode?: 'text' | 'numeric'
}) {
  const box = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!focus) return
    box.current?.focus()
    box.current?.select()
  }, [focus])

  const marks = [
    'wf-field__box',
    value ? '' : 'wf-field__box--empty',
    action ? 'wf-field__box--acts' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    /* A `div` and not a `label`: the box can hold a second control, and a
       label wrapping two of them would point at neither. */
    <div className="wf-field">
      <span className="wf-field__label">{label}</span>
      <div className={marks}>
        {onChange ? (
          <input
            ref={box}
            className="wf-field__value wf-field__input"
            value={value ?? ''}
            placeholder={placeholder}
            aria-label={label}
            inputMode={inputMode}
            autoComplete="off"
            autoCapitalize="words"
            spellCheck={false}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onEnter
              ? (event) => { if (event.key === 'Enter') onEnter() }
              : undefined}
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
 * One thing you can do, drawn so that it plainly can be done. A door carries a
 * glyph in a chip, a sentence and a chevron, and it is still not a filled
 * button: the one filled button in this system is the thing a screen is for,
 * and a screen has at most one. Each door's sentence is a constant here rather
 * than at each call site, since the gallery and the app both draw every door
 * and must agree on which room it opens.
 */
export function Doors({ children, cat }: {
  children: ReactNode
  /**
   * The cat, asleep on top of the things you can do. Only drawn where there is
   * something to lie on: a screen with no doors draws no `Doors` and no cat.
   */
  cat?: 'lying'
}) {
  return (
    <div className={`wf-doors${cat ? ' wf-doors--bed' : ''}`}>
      {cat && (
        /* Rendered before the buttons so they paint over him: each door is
           opaque and takes position: relative for exactly this. */
        <span className="wf-doors__cat">
          <Cat pose={cat} size={96} doing="dozing" />
        </span>
      )}
      {children}
    </div>
  )
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
  /** A name for this particular door, so a rule can target one of them. */
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
 * The way to the camera that reads a book you are already holding. Two doors
 * open it (this and the one on the find-a-book screen); both take `IN_HAND`
 * and `IconInHand` so the sentence and glyph agree on which of this app's two
 * cameras this is.
 */
export const IN_HAND = 'Find the book in your hand'

export function InHand({ onPress }: { onPress?: () => void }) {
  return <Door word={IN_HAND} icon={<IconInHand size={20} />} mark="inhand" onPress={onPress} />
}

/** The way to the books that are not where they now belong. Drawn only when there is something to carry. */
export const CARRY_BOOKS = 'Carry books where they belong'

export function CarryBooks({ onPress }: { onPress?: () => void }) {
  return <Door word={CARRY_BOOKS} icon={<IconCarry size={20} />} mark="carry" onPress={onPress} />
}

/**
 * The way to the books no rule claims. Drawn only when there is something to
 * say. The door says "the unfiled books" and the screen it opens
 * (`UnclaimedPane`) is titled "Unfiled books"; the two names must match.
 */
export const SAY_WHAT = 'Say what the unfiled books are'

export function SayWhat({ onPress }: { onPress?: () => void }) {
  return <Door word={SAY_WHAT} icon={<IconSaying size={20} />} mark="saying" onPress={onPress} />
}
