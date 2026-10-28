/**
 * What Settings says about each client connected over MCP.
 *
 * A client's name is whatever it registered itself as, and registering is open
 * to anybody, so a row never says the name without the host its approval was
 * sent to. A loopback host is a program on somebody's own computer, and any
 * program there could have registered under any name, so it says so.
 */

import type { McpConnection } from './api'
import { plural, whenSaid } from './carryWords'

/** One connection, said. `name` and `host` are kept apart from `said` so the host is drawn beside the name, and each as plain text. */
export interface ConnectionSaid {
  id: string
  name: string
  host: string
  said: string
}

const LOOPBACK = ['localhost', '127.0.0.1', '[::1]']

export const NO_NAME = 'An app that gave no name'

/**
 * The how-to, where it is published. The app serves no documents of its own, and
 * the repository is public, so this is the one copy that cannot fall behind.
 */
export const CONNECTING_GUIDE = 'https://github.com/BlakeHastings/book-scan/blob/master/docs/connecting-claude.md'

export function isLoopback(host: string): boolean {
  // A host is `name` or `name:port`, and an IPv6 literal keeps its brackets.
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]!
  return LOOPBACK.includes(name)
}

/** The day an ISO 8601 instant falls on, in this phone's own time zone. */
function dayOf(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const local = new Date(at.getTime() - at.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

export function connectionSaid(one: McpConnection, today = new Date()): ConnectionSaid {
  const host = one.redirectHost
  const now = dayOf(today.toISOString())
  // `whenSaid` counts days against a UTC noon, so the local day is handed to it as both ends.
  const noon = new Date(`${now}T12:00:00Z`)
  const when = (iso: string) => whenSaid(dayOf(iso), noon)
  const said = `Connected ${when(one.connectedAt)}, last used ${when(one.lastUsedAt)}.`
  return {
    id: one.id,
    name: one.client.name.trim() || NO_NAME,
    host,
    said: isLoopback(host)
      ? `${said} ${host} is a program on the computer it was connected from, so it could have given itself any name.`
      : said,
  }
}

/**
 * The question before a disconnect, with the count of what the app can reach in
 * it, since a connection reaches the whole catalogue. `books` is null before the
 * counts have been read.
 */
export function disconnectAsked(one: ConnectionSaid, books: number | null): { title: string; said: string } {
  return {
    title: books === null
      ? `Disconnect ${one.name} from your books?`
      : `Disconnect ${one.name} from your ${plural(books, 'book')}?`,
    said: `It connected through ${one.host}. It stops working at once, and can only come back by asking you again.`,
  }
}

export function disconnected(one: ConnectionSaid): string {
  return `${one.name} is disconnected. Nothing it held works any more.`
}

export const ALREADY_GONE = 'That one was already disconnected.'
