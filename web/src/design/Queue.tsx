/**
 * One book waiting to be filed, drawn once for the wireframe and for the app.
 * A row is a book and three pills, never a sentence about the book: what it
 * needs (only where something is wrong, via `FAILURE_LABEL` so Home's counts
 * cannot disagree), the state it is in (always, the same word the filter
 * above the list uses), and the device holding it. Every pill carries its
 * word; `design.test.tsx` checks that a pill is never colour alone.
 *
 * `Shots` in `mode="book"` is the book page's own drawing, passed
 * `size="small"` here, so there is no second arrangement of a spine against a
 * front anywhere.
 *
 * This is the inside of a row rather than the row: the app's row is dragged
 * sideways to discard, the wireframe's is a static target, and both wrappers
 * contain exactly this.
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
  /** The name is a machine's reading of a photograph rather than one anybody confirmed. Said in a word as well as in the styling. */
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
