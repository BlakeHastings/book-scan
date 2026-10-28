/**
 * How every tool answers, so the read tools and the write tools that follow
 * them cannot drift apart on it.
 */

import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

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

/**
 * The structured answer, and the same answer as JSON text. The specification
 * asks for the text block so a client that predates `structuredContent` still
 * hands the model the whole answer.
 */
export function answer<T extends Record<string, unknown>>(data: T): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data,
  }
}

/**
 * A refusal the model can act on: a tool execution error rather than a
 * protocol error, saying what was wrong and which tool answers the question.
 * The SDK skips output validation for it.
 */
export function refuse(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}
