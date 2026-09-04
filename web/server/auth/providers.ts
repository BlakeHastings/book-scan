/**
 * Which ways in exist, decided by configuration rather than by code (#521).
 *
 * #510 asked for "login with" to be provider-agnostic and for adding one to cost
 * a configuration entry rather than surgery. This file is the whole of what a
 * provider is: an issuer, three URLs, a scope and two secrets. Everything
 * downstream — the flow, the callback, the session, the gate — reads this list
 * and knows nothing about who is on it.
 *
 * ## Google and Microsoft, and Apple is closed
 *
 * Google permits `http://localhost` redirect URIs, so it was built and driven
 * first. **Apple is closed by the owner's own decision** (#510): there is no
 * developer account, and it was already the awkward one, refusing `localhost`,
 * needing a domain and a paid membership, and taking a client secret that is an
 * ES256-signed JWT this server would have to mint and rotate every six months.
 *
 * **Microsoft is a row here now (#537), and what it needed was not the row.**
 * #523 left it out because its issuer is tenant-scoped: an ID token from Entra
 * carries `https://login.microsoftonline.com/<the tenant's own GUID>/v2.0`, so
 * the `iss` a row would have to write down is not a constant the way Google's
 * is, and a row carrying Google's shape with Microsoft's endpoints would ship an
 * issuer check that is wrong in a way that still appears to work.
 *
 * So this row deliberately carries **no issuer at all**. It carries a
 * `discovery` URL instead, and `auth/discovery.ts` reads the issuer out of the
 * authority's own document at the first sign-in, checks it, and refuses an
 * authority that answers with a template rather than a value. That file is the
 * whole argument; this one decides only which authority is asked, and it refuses
 * to guess which.
 *
 * **The seam is proved rather than asserted, twice.**
 * `sign-in.routes.test.ts` ran a *second* provider through the entire flow
 * against a local stub before there was a second provider, and now runs a
 * *discovered* one the same way. What #523 predicted the seam would need was
 * "one more field on the provider type, an issuer that may be a pattern"; what
 * it turned out to need was one more field and an issuer that is **fetched**,
 * which is the finding #537 asked for and is written up in `docs/the-gate.md`.
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
   * the `(issuer, subject)` key. **Never taken from a token**, which is the
   * property the whole check rests on.
   *
   * Empty when `discovery` is set and the issuer is not knowable from
   * configuration. `resolveProvider` fills it in before anything reads it, so
   * nothing downstream ever sees a provider without one.
   */
  issuer: string
  /**
   * Where to read the issuer and the two endpoints from, when they are not
   * constants this repository is allowed to know. Empty for every provider whose
   * issuer is a constant, which is the ordinary case.
   *
   * See `auth/discovery.ts` for why this exists for exactly one provider rather
   * than for all of them, and for what is checked about the answer.
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
  /*
   * Empty, and that is the field being used rather than the field being ignored.
   * Google's issuer is a constant, so nothing is fetched for it and the argument
   * above stands unchanged for every provider that has one.
   */
  discovery: '',
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

/**
 * Microsoft's three variables, and why the third one exists.
 *
 * Google needs two because its issuer is a constant this file can carry.
 * Microsoft's is scoped to a tenant, so the row carries no issuer and no
 * endpoints; what it carries is the URL of one authority's discovery document,
 * built from the tenant a deployment named, and `auth/discovery.ts` reads the
 * rest out of the answer.
 *
 * **There is no default tenant, and that is the decision rather than an
 * oversight.** Every candidate default is wrong:
 *
 * - `common`, which is what most examples use and is the defect this issue
 *   exists to avoid. It signs in every Entra tenant and every personal account
 *   there is, its discovery document therefore answers with a template instead
 *   of an issuer, and the only way to accept it is a pattern that also accepts a
 *   tenant somebody registered this morning.
 * - `consumers`, personal Microsoft accounts, which is a decent guess at "the
 *   people in my household" and is still this repository guessing about somebody
 *   else's family.
 * - One tenant, which is site-specific and may never be written here.
 *
 * So it is required, and a deployment states which authority it admits.
 */
export const MICROSOFT_CLIENT_ID = 'BOOKSCAN_OIDC_MICROSOFT_CLIENT_ID'
export const MICROSOFT_CLIENT_SECRET = 'BOOKSCAN_OIDC_MICROSOFT_CLIENT_SECRET'
export const MICROSOFT_TENANT = 'BOOKSCAN_OIDC_MICROSOFT_TENANT'

/**
 * The one Microsoft host this app will talk to, and the trust anchor under the
 * whole arrangement.
 *
 * Something has to be a constant or there is nothing to trust: a discovery
 * document is only worth reading because of where it was fetched from. This is
 * that where, it is Microsoft's own public host rather than anybody's site, and
 * a tenant value can never move it. `microsoftDiscovery` builds the URL and then
 * checks the host of what it built, so a tenant carrying a slash or a scheme
 * cannot point this somewhere else.
 *
 * Azure Government, Azure China and B2C live on other hosts and are deliberately
 * not supported. Each is another constant and another decision, and none of them
 * is "the people in my household".
 */
const MICROSOFT_HOST = 'login.microsoftonline.com'

/**
 * The two authorities refused by name, and why they are refused a second time
 * later.
 *
 * Both answer their discovery document with
 * `https://login.microsoftonline.com/{tenantid}/v2.0`, a literal template, which
 * is a truthful answer: they issue tokens on behalf of every tenant, so there is
 * no one issuer to check an `iss` against. `readDiscovery` refuses that for what
 * the document says, which is the check that would still hold if Microsoft
 * invented a third such authority tomorrow. This list only makes the refusal
 * arrive at start, in words, instead of at somebody's first sign-in.
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
 * Where Microsoft's issuer is read from, for one tenant, or a refusal.
 *
 * Exported so `discovery.test.ts` can drive each refusal on its own. What it
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
   * Checked rather than assumed. The expression above should make this
   * unreachable, and "should" is the word that costs people their front door.
   */
  if (url.host !== MICROSOFT_HOST || url.protocol !== 'https:') {
    throw new Error(
      `${MICROSOFT_TENANT} would point this app at ${url.origin}, which is not Microsoft.`,
    )
  }
  return url.href
}

/**
 * How Microsoft is spelled: a label, a scope, and nothing it is not entitled to
 * know before it has asked.
 *
 * `scope` is Google's three for Google's reasons. Nothing here asks for a scope
 * that reaches a person's data: no Mail, no Files, no Directory.
 * `offline_access` is deliberately absent, because a refresh token is a
 * long-lived credential this app has no use for: the session it mints is its
 * own, and it never calls Microsoft again after the exchange.
 *
 * **What identifies a person, confirmed from the document rather than asserted
 * here.** Every one of Microsoft's authorities answers
 * `"subject_types_supported": ["pairwise"]`, which is OpenID Connect Core's word
 * for a `sub` that is stable for one user at one application and shared with no
 * other application. Stable is what `user_identity` needs, and per-application
 * is a property it is glad of rather than troubled by. Read on 2026-09-04 from
 * `consumers`, `common`, `organizations` and a tenant.
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

  /*
   * Microsoft, and the same "any of them means all of them" rule as Google, with
   * three names instead of two. Naming which one is missing rather than saying
   * the configuration is wrong: a process that exits naming a variable is
   * recoverable in one command.
   *
   * The tenant is in that set rather than defaulted, and `microsoftDiscovery`
   * carries the argument for why. It is called here, at start, so a deployment
   * that named an authority with no single issuer learns it while somebody is
   * watching the process come up, rather than at the first person's first
   * sign-in.
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

  /*
   * Which authority a discovered provider is pointed at, said out loud for the
   * same reason the two lines around it are: it is the one thing about this
   * configuration that decides who can get in, it is invisible from outside the
   * process, and a deployment pointed at the wrong tenant looks exactly like one
   * pointed at the right tenant until somebody is refused. The URL is the
   * deployment's own value in the deployment's own log, and no secret is in it.
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
