/**
 * A `401` or `403` never reaches this: both are the gate's answers, handled by
 * `whenTheGateRefuses` and `app/gate.tsx` before the throw, and this file does not
 * decide what a status code means.
 */

/** The bad news, and why it matters. Shaped like the other three cards. */
export interface ReachTrouble {
  title: string
  said: string
}

/** A constant rather than a function: not being able to reach the server is one state and reads the same whichever read found it. */
export const CANNOT_REACH: ReachTrouble = {
  title: 'Your books could not be counted',
  said:
    'Nothing answered when this screen asked what the collection holds and what ' +
    'is waiting on the table, so the counts are left out rather than guessed at. ' +
    'Nothing has been changed. It asks again each time you move around the app.',
}
