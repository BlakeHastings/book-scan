/**
 * The two screens somebody sees when they are not in the app yet (#524).
 *
 * The gate is the server's (`docs/the-gate.md`) and it answers three states.
 * Two of them are not the app: nobody is signed in, and somebody is signed in
 * and has not been let in. These are those two, drawn once here so the gallery
 * and the app draw the same thing.
 *
 * ## Neither of them wears the frame
 *
 * `Phone` carries a tab bar, and a tab bar is four places in an app this person
 * cannot reach. Drawing one greyed out would be offering four doors and locking
 * all of them. So these are their own layout, the way the camera is: one column,
 * centred, and nothing around it. `.wf-gate` in `library.css` is the geometry.
 *
 * ## The waiting screen is the one to get right
 *
 * Somebody here has signed in, proved exactly who they are, and been refused.
 * They have done nothing wrong, there is nothing they can do about it, and what
 * they can see the edge of is somebody else's collection. Three things are owed
 * to them and this screen says all three and nothing else:
 *
 * 1. **What has happened.** Signing in said who they are. It did not admit them,
 *    and it was never going to, because every person on earth already holds a
 *    Google credential and this collection is one person's.
 * 2. **Who can change it.** The owner, and only by a decision made outside the
 *    app. Not a form, not a button, not "try again": there is nothing to retry,
 *    and saying so is the difference between waiting and being sent round the
 *    sign-in loop for ever (#521).
 * 3. **A way out.** Sign out is the one act that is theirs, and it is here
 *    because the account they arrived on may simply be the wrong one. It is the
 *    reason `POST /api/auth/signout` is one of the five doors in front of the
 *    gate rather than behind it.
 *
 * **There is no count, no queue position and no estimate**, because the API does
 * not answer any of them and inventing one would be this screen promising
 * something nobody has agreed to. See the pull request for that finding.
 */

import type { ReactNode } from 'react'
import { Cat } from './Cat'
import { Button } from './Controls'

/**
 * The way in: whatever `GET /api/auth/providers` said, drawn as buttons.
 *
 * The list is the server's answer rather than a list in this file, which is what
 * makes adding a second provider a configuration change and not a screen change.
 * The development door is in that answer like any other and is deliberately not
 * special-cased here: if it ever needs distinguishing, the server says so.
 */
export function WayIn({
  ways,
  said,
}: {
  /** One button per provider, in the order the server listed them. */
  ways: { id: string; label: string; onPress?: () => void }[]
  /**
   * What is said under the title. The app and the gallery both hand this in,
   * because a screen that could not be asked what to say would be a screen
   * with the answer written twice.
   */
  said: ReactNode
}) {
  return (
    <div className="wf-gate">
      <div className="wf-gate__inner">
        <Cat pose="sitting" size={72} />
        <h1 className="wf-gate__title">Book scan</h1>
        <p className="wf-gate__said">{said}</p>

        {ways.length > 0 ? (
          <div className="wf-gate__acts">
            {ways.map((way) => (
              /*
               * Filled only when there is one of them. `Button` says a screen
               * has at most one primary, "the one thing this screen is for",
               * and a stack of filled buttons is a screen with no answer to
               * that. With two providers there genuinely is no answer: neither
               * is more the way in than the other, and this app is in no
               * position to recommend one of somebody's own accounts.
               */
              <Button
                key={way.id}
                tone={ways.length === 1 ? 'primary' : 'secondary'}
                block
                onPress={way.onPress}
              >
                Continue with {way.label}
              </Button>
            ))}
          </div>
        ) : (
          /*
           * A real state and not a failure to load: an app configured with no
           * provider has no way in, and a screen that drew a button anyway
           * would be a door onto nothing.
           */
          <p className="wf-gate__quiet">
            There is no way to sign in to this app yet.
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * Signed in, and not let in.
 *
 * `email` is the identity they arrived on, shown because it is the one fact
 * that makes the sign-out button worth anything: somebody who picked the wrong
 * account can see that they did.
 */
export function WaitingList({
  email,
  onSignOut,
  leaving = false,
}: {
  /** What the session says they signed in as. Empty when the provider sent none. */
  email: string
  onSignOut?: () => void
  /** The sign-out is in flight. Said in words below rather than only drawn. */
  leaving?: boolean
}) {
  return (
    <div className="wf-gate">
      <div className="wf-gate__inner">
        <Cat pose="sitting" size={72} />
        <h1 className="wf-gate__title">You are signed in, and not in yet.</h1>
        <p className="wf-gate__said">
          These are one person&rsquo;s own books, and that person decides who may
          look at them. Signing in told this app who you are. It did not let you
          in, and there is nothing here to try again.
        </p>
        <p className="wf-gate__said">
          If you are meant to be here, whoever owns this collection has to let
          you in. That happens away from this app, so there is nothing to do
          here but wait.
        </p>

        <div className="wf-gate__acts">
          {email && <p className="wf-gate__quiet">Signed in as {email}.</p>}
          <Button tone="secondary" block off={leaving} onPress={onSignOut}>
            Sign out
          </Button>
          <p className="wf-gate__quiet">
            {leaving
              ? 'Signing out.'
              : 'Sign out if you meant to arrive as somebody else.'}
          </p>
        </div>
      </div>
    </div>
  )
}
