/**
 * Client ID Metadata Documents: a client whose `client_id` is an `https` URL,
 * and the document at that URL saying what the client is. This file decides
 * which ids are such URLs, fetches one, and checks what came back. See
 * docs/the-mcp-connector.md for the specification and the reasoning.
 *
 * The fetch is the dangerous part. The URL is chosen by whoever sent the
 * authorization request, and this server sits on somebody's home network, so
 * the request this file makes is bounded on every side: `https` only, every
 * address the name resolves to checked before a socket opens and the socket
 * pinned to the address that was checked, no redirect followed, no cookie or
 * credential sent, five seconds and five kilobytes.
 */

import { BlockList, isIP } from 'node:net'
import { lookup as dnsLookup } from 'node:dns/promises'
import { request } from 'node:https'
import type { LookupFunction } from 'node:net'
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js'

import { USER_AGENT } from '../bounded-fetch'

/** The draft's recommended ceiling on a document (section 6.6). */
export const DOCUMENT_MAX_BYTES = 5 * 1024

export const DOCUMENT_TIMEOUT_MS = 5_000

/** How long a document is reused when it says nothing about caching. */
export const DOCUMENT_DEFAULT_SECONDS = 5 * 60

/** The longest a document is reused, whatever its `Cache-Control` says. */
export const DOCUMENT_MAX_SECONDS = 60 * 60

/** Why a document was not accepted, in words the person and the client both see. */
export class DocumentRefused extends Error {
  override name = 'DocumentRefused'
}

/**
 * Whether a `client_id` names a document rather than a registration. A
 * registered client's id is a `randomUUID()` and can never start this way, so
 * the two kinds of client cannot share an id.
 */
export function isDocumentClientId(clientId: string): boolean {
  return clientId.slice(0, 8).toLowerCase() === 'https://'
}

/**
 * The document's URL, or a refusal saying which rule the id broke. The id
 * must already be in the form a URL parser writes it back out in, which is
 * what refuses dot segments, an upper-case host or a spelled-out `:443`: the
 * document's own `client_id` is compared with this string exactly, so two
 * spellings of one address would be two clients.
 */
export function documentUrl(clientId: string): URL {
  let url: URL
  try {
    url = new URL(clientId)
  } catch {
    throw new DocumentRefused('The client_id is not a URL.')
  }
  if (url.protocol !== 'https:') throw new DocumentRefused('The client_id must be an https URL.')
  if (url.username || url.password) throw new DocumentRefused('The client_id must not carry a user name or password.')
  if (clientId.includes('#')) throw new DocumentRefused('The client_id must not have a fragment.')
  if (url.pathname === '/') throw new DocumentRefused('The client_id must have a path.')
  if (url.href !== clientId) {
    throw new DocumentRefused('The client_id must be written in normal form: no dot segments, a lower-case host and no default port.')
  }
  return url
}

const SPECIAL_V4: [string, number][] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]

const special = new BlockList()
for (const [network, prefix] of SPECIAL_V4) special.addSubnet(network, prefix, 'ipv4')

/*
 * IPv6 is the other way round: only global unicast, 2000::/3, may be fetched
 * from, less the parts of it that are documentation or that carry an IPv4
 * address inside them (6to4, Teredo and the rest of 2001::/23). Loopback,
 * link-local, unique-local, multicast, NAT64 and IPv4-mapped addresses all
 * fall outside 2000::/3 and are refused by that alone.
 */
const globalV6 = new BlockList()
globalV6.addSubnet('2000::', 3, 'ipv6')
const specialV6 = new BlockList()
specialV6.addSubnet('2001::', 23, 'ipv6')
specialV6.addSubnet('2001:db8::', 32, 'ipv6')
specialV6.addSubnet('2002::', 16, 'ipv6')

/**
 * Whether an address is one this server must not fetch from: private,
 * loopback, link-local, carrier-grade NAT, documentation, multicast, or any
 * other special-use range of RFC 6890. Anything that is not an address at all
 * is refused too.
 */
export function isSpecialUse(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return special.check(address, 'ipv4')
  if (family === 6) return !globalV6.check(address, 'ipv6') || specialV6.check(address, 'ipv6')
  return true
}

export interface Resolved {
  address: string
  family: number
}

export interface DocumentFetchOptions {
  /** Every address a host name resolves to. The system resolver unless a test says otherwise. */
  resolve?: (hostname: string) => Promise<Resolved[]>
  /** Whether an address is refused. `isSpecialUse` unless a test says otherwise. */
  refuses?: (address: string) => boolean
  /** Certificates to trust beside the system's, for a test's own server. */
  ca?: string
  timeoutMs?: number
  maxBytes?: number
}

export interface FetchedDocument {
  body: unknown
  /** How long it may be reused for, in seconds, already bounded. */
  freshSeconds: number
}

async function systemResolve(hostname: string): Promise<Resolved[]> {
  return dnsLookup(hostname, { all: true, verbatim: true })
}

/** How long a response may be reused, from its `Cache-Control`, bounded both ways. */
export function freshnessOf(cacheControl: string | undefined): number {
  const directives = (cacheControl ?? '').toLowerCase().split(',').map((one) => one.trim())
  if (directives.some((one) => one === 'no-store' || one === 'no-cache')) return 0
  const maxAge = directives.find((one) => one.startsWith('max-age='))
  if (!maxAge) return DOCUMENT_DEFAULT_SECONDS
  const seconds = Number(maxAge.slice('max-age='.length))
  if (!Number.isFinite(seconds) || seconds < 0) return 0
  return Math.min(Math.floor(seconds), DOCUMENT_MAX_SECONDS)
}

function jsonType(contentType: string | undefined): boolean {
  const type = ((contentType ?? '').split(';')[0] ?? '').trim().toLowerCase()
  return type === 'application/json' || (type.startsWith('application/') && type.endsWith('+json'))
}

/**
 * Fetch one document. Resolves with what it said and for how long, or rejects
 * with a `DocumentRefused` naming the reason. No request is sent to a host
 * any of whose addresses is refused.
 */
export async function fetchClientDocument(url: URL, options: DocumentFetchOptions = {}): Promise<FetchedDocument> {
  const resolve = options.resolve ?? systemResolve
  const refuses = options.refuses ?? isSpecialUse
  const timeoutMs = options.timeoutMs ?? DOCUMENT_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? DOCUMENT_MAX_BYTES

  if (url.protocol !== 'https:') throw new DocumentRefused('Only an https document is fetched.')
  const hostname = url.hostname.replace(/^\[(.*)\]$/, '$1')

  let addresses: Resolved[]
  if (isIP(hostname)) {
    addresses = [{ address: hostname, family: isIP(hostname) }]
  } else {
    try {
      addresses = await resolve(hostname)
    } catch {
      throw new DocumentRefused(`${hostname} could not be resolved.`)
    }
  }
  const [pinned] = addresses
  if (!pinned) throw new DocumentRefused(`${hostname} could not be resolved.`)
  /*
   * Every address, not only the one a connection would use: a name answering
   * one public and one private address is a name somebody pointed at both.
   */
  const refused = addresses.find((one) => refuses(one.address))
  if (refused) {
    throw new DocumentRefused(`${hostname} resolves to ${refused.address}, which is a private or special-use address this server does not fetch from.`)
  }

  /*
   * The socket asks this instead of DNS, so it connects to the address that
   * was checked above and nothing a second lookup could answer differently.
   * Node passes `all: true` when it races address families.
   */
  const pinnedLookup: LookupFunction = (_host, lookupOptions, callback) => {
    if (lookupOptions.all) {
      (callback as unknown as (error: null, all: Resolved[]) => void)(null, [pinned])
    } else {
      callback(null, pinned.address, pinned.family)
    }
  }

  return new Promise<FetchedDocument>((settle, fail) => {
    let finished = false
    const finish = (error: Error | undefined, value?: FetchedDocument) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      if (error) fail(error)
      else settle(value!)
    }

    const outgoing = request(url, {
      method: 'GET',
      agent: false,
      lookup: pinnedLookup,
      ca: options.ca,
      // Only these two headers: no cookie, no authorization, nothing asking for compression.
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    }, (response) => {
      const refuse = (why: string) => {
        response.destroy()
        finish(new DocumentRefused(why))
      }
      if (response.statusCode !== 200) {
        const moved = response.statusCode && response.statusCode >= 300 && response.statusCode < 400
        refuse(moved
          ? `The document answered ${response.statusCode}, and a redirect is not followed.`
          : `The document answered ${response.statusCode}, not 200.`)
        return
      }
      if (!jsonType(response.headers['content-type'])) {
        refuse('The document is not served as JSON.')
        return
      }
      const encoding = (response.headers['content-encoding'] ?? 'identity').toLowerCase()
      if (encoding !== 'identity') {
        refuse('The document is compressed, and none was asked for.')
        return
      }
      const declared = Number(response.headers['content-length'])
      if (Number.isFinite(declared) && declared > maxBytes) {
        refuse(`The document is ${declared} bytes, over the ${maxBytes} this server reads.`)
        return
      }
      const chunks: Buffer[] = []
      let size = 0
      response.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > maxBytes) {
          refuse(`The document is over the ${maxBytes} bytes this server reads.`)
          return
        }
        chunks.push(chunk)
      })
      response.on('error', () => finish(new DocumentRefused('The document could not be read.')))
      response.on('end', () => {
        if (finished) return
        let body: unknown
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } catch {
          finish(new DocumentRefused('The document is not valid JSON.'))
          return
        }
        finish(undefined, { body, freshSeconds: freshnessOf(response.headers['cache-control']) })
      })
    })

    const timer = setTimeout(() => {
      finish(new DocumentRefused(`The document took longer than ${timeoutMs / 1000} seconds.`))
      outgoing.destroy()
    }, timeoutMs)
    outgoing.on('error', () => finish(new DocumentRefused(`The document at ${url.host} could not be fetched.`)))
    outgoing.end()
  })
}

/**
 * The client a document describes, or a refusal. Kept: the name, the
 * redirect URIs and what the SDK needs to treat it as a public client.
 * Everything else the document says is dropped rather than stored.
 */
export function clientFromDocument(
  clientId: string,
  body: unknown,
  acceptableRedirect: (uri: string) => boolean,
): OAuthClientInformationFull {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new DocumentRefused('The document is not a JSON object.')
  }
  const said = body as Record<string, unknown>
  if (said.client_id !== clientId) {
    throw new DocumentRefused('The document names a different client_id from the URL it was fetched from.')
  }
  const redirects = said.redirect_uris
  if (!Array.isArray(redirects) || !redirects.length || !redirects.every((one) => typeof one === 'string')) {
    throw new DocumentRefused('The document lists no redirect_uris.')
  }
  const bad = (redirects as string[]).filter((uri) => !acceptableRedirect(uri))
  if (bad.length) {
    throw new DocumentRefused('Every redirect URI must be https, or http to localhost or 127.0.0.1, with no fragment.')
  }
  if (said.token_endpoint_auth_method !== 'none') {
    throw new DocumentRefused('The document must say token_endpoint_auth_method "none": this server has public clients only.')
  }
  if ('client_secret' in said || 'client_secret_expires_at' in said) {
    throw new DocumentRefused('A metadata document must not carry a client secret.')
  }
  if (said.client_name !== undefined && typeof said.client_name !== 'string') {
    throw new DocumentRefused('The document\'s client_name is not text.')
  }
  const listOf = (value: unknown): string[] | undefined =>
    Array.isArray(value) && value.every((one) => typeof one === 'string') ? value as string[] : undefined
  const grants = listOf(said.grant_types) ?? ['authorization_code']
  if (!grants.includes('authorization_code')) {
    throw new DocumentRefused('The document does not ask for the authorization_code grant.')
  }
  const responses = listOf(said.response_types) ?? ['code']
  if (!responses.includes('code')) {
    throw new DocumentRefused('The document does not ask for the code response type.')
  }
  return {
    client_id: clientId,
    ...(typeof said.client_name === 'string' ? { client_name: said.client_name } : {}),
    redirect_uris: redirects as string[],
    grant_types: grants,
    response_types: responses,
    token_endpoint_auth_method: 'none',
  }
}
