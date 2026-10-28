/**
 * The MCP connector's doors. Two sets, registered by one call from `createApp`
 * immediately below `mountGate`:
 *
 * - **Outside `/api`**, the OAuth authorization server and `/mcp`. The gate is
 *   a property of the path under `/api`, so none of these is behind it, and
 *   each is listed in `MCP_DOORS` so `gate.routes.test.ts` can fail on any
 *   path outside `/api` that is not. Only mounted when `BOOKSCAN_PUBLIC_ORIGIN`
 *   is set, because the issuer and the resource are absolute URLs and this
 *   server will not guess its own origin from a request that came through a
 *   proxy.
 * - **Under `/api/mcp`**, behind the gate like every other `/api` route: the
 *   answer to the consent page, and a person's list of connected clients.
 *   Always mounted, so a person can still see and disconnect clients on a
 *   server whose connector has been switched off.
 *
 * The OAuth endpoints are the SDK's own handlers. They are mounted one by one
 * rather than through `mcpAuthRouter` so that each is its own path in the
 * router stack, and so the metadata can say what this server actually does:
 * `mcpAuthRouter` advertises `client_secret_post`, and every client here is
 * registered public. See docs/the-mcp-connector.md.
 */

import express from 'express'
import { authorizationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/authorize.js'
import { tokenHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/token.js'
import { clientRegistrationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/register.js'
import { revocationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/revoke.js'
import { metadataHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/metadata.js'
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js'
import {
  createOAuthMetadata, getOAuthProtectedResourceMetadataUrl,
} from '@modelcontextprotocol/sdk/server/auth/router.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { OAuthProtectedResourceMetadata } from '@modelcontextprotocol/sdk/shared/auth.js'

import { SESSION_COOKIE } from '../../shared/auth'
import type { AuthStore } from '../../infrastructure/auth/auth-store'
import { OAuthStore } from '../../infrastructure/auth/oauth-store'
import type { Db } from '../driver'
import { cookieFrom } from '../auth/gate'
import type { SignInConfig } from '../auth/providers'
import { consentGone } from './pages'
import { approve, ConnectorProvider, deny, digest } from './provider'
import { catalogueServer } from './tools'

export const MCP_PATH = '/mcp'

/**
 * Every door outside `/api`, with a path a request would use. The order is the
 * order they are mounted in, and `gate.routes.test.ts` asserts both.
 */
export const MCP_DOORS = [
  { door: 'GET /.well-known/oauth-authorization-server', path: '/.well-known/oauth-authorization-server', guard: 'open' },
  { door: 'GET /.well-known/oauth-protected-resource/mcp', path: '/.well-known/oauth-protected-resource/mcp', guard: 'open' },
  { door: 'GET|POST /authorize', path: '/authorize', guard: 'session, to approve' },
  { door: 'POST /token', path: '/token', guard: 'a code and its PKCE verifier, or a refresh token' },
  { door: 'POST /register', path: '/register', guard: 'open' },
  { door: 'POST /revoke', path: '/revoke', guard: 'the token being revoked' },
  { door: 'POST|GET|DELETE /mcp', path: MCP_PATH, guard: 'bearer' },
] as const

/** The routes under `/api/mcp`, behind the gate. */
export const MCP_API_ROUTES = [
  'POST /api/mcp/consent',
  'GET /api/mcp/connections',
  'DELETE /api/mcp/connections/:id',
] as const

/**
 * `no-store` on every answer the connector gives outside `/api`. RFC 6749
 * section 5.1 requires it of a token response; the rest carry it so none of
 * them can be the answer a shared cache hands the next person (#556, #566).
 * The SDK sets it on its own four handlers already and not on the metadata or
 * on a bearer refusal, which is why it is here rather than trusted to them.
 */
function connectorNoStore(_req: express.Request, res: express.Response, next: express.NextFunction): void {
  res.setHeader('Cache-Control', 'no-store')
  next()
}

export interface ConnectorMountDeps {
  db: Db
  auth: AuthStore
  signIn: SignInConfig
  now?: () => Date
}

/**
 * The canonical `/mcp`, or undefined when there is no origin it may be named
 * with. OAuth 2.1 requires every authorization server endpoint on `https`, and
 * the SDK refuses any other issuer except `localhost` and `127.0.0.1`, so an
 * `http` origin elsewhere leaves the connector off rather than the process
 * unable to start.
 */
export function connectorResource(publicOrigin: string): URL | undefined {
  if (!publicOrigin) return undefined
  const origin = new URL(publicOrigin)
  const local = origin.hostname === 'localhost' || origin.hostname === '127.0.0.1'
  if (origin.protocol !== 'https:' && !local) return undefined
  return new URL(MCP_PATH, origin)
}

export function mountMcp(app: express.Express, deps: ConnectorMountDeps): void {
  const now = deps.now ?? (() => new Date())
  const oauth = new OAuthStore(deps.db)

  mountConnections(app, oauth, now)

  const resource = connectorResource(deps.signIn.publicOrigin)
  if (!resource) return

  const provider = new ConnectorProvider({
    auth: deps.auth, oauth, resource, providers: deps.signIn.providers, now,
  })
  const issuer = new URL(deps.signIn.publicOrigin)

  const oauthMetadata = {
    ...createOAuthMetadata({ provider, issuerUrl: issuer }),
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
  }
  const resourceMetadata: OAuthProtectedResourceMetadata = {
    resource: resource.href,
    authorization_servers: [oauthMetadata.issuer],
    resource_name: 'Book catalogue',
  }
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(resource)

  app.use('/.well-known/oauth-authorization-server', connectorNoStore, metadataHandler(oauthMetadata))
  app.use(new URL(resourceMetadataUrl).pathname, connectorNoStore, metadataHandler(resourceMetadata))
  app.use('/authorize', connectorNoStore, authorizationHandler({ provider }))
  app.use('/token', connectorNoStore, tokenHandler({ provider }))
  app.use('/register', connectorNoStore, clientRegistrationHandler({
    clientsStore: provider.clientsStore,
    // No secret is issued, so there is nothing to expire.
    clientSecretExpirySeconds: 0,
  }))
  app.use('/revoke', connectorNoStore, revocationHandler({ provider }))

  /*
   * The bearer check reads `Authorization` and nothing else, so a session
   * cookie arriving here is ignored and the request is a stranger's. That is
   * deliberate: a cookie is sent by the browser on its own, so a page on
   * another site could otherwise drive tools as whoever is signed in.
   */
  const bearer = requireBearerAuth({
    verifier: provider,
    resourceMetadataUrl,
    expectedResource: resource,
  })

  app.route(MCP_PATH)
    .all(connectorNoStore, bearer, function mcpEnabled(req, res, next) {
      if (req.auth?.extra?.enabled === true) return next()
      res.status(403).json({
        state: 'waiting',
        error: 'This account is signed in but has not been let in yet.',
      })
    })
    .post(function mcpRequest(req, res, next) {
      void (async () => {
        const server = catalogueServer({ auth: deps.auth })
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        })
        res.on('close', () => {
          void transport.close()
          void server.close()
        })
        await server.connect(transport)
        await transport.handleRequest(req, res, req.body)
      })().catch(next)
    })
    /*
     * Stateless: there is no session to open a stream on or to end, so the
     * two other verbs the transport defines are refused, after the bearer
     * check so a stranger still learns nothing but `401`.
     */
    .get(notAllowed)
    .delete(notAllowed)
}

function notAllowed(_req: express.Request, res: express.Response): void {
  res.status(405).setHeader('Allow', 'POST').json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed: this server is stateless.' },
    id: null,
  })
}

/**
 * Under `/api`, so behind the gate: `res.locals.userId` is an enabled person.
 */
function mountConnections(app: express.Express, oauth: OAuthStore, now: () => Date): void {
  /*
   * The consent page's answer. The gate has already refused anybody without a
   * session or not let in; this requires the page's token to belong to the
   * same session it was drawn for, which is what stops another site posting
   * an approval on somebody's behalf. A form post rather than JSON because
   * the browser that answers is on a page this server drew, with no script.
   */
  app.post('/api/mcp/consent', express.urlencoded({ extended: false, limit: '4kb' }), (req, res, next) => {
    void (async () => {
      const body = (req.body ?? {}) as Record<string, unknown>
      const token = typeof body.consent === 'string' ? body.consent : ''
      const session = cookieFrom(req.headers.cookie, SESSION_COOKIE)
      const answered = token
        ? await oauth.takeConsent(digest(token), digest(session), now())
        : undefined
      if (!answered || answered.user_id !== res.locals.userId) {
        consentGone(res)
        return
      }
      const where = body.decision === 'approve'
        ? await approve(oauth, answered, now())
        : deny(answered)
      res.redirect(302, where)
    })().catch(next)
  })

  app.get('/api/mcp/connections', (_req, res, next) => {
    void (async () => {
      const rows = await oauth.connections(String(res.locals.userId))
      res.json({
        connections: rows.map((row) => {
          const client = JSON.parse(row.metadata) as { client_name?: string }
          return {
            id: row.id,
            client: { id: row.client_id, name: client.client_name ?? '' },
            redirectHost: new URL(row.redirect_uri).host,
            connectedAt: row.created_at,
            lastUsedAt: row.last_used_at,
          }
        }),
      })
    })().catch(next)
  })

  app.delete('/api/mcp/connections/:id', (req, res, next) => {
    void (async () => {
      const gone = await oauth.revokeGrant(String(req.params.id), String(res.locals.userId), now())
      if (!gone) {
        res.status(404).json({ error: 'Not found.' })
        return
      }
      res.status(204).end()
    })().catch(next)
  })
}

/** What the process says about the connector on every start, both ways round. */
export function describeMcp(signIn: SignInConfig): string[] {
  const resource = connectorResource(signIn.publicOrigin)
  return [resource
    ? `[mcp] the MCP connector is at ${resource.href}, its own OAuth authorization server at ${signIn.publicOrigin}`
    : signIn.publicOrigin
      ? `[mcp] the MCP connector is off: ${signIn.publicOrigin} is neither https nor localhost, and OAuth 2.1 serves an authorization server over https only`
      : '[mcp] the MCP connector is off: BOOKSCAN_PUBLIC_ORIGIN is empty, and the issuer and /mcp are absolute URLs this server will not guess']
}
