/**
 * Two things are checked here and they are different in kind: that a query parameter
 * selects one of six sentences this repository wrote and never supplies one, and the
 * sentences themselves.
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

  /** Anything a stranger can put in the address bar selects nothing, which renders the ordinary first-visit screen. */
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
    // An unknowable provider is left out of the URL rather than sent as an empty parameter.
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
      expect(`${said.title} ${said.said}`, `${trouble} left a gap`).not.toMatch(/\s[.,]/)
    }
  })

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

  /** The flow row's expiry and the flow cookie's `Max-Age` must be the same number as this constant. */
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
