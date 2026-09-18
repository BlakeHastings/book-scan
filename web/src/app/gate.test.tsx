/**
 * Reached by a reload, `GET /api/auth/session` answers `waiting` with the person on it.
 * Reached by a `403` on a tab press, the gate's refusal body is `{ state, error }` and
 * carries no person. This asserts the two paths end up drawing the same screen rather
 * than checking either path's fields individually, so a third way onto the screen stays
 * covered too.
 *
 * There is no DOM in this project's test setup, so this reads what `renderToStaticMarkup`
 * writes, the way `design.test.tsx` and `HomePane.test.tsx` do.
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

  it('takes enabled from the refusal rather than from what it was holding', () => {
    expect(afterTheGateSaid(admitted, 'waiting').user?.enabled).toBe(false)
  })
})

describe('what a refusal is allowed to carry', () => {
  it('drops the person entirely when the server says there is nobody', () => {
    expect(afterTheGateSaid(admitted, 'anonymous')).toEqual({ state: 'anonymous' })
  })

  it('invents nobody when it was holding nobody', () => {
    expect(afterTheGateSaid(null, 'waiting')).toEqual({ state: 'waiting' })
    expect(afterTheGateSaid({ state: 'anonymous' }, 'waiting')).toEqual({ state: 'waiting' })
  })

  /* Returning the same object rather than an equal one is what keeps a page of many refusals to one re-render. */
  it('hands back the very same answer when nothing has moved', () => {
    expect(afterTheGateSaid(admitted, 'admitted')).toBe(admitted)
    expect(afterTheGateSaid(reloaded, 'waiting')).toBe(reloaded)
  })
})

/**
 * There is no DOM in this project's test setup, so `GateProvider`'s effects cannot be
 * run and driven, and this instead reads the source file to pin what the listener does.
 */
describe('the one listener that reads a refusal', () => {
  const source = readFileSync(new URL('./gate.tsx', import.meta.url), 'utf8')

  it('hands the answer it was holding to the function above', () => {
    const listener = /whenTheGateRefuses\(\(state\) => \{([\s\S]*?)\}\)/.exec(source)?.[1]

    expect(listener, 'the refusal listener is not where this file expects it').toBeTruthy()
    expect(listener).toContain('afterTheGateSaid(was, state)')
  })
})
