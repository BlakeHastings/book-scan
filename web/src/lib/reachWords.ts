/**
 * What the first screen says when it could not ask (#562).
 *
 * Here rather than in the screen that draws it, for the reason `backupWords.ts`
 * and `driftWords.ts` are here: one definition and two callers, the app and the
 * gallery, because a sentence copied into a drawing is two sentences that agree
 * until one of them is edited.
 *
 * ## Why there is anything to say at all
 *
 * The first screen is made of two reads, the collection's counts and the
 * queue's, and until #562 both ended in a bare `.catch(() => {})`. Neither the
 * counts nor the doors are drawn while either answer is missing, on purpose:
 * "drawing zeros would be saying something false about somebody's collection for
 * as long as the first request takes". So a read that failed drew the same
 * screen as a read that had not answered yet, which is a top bar, a tab bar and
 * nothing else, and it stayed that way until somebody happened to navigate.
 *
 * A person cannot tell that screen from a collection with nothing in it, from an
 * app that has not finished starting, or from a server that refused. This is the
 * app saying which.
 *
 * ## It is the same argument the backup card already made
 *
 * `design/gallery`'s `NoDisk` is the precedent and it is exact: the app could not
 * look, said "in the same weight as it says the news is bad, because to somebody
 * standing here they mean the same thing". The card below is that state for the
 * collection instead of for the disk.
 *
 * ## It says nothing about who refused
 *
 * A `401` or a `403` never reaches this. Both are the gate's answers, `lib/api.ts`
 * hands them to `whenTheGateRefuses` before the throw, and `app/gate.tsx` replaces
 * the whole app with the way in or the waiting screen. A second sentence about it
 * here would be a sentence drawn on a screen nobody is looking at, and it would be
 * this file deciding for itself what a status code means, which is the thing
 * `Refusal.authState` exists to stop.
 */

/** The bad news, and why it matters. Shaped like the other three cards. */
export interface ReachTrouble {
  title: string
  said: string
}

/**
 * The card, which has no cases in it.
 *
 * A constant rather than a function, unlike the three word files beside it: they
 * each turn something the server decided into a sentence, and there is nothing to
 * turn here. Not being able to reach the server is one state and it reads the
 * same whichever read found it.
 *
 * No button, like every other `Trouble`, and here the reason is that there is
 * nothing for one to do that moving around the app does not already do: both
 * reads are keyed on the route, so the last sentence is the true instruction
 * rather than a promise a button would have to keep.
 */
export const CANNOT_REACH: ReachTrouble = {
  title: 'Your books could not be counted',
  said:
    'Nothing answered when this screen asked what the collection holds and what ' +
    'is waiting on the table, so the counts are left out rather than guessed at. ' +
    'Nothing has been changed. It asks again each time you move around the app.',
}
