/**
 * Saying what a book is, in the one box where a person answers what no
 * catalogue could. A rule claims a book by its tags, so this is where
 * somebody tells the app what they are holding, and therefore where it lives.
 *
 * One field, no list of every tag kept: what is offered first is what
 * already exists, so a second comic book finds the existing tag rather than
 * making a duplicate.
 *
 * A panel rather than a card floating low over the screen, since this one has
 * a keyboard under it: on a phone the keyboard takes the bottom two thirds,
 * so the field sits at the top with the answers below it instead.
 */

import type { ReactNode } from 'react'
import { TopBar } from './Chrome'
import { SearchField } from './Finding'

/**
 * The panel itself. Deliberately dumb: it draws a field and whatever answers
 * it is handed, and decides none of them. Which tags a collection already
 * means, and whether a new one may be made at all, live in
 * `domain/tagging/naming.ts` where they can be tested without a browser.
 */
export function Naming({
  typed,
  caret = false,
  reads,
  title = 'Add a tag',
  asks = 'What is this book?',
  onType,
  onClose,
  children,
}: {
  /** What has been typed so far. Empty is the state this opens in. */
  typed?: string
  /** Whether the cursor is sitting in it, for a drawing that cannot be typed into. */
  caret?: boolean
  /** What the box made of what was typed, when that is worth saying. */
  reads?: ReactNode
  /**
   * What this panel is called, on its bar and to a screen reader. Must match
   * the verb of the control that opened it: a panel headed with a different
   * verb from its opener is two names for one act.
   */
  title?: string
  /** What the empty field asks for. Same reason as `title`. */
  asks?: string
  /** Given this, the box is a real field. Without it, it is the drawing. */
  onType?: (value: string) => void
  onClose?: () => void
  /** The answers: what already exists, and what could be made. */
  children?: ReactNode
}) {
  return (
    <div className="wf-name" role="dialog" aria-modal="true" aria-label={title}>
      <div className="wf-name__panel">
        <TopBar title={title} onBack={onClose} />
        <div className="wf-name__body">
          <SearchField
            typed={typed}
            caret={caret}
            placeholder={asks}
            label="Name a tag"
            reads={reads}
            onType={onType}
          />
          {children}
        </div>
      </div>
    </div>
  )
}

/**
 * The offer to make a tag that does not exist yet. Dashed, the shape this
 * system uses for a thing that is not there yet, same as `AddTag` and
 * `AddBox`. Says where the tag will sit, in words rather than the slug: a tag
 * under nothing is a tag no existing rule can reach.
 */
export function Make({
  name,
  where,
  onPress,
}: {
  /** What the new tag will be called. What was typed, tidied. */
  name: string
  /** What it will sit under, as a label: "Subject". */
  where: string
  onPress?: () => void
}) {
  return (
    <button type="button" className="wf-make" onClick={onPress}>
      <span className="wf-make__text">
        <span className="wf-make__name">{name}</span>
        <span className="wf-make__where">New, under {where}</span>
      </span>
      <span className="wf-make__add" aria-hidden="true">
        <IconPlus />
      </span>
    </button>
  )
}

/**
 * A plus, drawn rather than typed.
 *
 * Two strokes and no glyph out of a font: `design.test.tsx` refuses a
 * pictograph anywhere in this library, and the character somebody reaches for
 * first is exactly the one in that block.
 */
function IconPlus() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 6v12M6 12h12" />
    </svg>
  )
}
