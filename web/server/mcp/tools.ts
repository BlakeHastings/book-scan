/**
 * The MCP server's tools: `whoami`, which proves the chain from a bearer token
 * to a person this app owns, the catalogue's read tools in `read-tools.ts` and
 * its write tools in `write-tools.ts`. Every tool calls application handlers,
 * never `Store`.
 *
 * A fresh `McpServer` per request, because `/mcp` runs the Streamable HTTP
 * transport stateless: nothing about a client is held between requests, so
 * nothing has to be found again after a restart or shared between processes.
 * The handlers are not made here; `createApp` builds them once and passes them.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import type { AuthStore } from '../../infrastructure/auth/auth-store'
import { actingFor, answer } from './answers'
import { registerReadTools, type CatalogueQueries } from './read-tools'
import { registerWriteTools, type CatalogueCommands } from './write-tools'

export type { CatalogueCommands, CatalogueQueries }

export function catalogueServer(
  deps: { auth: AuthStore; queries: CatalogueQueries; commands: CatalogueCommands },
): McpServer {
  const server = new McpServer({ name: 'book-scan', version: '0.1.0' })

  server.registerTool('whoami', {
    title: 'Who am I',
    description:
      'Says which person this connection acts for in the book catalogue: their id, ' +
      'name and email as their sign-in provider gave them.',
    outputSchema: {
      id: z.string(),
      name: z.string(),
      email: z.string(),
      client: z.string().describe('The id this client registered under.'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async (extra) => {
    const userId = actingFor(extra.authInfo)
    const identity = await deps.auth.latestIdentity(userId)
    return answer({
      id: userId,
      name: identity?.name ?? '',
      email: identity?.email ?? '',
      client: extra.authInfo?.clientId ?? '',
    })
  })

  registerReadTools(server, deps.queries)
  registerWriteTools(server, deps.queries, deps.commands)

  return server
}
