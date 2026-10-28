/**
 * The MCP server's tools. One, for now: `whoami`, which proves the chain from a
 * bearer token to a person this app owns. The catalogue tools are later
 * children of #612 and call application handlers, never `Store`.
 *
 * A fresh `McpServer` per request, because `/mcp` runs the Streamable HTTP
 * transport stateless: nothing about a client is held between requests, so
 * nothing has to be found again after a restart or shared between processes.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'

import type { AuthStore } from '../../infrastructure/auth/auth-store'

/**
 * The person a request acts for, read off what `requireBearerAuth` attached.
 * Absent only if a tool were reached without the bearer check, which the
 * mount does not allow; refusing is the answer either way.
 */
export function actingFor(authInfo: AuthInfo | undefined): string {
  const userId = authInfo?.extra?.userId
  if (typeof userId !== 'string' || !userId) {
    throw new Error('This request carries no person, so no tool can act for one.')
  }
  return userId
}

export function catalogueServer(deps: { auth: AuthStore }): McpServer {
  const server = new McpServer({ name: 'book-scan', version: '0.1.0' })

  server.registerTool('whoami', {
    title: 'Who am I',
    description:
      'Says which person this connection acts for in the book catalogue: their id, ' +
      'name and email as their sign-in provider gave them.',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async (extra) => {
    const userId = actingFor(extra.authInfo)
    const identity = await deps.auth.latestIdentity(userId)
    const person = {
      id: userId,
      name: identity?.name ?? '',
      email: identity?.email ?? '',
      client: extra.authInfo?.clientId ?? '',
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(person) }],
      structuredContent: person,
    }
  })

  return server
}
