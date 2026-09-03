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
