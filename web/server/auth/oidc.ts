/**
 * The authorization code flow with PKCE, server-side, and nothing else. No
 * token ever reaches the client, because a token in a browser is a credential in
 * a place this app cannot revoke. What the browser gets is a cookie addressing a
 * row in `session`, which this app owns and can delete.
 *
 * The ID token's signature is deliberately not checked, and this is allowed.
 * OpenID Connect Core 1.0 section 3.1.3.7 item 6 says, of the code flow: "If the
 * ID Token is received via direct communication between the Client and the Token
 * Endpoint (which it is in this flow), the TLS server validation MAY be used to
 * validate the issuer in place of checking the token signature." `exchange`
 * posts to a hard-coded HTTPS endpoint belonging to the provider, over a TLS
 * connection Node validates, carrying a client secret only this server holds,
 * and the token does not pass through the browser, so there is nothing in
 * between to have altered it.
 *
 * What is checked instead, and all of it is: `iss` is the provider's, `aud` is
 * this app's client id, `exp` has not passed, `nonce` is the one this server put
 * in the authorization request, and `sub` is present.
 *
 * What would flip this: a flow where the token reaches this server through
 * anything but a direct call to the token endpoint. There is none, and if one is
 * ever added it needs JWKS and real verification, not this file's shortcut.
 */

import { createHash, randomBytes } from 'node:crypto'

import type { SignInTrouble } from '../../shared/auth'
import type { SignInProviderConfig } from './providers'

const TOKEN_TIMEOUT_MS = 10_000

export function opaque(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * A PKCE pair, RFC 7636.
 *
 * `S256` only. The `plain` method exists in the RFC and is worth nothing: it
 * sends the verifier itself as the challenge, so anybody who saw the
 * authorization request can complete the exchange, which is the attack the
 * extension is for.
 */
export function pkce(): { verifier: string; challenge: string } {
  const verifier = opaque()
  return {
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
  }
}

export function authorizationUrl(
  provider: SignInProviderConfig,
  args: { redirectUri: string; state: string; nonce: string; challenge: string },
): string {
  const url = new URL(provider.authorizationEndpoint)
  url.searchParams.set('client_id', provider.clientId)
  url.searchParams.set('redirect_uri', args.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', provider.scope)
  url.searchParams.set('state', args.state)
  url.searchParams.set('nonce', args.nonce)
  url.searchParams.set('code_challenge', args.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.href
}

/**
 * What a provider refused with, in a shape a route can answer from.
 *
 * `trouble` is required, so every `throw` names its reason where the refusal is
 * decided. A `catch` working it out from the message would be a string match on
 * English, and the next throw added would quietly fall into whichever branch its
 * wording happened to hit.
 */
export class SignInRefused extends Error {
  constructor(
    message: string,
    /** Which of the six a person is in. See `shared/auth.ts`. */
    readonly trouble: SignInTrouble,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'SignInRefused'
  }
}

/**
 * Trade the authorization code for an ID token, server to server.
 *
 * Bounded, because a reader with no `AbortController` behind it is a dependency
 * that can hang, and this one has somebody standing in front of a browser
 * waiting on it.
 *
 * The client secret goes in the body rather than in a Basic header. Both are
 * allowed by RFC 6749 and Google documents the body form; the body is not
 * logged by anything here and a URL never carries it.
 */
export async function exchange(
  provider: SignInProviderConfig,
  args: { code: string; redirectUri: string; verifier: string },
  now: Date,
): Promise<{ subject: string; email: string; name: string; nonce: string }> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: args.code,
    redirect_uri: args.redirectUri,
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
    code_verifier: args.verifier,
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TOKEN_TIMEOUT_MS)
  let payload: { id_token?: unknown; error?: unknown }
  try {
    const response = await fetch(provider.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
      signal: controller.signal,
    })
    // The status, never the body. A token endpoint's error body is somebody
    // else's text on its way into a log, and this request carried a secret.
    if (!response.ok) {
      throw new SignInRefused(
        `${provider.label} refused the sign-in (HTTP ${response.status}).`,
        // The provider answered, and its answer was no. Trying again gets the
        // same no.
        'refused',
      )
    }
    payload = await response.json() as { id_token?: unknown }
  } catch (error) {
    if (error instanceof SignInRefused) throw error
    const aborted = error instanceof Error && error.name === 'AbortError'
    throw new SignInRefused(
      aborted
        ? `${provider.label} did not answer in time.`
        : `${provider.label} could not be reached.`,
      // Nobody was asked, so nothing about this sign-in was decided.
      'unavailable',
      error,
    )
  } finally {
    clearTimeout(timer)
  }

  if (typeof payload.id_token !== 'string' || !payload.id_token) {
    throw new SignInRefused(`${provider.label} answered without an ID token.`, 'refused')
  }
  return claimsFrom(payload.id_token, provider, now)
}

interface Claims {
  iss?: unknown
  aud?: unknown
  sub?: unknown
  exp?: unknown
  nonce?: unknown
  email?: unknown
  email_verified?: unknown
  name?: unknown
}

/**
 * Read an ID token's claims and refuse it unless every one of them is right. See
 * the header for why the signature is not among them and why that is permitted.
 *
 * `aud` may be a string or an array of strings; both are in the specification.
 * `email_verified` is read and deliberately not used to decide anything: email
 * is a label on `user_identity`, and the identity is `(iss, sub)` either way.
 */
export function claimsFrom(
  idToken: string,
  provider: { issuer: string; clientId: string; label: string },
  now: Date,
): { subject: string; email: string; name: string; nonce: string } {
  const parts = idToken.split('.')
  if (parts.length !== 3 || !parts[1]) {
    throw new SignInRefused(
      `${provider.label} sent something that is not an ID token.`, 'refused',
    )
  }

  let claims: Claims
  try {
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Claims
  } catch (error) {
    throw new SignInRefused(
      `${provider.label} sent an ID token that will not parse.`, 'refused', error,
    )
  }

  if (claims.iss !== provider.issuer) {
    throw new SignInRefused(`That ID token was not issued by ${provider.label}.`, 'refused')
  }

  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (!audience.includes(provider.clientId)) {
    throw new SignInRefused('That ID token was issued for a different application.', 'refused')
  }

  // Seconds since the epoch, per the specification, and compared with no leeway.
  // A clock skew allowance is a window in which an expired token is accepted,
  // and the tokens this reads are seconds old.
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now.getTime()) {
    throw new SignInRefused('That ID token has expired.', 'refused')
  }

  if (typeof claims.sub !== 'string' || !claims.sub) {
    throw new SignInRefused(`${provider.label} did not say who signed in.`, 'refused')
  }

  return {
    subject: claims.sub,
    nonce: typeof claims.nonce === 'string' ? claims.nonce : '',
    email: typeof claims.email === 'string' ? claims.email : '',
    name: typeof claims.name === 'string' ? claims.name : '',
  }
}
