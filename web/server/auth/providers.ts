/**
 * Which ways in exist, decided by configuration rather than by code (#521).
 *
 * #510 asked for "login with" to be provider-agnostic and for adding one to cost
 * a configuration entry rather than surgery. This file is the whole of what a
 * provider is: an issuer, three URLs, a scope and two secrets. Everything
 * downstream — the flow, the callback, the session, the gate — reads this list
 * and knows nothing about who is on it.
 *
 * ## Google only, today, and that is the issue's instruction
 *
 * Google permits `http://localhost` redirect URIs, so it can be built and driven
 * now. Apple cannot: it refuses `localhost`, needs a domain #471 has not chosen
 * and a paid membership, and its client secret is an ES256-signed JWT this
 * server would have to mint and rotate every six months.
 *
 * **Microsoft is not a row here, and leaving it out is a decision rather than an
 * omission.** It is straightforward in every respect but one: its issuer is
 * tenant-scoped, `https://login.microsoftonline.com/{tenant}/v2.0`, so the `iss`
 * an ID token must carry is not a constant the way Google's is. A row that
 * carried Google's shape with Microsoft's endpoints would therefore ship a
 * wrong check, and a wrong `iss` check is exactly the kind of door nobody tries.
 * What it needs is one more field on `OidcProvider` — an issuer that may be a
 * pattern — and that is the extension point the day somebody wants it.
 *
 * **The seam is proved rather than asserted.** `sign-in.routes.test.ts` runs a
 * *second* provider, one that is not Google and exists only in that file's
 * configuration, through the entire authorization code flow against a local
 * stub. Nothing in this repository knows that provider's name, which is the
 * claim "a provider is configuration" being demonstrated rather than promised.
 *
 * ## The development door is a provider too
 *
 * See `devProvider`. It is on this list when configuration puts it there, it
 * mints an ordinary session for an ordinary user through the same code as
 * everybody else, and it is the answer to "development must keep working"
 * without a switch that turns the gate off. The argument for why that is not a
 * hole is in `docs/the-gate.md` and in `signInFrom` below.
 */

/** How a provider is asked. */
export type ProviderKind =
  /** OpenID Connect, authorization code with PKCE. Google, and whatever follows. */
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
  /** What a button says. */
  label: string
  kind: ProviderKind
  /**
   * The `iss` an ID token from this provider must carry, and the issuer half of
   * the `(issuer, subject)` key. Fixed per provider, never taken from a token.
   */
  issuer: string
  /** Where the browser is sent to authorize. Empty for a `trusted` provider. */
  authorizationEndpoint: string
  /** Where the code is exchanged, server to server. Empty for `trusted`. */
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

/** What the server was configured with, and what it refuses over. */
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
 * `/.well-known/openid-configuration`, and that is deliberate: discovery is a
 * network call this server would have to make before it could answer a sign-in,
 * with a cache and an expiry and a failure mode where the app is up and nobody
 * can get in. Google's three URLs have not changed in a decade and a change
 * would be announced. If a provider ever arrives whose endpoints genuinely move,
 * discovery is the thing to add for that provider, not for all of them.
 */
const GOOGLE = {
  id: 'google',
  label: 'Google',
  kind: 'oidc',
  issuer: 'https://accounts.google.com',
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  /**
   * `openid` because that is what makes this OpenID Connect rather than bare
   * OAuth, and the other two because the waiting-list screen has to be able to
   * say who is waiting. Nothing here asks for a scope that reaches a person's
   * data: no Drive, no contacts, no calendar.
   */
  scope: 'openid email profile',
  subject: '',
  admitsOnSight: false,
} as const

/** `BOOKSCAN_OIDC_GOOGLE_CLIENT_ID` and its secret, named once. */
export const GOOGLE_CLIENT_ID = 'BOOKSCAN_OIDC_GOOGLE_CLIENT_ID'
export const GOOGLE_CLIENT_SECRET = 'BOOKSCAN_OIDC_GOOGLE_CLIENT_SECRET'

/** Where a provider is told to send the browser back to. */
export const PUBLIC_ORIGIN = 'BOOKSCAN_PUBLIC_ORIGIN'

/**
 * The one variable that opens the development door, and the whole of what it
 * does.
 *
 * Its value is the subject the door signs in as, so setting it to `blake` and
 * setting it to `agent-7` are two different people in the database, and unsetting
 * it removes the door and leaves the rows behind.
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
 * The development door, as a provider.
 *
 * **This is the answer to "development must keep working", and the argument for
 * why it is not a hole is that it is not a bypass.** Signing in through it walks
 * the same three steps every other provider walks: find or create the user,
 * mint a session row, set the cookie. The gate is not consulted about which
 * provider a session came from and has no branch in it at all. Take this
 * provider away and the sessions it made still work; take the session table away
 * and this provider signs nobody in.
 *
 * What configuration decides is whether a second identity provider exists, which
 * is exactly what the provider seam is for. What it does **not** decide is
 * whether requests are checked.
 *
 * Three things keep it out of a deployment, and the third is the one with teeth:
 *
 * 1. It is off unless `BOOKSCAN_DEV_SIGN_IN` is set. `apphost.mts` sets it, and
 *    that is the only place in this repository that does.
 * 2. Every start says which of the two states it is in, both ways round, for the
 *    reason the backup line and the built-client line already do: "the gate is
 *    open to a development identity" and "it is not" are invisible from outside
 *    the process and look identical when something is wrong.
 * 3. **It refuses to start beside a real provider.** `signInFrom` throws if this
 *    variable is set at the same time as an OIDC provider is configured. A
 *    deployment that has configured Google cannot also be carrying this, which
 *    is the moment somebody would otherwise have left it on.
 *
 * The residual risk, said plainly rather than argued away: a deployment that
 * sets this variable and configures no real provider has an account anybody who
 * can reach it can sign into. That is one variable, set in one file, on a server
 * that #520 deliberately left bound to loopback.
 */
export function devProvider(subject: string): SignInProviderConfig {
  return {
    id: 'dev',
    label: 'this machine',
    kind: 'trusted',
    issuer: DEV_ISSUER,
    authorizationEndpoint: '',
    tokenEndpoint: '',
    scope: '',
    clientId: '',
    clientSecret: '',
    subject,
    // The one true `admitsOnSight` in the codebase. A development checkout has
    // no owner sitting beside it to run the enable script, and a browser test
    // that had to wait for one would never run.
    admitsOnSight: true,
  }
}

/**
 * Read the environment and say what the ways in are.
 *
 * Refuses rather than guesses, in the three cases where guessing would produce a
 * server that is up and cannot be signed into, or one that is open when nobody
 * meant it to be. A process that exits naming a variable is recoverable in one
 * command; one that comes up with the wrong door open is not obviously anything.
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
        `${DEV_SIGN_IN} is set and so is a real sign-in provider. The development ` +
        'door signs anybody who reaches it in as an enabled user, which is safe ' +
        'in a checkout and is a way in anywhere else, so the two are refused ' +
        `together. Unset ${DEV_SIGN_IN} to use ${GOOGLE_CLIENT_ID}, or unset that ` +
        'to develop.',
      )
    }
    providers.push(devProvider(devSubject))
  }

  return { providers, publicOrigin }
}

/**
 * What the process says about its own doors on every start, both ways round.
 *
 * Returned rather than logged so a test can read it, and so the caller decides
 * whether a line is a warning. See `server/index.ts`, which prints these beside
 * the backup line and the built-client line for the same reason those exist: the
 * state is invisible from outside the process and the quiet outcome is the one
 * that gets missed.
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

  said.push(dev
    ? `[auth] the development door is OPEN: GET /api/auth/dev/start signs in as ` +
      `${DEV_ISSUER}:${dev.subject}, enabled, with no provider asked. ` +
      `This is ${DEV_SIGN_IN} and it must not be set on a deployment.`
    : `[auth] the development door is shut (${DEV_SIGN_IN} is empty).`)

  return said
}
