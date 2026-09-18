/**
 * The three states a caller can be in, said once for both halves of the app.
 *
 * Under "sign in with Google" every person on earth already holds a valid
 * credential, so completing a sign-in proves who somebody is and says nothing
 * about whether they may come in. That splits "no" into two answers that are
 * not interchangeable: no session is `401` and `anonymous`, a session belonging
 * to a user who is not enabled is `403` and `waiting`, and a session belonging
 * to an enabled user gets the route and `admitted`.
 *
 * A client cannot choose between the login screen and the waiting-list screen
 * unless the server says which. Collapsing the two makes a person who is signed
 * in and simply not admitted look logged out, which sends them round the
 * sign-in loop for ever.
 *
 * This file is in `shared/` because both ends read it. It has no imports and
 * never will; `shared/` is the layer that depends on nothing.
 */

export type AuthState = 'anonymous' | 'waiting' | 'admitted'

/**
 * The status each state is answered with, so the two are written down together
 * rather than agreeing by coincidence in two files. `admitted` is not here: an
 * admitted caller gets whatever the route answers.
 */
export const REFUSAL_STATUS = {
  anonymous: 401,
  waiting: 403,
} as const satisfies Record<Exclude<AuthState, 'admitted'>, number>

/**
 * What the client is told about the person holding the session. The provider's
 * subject is not here and must not be: it lives on `user_identity` and nowhere
 * else, so that nothing above the identity table can start keying anything on
 * it.
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
  label: string
  /** Where to send the browser to begin. Always on this origin. */
  start: string
}

/** The cookie the session is addressed by. One spelling, read by both ends. */
export const SESSION_COOKIE = 'bookscan_session'

/**
 * How long a half-finished sign-in is allowed to sit unfinished. One number for
 * the `sign_in_flow` row's expiry (`infrastructure/auth/auth-store.ts`), the
 * flow cookie's `Max-Age` (`server/auth/gate.ts`) and the login screen.
 *
 * Which of the six troubles a person is told depends on the first two agreeing.
 * A sign-in left too long arrives with neither the row nor the cookie and lands
 * on `stale`; a cookie that outlived the row lands the same wait on
 * `already-used`, which says a sign-in was used when nobody used it.
 */
export const SIGN_IN_FLOW_MINUTES = 10

/**
 * Why a sign-in did not finish, in the six words a screen knows how to say.
 *
 * `GET /api/auth/:provider/start` and `GET /api/auth/:provider/callback` are the
 * only two routes in this app a browser reaches by a top-level navigation, so
 * their answer is a page rather than something `lib/api.ts` reads. The answer is
 * a redirect to the login screen, and what it carries travels in a URL.
 *
 * A URL is something a stranger can set, so the login screen must never render a
 * string out of a query parameter. What travels is one of these codes, and the
 * sentence the client draws is a constant in this repository that the code
 * merely selected. A code this list does not hold selects nothing and the screen
 * says nothing extra, which is the same outcome as arriving with no code at all.
 *
 * The split is by what the person is in a position to do next rather than by
 * which exit was reached: `server/auth/gate.ts` has the map from every exit to
 * its code, and `src/lib/signInWords.ts` has the sentences.
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
 * was about. `way` is the provider's id, which the client turns into a label by
 * looking it up in the answer `GET /api/auth/providers` gave it, so the label is
 * the server's own word for that door and never the parameter's text.
 */
export const TROUBLE_PARAM = 'signin'
export const TROUBLE_WAY_PARAM = 'way'

/**
 * A reason out of a query string, or nothing. The one door between an arbitrary
 * string and this vocabulary.
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
