/**
 * The authorization server behind the MCP connector, as the SDK's
 * `OAuthServerProvider`. The SDK's handlers parse and validate every OAuth
 * request and check PKCE; this decides who the person is, whether they may,
 * and what is written down.
 *
 * The person is decided by the existing sign-in and nothing else: `authorize`
 * reads the session cookie the gate reads, so a client is approved by
 * somebody who signed in through Google, Microsoft or the development door,
 * exactly as they would to use the app. See docs/the-mcp-connector.md.
 */

import { createHash, randomUUID } from 'node:crypto'
import type express from 'express'
import type { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js'
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import {
  CustomOAuthError, InvalidGrantError, InvalidTargetError, InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js'
import type {
  OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'

import { SESSION_COOKIE } from '../../shared/auth'
import type { AuthStore } from '../../infrastructure/auth/auth-store'
import { ACCESS_TOKEN_MINUTES, REPLAYED, type OAuthStore } from '../../infrastructure/auth/oauth-store'
import { cookieFrom } from '../auth/gate'
import { opaque } from '../auth/oidc'
import type { SignInProviderConfig } from '../auth/providers'
import { consent, notLetInYet, signInFirst } from './pages'

/** The digest every credential here is stored as. Never the credential. */
export function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Whether a redirect URI may be registered: `https`, or `http` to this
 * machine's own loopback for a native client such as Claude Code, and never
 * with a fragment (RFC 6749 section 3.1.2). The SDK matches an authorization
 * request's URI against the registered ones exactly, relaxing only a loopback
 * port as RFC 8252 section 7.3 requires.
 */
export function acceptableRedirect(uri: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(uri)
  } catch {
    return false
  }
  if (parsed.hash) return false
  if (parsed.protocol === 'https:') return true
  return parsed.protocol === 'http:' && LOOPBACK.has(parsed.hostname)
}

/** The same resource, fragment and one trailing slash aside, as the SDK compares them. */
function sameResource(asked: URL, ours: URL): boolean {
  const plain = (url: URL) => url.href.replace(/#.*$/, '').replace(/\/$/, '')
  return plain(asked) === plain(ours)
}

export interface ConnectorDeps {
  auth: AuthStore
  oauth: OAuthStore
  /** This server's own `/mcp`, RFC 8707's resource, from `BOOKSCAN_PUBLIC_ORIGIN`. */
  resource: URL
  providers: SignInProviderConfig[]
  now: () => Date
}

export function clientName(client: OAuthClientInformationFull): string {
  const named = (client.client_name ?? '').trim()
  return (named || 'An unnamed client').slice(0, 80)
}

export class ConnectorProvider implements OAuthServerProvider {
  constructor(private readonly deps: ConnectorDeps) {}

  get clientsStore(): OAuthRegisteredClientsStore {
    const { oauth, now } = this.deps
    return {
      getClient: async (clientId: string) => {
        const stored = await oauth.clientMetadata(clientId)
        return stored ? (JSON.parse(stored) as OAuthClientInformationFull) : undefined
      },
      /*
       * Every client is registered public, whatever it asked for. RFC 7591
       * section 3.2.1 lets the server replace requested metadata, and the
       * response says what was decided. A secret would be a credential this
       * table had to store, and claude.ai registers itself public anyway.
       */
      registerClient: async (asked) => {
        const bad = (asked.redirect_uris ?? []).filter((uri) => !acceptableRedirect(String(uri)))
        if (!asked.redirect_uris?.length || bad.length) {
          throw new CustomOAuthError(
            'invalid_redirect_uri',
            'Every redirect URI must be https, or http to localhost or 127.0.0.1, with no fragment.',
          )
        }
        const client = {
          ...asked,
          token_endpoint_auth_method: 'none',
          client_secret: undefined,
          client_secret_expires_at: undefined,
        } as OAuthClientInformationFull
        await oauth.registerClient(client.client_id, JSON.stringify(client), now())
        return client
      },
    }
  }

  /**
   * The browser half. The SDK has already checked the client and the redirect
   * URI; this decides who is asking and draws one of three pages. Nothing is
   * issued here: a code is issued only when the consent page is answered, by
   * `approve`.
   */
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: express.Response,
  ): Promise<void> {
    const { auth, oauth, resource, providers, now } = this.deps

    if (params.resource && !sameResource(params.resource, resource)) {
      throw new InvalidTargetError(`This server issues tokens for ${resource.href} and nothing else.`)
    }

    const name = clientName(client)
    const token = cookieFrom(res.req.headers.cookie, SESSION_COOKIE)
    const live = token ? await auth.liveSession(digest(token), now()) : undefined

    if (!live) {
      /*
       * Back to this same authorization request after signing in, rebuilt from
       * the validated parameters rather than copied from the address, so a POST
       * authorization request comes back as the equivalent GET.
       */
      const again = new URLSearchParams({
        response_type: 'code',
        client_id: client.client_id,
        redirect_uri: params.redirectUri,
        code_challenge: params.codeChallenge,
        code_challenge_method: 'S256',
      })
      if (params.state !== undefined) again.set('state', params.state)
      if (params.scopes?.length) again.set('scope', params.scopes.join(' '))
      if (params.resource) again.set('resource', params.resource.href)
      const next = `/authorize?${again.toString()}`
      signInFirst(res, name, providers.map((one) => ({
        label: one.label,
        start: `/api/auth/${one.id}/start?next=${encodeURIComponent(next)}`,
      })))
      return
    }

    // The gate's own meaning: signed in, and not let in.
    if (!live.enabled) {
      notLetInYet(res, name)
      return
    }

    const identity = await auth.latestIdentity(live.user_id)
    const consentToken = opaque()
    await oauth.openConsent({
      tokenHash: digest(consentToken),
      sessionHash: digest(token),
      userId: live.user_id,
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      state: params.state ?? '',
      resource: resource.href,
    }, now())

    consent(res, {
      clientName: name,
      redirectUri: params.redirectUri,
      who: identity?.email || identity?.name || live.user_id,
      consentToken,
    })
  }

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    code: string,
  ): Promise<string> {
    const { oauth, now } = this.deps
    const challenge = await oauth.challengeFor(digest(code), client.client_id, now())
    if (challenge) return challenge
    /*
     * Not exchangeable. Spending it anyway is what notices a replay, because
     * the SDK asks for the challenge before it ever reaches the exchange.
     */
    const outcome = await oauth.spendCode(digest(code), client.client_id, now())
    throw new InvalidGrantError(outcome === REPLAYED
      ? 'This authorization code was already used. Every token issued from it has been revoked.'
      : 'This authorization code is not valid.')
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    code: string,
    _verifier?: string,
    redirectUri?: string,
    asked?: URL,
  ): Promise<OAuthTokens> {
    const { oauth, now } = this.deps
    const grant = await oauth.spendCode(digest(code), client.client_id, now())
    if (!grant || grant === REPLAYED) {
      throw new InvalidGrantError('This authorization code is not valid.')
    }
    // RFC 6749 section 4.1.3: the same redirect URI as the authorization request.
    if (redirectUri !== undefined && redirectUri !== grant.redirect_uri) {
      throw new InvalidGrantError('redirect_uri does not match the authorization request.')
    }
    if (asked && !sameResource(asked, new URL(grant.resource))) {
      throw new InvalidTargetError(`This code was issued for ${grant.resource}.`)
    }
    return this.issue(grant.id)
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    _scopes?: string[],
    asked?: URL,
  ): Promise<OAuthTokens> {
    const { oauth, now } = this.deps
    const grant = await oauth.spendRefresh(digest(refreshToken), client.client_id, now())
    if (grant === REPLAYED) {
      throw new InvalidGrantError('This refresh token was already used. The connection has been revoked.')
    }
    if (!grant) throw new InvalidGrantError('This refresh token is not valid.')
    if (asked && !sameResource(asked, new URL(grant.resource))) {
      throw new InvalidTargetError(`This token was issued for ${grant.resource}.`)
    }
    return this.issue(grant.id)
  }

  private async issue(grantId: string): Promise<OAuthTokens> {
    const access = opaque()
    const refresh = opaque()
    await this.deps.oauth.issueTokens(grantId, digest(access), digest(refresh), this.deps.now())
    return {
      access_token: access,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_MINUTES * 60,
      refresh_token: refresh,
    }
  }

  /**
   * Who a bearer token acts for. `enabled` is carried out rather than refused
   * here, so `/mcp` can answer a person who has been disabled `403` with the
   * gate's `waiting` rather than `401`, which would send a client round its
   * refresh loop for a token that is fine.
   */
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const live = await this.deps.oauth.liveAccess(digest(token), this.deps.now())
    if (!live) throw new InvalidTokenError('This token is not valid.')
    return {
      token,
      clientId: live.client_id,
      scopes: [],
      expiresAt: Math.floor(new Date(live.expires_at).getTime() / 1000),
      resource: new URL(live.resource),
      extra: { userId: live.user_id, enabled: live.enabled, grantId: live.grant_id },
    }
  }

  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    await this.deps.oauth.revokeByToken(digest(request.token), client.client_id, this.deps.now())
  }
}

/**
 * The consent page was answered with Allow: open the grant and hand the
 * client its code. Returns where to send the browser.
 */
export async function approve(
  oauth: OAuthStore,
  answered: { user_id: string; client_id: string; redirect_uri: string; code_challenge: string; state: string; resource: string },
  now: Date,
): Promise<string> {
  const code = opaque()
  await oauth.openGrant({
    id: randomUUID(),
    clientId: answered.client_id,
    userId: answered.user_id,
    resource: answered.resource,
    redirectUri: answered.redirect_uri,
    codeHash: digest(code),
    codeChallenge: answered.code_challenge,
  }, now)
  const back = new URL(answered.redirect_uri)
  back.searchParams.set('code', code)
  if (answered.state) back.searchParams.set('state', answered.state)
  return back.href
}

/** The consent page was answered with Deny. RFC 6749 section 4.1.2.1. */
export function deny(answered: { redirect_uri: string; state: string }): string {
  const back = new URL(answered.redirect_uri)
  back.searchParams.set('error', 'access_denied')
  if (answered.state) back.searchParams.set('state', answered.state)
  return back.href
}
