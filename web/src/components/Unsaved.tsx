/** Says what is about to be lost by name rather than generically: "unsaved changes" is a phrase about the app, "Cookery" is the thing the person actually typed. */

import type { ReactElement } from 'react'
import { Sure } from '../design/Sure'

export function Unsaved({ typed, keeping, onLeave, onStay }: {
  /** What they typed, said back, or empty where they cleared a name instead. */
  typed: string
  /** What the button they have not pressed says, so the way on is nameable. */
  keeping: string
  onLeave: () => void
  onStay: () => void
}): ReactElement {
  return (
    <Sure
      title={typed ? `${typed} has not been saved` : 'What you typed has not been saved'}
      said={
        <>
          Going back now throws it away. The way to keep it is
          {' '}<strong>{keeping}</strong>, further down this screen.
        </>
      }
      act="Go back without it"
      onAct={onLeave}
      onKeep={onStay}
    />
  )
}
