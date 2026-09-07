/**
 * What the login screen says to somebody a sign-in has just dropped there
 * (#557).
 *
 * Here rather than in `app/gate.tsx` for `backupWords.ts`'s reason: these are
 * six sentences that have to stay true to six states the server distinguishes,
 * and a sentence written where it is drawn is a sentence nobody tests. The
 * states are `shared/auth.ts`'s and the wire carries the code rather than the
 * words, so the server keeps deciding what is true and this file keeps deciding
 * how to say it.
 *
 * ## Why the words are the whole of this change
 *
 * This is the worst moment of somebody's first encounter with the app. They
 * pressed one button, something did not work, and until now what they got was
 * `{"error":"Google did not complete the sign-in."}` filling a browser tab. The
 * mechanism that replaces it is a redirect and half a day's work; **the part
 * that decides whether it was worth doing is what these sentences say.**
 *
 * Three rules came out of writing them, and each one has a wrong version it was
 * written against:
 *
 * 1. **Say whose doing it was, and do not get it backwards.** "That sign-in did
 *    not start here" is the line #557 quotes, and it reads as an accusation —
 *    *you* did something irregular — when it is almost always a Back button.
 *    `stale` now opens by naming the innocent causes, because they are the
 *    causes.
 * 2. **Do not offer an act that does not exist.** `WaitingList` in
 *    `design/Gate.tsx` already settled this for the other refusal: "there is
 *    nothing here to try again" is worth more than a hopeful sentence. So
 *    `refused` and `unavailable` say plainly that pressing the button again is
 *    or is not likely to help, rather than both ending on "try again".
 * 3. **Never recite the machinery.** `server/auth/oidc.ts` refuses a token in
 *    ten different sentences, each naming a claim. Those go to the log, where
 *    whoever runs this app can read them. None of them is a thing the person in
 *    front of the screen can act on, and a screen that spelled them out would be
 *    this app explaining itself instead of answering them.
 *
 * ## The provider's name is used and is never taken from the URL
 *
 * `who` is a label out of `GET /api/auth/providers`, chosen by the id the
 * redirect carried. The URL selects a name this server published; it never
 * supplies one. Every sentence is written twice, once with a name and once
 * without, rather than folding an empty string into a template and getting "You
 * did not finish signing in with ." — the nameless form is what somebody sees
 * when the provider list has not loaded or no longer holds that door.
 */

import { SIGN_IN_FLOW_MINUTES, type SignInTrouble } from '../../shared/auth'

/** Ten, said the way somebody would say it rather than as a digit. */
const NUMBERS: Record<number, string> = {
  5: 'five', 10: 'ten', 15: 'fifteen', 20: 'twenty', 30: 'thirty', 60: 'sixty',
}

/**
 * How long somebody has at the provider, in words.
 *
 * Read off the constant rather than typed into the sentence, because this is
 * the fourth place that number would have been written down and the other three
 * have to agree with each other for the sentence to be true at all. See
 * `SIGN_IN_FLOW_MINUTES`. A value nobody has spelled falls back to the digits,
 * which is honest rather than pretty.
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
     * Named without the provider on purpose. This is the branch a Back button
     * lands on, and by then the browser has usually forgotten which door it went
     * out of; naming one would be this screen guessing about the very thing it
     * is telling somebody it could not follow.
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
     * No second sentence telling somebody to use the buttons below, because
     * there may not be any: a server carrying no provider draws "There is no way
     * to sign in to this app yet" instead, and this card promising a way in over
     * the top of that would be the one thing `Trouble` exists not to do.
     */
    title: 'That is not a way in to this app',
    said: 'The link you followed named a sign-in this app does not have.',
  }),
}

/**
 * What to say about a sign-in that ended on the login screen, or nothing.
 *
 * `trouble` is already one of the six by the time it arrives: `signInTroubleIn`
 * in `shared/auth.ts` is the one door between a query string and this
 * vocabulary, so nothing here has to be defensive about what it was handed.
 */
export function signInTroubleSaid(
  trouble: SignInTrouble,
  who = '',
): SignInTroubleSaid {
  return WORDS[trouble](who)
}
