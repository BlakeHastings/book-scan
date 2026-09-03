/**
 * What the app says when the shelf and the rules disagree about where a book
 * stands (#489).
 *
 * Here rather than in the two screens that draw it, for the reason
 * `backupWords.ts` is here: this is a small number of sentences that have to
 * stay true to something the server decided, and a sentence written where it is
 * drawn is a sentence nobody tests. The server keeps deciding what is true, and
 * this file keeps deciding how to say it.
 *
 * ## The log line is not the sentence, and that is the whole point
 *
 * `applySchema` prints this on every start:
 *
 * > 12 books are drawn on one plank by the shelf and another by the rules, so
 * > the range a book files into and the rule that claims it no longer say the
 * > same thing. Read the names before changing anything.
 *
 * Every word of that is true and it is written for whoever reads a server log:
 * it names two internal readings, uses three words out of the model, and its
 * instruction is addressed to a developer. A person who owns these books needs
 * three different things, and they are what these sentences carry:
 *
 * - **what is wrong**, in the terms of the room rather than the schema;
 * - **what it means for them**, which is that neither answer about those books
 *   can be relied on until somebody settles it;
 * - **what to do**, which is to leave the books alone and go and read the names.
 *
 * ## It says out loud that nothing will be repaired
 *
 * Not as a disclaimer: as the design decision it is, said where the reader can
 * see it, so that nobody later adds a repair button on the grounds that the
 * card looked unfinished without one. Repairing on sight would have hidden
 * #485 indefinitely. That defect was found three weeks in **because the broken
 * state was stable and survived every restart**, which is the property a
 * self-healing check destroys.
 *
 * There is also no reassuring sentence in this file. A day when the shelf and
 * the rules agree draws no card at all, for `backupWords.ts`'s reason: a line
 * saying everything is fine is a line a bug can print over a check that never
 * ran.
 */

import { saidBooks } from './carryWords'

/** The bad news, and why it matters. */
export interface DriftTrouble {
  title: string
  said: string
}

/**
 * That the app will not put this right on its own, said to the person.
 *
 * One definition and two callers, which is the design system's own rule about
 * a component and is worth more here: this is the sentence that stops somebody
 * expecting a button, and two copies of it are two sentences that agree until
 * one is edited.
 */
export const NOT_REPAIRED =
  'Nothing has been moved and nothing will be: this is never repaired, ' +
  'because a repair would erase how it happened.'

/** "Twelve books are", "One book is". */
function counted(n: number): string {
  return `${saidBooks(n)} ${n === 1 ? 'is' : 'are'}`
}

/**
 * The card on the first screen: that something is wrong, and where to look.
 *
 * It never names a book, which is round eight's deletion holding: the first
 * screen counts and the screen whose job it is names. So the last sentence is
 * the door, said in words rather than drawn as a button, because the card has
 * none — see `design/Trouble.tsx`, where the same argument was settled for the
 * backup card.
 *
 * Null for nought and for a read that has not answered, and those are two
 * different silences: no disagreement is an ordinary day, and a request that
 * did not come back is not something to write a sentence from.
 */
export function driftTrouble(found: number | null): DriftTrouble | null {
  if (found === null || found <= 0) return null

  return {
    title: `${counted(found)} drawn in one place and claimed by another`,
    said:
      'Your bookcases and the rules that file books into them no longer agree ' +
      `about where ${found === 1 ? 'this one goes' : 'these go'}, so neither ` +
      `answer can be trusted. ${NOT_REPAIRED} ` +
      `${found === 1 ? 'It is' : 'They are'} named in your library, under ` +
      '"Books that are not where they should be".',
  }
}

/**
 * The card over the drawing, where the books themselves are named.
 *
 * The count is the whole collection's and not this run's, deliberately. #485
 * was three screens giving three different counts of one thing, and a card
 * that said "four" beside a first screen that said "twelve" would be that
 * failure rebuilt by somebody trying to be tidy. A disagreement is a fact about
 * how the furniture and the rules fit together, which is not a fact about the
 * half of it somebody happens to be looking at.
 */
export function driftOnShelves(found: number): DriftTrouble {
  const one = found === 1
  return {
    title: `${counted(found)} drawn in one place and claimed by another`,
    said:
      `${one ? 'This one is' : 'Each of these is'} drawn where you see it and ` +
      `filed by the rules somewhere else. ${NOT_REPAIRED} Leave ` +
      `${one ? 'it where it stands' : 'them where they stand'} rather than ` +
      'moving a book to make the two agree.',
  }
}
