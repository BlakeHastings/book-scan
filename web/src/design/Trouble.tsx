/**
 * Something is wrong that nobody is going to find out about any other way.
 *
 * The first screen is the one place in this app that says what needs a person,
 * and everything on it so far has been work: books ready to be put away, books
 * to be carried somewhere else. This is the other kind, the kind where the app
 * is the only thing that has looked.
 *
 * ## Why it is a card with words at the top and nothing else
 *
 * A coloured rail down the side is the obvious way to draw a warning and it is
 * named in `Card` as the thing this design system does not do: it was called an
 * AI fingerprint and rejected. The honest replacement is the one already
 * written down there, "say the thing in words at the top of it", so the title
 * carries the whole of the bad news and the sentence under it carries why it
 * matters. Nothing here is red, and nothing here has a glyph on it.
 *
 * ## It has no button
 *
 * Deliberate, and it is the departure somebody will want to close. Everything
 * else on this screen goes somewhere, because a count nobody can act on is
 * decoration. This one cannot: what fixes it is a scheduled job on a machine,
 * and a button that pretended otherwise would be a button that does nothing
 * while looking like the answer. The screen says the true thing and stops.
 */

import type { ReactNode } from 'react'
import { Card, Said } from './Card'

export function Trouble({
  kind,
  title,
  children,
}: {
  /** What the trouble is about, said quietly under the title. */
  kind: string
  /** The bad news, in one line, at the top where it gets read. */
  title: string
  /** Why it matters, in a sentence or two. */
  children: ReactNode
}) {
  return (
    <Card kind={kind} title={title}>
      <Said>{children}</Said>
    </Card>
  )
}
