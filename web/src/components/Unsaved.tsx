/**
 * Leaving a screen with something typed on it that has not been kept.
 *
 * **A data-loss defect that reads as a nicety** (#430 item 4). Somebody typed a
 * name for an area, pressed Back, and it was gone: no prompt, no trace, nothing
 * anywhere saying it had not been saved. The button that keeps a name sits under
 * the field, which is right, and Back sits at the top of the screen, which is
 * also right, and between them is a thumb's width and everything the person had
 * written.
 *
 * The two screens that hold a draft are the area's page and the piece's page, so
 * this is one sentence rather than two that agree today. Both say what is about
 * to be lost by name, because "unsaved changes" is a phrase about the app and
 * "Cookery" is the thing the person actually typed.
 *
 * `Sure` and no new dialog: this is a destructive answer and a way back out,
 * which is exactly the two answers it draws, in the order it draws them. The
 * red one throws the words away and the quiet one returns to the screen with
 * the keeping button still on it.
 */

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
          {' '}<strong>{keeping}</strong>, which is the button under the field.
        </>
      }
      act="Go back without it"
      onAct={onLeave}
      onKeep={onStay}
    />
  )
}
