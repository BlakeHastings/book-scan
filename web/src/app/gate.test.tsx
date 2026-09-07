/**
 * The two ways onto the waiting screen, and the one thing they have to agree
 * about (#558).
 *
 * There are two, and until this file they drew different screens. Reached by a
 * reload, the client asks `GET /api/auth/session`, which answers `waiting` with
 * the person on it, and the screen says "Signed in as somebody@example". Reached
 * by a `403` on a tab press, the word travels out of `lib/api.ts` carrying no
 * person, because the gate's refusal body is `{ state, error }` and deliberately
 * says nothing more. The screen then offered only "Sign out".
 *
 * **That is the wrong screen to lose an address from**, and #524 already said
 * why in the test that pins it: the address "is not decoration: it is what makes
 * signing out worth offering to somebody who arrived on the wrong account, and
 * without it the button is a way to lose a session for no stated reason". So the
 * property worth asserting is not that one path works. It is that **the two
 * paths end up drawing the same thing**, which is one assertion rather than two
 * screens to keep in step, and it stays true if a third way onto that screen is
 * ever added.
 *
 * ## Why it is a rendered comparison and not two field checks
 *
 * `design.test.tsx` renders the gallery's waiting screen and asks it for
 * `Signed in as`. That is the drawing. What was broken is what the app hands the
 * drawing, so this renders the same component from each of the two answers the
 * app actually produces and compares the markup. A future edit that carried the
 * email and dropped the name, or carried a person whose `enabled` disagreed with
 * the state, would be a difference here.
 *
 * There is no DOM in this project's test setup, so this reads what
 * `renderToStaticMarkup` writes, the way `design.test.tsx` and
 * `HomePane.test.tsx` do.
 */

import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { SessionAnswer } from '../../shared/auth'
import { WaitingList } from '../design/Gate'
import { afterTheGateSaid } from './gate'

/** The person the development door makes, as `GET /api/auth/session` sends one. */
const developer = {
  id: 'c2819db5-0000-4000-8000-000000000000',
  enabled: true,
  email: 'developer@localhost',
  name: 'developer',
}

/** What the first ask answered while this person was still admitted. */
const admitted: SessionAnswer = { state: 'admitted', user: developer }

/**
 * What a reload answers once the owner has taken them off the list: the same
 * person, `enabled` now false, straight from the server.
 */
const reloaded: SessionAnswer = {
  state: 'waiting',
  user: { ...developer, enabled: false },
}

/** The screen, drawn out of an answer exactly as `WaitingScreen` draws it. */
const drawn = (answer: SessionAnswer) =>
  renderToStaticMarkup(<WaitingList email={answer.user?.email ?? ''} />)

describe('the two ways onto the waiting screen', () => {
  it('draws the same screen whether a refusal or a reload got you there', () => {
    const byRefusal = afterTheGateSaid(admitted, 'waiting')

    expect(byRefusal).toEqual(reloaded)
    expect(drawn(byRefusal)).toBe(drawn(reloaded))
  })

  it('says who this browser is signed in as on both of them', () => {
    for (const answer of [afterTheGateSaid(admitted, 'waiting'), reloaded]) {
      expect(drawn(answer)).toContain('developer@localhost')
    }
  })

  /*
   * The state the server just said, never the one carried. Somebody refused
   * `403` is not enabled, whatever the answer this browser was holding said a
   * moment ago, and the corner menu reads `answer.user` too.
   */
  it('takes enabled from the refusal rather than from what it was holding', () => {
    expect(afterTheGateSaid(admitted, 'waiting').user?.enabled).toBe(false)
  })
})

describe('what a refusal is allowed to carry', () => {
  it('drops the person entirely when the server says there is nobody', () => {
    // `SessionAnswer` means an absent `user` by `anonymous`, and a signed-out
    // browser describing the person who just left would be a screen lying.
    expect(afterTheGateSaid(admitted, 'anonymous')).toEqual({ state: 'anonymous' })
  })

  it('invents nobody when it was holding nobody', () => {
    expect(afterTheGateSaid(null, 'waiting')).toEqual({ state: 'waiting' })
    expect(afterTheGateSaid({ state: 'anonymous' }, 'waiting')).toEqual({ state: 'waiting' })
  })

  /*
   * A page of thirty photographs failing at once is thirty refusals, and the one
   * that matters is that the question was asked rather than that it was asked
   * thirty times. Returning the same object is what keeps that one re-render.
   */
  it('hands back the very same answer when nothing has moved', () => {
    expect(afterTheGateSaid(admitted, 'admitted')).toBe(admitted)
    expect(afterTheGateSaid(reloaded, 'waiting')).toBe(reloaded)
  })
})

/**
 * And the caller, which is the half the cases above cannot see.
 *
 * Everything here is about a function, and the defect was in what the listener
 * did instead of calling one. There is no DOM in this project's test setup, so
 * `GateProvider`'s effects cannot be run and driven; `arranging.test.ts` and
 * `design.test.tsx` both pin a property of a file by reading the file when that
 * is what is available, and this is the same trade said out loud. It fails if
 * somebody puts the bare `{ state }` back, which is exactly what was there.
 */
describe('the one listener that reads a refusal', () => {
  const source = readFileSync(new URL('./gate.tsx', import.meta.url), 'utf8')

  it('hands the answer it was holding to the function above', () => {
    const listener = /whenTheGateRefuses\(\(state\) => \{([\s\S]*?)\}\)/.exec(source)?.[1]

    expect(listener, 'the refusal listener is not where this file expects it').toBeTruthy()
    expect(listener).toContain('afterTheGateSaid(was, state)')
  })
})
