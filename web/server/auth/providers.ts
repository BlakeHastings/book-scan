/**
 * Which ways in exist, decided by configuration rather than by code.
 *
 * A provider is an issuer, three URLs, a scope and two secrets. Everything
 * downstream, the flow, the callback, the session and the gate, reads this list
 * and knows nothing about who is on it.
 *
 * Microsoft's issuer is tenant-scoped: an ID token from Entra carries
 * `https://login.microsoftonline.com/<the tenant's own GUID>/v2.0`, so the `iss`
 * a row would have to write down is not a constant the way Google's is. That
 * row therefore carries no issuer at all, only a `discovery` URL, and
 * `auth/discovery.ts` reads the issuer out of the authority's own document at
 * the first sign-in. See docs/the-gate.md.
 */

export type ProviderKind =
  /** OpenID Connect, authorization code with PKCE. */
  | 'oidc'
  /**
   * No provider at all: configuration has named a subject and this server takes
   * its word for it. Exactly one of these can exist and only when a variable
   * says so. See `devProvider`.
   */
  | 'trusted'

export interface SignInProviderConfig {
  /** The path segment, e.g. `google` in `/api/auth/google/start`. */
  id: string
  label: string
  kind: ProviderKind
  /**
   * The `iss` an ID token from this provider must carry, and the issuer half of
   * the `(issuer, subject)` key. Never taken from a token, which is the property
   * the whole check rests on.
   *
   * Empty when `discovery` is set and the issuer is not knowable from
   * configuration. `resolveProvider` fills it in before anything reads it, so
   * nothing downstream ever sees a provider without one.
   */
  issuer: string
  /**
   * Where to read the issuer and the two endpoints from, when they are not
   * constants this repository is allowed to know. Empty for every provider whose
   * issuer is a constant, which is the ordinary case. See `auth/discovery.ts`.
   */
  discovery: string
  /**
   * Where the browser is sent to authorize. Empty for a `trusted` provider, and
   * empty when `discovery` supplies it.
   */
  authorizationEndpoint: string
  /**
   * Where the code is exchanged, server to server. Empty for `trusted`, and
   * empty when `discovery` supplies it.
   */
  tokenEndpoint: string
  /** OpenID Connect requires `openid`; the rest is what the screens want. */
  scope: string
  clientId: string
  clientSecret: string
  /**
   * The subject a `trusted` provider signs in as, and the only thing it can
   * ever sign in as. Empty for `oidc`.
   */
  subject: string
  /**
   * Whether a user created through this provider is enabled on sight.
   *
   * True for the development door and false for every real provider, because
   * "who are you" and "may you come in" are different questions and only the
   * owner answers the second one. A provider that set this without also being
   * `trusted` would be a way for a stranger to enable themselves.
   */
  admitsOnSight: boolean
}

export interface SignInConfig {
  providers: SignInProviderConfig[]
  /**
   * The absolute origin a provider redirects back to, e.g.
   * `https://books.example` or `http://localhost:5173`.
   *
   * Required by every OIDC provider, because a redirect URI is an absolute URL
   * and has to be registered with them ahead of time. Empty is legal only when
   * no OIDC provider is configured.
   */
  publicOrigin: string
}

/**
 * How Google is spelled, and the two variables that turn it on.
 *
 * The endpoints are literals rather than discovered from
 * `/.well-known/openid-configuration`: Google's issuer is a constant, so
 * nothing about it has to be fetched. Discovery is for a provider whose issuer
 * genuinely is not knowable here, not for all of them.
 */
const GOOGLE = {
  id: 'google',
  label: 'Google',
  kind: 'oidc',
  issuer: 'https://accounts.google.com',
  discovery: '',
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  /**
   * `email` and `profile` because the waiting-list screen has to be able to say
   * who is waiting. Nothing here asks for a scope that reaches a person's data:
   * no Drive, no contacts, no calendar.
   */
  scope: 'openid email profile',
  subject: '',
  admitsOnSight: false,
} as const

export const GOOGLE_CLIENT_ID = 'BOOKSCAN_OIDC_GOOGLE_CLIENT_ID'
export const GOOGLE_CLIENT_SECRET = 'BOOKSCAN_OIDC_GOOGLE_CLIENT_SECRET'

/**
 * Microsoft's three variables. The third names the tenant whose discovery
 * document the row is pointed at, and there is no default for it because none is
 * safe: `common` signs in every Entra tenant and every personal account there
 * is, so its discovery document answers with a template instead of an issuer and
 * the only way to accept it is a pattern that also accepts a tenant somebody
 * registered this morning.
 */
export const MICROSOFT_CLIENT_ID = 'BOOKSCAN_OIDC_MICROSOFT_CLIENT_ID'
export const MICROSOFT_CLIENT_SECRET = 'BOOKSCAN_OIDC_MICROSOFT_CLIENT_SECRET'
export const MICROSOFT_TENANT = 'BOOKSCAN_OIDC_MICROSOFT_TENANT'

/**
 * The one Microsoft host this app will talk to, and the trust anchor under the
 * whole arrangement.
 *
 * Something has to be a constant or there is nothing to trust: a discovery
 * document is only worth reading because of where it was fetched from, and a
 * tenant value can never move it. `microsoftDiscovery` builds the URL and then
 * checks the host of what it built, so a tenant carrying a slash or a scheme
 * cannot point this somewhere else.
 *
 * Azure Government, Azure China and B2C live on other hosts and are deliberately
 * not supported.
 */
const MICROSOFT_HOST = 'login.microsoftonline.com'

/**
 * The two authorities that have no single issuer, refused here by name.
 * `readDiscovery` refuses them again for what their document says, which is the
 * check that would still hold for a third such authority; this list only makes
 * the refusal arrive at start instead of at somebody's first sign-in.
 */
const AUTHORITIES_WITHOUT_ONE_ISSUER = ['common', 'organizations']

/**
 * A tenant, as a path segment and nothing more.
 *
 * A GUID, a verified domain such as `contoso.example`, or one of Microsoft's
 * words. What it may not contain is anything that could make the URL below name
 * a different host or a different path: no slash, no scheme, no percent sign and
 * no `..`. The host check after `new URL` is what makes that a fact rather than
 * a belief about this expression.
 */
const TENANT_SEGMENT = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/

/**
 * Where Microsoft's issuer is read from, for one tenant, or a refusal. What it
 * returns is the only Microsoft URL in this repository; everything else about
 * the provider comes out of what that URL answers.
 */
export function microsoftDiscovery(tenant: string): string {
  const named = tenant.trim()
  if (!named) {
    throw new Error(
      `Sign in with Microsoft needs ${MICROSOFT_TENANT}, and there is no default. ` +
      "Microsoft's issuer is scoped to a tenant, so this app cannot know which " +
      'authority it is admitting unless a deployment says. Set it to the tenant GUID ' +
      'or verified domain of one organisation, or to "consumers" for personal ' +
      'Microsoft accounts.',
    )
  }

  if (AUTHORITIES_WITHOUT_ONE_ISSUER.includes(named.toLowerCase())) {
    throw new Error(
      `${MICROSOFT_TENANT} is "${named}", which is an authority rather than a tenant ` +
      'and has no single issuer. It signs in people from every tenant there is, and ' +
      'its own discovery document says so by answering with the template ' +
      '"https://login.microsoftonline.com/{tenantid}/v2.0" instead of a value. ' +
      'Accepting it would mean accepting any tenant, including one somebody ' +
      'registered this morning, which is an issuer check that proves nothing while ' +
      'sign-in still works. Name one tenant, by GUID or verified domain, or use ' +
      '"consumers" for personal Microsoft accounts.',
    )
  }

  if (!TENANT_SEGMENT.test(named)) {
    throw new Error(
      `${MICROSOFT_TENANT} is not a tenant. It is one path segment: a GUID, a ` +
      'verified domain, or "consumers". It may not contain a slash, a scheme or an ' +
      'escape.',
    )
  }

  const url = new URL(
    `https://${MICROSOFT_HOST}/${named}/v2.0/.well-known/openid-configuration`,
  )
  /*
   * Checked rather than assumed: the expression above should make this
   * unreachable.
   */
  if (url.host !== MICROSOFT_HOST || url.protocol !== 'https:') {
    throw new Error(
      `${MICROSOFT_TENANT} would point this app at ${url.origin}, which is not Microsoft.`,
    )
  }
  return url.href
}

/**
 * How Microsoft is spelled.
 *
 * Nothing here asks for a scope that reaches a person's data: no Mail, no
 * Files, no Directory. `offline_access` is deliberately absent, because a
 * refresh token is a long-lived credential this app has no use for: the session
 * it mints is its own, and it never calls Microsoft again after the exchange.
 *
 * Every one of Microsoft's authorities answers
 * `"subject_types_supported": ["pairwise"]`, which is OpenID Connect Core's word
 * for a `sub` that is stable for one user at one application and shared with no
 * other application. Stable is what `user_identity` needs.
 */
const MICROSOFT = {
  id: 'microsoft',
  label: 'Microsoft',
  kind: 'oidc',
  // All three empty, and filled in by `resolveProvider` from `discovery`.
  issuer: '',
  authorizationEndpoint: '',
  tokenEndpoint: '',
  scope: 'openid email profile',
  subject: '',
  admitsOnSight: false,
} as const

/** Where a provider is told to send the browser back to. */
export const PUBLIC_ORIGIN = 'BOOKSCAN_PUBLIC_ORIGIN'

/**
 * The one variable that opens the development door. Its value is the subject the
 * door signs in as, so setting it to `blake` and setting it to `agent-7` are two
 * different people in the database.
 */
export const DEV_SIGN_IN = 'BOOKSCAN_DEV_SIGN_IN'

/**
 * The issuer a development identity is filed under.
 *
 * Not a URL, and not anything a real provider could ever assert, so a row
 * written by this door can never be confused with one written by Google even if
 * both are in the same database. `bookscan:` is not a scheme any issuer uses.
 */
export const DEV_ISSUER = 'bookscan:dev'

/**
 * The development door, as a provider, and it is not a bypass.
 *
 * Signing in through it walks the same three steps every other provider walks:
 * find or create the user, mint a session row, set the cookie. The gate is not
 * consulted about which provider a session came from and has no branch in it at
 * all. What configuration decides here is whether a second identity provider
 * exists, not whether requests are checked.
 *
 * It is off unless `BOOKSCAN_DEV_SIGN_IN` is set, and `signInFrom` refuses to
 * start if that variable is set at the same time as an OIDC provider is
 * configured. The residual risk, said plainly: a deployment that sets this
 * variable and configures no real provider has an account anybody who can reach
 * it can sign into.
 */
export function devProvider(subject: string): SignInProviderConfig {
  return {
    id: 'dev',
    label: 'this machine',
    kind: 'trusted',
    issuer: DEV_ISSUER,
    // Nothing to discover: there is no authority to ask, which is what `trusted`
    // means.
    discovery: '',
    authorizationEndpoint: '',
    tokenEndpoint: '',
    scope: '',
    clientId: '',
    clientSecret: '',
    subject,
    // The one true `admitsOnSight` in the codebase. A development checkout has
    // no owner sitting beside it to run the enable script.
    admitsOnSight: true,
  }
}

/**
 * Read the environment and say what the ways in are. Refuses rather than
 * guesses, in the three cases where guessing would produce a server that is up
 * and cannot be signed into, or one that is open when nobody meant it to be.
 */
export function signInFrom(env: NodeJS.ProcessEnv): SignInConfig {
  const providers: SignInProviderConfig[] = []

  const googleId = (env[GOOGLE_CLIENT_ID] ?? '').trim()
  const googleSecret = (env[GOOGLE_CLIENT_SECRET] ?? '').trim()
  if (googleId || googleSecret) {
    if (!googleId || !googleSecret) {
      throw new Error(
        `Sign in with Google needs both ${GOOGLE_CLIENT_ID} and ${GOOGLE_CLIENT_SECRET}. ` +
        `Only ${googleId ? GOOGLE_CLIENT_ID : GOOGLE_CLIENT_SECRET} is set.`,
      )
    }
    providers.push({ ...GOOGLE, clientId: googleId, clientSecret: googleSecret })
  }

  /*
   * The same "any of them means all of them" rule as Google, with three names
   * instead of two, the tenant among them rather than defaulted.
   * `microsoftDiscovery` is called here, at start, so a deployment that named an
   * authority with no single issuer learns it while somebody is watching the
   * process come up rather than at the first person's first sign-in.
   */
  const microsoftId = (env[MICROSOFT_CLIENT_ID] ?? '').trim()
  const microsoftSecret = (env[MICROSOFT_CLIENT_SECRET] ?? '').trim()
  const microsoftTenant = (env[MICROSOFT_TENANT] ?? '').trim()
  if (microsoftId || microsoftSecret || microsoftTenant) {
    const missing = [
      [MICROSOFT_CLIENT_ID, microsoftId],
      [MICROSOFT_CLIENT_SECRET, microsoftSecret],
      [MICROSOFT_TENANT, microsoftTenant],
    ].filter(([, value]) => !value).map(([name]) => name)
    if (missing.length) {
      throw new Error(
        `Sign in with Microsoft needs ${MICROSOFT_CLIENT_ID}, ` +
        `${MICROSOFT_CLIENT_SECRET} and ${MICROSOFT_TENANT}. ` +
        `${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} not set.`,
      )
    }
    providers.push({
      ...MICROSOFT,
      discovery: microsoftDiscovery(microsoftTenant),
      clientId: microsoftId,
      clientSecret: microsoftSecret,
    })
  }

  const publicOrigin = (env[PUBLIC_ORIGIN] ?? '').trim().replace(/\/+$/, '')
  if (providers.length && !publicOrigin) {
    throw new Error(
      `A sign-in provider is configured and ${PUBLIC_ORIGIN} is empty. Every ` +
      'OpenID Connect provider requires a registered redirect URI, and a ' +
      'redirect URI is an absolute URL, so this server cannot build one without ' +
      `being told its own origin. Set ${PUBLIC_ORIGIN} to the origin a browser ` +
      'reaches this app on, e.g. http://localhost:5173.',
    )
  }

  const devSubject = (env[DEV_SIGN_IN] ?? '').trim()
  if (devSubject) {
    if (providers.length) {
      throw new Error(
        `${DEV_SIGN_IN} is set and so is a real sign-in provider ` +
        `(${providers.map((one) => one.label).join(', ')}). The development ` +
        'door signs anybody who reaches it in as an enabled user, which is safe ' +
        'in a checkout and is a way in anywhere else, so the two are refused ' +
        `together. Unset ${DEV_SIGN_IN} to sign in with a real provider, or unset ` +
        "that provider's variables to develop.",
      )
    }
    providers.push(devProvider(devSubject))
  }

  return { providers, publicOrigin }
}

/**
 * What the process says about its own doors on every start, both ways round.
 * Returned rather than logged, so the caller decides whether a line is a
 * warning.
 */
export function describeSignIn(config: SignInConfig): string[] {
  const said: string[] = []
  const real = config.providers.filter((one) => one.kind === 'oidc')
  const dev = config.providers.find((one) => one.kind === 'trusted')

  said.push(real.length
    ? `[auth] sign in with ${real.map((one) => one.label).join(', ')}, ` +
      `redirecting to ${config.publicOrigin}`
    : '[auth] no sign-in provider is configured, so nobody new can get in. ' +
      `Set ${GOOGLE_CLIENT_ID}, ${GOOGLE_CLIENT_SECRET} and ${PUBLIC_ORIGIN}.`)

  /*
   * Which authority a discovered provider is pointed at, said out loud because a
   * deployment pointed at the wrong tenant looks exactly like one pointed at the
   * right tenant until somebody is refused. No secret is in the URL.
   */
  for (const one of real.filter((each) => each.discovery)) {
    said.push(
      `[auth] ${one.label}'s issuer is not written down in this app: it is read ` +
      `from ${one.discovery} at the first sign-in, and an ID token whose iss is ` +
      'anything else is refused.',
    )
  }

  said.push(dev
    ? `[auth] the development door is OPEN: GET /api/auth/dev/start signs in as ` +
      `${DEV_ISSUER}:${dev.subject}, enabled, with no provider asked. ` +
      `This is ${DEV_SIGN_IN} and it must not be set on a deployment.`
    : `[auth] the development door is shut (${DEV_SIGN_IN} is empty).`)

  return said
}
