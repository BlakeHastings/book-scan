/**
 * An MCP client in the test process, shaped like Claude Code: the SDK's own
 * client, a loopback listener for the redirect, and the browser half left to
 * whoever is driving the browser.
 *
 * It talks to the api with a `fetch` that carries no session cookie, because a
 * connected client holds a bearer and nothing else. The suite's own `fetch` is
 * wrapped to attach the cookie (see `steps/fixtures.ts`), so the unwrapped one
 * is passed in rather than picked up from the global.
 */

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'

export const CLIENT_NAME = 'The end to end suite'

/** What the redirect brought back to the loopback listener. */
export interface Callback {
  code: string | null
  error: string | null
}

/**
 * The loopback redirect, on a port the operating system picks, the way Claude
 * Code listens for its own. `127.0.0.1` rather than `localhost` so the browser
 * cannot resolve it to an address nothing is listening on.
 */
class Loopback {
  private server: Server | undefined
  private arrived: (callback: Callback) => void = () => {}
  readonly answered = new Promise<Callback>((resolve) => { this.arrived = resolve })
  url = ''

  async listen(): Promise<void> {
    this.server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      // The browser asks for a favicon too, and a 404 for it reads as trouble in a red scenario's report.
      if (url.pathname !== '/callback') {
        res.writeHead(204).end()
        return
      }
      this.arrived({ code: url.searchParams.get('code'), error: url.searchParams.get('error') })
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<!doctype html><title>Back at the client</title><h1>Back at the client</h1>')
    })
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve))
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/callback`
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()))
  }
}

/** What an MCP client keeps between runs, in memory. */
class Remembering implements OAuthClientProvider {
  info: OAuthClientInformationMixed | undefined
  saved: OAuthTokens | undefined
  verifier = ''
  sentTo: URL | undefined

  constructor(private readonly callback: string) {}

  get redirectUrl(): string {
    return this.callback
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: CLIENT_NAME,
      redirect_uris: [this.callback],
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

export class McpConnection {
  private readonly loopback = new Loopback()
  private remembered: Remembering | undefined
  private transport: StreamableHTTPClientTransport | undefined
  private client: Client | undefined

  constructor(private readonly apiUrl: string, private readonly fetchAsAStranger: typeof fetch) {}

  private newTransport(): StreamableHTTPClientTransport {
    return new StreamableHTTPClientTransport(new URL('/mcp', this.apiUrl), {
      authProvider: this.remembered!,
      fetch: this.fetchAsAStranger,
    })
  }

  /**
   * Discovery from a `401`, registration, and the address of the authorization
   * page, which a real client would open in the person's browser.
   */
  async register(): Promise<URL> {
    await this.loopback.listen()
    this.remembered = new Remembering(this.loopback.url)
    this.transport = this.newTransport()
    const refused = await new Client({ name: 'e2e', version: '0.0.0' })
      .connect(this.transport)
      .then(() => undefined, (error: unknown) => error)
    if (!(refused instanceof UnauthorizedError)) {
      throw new Error(`/mcp should have asked for sign-in, and instead: ${String(refused)}`)
    }
    if (!this.remembered.info?.client_id || !this.remembered.sentTo) {
      throw new Error('the client registered nothing, or was sent nowhere to be approved')
    }
    return this.remembered.sentTo
  }

  /** Where the browser was sent back to, once it has been. */
  callback(): Promise<Callback> {
    return this.loopback.answered
  }

  /** The code exchanged for tokens, and a client connected with them. */
  async exchange(code: string): Promise<void> {
    await this.transport!.finishAuth(code)
    if (!this.remembered!.saved?.access_token) throw new Error('the token endpoint issued no access token')
    this.client = new Client({ name: 'e2e', version: '0.0.0' })
    await this.client.connect(this.newTransport())
  }

  get connected(): boolean {
    return this.client !== undefined
  }

  /** A tool's structured answer, or the refusal it gave, thrown. */
  async call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    if (!this.client) throw new Error(`cannot call ${name}: the client never connected`)
    const result = await this.client.callTool({ name, arguments: args })
    if (result.isError) {
      const content = result.content as { type: string; text?: string }[]
      throw new Error(`${name} refused: ${content.map((one) => one.text ?? '').join(' ')}`)
    }
    return result.structuredContent as T
  }

  async close(): Promise<void> {
    await this.client?.close().catch(() => {})
    await this.loopback.close()
  }
}
