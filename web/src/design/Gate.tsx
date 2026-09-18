/**
 * The two screens somebody sees when they are not in the app yet: nobody is
 * signed in, and somebody is signed in but has not been let in.
 *
 * Neither wears the tab-bar frame, since a tab bar here would be four doors
 * this person cannot reach, all shown locked. `.wf-gate` in `library.css` is
 * the geometry.
 *
 * The waiting screen says three things and nothing else: what has happened
 * (signed in, not admitted), who can change it (the owner, outside the app,
 * so there is no "try again"), and a way out (sign out, since the account
 * arrived on may simply be the wrong one). There is no count, no queue
 * position and no estimate, since the API does not answer any of them.
 */

import type { ReactNode } from 'react'
import { Cat } from './Cat'
import { Button } from './Controls'
import { Trouble } from './Trouble'

/**
 * The way in: whatever `GET /api/auth/providers` said, drawn as buttons. The
 * list is the server's answer rather than one in this file, so adding a
 * second provider is a configuration change rather than a screen change.
 *
 * This is also where a sign-in that failed redirects back to, carrying which
 * of several things went wrong. It draws that with `Trouble`, the same
 * pattern as the first screen's bad news: words at the top of a card, no
 * coloured rail. `Trouble` itself carries no button; the buttons here are
 * under the card and are the way in regardless, not an act the card grows to
 * pretend to fix something.
 */
export function WayIn({
  ways,
  said,
  trouble,
}: {
  /** One button per provider, in the order the server listed them. */
  ways: { id: string; label: string; onPress?: () => void }[]
  /**
   * What is said under the title. The app and the gallery both hand this in,
   * because a screen that could not be asked what to say would be a screen
   * with the answer written twice.
   */
  said: ReactNode
  /**
   * Why the last sign-in did not finish, when somebody arrived from one.
   * Absent on the ordinary first visit, which is most of them.
   */
  trouble?: { title: string; said: string }
}) {
  return (
    <div className="wf-gate">
      <div className="wf-gate__inner">
        <Cat pose="sitting" size={72} />
        <h1 className="wf-gate__title">Book scan</h1>
        <p className="wf-gate__said">{said}</p>

        {trouble && (
          <div className="wf-gate__trouble">
            <Trouble title={trouble.title}>{trouble.said}</Trouble>
          </div>
        )}

        {ways.length > 0 ? (
          <div className="wf-gate__acts">
            {ways.map((way) => (
              /* Filled only when there is exactly one: a screen has at most one primary button. */
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
          /* A real state, not a failure to load: an app with no configured provider has no way in. */
          <p className="wf-gate__quiet">
            There is no way to sign in to this app yet.
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * Signed in, and not let in. `email` is shown because it is the one fact that
 * makes the sign-out button worth anything: somebody who picked the wrong
 * account can see that they did.
 *
 * This screen deliberately does not poll `GET /api/auth/session`. Being let
 * in is a person's decision made out of band, so a timer here would only be
 * an unbounded stream of requests from every refused tab left open, for a
 * window a poll would rarely win anyway. Reloading, or leaving the tab and
 * coming back, both re-ask the gate, so the screen tells the person to do
 * that instead. It is also deliberately not a button: `design.test.tsx` holds
 * that the only thing to press here is the way out, since the request a "try
 * again" would retry is the one that has just answered 403.
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
          you in. That happens away from this app, so this page will not change
          on its own. Once they tell you, reload it, or leave this tab and come
          back to it. Either one asks again.
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
