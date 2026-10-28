import { describe, expect, it } from 'vitest'

import { PROXY_HOPS, describeProxyHops, proxyHopsFrom, trustProxySetting } from './trust-proxy'

describe('how many proxy hops are trusted', () => {
  it('is none when nothing says otherwise, and when the variable is empty', () => {
    expect(proxyHopsFrom({})).toBe(0)
    expect(proxyHopsFrom({ [PROXY_HOPS]: '' })).toBe(0)
    expect(proxyHopsFrom({ [PROXY_HOPS]: '  ' })).toBe(0)
  })

  it('is the count a deployment gives', () => {
    expect(proxyHopsFrom({ [PROXY_HOPS]: '0' })).toBe(0)
    expect(proxyHopsFrom({ [PROXY_HOPS]: '1' })).toBe(1)
    expect(proxyHopsFrom({ [PROXY_HOPS]: ' 2 ' })).toBe(2)
  })

  /*
   * Express would accept every one of these, and `true` is the one a deployer
   * reaches for. Each lets a client choose the address its rate limit counts.
   */
  it('refuses true, and says why', () => {
    expect(() => proxyHopsFrom({ [PROXY_HOPS]: 'true' })).toThrow(/BOOKSCAN_PROXY_HOPS is "true", which is not a count/)
    expect(() => proxyHopsFrom({ [PROXY_HOPS]: 'true' })).toThrow(/anybody could choose/)
  })

  it('refuses an address, a list, a negative and a fraction rather than falling back to none', () => {
    for (const asked of ['10.0.0.1', 'loopback, uniquelocal', '-1', '1.5', 'two']) {
      expect(() => proxyHopsFrom({ [PROXY_HOPS]: asked })).toThrow(/which is not a count/)
    }
  })

  it('hands Express false for none, so express-rate-limit can still say a proxy is being ignored', () => {
    expect(trustProxySetting(0)).toBe(false)
    expect(trustProxySetting(2)).toBe(2)
  })

  it('says on start which entry the client address is read from', () => {
    expect(describeProxyHops(0)[0]).toMatch(/trusting no proxy/)
    expect(describeProxyHops(1)[0]).toMatch(/1 proxy hop .*the 1st entry from the right/)
    expect(describeProxyHops(2)[0]).toMatch(/2 proxy hops .*the 2nd entry from the right/)
  })
})
