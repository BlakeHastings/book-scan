/**
 * Something is wrong that nobody is going to find out about any other way.
 *
 * No coloured rail and no glyph: `Card` says why elsewhere. No button either,
 * since what fixes this is a scheduled job on a machine, and a button that
 * pretended otherwise would look like an answer while doing nothing.
 */

import type { ReactNode } from 'react'
import { Card, Said } from './Card'

export function Trouble({
  kind,
  title,
  children,
}: {
  /**
   * What the trouble is about, said quietly under the title.
   *
   * Leave it off where this card is the only thing on the screen: there is
   * nothing to tell it apart from, so the line would just restate the title.
   */
  kind?: string
  title: string
  children: ReactNode
}) {
  return (
    <Card kind={kind} title={title}>
      <Said>{children}</Said>
    </Card>
  )
}
