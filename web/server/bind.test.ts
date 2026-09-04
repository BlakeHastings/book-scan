/**
 * Which interface the server listens on, and what it refuses (#539).
 *
 * The three things this file is here to hold, in the order they matter:
 *
 * 1. **The default does not move.** Unset, empty and blank all mean loopback,
 *    which is what every deployment that has not thought about this gets, and
 *    what this app has done since it was a development server. A change that
 *    opened it would be a change that made an app reachable without anybody
 *    deciding to, and this is the test that would go red.
 * 2. **A value it does not recognise is refused rather than defaulted.** A
 *    deployment that asked to be reachable and silently was not would look
 *    exactly like the bind it was trying to change.
 * 3. **The start log says which, both ways round.** The two addresses differ by
 *    one character and by everything else in what they mean.
 */

import { describe, expect, it } from 'vitest'

import { BIND, BIND_ADDRESSES, DEFAULT_BIND, bindFrom, describeBind } from './bind'

describe('the bind', () => {
  it('is loopback when nothing says otherwise', () => {
    expect(bindFrom({})).toEqual({ name: 'loopback', address: '127.0.0.1' })
  })

  it('is loopback when the variable is empty, because empty means unset', () => {
    expect(bindFrom({ [BIND]: '' }).address).toBe('127.0.0.1')
    expect(bindFrom({ [BIND]: '   ' }).address).toBe('127.0.0.1')
  })

  it('is loopback when a deployment says so out loud', () => {
    expect(bindFrom({ [BIND]: 'loopback' })).toEqual({ name: 'loopback', address: '127.0.0.1' })
  })

  it('opens every interface when a deployment asks for one', () => {
    expect(bindFrom({ [BIND]: 'all' })).toEqual({ name: 'all', address: '0.0.0.0' })
  })

  it('is forgiving about spacing and case, because those are not decisions', () => {
    expect(bindFrom({ [BIND]: '  ALL  ' }).name).toBe('all')
  })

  /*
   * The value everybody types. Refusing it is the whole of the "a word rather
   * than an address" decision, so this is the case that would be quietly deleted
   * by somebody who thought the refusal was pedantry, and the message is what
   * has to make the case to them at 2am.
   */
  it('refuses the address that means the same thing, and says which word to use', () => {
    expect(() => bindFrom({ [BIND]: '0.0.0.0' })).toThrow(/is "0\.0\.0\.0"/)
    expect(() => bindFrom({ [BIND]: '0.0.0.0' })).toThrow(/all\s+0\.0\.0\.0/)
  })

  it('refuses an interface address, which is the one that would break on the next start', () => {
    expect(() => bindFrom({ [BIND]: '172.17.0.2' })).toThrow(/not one of the two words/)
  })

  it('refuses a word nobody defined rather than falling back to the default', () => {
    expect(() => bindFrom({ [BIND]: 'public' })).toThrow(/BOOKSCAN_BIND is "public"/)
  })

  it('names the variable in the refusal, because that is what makes it recoverable', () => {
    expect(() => bindFrom({ [BIND]: 'yes' })).toThrow(/BOOKSCAN_BIND/)
  })

  /*
   * The contract declares these two pairs and
   * `scripts/check-deploy-contract.mjs` holds the file to them. This is the same
   * claim from the other side, so a change here fails a test as well as a check.
   */
  it('knows two answers and only two', () => {
    expect(Object.entries(BIND_ADDRESSES)).toEqual([['loopback', '127.0.0.1'], ['all', '0.0.0.0']])
    expect(DEFAULT_BIND).toBe('loopback')
  })
})

describe('what it says on start', () => {
  it('says loopback is loopback, and what that costs in a container', () => {
    const [line] = describeBind(bindFrom({}))
    expect(line).toContain('[api] bound to loopback only')
    expect(line).toContain('a published port reaches nothing')
    expect(line).toContain('BOOKSCAN_BIND=all')
  })

  it('says an open bind is open, in a word that cannot be skimmed past', () => {
    const [line] = describeBind(bindFrom({ [BIND]: 'all' }))
    expect(line).toContain('[api] bound to EVERY interface')
    expect(line).toContain('the sign-in gate is the only thing in front')
  })

  it('says one or the other and never neither', () => {
    for (const value of ['', 'loopback', 'all']) {
      expect(describeBind(bindFrom({ [BIND]: value }))).toHaveLength(1)
    }
  })
})
