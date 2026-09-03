/**
 * Saying what a book is, in the one box where a person answers what no
 * catalogue could.
 *
 * A rule claims a book by its tags, so a tag is how a book gets a place. That
 * makes this small panel more load bearing than it looks: it is where somebody
 * standing with a comic book in one hand tells the app what they are holding,
 * and therefore where it lives.
 *
 * ## One field, and the field does the work
 *
 * The same shape the find screen already has, and for the same reason: a person
 * types the word they would say out loud, and what comes back is what their own
 * collection already means by it. Nothing is chosen from a list of every tag
 * they keep, because a collection of forty tags is a wall, and nothing is
 * created before the collection has been asked.
 *
 * **What is offered first is what is already there.** The second comic book
 * somebody scans has to find the tag rather than make it again, and that is not
 * a nicety: two tags meaning one thing is two rules to write and two counts that
 * are each half the answer, with nothing anywhere reporting a problem.
 *
 * ## A panel and not a card floating over the screen
 *
 * Every other thing drawn over a screen here is a question with two answers on
 * it, and it sits low where a thumb is because that is where the answer is
 * tapped. This one has a keyboard under it. On a phone the keyboard takes the
 * bottom two thirds, so a card anchored to the bottom is a card behind the
 * keyboard, and the list of what somebody's collection already means would be
 * the part that went.
 *
 * So the field is at the top with the answers below it, and the panel is
 * opaque: at 414 by 896 with the keyboard up there is room for the field and
 * three or four answers, which is the whole of what this screen is for. The
 * book underneath is not hidden for long, because using this is measured in
 * seconds.
 */

import type { ReactNode } from 'react'
import { TopBar } from './Chrome'
import { SearchField } from './Finding'

/**
 * The panel itself.
 *
 * Deliberately dumb, the way `Sure` is. It draws a field and whatever answers
 * it is handed, and it decides none of them: which tags a collection already
 * means, and whether a new one may be made at all, are rules and they live in
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
   * What this panel is called, on its bar and to a screen reader.
   *
   * "Add a tag" on the two doors that start with a book in your hand, because
   * that is what pressing it does: it puts the book under a word. #452 opened a
   * third with no book anywhere near it, where adding is not what happens and
   * the button that opens this one says so; a panel headed with a different verb
   * from the control that opened it is two names for one act, which is the thing
   * the library's own rules refuse.
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
 * The offer to make a tag that does not exist yet.
 *
 * Dashed, which is the shape this system already uses for a thing that is not
 * there yet: the same move `AddTag` makes at the end of a row of tags and
 * `AddBox` makes under a piece of furniture.
 *
 * **It says where the tag will sit, in the words the collection already uses.**
 * A tag under nothing is a tag no rule anybody has can reach, so where it goes
 * is part of what is being agreed to, and it is said here rather than found out
 * later by the book not moving. The slug is never drawn: nesting is words.
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
