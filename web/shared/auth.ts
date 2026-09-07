/**
 * The three states a caller can be in, said once for both halves of the app
 * (#521).
 *
 * ## Why there are three and not two
 *
 * Under "sign in with Google" every person on earth already holds a valid
 * credential, so completing a sign-in proves who somebody is and says nothing
 * about whether they may come in. That splits "no" into two different answers,
 * and #510 is explicit that they are not interchangeable:
 *
 * | Who | What the API answers |
 * | --- | --- |
 * | No session | `401`, and this vocabulary's `anonymous` |
 * | A session belonging to a user who is not enabled | `403`, and `waiting` |
 * | A session belonging to an enabled user | the route, and `admitted` |
 *
 * **A client cannot choose between the login screen and the waiting-list screen
 * unless the server says which.** Collapsing the two makes a person who is
 * signed in and simply not admitted look logged out, which sends them round the
 * sign-in loop for ever: they sign in successfully, are told they are not signed
 * in, and sign in again.
 *
 * This file is in `shared/` because both ends read it: the gate writes one of
 * these words into every refusal it makes, and the screens that follow #521 pick
 * a screen from it. It has no imports and never will; `shared/` is the layer
 * that depends on nothing.
 */

/** Which of the three states a caller is in. */
export type AuthState = 'anonymous' | 'waiting' | 'admitted'

/**
 * The status each state is answered with, so the two are written down together
 * rather than agreeing by coincidence in two files.
 *
 * `admitted` is not here: an admitted caller gets whatever the route answers,
 * which is the point.
 */
export const REFUSAL_STATUS = {
  anonymous: 401,
  waiting: 403,
} as const satisfies Record<Exclude<AuthState, 'admitted'>, number>

/**
 * What the client is told about the person holding the session.
 *
 * The local id, and the two fields a person recognises themselves by. **The
 * provider's subject is not here and must not be**: it lives on `user_identity`
 * and nowhere else, so that nothing above the identity table can start keying
 * anything on it.
 */
export interface SignedInUser {
  /** The id this app owns. Everything that means a person means this. */
  id: string
  /** Whether this person may come in. `false` is the waiting-list screen. */
  enabled: boolean
  /**
   * From the identity they signed in with, and shown rather than trusted.
   * Two providers can assert the same address about different people, so this
   * is a label and never a key.
   */
  email: string
  /** Likewise. Empty when the provider did not send one. */
  name: string
}

/** What `GET /api/auth/session` answers, in every one of the three states. */
export interface SessionAnswer {
  state: AuthState
  /** Absent when `state` is `anonymous`, because there is nobody to describe. */
  user?: SignedInUser
}

/** One way in, as `GET /api/auth/providers` lists it. */
export interface SignInProvider {
  /** `google`, and whatever configuration adds beside it. */
  id: string
  /** What a button says. */
  label: string
  /** Where to send the browser to begin. Always on this origin. */
  start: string
}

/** The cookie the session is addressed by. One spelling, read by both ends. */
export const SESSION_COOKIE = 'bookscan_session'

/**
 * Why a sign-in did not finish, in the six words a screen knows how to say
 * (#557).
 *
 * ## Why this is a closed set and not a message
 *
 * `GET /api/auth/:provider/start` and `GET /api/auth/:provider/callback` are the
 * only two routes in this app a browser reaches by a top-level navigation, so
 * their answer is a *page* rather than something `lib/api.ts` reads. Until this
 * existed, every way either of them could fail ended on a page of raw JSON with
 * no link, no button and no way back but the address bar.
 *
 * The answer is a redirect to the login screen carrying enough for it to say
 * what happened, and what it carries travels in a URL. **A URL is something a
 * stranger can set**, so the login screen must never render a string out of a
 * query parameter: that is an injection with a friendly name. What travels is
 * one of these codes, the client looks the code up, and the sentence it draws is
 * a constant in this repository that the code merely *selected*. A code this
 * list does not hold selects nothing and the screen says nothing extra, which is
 * the same outcome as arriving with no code at all.
 *
 * ## Why there are six of them and not one
 *
 * The same argument `AuthState` makes above, one storey down. "You pressed
 * Cancel" and "that sign-in did not start in this browser" are not the same
 * situation, and the second reads as an accusation when it is almost always a
 * Back button. Collapsing them would tell two people in different situations the
 * same sentence, and one of the two would be told something untrue about
 * themselves.
 *
 * They are six rather than the eleven exits that produce them because the split
 * is by **what the person is in a position to do next**, not by which line of
 * `auth/gate.ts` was reached. Somebody cannot act differently on "that ID token
 * has expired" than on "the provider answered without an ID token", and a screen
 * that spelled the difference out would be reciting this server's internals at a
 * person who wants to look at some books. `server/auth/gate.ts` has the map from
 * every exit to its code, and `src/lib/signInWords.ts` has the sentences.
 */
export const SIGN_IN_TROUBLE = [
  /** The provider came back with `error=access_denied`. Cancel, or Deny. */
  'cancelled',
  /**
   * The provider, or the token it sent, was something this server would not
   * accept: any other `error=`, no authorization code at all, an ID token that
   * will not parse or whose claims are wrong, or a nonce that is not the one
   * that went out. Trying again lands here again.
   */
  'refused',
  /**
   * The callback did not carry the state this browser was given. A Back button,
   * a link opened a second time, a sign-in left longer than the flow lives, or
   * genuine login CSRF, and this server cannot tell them apart.
   */
  'stale',
  /** The flow row is gone: it was already spent, or it ran out. */
  'already-used',
  /**
   * Nobody could be asked. The provider could not be reached or did not answer
   * in time, or the authority would not say what its issuer is.
   */
  'unavailable',
  /** There is no provider on this server by that name. */
  'no-such-way',
] as const

/** One of the six. Never a string off the wire until `signInTroubleIn` says so. */
export type SignInTrouble = typeof SIGN_IN_TROUBLE[number]

/**
 * The query parameter the reason travels in, and the one naming which way in it
 * was about.
 *
 * `way` is the provider's id, which the client turns into a label by looking it
 * up in the answer `GET /api/auth/providers` gave it. The label is therefore the
 * server's own word for that door and never the parameter's text, which is what
 * lets the sentences name a provider at all without the URL choosing what a
 * screen says.
 */
export const TROUBLE_PARAM = 'signin'
export const TROUBLE_WAY_PARAM = 'way'

/**
 * A reason out of a query string, or nothing.
 *
 * The one door between an arbitrary string and this vocabulary, so there is one
 * place to look rather than a comparison written wherever somebody needed one.
 */
export function signInTroubleIn(asked: unknown): SignInTrouble | undefined {
  return SIGN_IN_TROUBLE.find((one) => one === asked)
}

/** Where a failed sign-in sends the browser, reason in hand. */
export function troubleUrl(trouble: SignInTrouble, way?: string): string {
  const query = new URLSearchParams({ [TROUBLE_PARAM]: trouble })
  if (way) query.set(TROUBLE_WAY_PARAM, way)
  return `/?${query}`
}
