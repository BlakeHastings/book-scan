/**
 * What the app says when the shelf and the rules disagree about where a
 * book stands.
 *
 * Here rather than in the two screens that draw it: this is a small
 * number of sentences that have to stay true to something the server
 * decided, and a sentence written where it is drawn is a sentence nobody
 * tests.
 *
 * It says out loud that nothing will be repaired, as a design decision
 * rather than a disclaimer: a self-healing check would hide the
 * disagreement, and the broken state staying stable and surviving a
 * restart is exactly what makes it findable.
 */

import { saidBooks } from './carryWords'

/** The bad news, and why it matters. */
export interface DriftTrouble {
  title: string
  said: string
}

/**
 * That the app will not put this right on its own, said to the person.
 * One definition and two callers, so the two do not drift into
 * disagreeing sentences.
 */
export const NOT_REPAIRED =
  'Nothing has been moved and nothing will be: this is never repaired, ' +
  'because a repair would erase how it happened.'

/** "Twelve books are", "One book is". */
function counted(n: number): string {
  return `${saidBooks(n)} ${n === 1 ? 'is' : 'are'}`
}

/**
 * The card on the first screen: that something is wrong, and where to
 * look. It never names a book: the first screen counts, the screen whose
 * job it is names.
 *
 * Null for nought and for a read that has not answered, and those are two
 * different silences: no disagreement is an ordinary day, and a request
 * that did not come back is not something to write a sentence from.
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
 * The card over the drawing, where the books themselves are named. The
 * count is the whole collection's and not this run's, deliberately: a
 * disagreement is a fact about how the furniture and the rules fit
 * together, not about the half of it somebody happens to be looking at.
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
