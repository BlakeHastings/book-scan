/**
 * Which of the three screens this browser gets, decided by asking the server.
 *
 * `docs/the-gate.md` is the server half. It answers `401` with `anonymous`,
 * `403` with `waiting`, and the route when the caller is admitted, and until
 * this file existed nothing in the client read any of it: a person meeting the
 * app got a line of red saying "Sign in to use this." and no way to.
 *
 * ## The two refusals are different, and that is the whole point
 *
 * A `401` means this browser is not signed in. A `403` means somebody is signed
 * in, is exactly who they say they are, and has not been let in. #521 spelled
 * out what treating the second as the first costs: they sign in successfully,
 * are told they are not signed in, and sign in again, for ever. So the two
 * words the server writes are carried all the way here rather than collapsed
 * into "logged out" at the first place that reads a status code.
 *
 * ## Nothing here is remembered
 *
 * The state is asked for, never stored anywhere it would outlive the answer,
 * and re-asked whenever something suggests it has moved. #524: "a client that
 * remembers being admitted is a client that will show the app to somebody who
 * has just been disabled." The gate reads `enabled` off the `user` row on every
 * single request for that reason; a cache on this side would hand the saving
 * back.
 *
 * ## Three things move it, and none of them is a timer
 *
 * 1. **The first ask**, on mount.
 * 2. **A refusal reaching `lib/api.ts`.** Every request in the app goes through
 *    one function, so any of them can be the one that finds out. The word
 *    travels out through `whenTheGateRefuses` rather than back to whichever
 *    screen happened to ask, because the thing that has to change is the app
 *    and not that screen.
 * 3. **A photograph that would not load.** See `coversAreBehindTheGate` below.
 *
 * and a fourth that is not an event this app can generate: coming back to the
 * tab. See `useEffect` on `visibilitychange`.
 */

import {
  createContext, useCallback, useContext, useEffect, useState,
  type ReactNode,
} from 'react'

import type { SessionAnswer, SignInProvider } from '../../shared/auth'
import { api, whenTheGateRefuses, theGateSaid } from '../lib/api'
import { WaitingList, WayIn } from '../design/Gate'
import { usePaper } from './paper'

/** What the app knows about who is asking. Read by the corner menu. */
export interface Gate {
  /** The server's last answer, or null while the first one is still coming. */
  answer: SessionAnswer | null
  /** Ask again. Used by the sign-out, which changes the answer by succeeding. */
  reask: () => void
  /** Give up the session in this browser's cookie. */
  signOut: () => Promise<void>
}

const Context = createContext<Gate | null>(null)

export function useGate(): Gate {
  const found = useContext(Context)
  if (!found) throw new Error('useGate was called outside GateProvider')
  return found
}

/**
 * A photograph that answers `401` is not a broken image.
 *
 * The covers went behind the gate with everything else under `/api` (#521), and
 * they are the one thing this app asks for without going through
 * `lib/api.ts`: the browser fetches them itself, from a `src` attribute. So a
 * session that expires while somebody is looking at a shelf turns every
 * photograph on the page into a failed request that no `catch` in this codebase
 * can see, and the app draws a page of grey holes while believing it is signed
 * in.
 *
 * This is one listener rather than an `onError` on each `<img>` because there
 * are eight of them across the design system and the ninth is the one that
 * would be forgotten. `error` does not bubble from a resource load, but it does
 * capture, which is what the `true` is doing.
 *
 * It asks the server rather than assuming: an image can fail for reasons that
 * have nothing to do with the gate, and the answer to "am I still signed in" is
 * the same one endpoint every other path here uses.
 */
function coversAreBehindTheGate(ask: () => void): () => void {
  const onError = (event: Event) => {
    const target = event.target
    if (!(target instanceof HTMLImageElement)) return
    // `src` is absolute by the time it is read back, so compare the path.
    let path: string
    try {
      path = new URL(target.src, window.location.href).pathname
    } catch {
      return
    }
    if (!path.startsWith('/api/covers/')) return
    ask()
  }

  window.addEventListener('error', onError, true)
  return () => window.removeEventListener('error', onError, true)
}

/**
 * The gate, in front of everything.
 *
 * Draws nothing at all while the first answer is in flight. That is one request
 * against the loopback API, and the alternative is a sign-in screen that
 * flashes up in front of somebody who was already signed in.
 */
export function GateProvider({ children }: { children: ReactNode }) {
  const [answer, setAnswer] = useState<SessionAnswer | null>(null)
  /*
   * A counter rather than a boolean, because two things can ask at once: a page
   * of thirty photographs all failing is thirty error events, and the one that
   * matters is that the question gets asked, not that it gets asked thirty
   * times. Each bump supersedes the answer to the one before it.
   */
  const [asked, setAsked] = useState(0)
  const reask = useCallback(() => setAsked((n) => n + 1), [])

  useEffect(() => {
    let live = true
    api.auth.session()
      .then((said) => { if (live) setAnswer(said) })
      /*
       * This endpoint is in front of the gate and answers in all three states,
       * so a failure here is the server being unreachable rather than a
       * refusal. Treated as anonymous, which is the honest screen for it: this
       * browser cannot show anybody the app, and the way in is what it can
       * offer. The sign-in press then fails visibly rather than this drawing a
       * silent blank page.
       */
      .catch(() => { if (live) setAnswer({ state: 'anonymous' }) })
    return () => { live = false }
  }, [asked])

  /* The server refused something, somewhere. Take its word for the state. */
  useEffect(() => whenTheGateRefuses((state) => {
    setAnswer((was) => (was && was.state === state ? was : { state }))
  }), [])

  useEffect(() => coversAreBehindTheGate(reask), [reask])

  /*
   * And ask again on coming back to the tab.
   *
   * A phone at a bookshelf is put in a pocket and taken out again, and the
   * enable script takes effect on the next request rather than on a timer, so
   * the app can sit on a screen for an hour after the answer has changed. It is
   * one request per return to the tab, which is the cheapest way to keep the
   * promise this file is named for: the server says, the client asks.
   */
  useEffect(() => {
    const onShown = () => { if (document.visibilityState === 'visible') reask() }
    document.addEventListener('visibilitychange', onShown)
    return () => document.removeEventListener('visibilitychange', onShown)
  }, [reask])

  const signOut = useCallback(async () => {
    await api.auth.signOut()
    /*
     * Said rather than assumed, through the same channel a refusal uses, so
     * there is one path into the state and not two. The cookie is gone, so the
     * next ask would say this anyway; this is what makes the screen change
     * before the round trip that would prove it.
     */
    theGateSaid('anonymous')
  }, [])

  const gate: Gate = { answer, reask, signOut }

  return (
    <Context.Provider value={gate}>
      {answer === null ? null
        : answer.state === 'anonymous' ? <WayInScreen />
        : answer.state === 'waiting' ? <WaitingScreen />
        : children}
    </Context.Provider>
  )
}

/**
 * The way in, drawn from `GET /api/auth/providers`.
 *
 * The list is asked for rather than written here, which is what makes adding
 * Microsoft later a configuration change. Each button is a plain navigation to
 * the `start` path the server gave, and it has to be one: the provider answers
 * by redirecting the browser back, so this is a journey out of the page rather
 * than a request from inside it.
 */
function WayInScreen() {
  usePaper()
  const [ways, setWays] = useState<SignInProvider[] | null>(null)

  useEffect(() => {
    let live = true
    api.auth.providers()
      .then((said) => { if (live) setWays(said.providers) })
      /* An empty list is the honest drawing for "nobody answered which ways in
         there are", and it is the same drawing as a server configured with
         none. Either way there is no button that would work. */
      .catch(() => { if (live) setWays([]) })
    return () => { live = false }
  }, [])

  if (!ways) return null

  return (
    <div className="wf">
      <WayIn
        ways={ways.map((way) => ({
          id: way.id,
          label: way.label,
          onPress: () => { window.location.href = way.start },
        }))}
        said="These are somebody's own books. Sign in, and the person whose books they are can let you in."
      />
    </div>
  )
}

/** Signed in, and not let in. The screen #524 exists for. */
function WaitingScreen() {
  usePaper()
  const { answer, signOut } = useGate()
  const [leaving, setLeaving] = useState(false)

  return (
    <div className="wf">
      <WaitingList
        email={answer?.user?.email ?? ''}
        leaving={leaving}
        onSignOut={() => {
          setLeaving(true)
          /* Whatever happens, this screen stops being the one to press again:
             it succeeds and the way in replaces it, or it fails and the state
             is re-asked. There is nothing else this person can do here. */
          void signOut().catch(() => setLeaving(false))
        }}
      />
    </div>
  )
}
