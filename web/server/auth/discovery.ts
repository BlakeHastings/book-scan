/**
 * The issuer this server has not been told, read from the authority that owns
 * it (#537).
 *
 * ## Why this file exists at all, when `providers.ts` argued against it
 *
 * `providers.ts` says Google's three URLs are literals on purpose, and that
 * discovery is "a network call this server would have to make before it could
 * answer a sign-in, with a cache and an expiry and a failure mode where the app
 * is up and nobody can get in". That argument is still right for Google, and
 * Google still has no discovery URL: a provider that carries an issuer carries
 * it, and nothing here is fetched for it.
 *
 * It is wrong for Microsoft, and the reason is the whole of #537. Microsoft's
 * issuer is **tenant-scoped**: an ID token from Entra carries
 * `https://login.microsoftonline.com/<the tenant's own GUID>/v2.0`, and which
 * GUID that is depends on which tenant a deployment is pointed at. A repository
 * that cannot know the tenant cannot know the issuer, so the choice is not
 * "literal or discovered". It is "discovered, or invented".
 *
 * **An invented issuer is the defect #523 refused to ship and this file exists
 * to keep refusing.** A row that carried Google's shape with Microsoft's
 * endpoints would have to write *something* in the issuer field, and every
 * available something is wrong in a way that still looks like a working
 * sign-in:
 *
 * - `https://login.microsoftonline.com/common/v2.0`, which is the authority a
 *   person types and is an `iss` no token has ever carried.
 * - One tenant's GUID, hard-coded, which is site-specific and forbidden here.
 * - A prefix test such as `startsWith('https://login.microsoftonline.com/')`,
 *   which is the dangerous one. It accepts every tenant in the world, including
 *   one an attacker created this morning for nothing, and it turns "which
 *   authority issued this token" into "some authority did". Sign-in succeeds.
 *   Nothing looks wrong. The check proves nothing.
 *
 * So the issuer is asked for, and what comes back is checked before it is
 * believed.
 *
 * ## What is checked about a document before it is believed
 *
 * A discovery document is somebody else's JSON arriving over the network, and
 * the thing it is being asked for is *what this server will trust from now on*.
 * Four rules, and each one is a case in `discovery.test.ts`:
 *
 * 1. **It must be an object with a non-empty string `issuer`.**
 * 2. **The issuer must not be a template.** This is the rule that decides which
 *    Microsoft authorities this app supports, and it decides it by reading
 *    rather than by carrying a list of forbidden words. Measured against the
 *    live documents on 2026-09-04:
 *
 *    | Authority | `issuer` |
 *    | --- | --- |
 *    | `consumers` | `https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0` |
 *    | a tenant GUID or domain | `https://login.microsoftonline.com/<that tenant's GUID>/v2.0` |
 *    | `common` | `https://login.microsoftonline.com/{tenantid}/v2.0` |
 *    | `organizations` | `https://login.microsoftonline.com/{tenantid}/v2.0` |
 *
 *    The last two answer with a **template**, not a value, and they are telling
 *    the truth: those authorities do not have one issuer, because a token from
 *    them carries whichever tenant the person signing in belongs to. There is
 *    nothing to check an `iss` against, and the only way to accept them is a
 *    pattern that accepts every tenant. So they are refused, and refused for
 *    what the document said rather than for what they are called: if Microsoft
 *    ever answers `organizations` with a value, this reads the value.
 * 3. **The issuer must be on the same origin as the document.** Scheme, host and
 *    port. A document fetched from one place may not nominate somewhere else as
 *    the authority to trust, which is the whole of what makes fetching it safe.
 *    OpenID Connect Discovery 1.0 section 4.3 is stricter still and requires the
 *    issuer to equal the URL discovery was performed against; that cannot be
 *    used here, because a tenant named by domain discovers at
 *    `.../contoso.example/v2.0/...` and is answered with the tenant's GUID. Same
 *    origin is the part of the rule that survives, and it is the part that is
 *    load-bearing.
 * 4. **Both endpoints must be on that same origin too**, for the same reason and
 *    with more at stake: the token endpoint is where this server posts its
 *    client secret.
 *
 * ## When it is fetched, and the failure that was chosen
 *
 * **At the first sign-in through that provider, not at start.** Resolving at
 * start would mean a Microsoft outage, or a slow DNS answer, stops this app from
 * booting, and then nobody reaches the catalogue: not the person signing in, and
 * not the household already holding sessions. Resolving lazily costs exactly the
 * people who cannot sign in anyway, because signing in needs Microsoft to be up
 * regardless. The app stays up, sessions keep working, and the next attempt
 * tries again.
 *
 * **Cached for the life of the process, with no expiry, and successes only.** A
 * tenant's issuer does not change; if it ever did, so did the deployment, and a
 * deployment is a restart. An expiry would buy a re-fetch nobody needs and a
 * second failure mode nobody would ever see happen.
 */

import type { SignInProviderConfig } from './providers'
import { SignInRefused } from './oidc'

/** How long this server waits on a discovery document before giving up. */
const DISCOVERY_TIMEOUT_MS = 10_000

/** The three things a document is asked for, and the whole of what is kept. */
export interface Discovered {
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
}

/**
 * What has been discovered already, keyed by the URL it came from.
 *
 * Module-level because it is per process and per URL and there is nothing to
 * scope it to; `forgetDiscovered` exists so a test can drive a second fetch
 * rather than assert against whatever an earlier test left here.
 */
const remembered = new Map<string, Discovered>()

/** Throw away the cache. For tests, and called by nothing else. */
export function forgetDiscovered(): void {
  remembered.clear()
}

/** How many documents are being remembered. For tests. */
export function discoveredCount(): number {
  return remembered.size
}

/**
 * Read a discovery document, and refuse it unless every rule in the header
 * holds.
 *
 * Pure, and exported separately from the fetch, because the rules are the part
 * worth driving: a check nobody has watched refuse is not a check, and every one
 * of these can be watched refuse without a network.
 *
 * `from` is the URL the document was fetched from, and it is what "the same
 * origin" is measured against.
 */
export function readDiscovery(document: unknown, from: string, label: string): Discovered {
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    throw new SignInRefused(`${label} answered its discovery document with something that is not an object.`)
  }

  const said = document as Record<string, unknown>
  const issuer = said.issuer
  if (typeof issuer !== 'string' || !issuer.trim()) {
    throw new SignInRefused(`${label}'s discovery document names no issuer.`)
  }

  /*
   * The rule that decides which Microsoft authorities are supported, applied to
   * whatever the document said rather than to a list of authority names kept
   * here. `common` and `organizations` answer with the literal string
   * `https://login.microsoftonline.com/{tenantid}/v2.0`, which is an honest
   * answer to a question they cannot answer: those authorities issue tokens on
   * behalf of every tenant there is, so there is no single issuer to check an
   * `iss` claim against. Accepting one would mean accepting a pattern, and a
   * pattern over that host accepts a tenant somebody made this morning.
   */
  if (/[{}]/.test(issuer)) {
    throw new SignInRefused(
      `${label}'s discovery document answered with a template rather than an issuer ` +
      `(${issuer}). That authority does not have one issuer: it signs in people from ` +
      'many tenants and a token carries whichever tenant its owner belongs to, so there ' +
      'is nothing for this server to check the token against. Point this app at one ' +
      'authority whose issuer is a value.',
    )
  }

  const origin = originOf(from)
  if (!origin) {
    throw new SignInRefused(`${label} was configured with a discovery URL that is not a URL.`)
  }

  if (originOf(issuer) !== origin) {
    throw new SignInRefused(
      `${label}'s discovery document names an issuer somewhere else (${issuer}). A ` +
      'document is only worth fetching because what it says about itself comes from ' +
      'itself, so an issuer on another origin is refused.',
    )
  }

  const authorizationEndpoint = endpoint(said.authorization_endpoint, 'authorization_endpoint', origin, label)
  const tokenEndpoint = endpoint(said.token_endpoint, 'token_endpoint', origin, label)

  return { issuer, authorizationEndpoint, tokenEndpoint }
}

/** One endpoint out of a document, on the document's own origin or not at all. */
function endpoint(value: unknown, name: string, origin: string, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new SignInRefused(`${label}'s discovery document names no ${name}.`)
  }
  if (originOf(value) !== origin) {
    throw new SignInRefused(
      `${label}'s discovery document points its ${name} at another origin (${value}). ` +
      'This server posts its client secret to the token endpoint, so a document that ' +
      'can move it elsewhere is refused.',
    )
  }
  return value
}

/** An origin, or empty for anything that will not parse. */
function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

/**
 * Fetch a discovery document and read it, once per URL per process.
 *
 * Bounded for the reason `exchange` is: a reader with no `AbortController`
 * behind it is a dependency that can hang, and this one has somebody standing in
 * front of a browser waiting on it.
 */
export async function discover(
  url: string,
  label: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Discovered> {
  const already = remembered.get(url)
  if (already) return already

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS)
  let document: unknown
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    // The status, never the body, for the same reason `exchange` says so.
    if (!response.ok) {
      throw new SignInRefused(
        `${label} did not answer for its discovery document (HTTP ${response.status}).`,
      )
    }
    document = await response.json()
  } catch (error) {
    if (error instanceof SignInRefused) throw error
    const aborted = error instanceof Error && error.name === 'AbortError'
    throw new SignInRefused(
      aborted
        ? `${label} did not answer for its discovery document in time.`
        : `${label}'s discovery document could not be reached.`,
      error,
    )
  } finally {
    clearTimeout(timer)
  }

  const found = readDiscovery(document, url, label)
  remembered.set(url, found)
  return found
}

/**
 * A provider with its issuer and endpoints filled in, whichever they came from.
 *
 * **This is the seam #523 built and #537 is the first to lean on.** Until now a
 * provider *was* its issuer: `SignInProviderConfig.issuer` was a constant read
 * straight out of the row by the callback and written into `user_identity`.
 * Microsoft's is not a constant, so the flow can no longer read a field. It asks
 * for a resolved provider and gets one, and Google's resolves to itself without
 * touching the network.
 *
 * Everything downstream is unchanged and does not know which kind it has:
 * `authorizationUrl`, `exchange`, `claimsFrom` and `admit` all take a provider
 * with an issuer on it, and by the time they see one it has one.
 */
export async function resolveProvider(
  provider: SignInProviderConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<SignInProviderConfig> {
  if (!provider.discovery) {
    /*
     * Not reachable through `signInFrom`, which builds every row itself. It is
     * here because the alternative to refusing is signing somebody in against an
     * empty issuer, and `''` compares equal to a claim this server never got.
     */
    if (!provider.issuer) {
      throw new SignInRefused(
        `${provider.label} is configured with neither an issuer nor a discovery URL, ` +
        'so there is nothing to check an ID token against.',
      )
    }
    return provider
  }

  const found = await discover(provider.discovery, provider.label, fetchImpl)
  return {
    ...provider,
    issuer: found.issuer,
    authorizationEndpoint: found.authorizationEndpoint,
    tokenEndpoint: found.tokenEndpoint,
  }
}
