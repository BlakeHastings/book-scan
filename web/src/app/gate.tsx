/**
 * Which of the three screens this browser gets, decided by asking the server.
 *
 * A `401` means this browser is not signed in; a `403` means the caller is
 * recognised but not admitted. The two are kept distinct rather than
 * collapsed into "logged out", so a signed-in-but-waiting caller is not told
 * to sign in again.
 *
 * The state is never cached. It is re-asked on mount, on any request
 * refusal, on a cover image failing to load, and on the tab regaining
 * visibility, rather than polled on a timer.
 */

import {
  createContext, useCallback, useContext, useEffect, useState,
  type ReactNode,
} from 'react'

import {
  signInTroubleIn, TROUBLE_PARAM, TROUBLE_WAY_PARAM,
  type AuthState, type SessionAnswer, type SignInProvider,
} from '../../shared/auth'
import { api, whenTheGateRefuses, theGateSaid } from '../lib/api'
import { signInTroubleSaid, type SignInTroubleSaid } from '../lib/signInWords'
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
 * Covers are fetched directly by the browser from an `<img src>`, not
 * through `lib/api.ts`, so a session expiring while a shelf is open turns
 * every photograph into a failed request no `catch` here can see.
 *
 * One listener rather than an `onError` per `<img>`, since `error` does not
 * bubble from a resource load but does capture, which is what the `true` is
 * for.
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
 * What the app knows after a refusal. The person (email, etc.) is carried
 * over from the previous answer rather than re-asked, since a `403` refuses
 * this same cookie's user, not a different one; only `enabled` changes,
 * taken from the state just given.
 *
 * Exported for `gate.test.tsx`.
 */
export function afterTheGateSaid(
  was: SessionAnswer | null,
  state: AuthState,
): SessionAnswer {
  // Returns the same reference when the state is unchanged, so many failing
  // photographs on one page do not cause a re-render each.
  if (was?.state === state) return was
  if (state === 'anonymous' || !was?.user) return { state }
  return { state, user: { ...was.user, enabled: state === 'admitted' } }
}

/**
 * The gate, in front of everything.
 *
 * Draws nothing while the first answer is in flight, so an already
 * signed-in caller does not see the sign-in screen flash up first.
 */
export function GateProvider({ children }: { children: ReactNode }) {
  const [answer, setAnswer] = useState<SessionAnswer | null>(null)
  /*
   * A counter rather than a boolean: bumping it twice in a row (two failing
   * photographs) has to trigger the effect twice, and setting a boolean to
   * the same value again would not.
   */
  const [asked, setAsked] = useState(0)
  const reask = useCallback(() => setAsked((n) => n + 1), [])

  useEffect(() => {
    let live = true
    api.auth.session()
      .then((said) => { if (live) setAnswer(said) })
      /*
       * A failure here means the server is unreachable, not a refusal (this
       * endpoint answers in all three states), so it is treated as anonymous
       * rather than leaving a blank page.
       */
      .catch(() => { if (live) setAnswer({ state: 'anonymous' }) })
    return () => { live = false }
  }, [asked])

  useEffect(() => whenTheGateRefuses((state) => {
    setAnswer((was) => afterTheGateSaid(was, state))
  }), [])

  useEffect(() => coversAreBehindTheGate(reask), [reask])

  /*
   * Ask again on returning to the tab: a phone can sit on a screen for an
   * hour after the answer has changed, since nothing else here would notice.
   */
  useEffect(() => {
    const onShown = () => { if (document.visibilityState === 'visible') reask() }
    document.addEventListener('visibilitychange', onShown)
    return () => document.removeEventListener('visibilitychange', onShown)
  }, [reask])

  const signOut = useCallback(async () => {
    await api.auth.signOut()
    /*
     * Said through the same channel a refusal uses, so there is one path
     * into the state; this changes the screen before the round trip that
     * would otherwise prove it.
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
 * Why the last sign-in did not finish, read off this page's address.
 *
 * The query parameter only selects among a closed set of known sentences
 * (`signInTroubleIn` rejects anything else), and the provider name is
 * looked up in the list the server sent rather than taken from the URL, so
 * a crafted link cannot inject arbitrary text.
 */
function troubleOnThisPage(ways: SignInProvider[]): SignInTroubleSaid | undefined {
  const asked = new URLSearchParams(window.location.search)
  const trouble = signInTroubleIn(asked.get(TROUBLE_PARAM))
  if (!trouble) return undefined
  const way = ways.find((one) => one.id === asked.get(TROUBLE_WAY_PARAM))
  return signInTroubleSaid(trouble, way?.label ?? '')
}

/**
 * The way in, drawn from `GET /api/auth/providers`.
 *
 * Each button is a plain navigation to the `start` path the server gave,
 * not a request: the provider redirects the browser back, so it must leave
 * the page, which is why a failed sign-in lands back here rather than
 * surfacing through a `catch` in `lib/api.ts`.
 */
function WayInScreen() {
  usePaper()
  const [ways, setWays] = useState<SignInProvider[] | null>(null)

  useEffect(() => {
    let live = true
    api.auth.providers()
      .then((said) => { if (live) setWays(said.providers) })
      /* An empty list here is treated the same as a server with no
         providers configured: no button would work either way. */
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
        trouble={troubleOnThisPage(ways)}
      />
    </div>
  )
}

/** Signed in, but not let in. */
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
          void signOut().catch(() => setLeaving(false))
        }}
      />
    </div>
  )
}
