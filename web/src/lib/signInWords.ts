/**
 * What the login screen says to somebody a sign-in has just dropped there.
 *
 * Here rather than in `app/gate.tsx`: these are six sentences that have to
 * stay true to six states the server distinguishes, and a sentence written
 * where it is drawn is a sentence nobody tests.
 *
 * `who` is a label out of `GET /api/auth/providers`, chosen by the id the
 * redirect carried; the URL never supplies a name itself. Every sentence
 * is written twice, once with a name and once without, rather than folding
 * an empty string into a template.
 */

import { SIGN_IN_FLOW_MINUTES, type SignInTrouble } from '../../shared/auth'

/** Ten, said the way somebody would say it rather than as a digit. */
const NUMBERS: Record<number, string> = {
  5: 'five', 10: 'ten', 15: 'fifteen', 20: 'twenty', 30: 'thirty', 60: 'sixty',
}

/**
 * How long somebody has at the provider, in words. Read off the constant
 * rather than typed into the sentence, so this and `SIGN_IN_FLOW_MINUTES`
 * cannot disagree. A value with no word spelled out falls back to digits.
 */
const HOW_LONG = NUMBERS[SIGN_IN_FLOW_MINUTES] ?? String(SIGN_IN_FLOW_MINUTES)

/** What went wrong, and what that means, or nothing to say. */
export interface SignInTroubleSaid {
  /** The news, in one line, at the top where it gets read. */
  title: string
  /** What it means and what is worth doing, in a sentence or two. */
  said: string
}

/**
 * One reason, said. `who` is the provider's label, or empty when there is none.
 *
 * A function per reason rather than a table of strings, because half of them
 * change shape and not just a word when the name is missing.
 */
const WORDS: Record<SignInTrouble, (who: string) => SignInTroubleSaid> = {
  cancelled: (who) => ({
    title: who
      ? `You did not finish signing in with ${who}`
      : 'You did not finish signing in',
    said: 'That is what Cancel does, and it is a perfectly good thing to press. '
      + 'Nothing here has changed. Start again whenever you like.',
  }),

  refused: (who) => ({
    title: who
      ? `That sign-in with ${who} could not be completed`
      : 'That sign-in could not be completed',
    said: 'The answer that came back was not one this app could accept, so trying '
      + 'again will probably end in the same place. This is not something you did. '
      + 'If you are meant to be using this, whoever set it up is the person to tell.',
  }),

  stale: () => ({
    /*
     * Named without the provider on purpose: by the time a Back button
     * lands here, the browser has usually forgotten which door it went out
     * of, so naming one would be a guess.
     */
    title: 'That sign-in did not finish in this browser',
    said: 'Pressing Back, opening a sign-in link a second time, or leaving one for '
      + `more than ${HOW_LONG} minutes all end here. Nothing has gone wrong. Start again.`,
  }),

  'already-used': () => ({
    title: 'That sign-in had already been used',
    said: 'A sign-in works once, and this one had been finished or had run out. '
      + 'Start again if you are still not in.',
  }),

  unavailable: (who) => ({
    title: who ? `${who} could not be reached` : 'That way in could not be reached',
    said: 'Nobody could be asked, so nothing about your sign-in was decided. '
      + 'This is not something you did, and there is nothing here to fix. '
      + 'It is worth trying again in a minute.',
  }),

  'no-such-way': () => ({
    /*
     * No second sentence pointing at the buttons below, since there may
     * not be any: a server with no provider draws its own message instead.
     */
    title: 'That is not a way in to this app',
    said: 'The link you followed named a sign-in this app does not have.',
  }),
}

/**
 * What to say about a sign-in that ended on the login screen, or nothing.
 * `trouble` is already validated by `signInTroubleIn` in `shared/auth.ts`,
 * so nothing here has to be defensive about what it was handed.
 */
export function signInTroubleSaid(
  trouble: SignInTrouble,
  who = '',
): SignInTroubleSaid {
  return WORDS[trouble](who)
}
