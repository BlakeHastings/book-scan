/**
 * The things you press and the things you type into.
 *
 * Everything here is at least 44px tall, which is the iOS minimum and the
 * only size that survives being used one-handed on a landing while holding a
 * book. The segmented control is 38px inside a 44px row of its own for the
 * same reason: the row is the target, the pill is the drawing.
 */

import type { ReactNode } from 'react'

export function Button({
  children,
  tone = 'secondary',
  block = false,
  small = false,
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
    <button type="button" className={className} onClick={onPress}>
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
 * A field, drawn rather than editable: this is a wireframe and nothing here
 * is wired to anything. The label sits above rather than inside, because a
 * placeholder that disappears when you type is a label you cannot check your
 * answer against.
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
}) {
  const marks = [
    'wf-field__box',
    value ? '' : 'wf-field__box--empty',
    action ? 'wf-field__box--acts' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="wf-field">
      <span className="wf-field__label">{label}</span>
      <div className={marks}>
        <span className="wf-field__value">{value || placeholder}</span>
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
