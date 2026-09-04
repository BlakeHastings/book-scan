/**
 * The issuer check, driven against documents and tokens constructed here (#537).
 *
 * ## Why this file is where the argument is settled
 *
 * #537's whole point is that Microsoft's defect is not findable by driving a
 * happy path: a wrong issuer check produces a sign-in that succeeds. So the
 * cases that matter are the refusals, and every one of them is driven here with
 * no network and no app registration.
 *
 * **The fixtures are real, and where they came from is recorded.** The four
 * documents below are the `issuer`, `authorization_endpoint`, `token_endpoint`
 * and `subject_types_supported` fields of Microsoft's live discovery documents,
 * read on 2026-09-04 from
 * `https://login.microsoftonline.com/<authority>/v2.0/.well-known/openid-configuration`,
 * which is a public unauthenticated GET and needs no app registration. They are
 * copied in rather than fetched, because a suite that reaches Microsoft on every
 * pull request is a suite that goes red when Microsoft has a bad afternoon.
 *
 * The tenant one is Microsoft's own published tenant and is used as a specimen
 * of the *shape* a tenant answers with. **No tenant belonging to this
 * deployment is in this repository and none may be.**
 */

import { describe, expect, it, beforeEach } from 'vitest'

import {
  discoveredCount, forgetDiscovered, readDiscovery, resolveProvider,
} from './discovery'
import { microsoftDiscovery, signInFrom, MICROSOFT_TENANT } from './providers'
import { claimsFrom, SignInRefused } from './oidc'
import type { SignInProviderConfig } from './providers'

const HOST = 'https://login.microsoftonline.com'
const where = (authority: string) =>
  `${HOST}/${authority}/v2.0/.well-known/openid-configuration`

/**
 * What Microsoft actually answers, per authority, on 2026-09-04.
 *
 * The two shapes are the finding: `consumers` and a named tenant answer with an
 * issuer, and `common` and `organizations` answer with the string
 * `https://login.microsoftonline.com/{tenantid}/v2.0`, braces and all.
 */
const AS_MICROSOFT_ANSWERS = {
  consumers: {
    issuer: `${HOST}/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0`,
    authorization_endpoint: `${HOST}/consumers/oauth2/v2.0/authorize`,
    token_endpoint: `${HOST}/consumers/oauth2/v2.0/token`,
    subject_types_supported: ['pairwise'],
  },
  /** Discovered at `.../microsoft.onmicrosoft.com/v2.0/...`, answered as a GUID. */
  tenant: {
    issuer: `${HOST}/72f988bf-86f1-41af-91ab-2d7cd011db47/v2.0`,
    authorization_endpoint: `${HOST}/72f988bf-86f1-41af-91ab-2d7cd011db47/oauth2/v2.0/authorize`,
    token_endpoint: `${HOST}/72f988bf-86f1-41af-91ab-2d7cd011db47/oauth2/v2.0/token`,
    subject_types_supported: ['pairwise'],
  },
  common: {
    issuer: `${HOST}/{tenantid}/v2.0`,
    authorization_endpoint: `${HOST}/common/oauth2/v2.0/authorize`,
    token_endpoint: `${HOST}/common/oauth2/v2.0/token`,
    subject_types_supported: ['pairwise'],
  },
  organizations: {
    issuer: `${HOST}/{tenantid}/v2.0`,
    authorization_endpoint: `${HOST}/organizations/oauth2/v2.0/authorize`,
    token_endpoint: `${HOST}/organizations/oauth2/v2.0/token`,
    subject_types_supported: ['pairwise'],
  },
}

beforeEach(() => {
  forgetDiscovered()
})

describe('reading an authority, out of its own discovery document', () => {
  it('takes the issuer and both endpoints out of what a tenant answered', () => {
    const found = readDiscovery(
      AS_MICROSOFT_ANSWERS.tenant,
      where('microsoft.onmicrosoft.com'),
      'Microsoft',
    )

    /*
     * The point of the whole file, in one assertion. Discovery was performed
     * against a *domain* and the issuer that came back is a *GUID*, so an issuer
     * spelled from the configured tenant would not have matched a single real
     * token, and one spelled from a GUID would have had to be written down here.
     */
    expect(found.issuer).toBe(`${HOST}/72f988bf-86f1-41af-91ab-2d7cd011db47/v2.0`)
    expect(found.tokenEndpoint).toBe(AS_MICROSOFT_ANSWERS.tenant.token_endpoint)
    expect(found.authorizationEndpoint)
      .toBe(AS_MICROSOFT_ANSWERS.tenant.authorization_endpoint)
  })

  it('takes personal Microsoft accounts, whose issuer is the well-known MSA tenant', () => {
    const found = readDiscovery(AS_MICROSOFT_ANSWERS.consumers, where('consumers'), 'Microsoft')
    expect(found.issuer).toBe(`${HOST}/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0`)
  })

  /**
   * The defect this issue exists to avoid, refused for what the document said
   * rather than for what the authority is called.
   */
  for (const authority of ['common', 'organizations'] as const) {
    it(`refuses ${authority}, which answers with a template rather than an issuer`, () => {
      expect(() => readDiscovery(
        AS_MICROSOFT_ANSWERS[authority], where(authority), 'Microsoft',
      )).toThrow(/template rather than an issuer/)
    })
  }

  it('refuses a template whatever the authority is called, so a third one is covered too', () => {
    expect(() => readDiscovery(
      { ...AS_MICROSOFT_ANSWERS.consumers, issuer: `${HOST}/{tenantid}/v2.0` },
      where('an-authority-microsoft-has-not-invented-yet'),
      'Microsoft',
    )).toThrow(/template rather than an issuer/)
  })

  /**
   * A document is only worth fetching because what it says about itself comes
   * from itself. Without this rule, one bad answer moves the issuer, or the
   * endpoint this server posts its client secret to, anywhere at all.
   */
  it('refuses an issuer on another origin', () => {
    expect(() => readDiscovery(
      { ...AS_MICROSOFT_ANSWERS.consumers, issuer: 'https://login.microsoftonline.example/x/v2.0' },
      where('consumers'),
      'Microsoft',
    )).toThrow(/names an issuer somewhere else/)
  })

  it('refuses a token endpoint on another origin, where the client secret would go', () => {
    expect(() => readDiscovery(
      { ...AS_MICROSOFT_ANSWERS.consumers, token_endpoint: 'https://collector.example/token' },
      where('consumers'),
      'Microsoft',
    )).toThrow(/points its token_endpoint at another origin/)
  })

  it('refuses an authorization endpoint on another origin', () => {
    expect(() => readDiscovery(
      { ...AS_MICROSOFT_ANSWERS.consumers, authorization_endpoint: 'https://elsewhere.example/a' },
      where('consumers'),
      'Microsoft',
    )).toThrow(/points its authorization_endpoint at another origin/)
  })

  it('refuses a document with no issuer, an empty one, or one that is not a string', () => {
    for (const issuer of [undefined, '', '   ', 42, null, ['a']]) {
      expect(() => readDiscovery(
        { ...AS_MICROSOFT_ANSWERS.consumers, issuer }, where('consumers'), 'Microsoft',
      ), JSON.stringify(issuer)).toThrow(/names no issuer/)
    }
  })

  it('refuses a document missing either endpoint', () => {
    expect(() => readDiscovery(
      { ...AS_MICROSOFT_ANSWERS.consumers, token_endpoint: undefined }, where('consumers'), 'Microsoft',
    )).toThrow(/names no token_endpoint/)
    expect(() => readDiscovery(
      { ...AS_MICROSOFT_ANSWERS.consumers, authorization_endpoint: undefined },
      where('consumers'), 'Microsoft',
    )).toThrow(/names no authorization_endpoint/)
  })

  it('refuses something that is not a document at all', () => {
    for (const document of [null, 'a string', 42, ['a', 'list']]) {
      expect(() => readDiscovery(document, where('consumers'), 'Microsoft'), JSON.stringify(document))
        .toThrow(/not an object/)
    }
  })
})

/**
 * The issuer check itself, against tokens constructed here.
 *
 * `claimsFrom` is what the callback runs, and the provider it is handed is a
 * *resolved* one. These cases build the resolved provider out of a real document
 * and then hand it tokens, which is the only way to show that the check does
 * what #537 asked for without an app registration.
 */
describe('the issuer check, against tokens constructed here', () => {
  /** An ID token, unsigned, because nothing verifies a signature. See oidc.ts. */
  const token = (claims: Record<string, unknown>) => [
    Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify(claims)).toString('base64url'),
    'a-signature-nothing-reads',
  ].join('.')

  const tenantA = readDiscovery(
    AS_MICROSOFT_ANSWERS.tenant, where('microsoft.onmicrosoft.com'), 'Microsoft',
  )
  const asMicrosoft = { issuer: tenantA.issuer, clientId: 'this-app', label: 'Microsoft' }
  const claims = (over: Record<string, unknown> = {}) => ({
    iss: tenantA.issuer,
    aud: 'this-app',
    sub: 'a-pairwise-subject',
    exp: Math.floor(Date.now() / 1000) + 300,
    nonce: 'the-nonce-that-went-out',
    email: 'somebody@example.invalid',
    name: 'Some Body',
    ...over,
  })

  it('accepts a token from the tenant the document named', () => {
    const read = claimsFrom(token(claims()), asMicrosoft, new Date())
    expect(read.subject).toBe('a-pairwise-subject')
  })

  /**
   * **This is the case the issue exists for.** A token from a different Entra
   * tenant is a perfectly valid Microsoft token: real signature, real user, real
   * `aud` if the app is multi-tenant. Everything about it is right except which
   * authority issued it, and a check that merely established "this came from
   * login.microsoftonline.com" would let it through and look like a working
   * sign-in.
   */
  it('refuses a token from another tenant on the same host', () => {
    const anotherTenant = `${HOST}/00000000-1111-2222-3333-444444444444/v2.0`
    expect(() => claimsFrom(token(claims({ iss: anotherTenant })), asMicrosoft, new Date()))
      .toThrow(SignInRefused)
  })

  it('refuses a token whose issuer is the authority rather than the tenant', () => {
    // What a hand-written row would most likely have carried, and what no token
    // has ever contained.
    for (const iss of [`${HOST}/common/v2.0`, `${HOST}/organizations/v2.0`, `${HOST}/{tenantid}/v2.0`]) {
      expect(() => claimsFrom(token(claims({ iss })), asMicrosoft, new Date()), iss)
        .toThrow(/was not issued by Microsoft/)
    }
  })

  it('refuses a token whose issuer merely starts with the right thing', () => {
    // The relaxation somebody reaches for when a fixture will not pass, and the
    // one #537 says not to make. Both of these share a prefix with the issuer.
    for (const iss of [
      `${tenantA.issuer}.evil.example`,
      `${HOST}/72f988bf-86f1-41af-91ab-2d7cd011db47/v2.0/../../someone-else/v2.0`,
    ]) {
      expect(() => claimsFrom(token(claims({ iss })), asMicrosoft, new Date()), iss)
        .toThrow(/was not issued by Microsoft/)
    }
  })

  it('refuses a token with no issuer at all', () => {
    expect(() => claimsFrom(token(claims({ iss: undefined })), asMicrosoft, new Date()))
      .toThrow(/was not issued by Microsoft/)
  })
})

describe('which authority a deployment may name', () => {
  it("builds one URL, on Microsoft's host, for a GUID, a domain, or consumers", () => {
    expect(microsoftDiscovery('72f988bf-86f1-41af-91ab-2d7cd011db47'))
      .toBe(where('72f988bf-86f1-41af-91ab-2d7cd011db47'))
    expect(microsoftDiscovery('contoso.example')).toBe(where('contoso.example'))
    expect(microsoftDiscovery('consumers')).toBe(where('consumers'))
    expect(microsoftDiscovery('  consumers  ')).toBe(where('consumers'))
  })

  /**
   * Refused at start, in words, rather than at the first person's first sign-in.
   * `readDiscovery` refuses them again on what the document says, which is the
   * check that would hold for an authority Microsoft has not invented yet; this
   * one only makes the answer arrive sooner.
   */
  it('refuses the two authorities that have no single issuer, by name', () => {
    for (const authority of ['common', 'organizations', 'COMMON', 'Organizations']) {
      expect(() => microsoftDiscovery(authority), authority)
        .toThrow(/authority rather than a tenant/)
    }
  })

  it('refuses a tenant that could move the URL somewhere else', () => {
    for (const tenant of [
      'consumers/../../evil.example',
      'evil.example/consumers',
      '..',
      'a%2fb',
      'a b',
      'https://evil.example',
      '@evil.example',
      '-leading-dash-is-not-a-host',
    ]) {
      expect(() => microsoftDiscovery(tenant), tenant).toThrow(/not a tenant/)
    }
  })

  it('refuses an empty tenant rather than defaulting to one', () => {
    expect(() => microsoftDiscovery('   ')).toThrow(/there is no default/)
  })

  it("never builds a URL off Microsoft's host, whatever it was handed", () => {
    for (const tenant of ['consumers', 'contoso.example', 'a'.repeat(200)]) {
      expect(new URL(microsoftDiscovery(tenant)).host).toBe('login.microsoftonline.com')
    }
  })
})

describe('resolving a provider', () => {
  const rowOf = (over: Partial<SignInProviderConfig>): SignInProviderConfig => ({
    id: 'x', label: 'X', kind: 'oidc', issuer: '', discovery: '',
    authorizationEndpoint: '', tokenEndpoint: '', scope: 'openid',
    clientId: 'c', clientSecret: 's', subject: '', admitsOnSight: false, ...over,
  })

  /** A `fetch` that answers one document and counts how often it was called. */
  function answering(document: unknown, status = 200) {
    let calls = 0
    const impl = (async () => {
      calls += 1
      return new Response(JSON.stringify(document), {
        status, headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch
    return { impl, calls: () => calls }
  }

  it('returns a provider that carries an issuer unchanged, and fetches nothing', async () => {
    const stub = answering(AS_MICROSOFT_ANSWERS.consumers)
    const row = rowOf({
      issuer: 'https://accounts.google.com',
      authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenEndpoint: 'https://oauth2.googleapis.com/token',
    })

    expect(await resolveProvider(row, stub.impl)).toEqual(row)
    expect(stub.calls(), 'a provider with an issuer must not touch the network').toBe(0)
  })

  it('fills the issuer and both endpoints in from the document', async () => {
    const stub = answering(AS_MICROSOFT_ANSWERS.consumers)
    const resolved = await resolveProvider(rowOf({ discovery: where('consumers') }), stub.impl)

    expect(resolved.issuer).toBe(AS_MICROSOFT_ANSWERS.consumers.issuer)
    expect(resolved.tokenEndpoint).toBe(AS_MICROSOFT_ANSWERS.consumers.token_endpoint)
    expect(stub.calls()).toBe(1)
  })

  it('reads a document once per process and remembers it', async () => {
    const stub = answering(AS_MICROSOFT_ANSWERS.consumers)
    const row = rowOf({ discovery: where('consumers') })

    await resolveProvider(row, stub.impl)
    await resolveProvider(row, stub.impl)
    await resolveProvider(row, stub.impl)

    expect(stub.calls()).toBe(1)
    expect(discoveredCount()).toBe(1)
  })

  it('remembers nothing when the document was refused, so the next attempt tries again', async () => {
    const bad = answering(AS_MICROSOFT_ANSWERS.common)
    await expect(resolveProvider(rowOf({ discovery: where('common') }), bad.impl))
      .rejects.toThrow(/template rather than an issuer/)
    expect(discoveredCount()).toBe(0)
  })

  it('refuses when the authority will not answer, and says so as a status', async () => {
    const stub = answering({}, 503)
    await expect(resolveProvider(rowOf({ label: 'Microsoft', discovery: where('consumers') }), stub.impl))
      .rejects.toThrow(/did not answer for its discovery document \(HTTP 503\)/)
  })

  it('refuses when the authority cannot be reached at all', async () => {
    const dead = (async () => { throw new Error('getaddrinfo ENOTFOUND') }) as unknown as typeof fetch
    await expect(resolveProvider(rowOf({ label: 'Microsoft', discovery: where('consumers') }), dead))
      .rejects.toThrow(/could not be reached/)
  })

  /**
   * Unreachable through `signInFrom`, which builds every row itself, and here
   * because the alternative to refusing is comparing every token's `iss` against
   * an empty string.
   */
  it('refuses a provider with neither an issuer nor anywhere to ask', async () => {
    await expect(resolveProvider(rowOf({}))).rejects.toThrow(/neither an issuer nor a discovery URL/)
  })

  it("does not carry one authority's answer over to another", async () => {
    const consumers = answering(AS_MICROSOFT_ANSWERS.consumers)
    await resolveProvider(rowOf({ discovery: where('consumers') }), consumers.impl)

    const tenant = answering(AS_MICROSOFT_ANSWERS.tenant)
    const second = await resolveProvider(
      rowOf({ discovery: where('microsoft.onmicrosoft.com') }), tenant.impl,
    )

    expect(second.issuer).toBe(AS_MICROSOFT_ANSWERS.tenant.issuer)
    expect(tenant.calls()).toBe(1)
  })
})

/**
 * What `signInFrom` builds for Microsoft, which is a row with a hole in it and a
 * place to ask.
 */
describe('Microsoft, read out of the environment', () => {
  const withMicrosoft = (over: Record<string, string> = {}) => ({
    BOOKSCAN_OIDC_MICROSOFT_CLIENT_ID: 'an-id',
    BOOKSCAN_OIDC_MICROSOFT_CLIENT_SECRET: 'a-secret',
    BOOKSCAN_OIDC_MICROSOFT_TENANT: 'consumers',
    BOOKSCAN_PUBLIC_ORIGIN: 'https://books.example',
    ...over,
  })

  it('builds a row with no issuer on it, and a discovery URL instead', () => {
    const [provider] = signInFrom(withMicrosoft()).providers

    expect(provider).toMatchObject({
      id: 'microsoft',
      label: 'Microsoft',
      kind: 'oidc',
      clientId: 'an-id',
      admitsOnSight: false,
    })
    /*
     * The three assertions this issue is about. Nothing about Microsoft's issuer
     * or endpoints is written down in this repository; there is one URL, and it
     * is where to go and ask.
     */
    expect(provider?.issuer).toBe('')
    expect(provider?.authorizationEndpoint).toBe('')
    expect(provider?.tokenEndpoint).toBe('')
    expect(provider?.discovery).toBe(where('consumers'))
  })

  it("does not ask for a scope that reaches anybody's data, and takes no refresh token", () => {
    const [provider] = signInFrom(withMicrosoft()).providers
    expect(provider?.scope).toBe('openid email profile')
    expect(provider?.scope).not.toContain('offline_access')
  })

  it('refuses any two of the three, naming what is missing', () => {
    for (const missing of [
      'BOOKSCAN_OIDC_MICROSOFT_CLIENT_ID',
      'BOOKSCAN_OIDC_MICROSOFT_CLIENT_SECRET',
      MICROSOFT_TENANT,
    ]) {
      const env = withMicrosoft()
      delete (env as Record<string, string>)[missing]
      expect(() => signInFrom(env), missing).toThrow(new RegExp(missing))
    }
  })

  it('refuses common at start, before anybody tries to sign in', () => {
    expect(() => signInFrom(withMicrosoft({ BOOKSCAN_OIDC_MICROSOFT_TENANT: 'common' })))
      .toThrow(/authority rather than a tenant/)
  })

  it('refuses a provider with nowhere to redirect back to, as Google is refused', () => {
    const env = withMicrosoft()
    delete (env as Record<string, string>).BOOKSCAN_PUBLIC_ORIGIN
    expect(() => signInFrom(env)).toThrow(/BOOKSCAN_PUBLIC_ORIGIN/)
  })

  /** The refusal with teeth, for the new provider rather than only the old one. */
  it('refuses the development door beside Microsoft', () => {
    expect(() => signInFrom(withMicrosoft({ BOOKSCAN_DEV_SIGN_IN: 'a-developer' })))
      .toThrow(/BOOKSCAN_DEV_SIGN_IN/)
  })

  it('stands beside Google without either learning anything from the other', () => {
    const { providers } = signInFrom(withMicrosoft({
      BOOKSCAN_OIDC_GOOGLE_CLIENT_ID: 'a-google-id',
      BOOKSCAN_OIDC_GOOGLE_CLIENT_SECRET: 'a-google-secret',
    }))

    expect(providers.map((one) => one.id)).toEqual(['google', 'microsoft'])
    // Google keeps its constant issuer and asks nobody for it, which is the
    // property #523's argument against discovery depended on.
    expect(providers[0]?.issuer).toBe('https://accounts.google.com')
    expect(providers[0]?.discovery).toBe('')
    expect(providers[1]?.issuer).toBe('')
    for (const one of providers) expect(one.admitsOnSight).toBe(false)
  })
})
