/**
 * One book waiting to be filed, drawn once for the wireframe and for the app.
 *
 * ## What the owner asked for
 *
 * > The books that we have in the queue, we're putting way too much information
 * > here. "Needs an ISBN" should be like a tag, it should be like a pill there.
 * > "Identified" should be a pill. Instead of "checked by" and then the device,
 * > just have the device there as a pill. And instead of "cover reads" and then
 * > listing it there, we don't need that.
 *
 * and, in the same breath:
 *
 * > The book display that we have here, we should show the books larger than
 * > what they are now. I would say the same component that we're using to show
 * > the book and the spine of the book whenever you select a book, like the book
 * > detail view, is what we should use here.
 *
 * So a row is a book and three pills. Nothing on it is a sentence about the
 * book: the row said "identified · with device-8f21 · worked on by device-8f21"
 * and printed whatever OCR read off the cover underneath, which is four facts
 * written as prose on a screen used by somebody standing over a pile of books
 * with one hand free.
 *
 * ## The book is called, not copied
 *
 * `Shots` in `mode="book"` is the book page's own drawing, and this passes it
 * `size="small"`. There is no second arrangement of a spine against a front
 * anywhere, which is why the two have not drifted and is the whole argument of
 * `Shots.tsx`'s header.
 *
 * ## Which pills, and why each one is a pill rather than a word in a line
 *
 * - **What it needs**, and only where something is wrong. This is #148: a
 *   sentence that said what a book needed once sent somebody to retype an ISBN
 *   that was already correct, so the four kinds of stuck are four different
 *   words and the row says which. `FAILURE_LABEL` is where those words live and
 *   Home counts by the same helper, so the two cannot disagree.
 * - **What state it is in**, always. One word, the same word the control above
 *   the list filters by, so a book found under "Stuck" says "Stuck" on itself.
 * - **The device that has it**, where one does. The name and nothing wrapped
 *   around it.
 *
 * **Every one of them carries its word.** A pill with no word is a colour, and
 * this design system does not tell anybody anything with colour alone;
 * `design.test.tsx` checks that on every screen rather than trusting it here.
 *
 * ## Why this is the inside of a row rather than the row
 *
 * The app's row is dragged sideways to discard and carries an undo that
 * replaces it, and the wireframe's is a static target. Those two wrappers are
 * genuinely different things. What must not differ is what a book looks like,
 * so that is what lives here, and both wrappers contain exactly this.
 */

import { Tag, Tags } from './List'
import { Shots, type Shot } from './Shots'

export function Queued({
  name,
  guessed = false,
  sub,
  shots,
  state,
  wants,
  device,
}: {
  /** What this book is called: a title, or the number it was given. */
  name: string
  /**
   * The name is a machine's reading of a photograph rather than one anybody
   * confirmed. Said in a word as well as in the styling, because the difference
   * between a title and OCR's guess at one is not something a shade of grey can
   * carry (#156).
   */
  guessed?: boolean
  /** Who wrote it, or its ISBN where nobody knows yet. */
  sub?: string
  /** Its photographs, for `Shots` to draw as the book they are of. */
  shots: Shot[]
  /** The state it is in, in the word the control above the list uses. */
  state: string
  /** What it needs from a person, where anything is wrong with it. */
  wants?: string
  /** The device holding it. The name, with no words around it. */
  device?: string
}) {
  return (
    <span className="wf-queued">
      <Shots shots={shots} mode="book" size="small" />
      <span className="wf-queued__text">
        <span className={`wf-queued__name${guessed ? ' wf-queued__name--guess' : ''}`}>
          <span className="wf-queued__title">{name}</span>
          {guessed && <span className="wf-queued__guess">OCR guess</span>}
        </span>
        {sub && <span className="wf-queued__sub">{sub}</span>}
        <Tags>
          <Tag>{state}</Tag>
          {wants && <Tag tone="wants">{wants}</Tag>}
          {device && <Tag>{device}</Tag>}
        </Tags>
      </span>
    </span>
  )
}
