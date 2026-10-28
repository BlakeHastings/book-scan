/**
 * An MCP client connected the way claude.ai or Claude Code connects: the SDK's
 * own client, discovering from a `401`, registering, sent through the browser
 * half with a session cookie, approving, and exchanging the code.
 *
 * Test support only; nothing the server runs imports this file.
 */

import { expect } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'

export const CALLBACK = 'http://localhost:7777/callback'

/** What an MCP client keeps between runs, in memory. */
export class RememberingClient implements OAuthClientProvider {
  info: OAuthClientInformationMixed | undefined
  saved: OAuthTokens | undefined
  verifier = ''
  sentTo: URL | undefined

  get redirectUrl(): string {
    return CALLBACK
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'A test client',
      redirect_uris: [CALLBACK],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }
  }

  clientInformation() { return this.info }
  saveClientInformation(info: OAuthClientInformationMixed) { this.info = info }
  tokens() { return this.saved }
  saveTokens(tokens: OAuthTokens) { this.saved = tokens }
  redirectToAuthorization(url: URL) { this.sentTo = url }
  saveCodeVerifier(verifier: string) { this.verifier = verifier }
  codeVerifier() { return this.verifier }
}

export function newClient(): Client {
  return new Client({ name: 'connector-test', version: '0.0.0' })
}

export const mcpUrl = (origin: string) => new URL('/mcp', origin)

/** The consent page's hidden token, out of the HTML this server drew. */
export function consentTokenIn(html: string): string {
  const found = /name="consent" value="([^"]+)"/.exec(html)?.[1]
  if (!found) throw new Error(`no consent form on this page:\n${html}`)
  return found
}

/** Answer a consent page as a browser would, and say where it was sent. */
export function answerConsent(
  origin: string, token: string, cookie: string, decision: 'approve' | 'deny',
): Promise<Response> {
  return fetch(`${origin}/api/mcp/consent`, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ consent: token, decision }).toString(),
  })
}

/** The browser half: open the authorization URL signed in, and approve. */
export async function approveIn(origin: string, browserCookie: string, authorizationUrl: URL): Promise<string> {
  const page = await fetch(authorizationUrl, { headers: { cookie: browserCookie }, redirect: 'manual' })
  expect(page.status).toBe(200)
  const back = await answerConsent(origin, consentTokenIn(await page.text()), browserCookie, 'approve')
  expect(back.status).toBe(302)
  const location = new URL(back.headers.get('location') ?? '')
  expect(`${location.origin}${location.pathname}`).toBe(CALLBACK)
  return location.searchParams.get('code') ?? ''
}

/** A connected SDK client, through the whole flow, as the person behind `cookie`. */
export async function connect(
  origin: string, cookie: string,
): Promise<{ client: Client; remembered: RememberingClient; code: string }> {
  const remembered = new RememberingClient()
  const first = newClient()
  const transport = new StreamableHTTPClientTransport(mcpUrl(origin), { authProvider: remembered })
  await expect(first.connect(transport)).rejects.toBeInstanceOf(UnauthorizedError)
  expect(remembered.info?.client_id).toBeTruthy()
  expect(remembered.sentTo).toBeDefined()

  const code = await approveIn(origin, cookie, remembered.sentTo!)
  await transport.finishAuth(code)

  const client = newClient()
  await client.connect(new StreamableHTTPClientTransport(mcpUrl(origin), { authProvider: remembered }))
  return { client, remembered, code }
}
