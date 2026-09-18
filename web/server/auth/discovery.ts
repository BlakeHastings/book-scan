/**
 * The issuer this server has not been told, read from the authority that owns
 * it.
 *
 * Microsoft's issuer is tenant-scoped: an ID token from Entra carries
 * `https://login.microsoftonline.com/<the tenant's own GUID>/v2.0`, and which
 * GUID that is depends on which tenant a deployment is pointed at. A repository
 * that cannot know the tenant cannot know the issuer, so the choice is not
 * literal or discovered, it is discovered or invented. Every invented issuer is
 * wrong in a way that still looks like a working sign-in, and the dangerous one
 * is a prefix test such as `startsWith('https://login.microsoftonline.com/')`:
 * it accepts every tenant in the world, including one an attacker created this
 * morning, and turns "which authority issued this token" into "some authority
 * did".
 *
 * A discovery document is somebody else's JSON arriving over the network, and
 * what it is being asked for is what this server will trust from now on. Four
 * rules, each one a case in `discovery.test.ts`:
 *
 * 1. It must be an object with a non-empty string `issuer`.
 * 2. The issuer must not be a template. `common` and `organizations` answer
 *    with `https://login.microsoftonline.com/{tenantid}/v2.0`, and they are
 *    telling the truth: those authorities do not have one issuer, because a
 *    token from them carries whichever tenant the person signing in belongs to,
 *    so the only way to accept them is a pattern that accepts every tenant.
 *    They are refused for what the document said rather than for what they are
 *    called, so an authority answering with a value is read either way.
 * 3. The issuer must be on the same origin as the document: scheme, host and
 *    port. A document fetched from one place may not nominate somewhere else as
 *    the authority to trust. OpenID Connect Discovery 1.0 section 4.3 is
 *    stricter still and requires the issuer to equal the URL discovery was
 *    performed against, which cannot be used here, because a tenant named by
 *    domain discovers at `.../contoso.example/v2.0/...` and is answered with the
 *    tenant's GUID.
 * 4. Both endpoints must be on that same origin too, and with more at stake:
 *    the token endpoint is where this server posts its client secret.
 *
 * Fetched at the first sign-in through that provider rather than at start, so a
 * Microsoft outage or a slow DNS answer does not stop this app booting and cost
 * the household its existing sessions. Cached for the life of the process, with
 * no expiry, and successes only: a tenant's issuer does not change, and if it
 * ever did then so did the deployment, and a deployment is a restart.
 *
 * Every refusal here is `unavailable`, because they are ten ways of saying one
 * thing to whoever pressed the button, that nobody could be asked, and there is
 * nothing in any of them that person did or can undo.
 */

import type { SignInProviderConfig } from './providers'
import { SignInRefused } from './oidc'

const DISCOVERY_TIMEOUT_MS = 10_000

export interface Discovered {
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
}

/** What has been discovered already, keyed by the URL it came from. */
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
 * holds. Pure, and exported separately from the fetch so every rule can be
 * driven without a network.
 *
 * `from` is the URL the document was fetched from, and it is what "the same
 * origin" is measured against.
 */
export function readDiscovery(document: unknown, from: string, label: string): Discovered {
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    throw new SignInRefused(
      `${label} answered its discovery document with something that is not an object.`,
      'unavailable',
    )
  }

  const said = document as Record<string, unknown>
  const issuer = said.issuer
  if (typeof issuer !== 'string' || !issuer.trim()) {
    throw new SignInRefused(`${label}'s discovery document names no issuer.`, 'unavailable')
  }

  /*
   * The rule that decides which Microsoft authorities are supported, applied to
   * whatever the document said rather than to a list of authority names kept
   * here, so an authority Microsoft has not invented yet is covered too.
   */
  if (/[{}]/.test(issuer)) {
    throw new SignInRefused(
      `${label}'s discovery document answered with a template rather than an issuer ` +
      `(${issuer}). That authority does not have one issuer: it signs in people from ` +
      'many tenants and a token carries whichever tenant its owner belongs to, so there ' +
      'is nothing for this server to check the token against. Point this app at one ' +
      'authority whose issuer is a value.',
      'unavailable',
    )
  }

  const origin = originOf(from)
  if (!origin) {
    throw new SignInRefused(
      `${label} was configured with a discovery URL that is not a URL.`, 'unavailable',
    )
  }

  if (originOf(issuer) !== origin) {
    throw new SignInRefused(
      `${label}'s discovery document names an issuer somewhere else (${issuer}). A ` +
      'document is only worth fetching because what it says about itself comes from ' +
      'itself, so an issuer on another origin is refused.',
      'unavailable',
    )
  }

  const authorizationEndpoint = endpoint(said.authorization_endpoint, 'authorization_endpoint', origin, label)
  const tokenEndpoint = endpoint(said.token_endpoint, 'token_endpoint', origin, label)

  return { issuer, authorizationEndpoint, tokenEndpoint }
}

/** One endpoint out of a document, on the document's own origin or not at all. */
function endpoint(value: unknown, name: string, origin: string, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new SignInRefused(`${label}'s discovery document names no ${name}.`, 'unavailable')
  }
  if (originOf(value) !== origin) {
    throw new SignInRefused(
      `${label}'s discovery document points its ${name} at another origin (${value}). ` +
      'This server posts its client secret to the token endpoint, so a document that ' +
      'can move it elsewhere is refused.',
      'unavailable',
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
 * Fetch a discovery document and read it, once per URL per process. Bounded
 * because a reader with no `AbortController` behind it is a dependency that can
 * hang, and this one has somebody standing in front of a browser waiting on it.
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
        'unavailable',
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
      'unavailable',
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
 * Nothing downstream knows which kind it has: `authorizationUrl`, `exchange`,
 * `claimsFrom` and `admit` all take a provider with an issuer on it, and by the
 * time they see one it has one. Google's resolves to itself without touching the
 * network.
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
        'unavailable',
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
