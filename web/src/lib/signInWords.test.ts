/**
 * What the login screen says to somebody a failed sign-in dropped there (#557).
 *
 * Two things are checked here and they are different in kind. The first is the
 * closed set holding: a query parameter selects one of six sentences this
 * repository wrote, and never supplies one. The second is the sentences
 * themselves, which are the part of #557 that is actually the work and are
 * otherwise checked by nothing at all.
 */

import { describe, expect, it } from 'vitest'

import {
  SIGN_IN_FLOW_MINUTES, SIGN_IN_TROUBLE, signInTroubleIn, troubleUrl,
} from '../../shared/auth'
import { signInTroubleSaid } from './signInWords'

describe('what may reach the words at all', () => {
  it('lets each of the six through, and nothing else', () => {
    for (const one of SIGN_IN_TROUBLE) expect(signInTroubleIn(one)).toBe(one)
  })

  /**
   * The whole of the injection defence, driven rather than asserted in a
   * comment. Anything a stranger can put in the address bar selects nothing,
   * and a screen that renders nothing is the same screen somebody gets on an
   * ordinary first visit.
   */
  it('lets nothing a stranger could write through', () => {
    const tried: unknown[] = [
      '<script>alert(1)</script>',
      'Your account has been suspended. Call 0800 000 000.',
      'CANCELLED',
      'cancelled ',
      '',
      null,
      undefined,
      42,
      ['cancelled'],
      { toString: () => 'cancelled' },
    ]
    for (const one of tried) expect(signInTroubleIn(one), String(one)).toBeUndefined()
  })

  it('builds a URL back to the login screen and nowhere else', () => {
    expect(troubleUrl('cancelled', 'google')).toBe('/?signin=cancelled&way=google')
    // A provider is not always knowable, and an absent one is absent rather
    // than an empty parameter for the client to have to think about.
    expect(troubleUrl('no-such-way')).toBe('/?signin=no-such-way')
  })
})

describe('the words themselves', () => {
  const each = SIGN_IN_TROUBLE.map((one) => [one] as const)

  it.each(each)('has something to say about %s, with a name and without', (trouble) => {
    for (const who of ['Google', '']) {
      const said = signInTroubleSaid(trouble, who)
      expect(said.title.length, `${trouble} has no title`).toBeGreaterThan(10)
      expect(said.said.length, `${trouble} has no explanation`).toBeGreaterThan(30)
      // The sentence somebody sees when the provider list has not loaded, and
      // the failure this guards is "signing in with ." with a hole in it.
      expect(`${said.title} ${said.said}`, `${trouble} left a gap`).not.toMatch(/\s[.,]/)
    }
  })

  /**
   * **The distinction #557 is about**, asked directly.
   *
   * Somebody who pressed Cancel and somebody who pressed Back are not in the
   * same situation, and the second sentence sounds like an accusation when it is
   * given to the first. This is the case that would fail the day the six get
   * quietly collapsed into "your sign-in did not work", which is what every
   * cheaper version of this fix looks like.
   */
  it('tells six different people six different things', () => {
    const titles = SIGN_IN_TROUBLE.map((one) => signInTroubleSaid(one, 'Google').title)
    expect(new Set(titles).size).toBe(SIGN_IN_TROUBLE.length)

    const saids = SIGN_IN_TROUBLE.map((one) => signInTroubleSaid(one, 'Google').said)
    expect(new Set(saids).size).toBe(SIGN_IN_TROUBLE.length)
  })

  it('names the provider where it has one, and never leaves the name out of a title that had it', () => {
    expect(signInTroubleSaid('cancelled', 'Google').title).toContain('Google')
    expect(signInTroubleSaid('cancelled', '').title).not.toContain('Google')
    expect(signInTroubleSaid('unavailable', 'Microsoft').title).toContain('Microsoft')
  })

  /**
   * Nothing out of the model, which is the design system's rule applied to the
   * words rather than to the markup: "no word out of the model reaches the
   * interface". `server/auth/oidc.ts` refuses a token in ten sentences naming
   * claims and endpoints, and none of them is a thing a person can act on.
   */
  it('recites none of this server\'s machinery at a person', () => {
    const machinery = [
      'ID token', 'id_token', 'issuer', 'iss', 'aud', 'nonce', 'PKCE', 'OIDC',
      'OpenID', 'claim', 'token endpoint', 'HTTP', 'state', 'cookie', '401',
      'discovery', 'redirect_uri', 'access_denied',
    ]
    for (const trouble of SIGN_IN_TROUBLE) {
      const said = signInTroubleSaid(trouble, 'Google')
      const whole = `${said.title} ${said.said}`
      for (const word of machinery) {
        expect(whole, `${trouble} said "${word}"`).not.toContain(word)
      }
    }
  })

  /**
   * The advice has to be true, not encouraging.
   *
   * `refused` is the one where trying again lands in the same place, and
   * `WaitingList` already settled that this app says so rather than offering an
   * act that does not exist. A hopeful "try again" there would be the thing
   * `design/Gate.tsx` calls being sent round the sign-in loop for ever.
   */
  /**
   * The one number in these sentences, and it is a fact about the server.
   *
   * The flow row's expiry and the flow cookie's `Max-Age` are the same number as
   * this, and #557 records what happens when they are not: the same wait lands
   * on a different exit and somebody is told a sign-in was used that nobody
   * used. So the sentence reads the constant, and this is the case that fails if
   * somebody writes a fresh number into it.
   */
  it('says how long a sign-in lives from the constant that decides it', () => {
    expect(signInTroubleSaid('stale').said).toContain('ten minutes')
    expect(SIGN_IN_FLOW_MINUTES).toBe(10)
  })

  it('does not tell somebody to try again where trying again will not help', () => {
    expect(signInTroubleSaid('refused', 'Google').said).toContain('same place')
    expect(signInTroubleSaid('unavailable', 'Google').said).toContain('trying again')
    expect(signInTroubleSaid('cancelled', 'Google').said).toContain('Start again')
  })
})
