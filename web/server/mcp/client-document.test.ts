/**
 * The metadata document fetch, against a real https server on loopback whose
 * every connection is counted. The refusals that matter most are the ones
 * that must happen before a socket opens, and those are proved by the count
 * staying at nought, not by the error alone.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { removeScratchRoot, scratchRoot } from '../scratchdir'
import {
  clientFromDocument, documentUrl, DocumentRefused, fetchClientDocument, freshnessOf,
  isDocumentClientId, isSpecialUse, DOCUMENT_MAX_BYTES, DOCUMENT_MAX_SECONDS,
  type DocumentFetchOptions,
} from './client-document'
import { acceptableRedirect } from './provider'
import { json, reaching, startDocumentServer, type DocumentServer } from './testdocument'

let scratch: string
let documents: DocumentServer

/** Loopback is let through for the test server; everything else is the real rule. */
const exceptLoopback = (address: string) => address !== '127.0.0.1' && isSpecialUse(address)

beforeAll(async () => {
  scratch = scratchRoot('client-document')
  documents = await startDocumentServer(scratch)
})

afterAll(async () => {
  await documents.close()
  removeScratchRoot(scratch)
})

beforeEach(() => {
  documents.answers.clear()
  documents.requests.length = 0
  documents.connections = 0
})

const doc = (path = '/client.json') => `${documents.origin}${path}`

function claudeLike(clientId: string) {
  return {
    client_id: clientId,
    client_name: 'Claude Code',
    client_uri: 'https://claude.ai',
    redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  }
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(() => undefined, (caught: unknown) => caught)
  expect(error).toBeInstanceOf(DocumentRefused)
  return (error as Error).message
}

describe('which addresses are never fetched from', () => {
  it.each([
    '10.0.0.5', '172.16.4.1', '192.168.1.20', '127.0.0.1', '127.8.8.8', '169.254.169.254',
    '100.64.0.1', '100.127.255.254', '0.0.0.0', '192.0.2.1', '198.18.0.1', '224.0.0.1', '255.255.255.255',
    '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1',
    '64:ff9b::a00:1', '2002:a00:1::1', '2001::1', '2001:db8::1', 'not an address',
  ])('refuses %s', (address) => {
    expect(isSpecialUse(address)).toBe(true)
  })

  it.each(['8.8.8.8', '160.79.104.10', '104.18.32.47', '2606:4700::6812:1', '2a00:1450:4001::1'])('allows %s', (address) => {
    expect(isSpecialUse(address)).toBe(false)
  })
})

describe('which client ids are documents', () => {
  it('is an https URL, and a registered client\'s UUID never is', () => {
    expect(isDocumentClientId('https://claude.ai/oauth/claude-code-client-metadata')).toBe(true)
    expect(isDocumentClientId('HTTPS://claude.ai/x')).toBe(true)
    expect(isDocumentClientId('9c658c6f-1b2d-4c33-9e5e-6f7a8b9c0d1e')).toBe(false)
    expect(isDocumentClientId('http://claude.ai/x')).toBe(false)
  })

  it.each([
    ['https://claude.ai/', 'path'],
    ['https://claude.ai/a#b', 'fragment'],
    ['https://user:pw@claude.ai/a', 'user name'],
    ['https://claude.ai/a/../b', 'normal form'],
    ['https://Claude.AI/a', 'normal form'],
    ['https://claude.ai:443/a', 'normal form'],
    ['https://', 'not a URL'],
  ])('refuses %s', (clientId, why) => {
    expect(() => documentUrl(clientId)).toThrow(why)
  })
})

describe('how long a document is kept', () => {
  it('honours max-age up to an hour, defaults to five minutes, and keeps nothing it was told not to', () => {
    expect(freshnessOf('public, max-age=300')).toBe(300)
    expect(freshnessOf('max-age=999999')).toBe(DOCUMENT_MAX_SECONDS)
    expect(freshnessOf(undefined)).toBe(300)
    expect(freshnessOf('no-store')).toBe(0)
    expect(freshnessOf('max-age=60, no-cache')).toBe(0)
    expect(freshnessOf('max-age=-1')).toBe(0)
  })
})

describe('what a document must say', () => {
  const id = 'https://claude.ai/oauth/claude-code-client-metadata'

  it('keeps the name and redirect URIs of a document like Claude Code\'s, and nothing else', () => {
    const client = clientFromDocument(id, { ...claudeLike(id), logo_uri: 'https://x.test/l.png' }, acceptableRedirect)
    expect(client).toEqual({
      client_id: id,
      client_name: 'Claude Code',
      redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    })
  })

  it('refuses a document naming a different client_id from its own URL', () => {
    expect(() => clientFromDocument(id, claudeLike('https://evil.test/claude.json'), acceptableRedirect))
      .toThrow('different client_id')
  })

  it.each([
    ['no redirect URIs', { redirect_uris: [] }, 'no redirect_uris'],
    ['a plain http redirect elsewhere', { redirect_uris: ['http://evil.test/cb'] }, 'https, or http to localhost'],
    ['a secret method', { token_endpoint_auth_method: 'client_secret_basic' }, '"none"'],
    ['no method at all', { token_endpoint_auth_method: undefined }, '"none"'],
    ['a secret', { client_secret: 's' }, 'secret'],
    ['no code grant', { grant_types: ['client_credentials'] }, 'authorization_code'],
  ])('refuses %s', (_label, change, why) => {
    expect(() => clientFromDocument(id, { ...claudeLike(id), ...change }, acceptableRedirect)).toThrow(why)
  })

  it('refuses something that is not an object', () => {
    expect(() => clientFromDocument(id, [claudeLike(id)], acceptableRedirect)).toThrow('not a JSON object')
  })
})

describe('the fetch', () => {
  const allowed = (): DocumentFetchOptions => reaching(documents, exceptLoopback)

  it('reads a document, and sends nothing but what it asks for: no cookie, no credential', async () => {
    documents.answers.set('/client.json', json(claudeLike(doc()), 'public, max-age=120'))
    const fetched = await fetchClientDocument(new URL(doc()), allowed())
    expect(fetched).toEqual({ body: claudeLike(doc()), freshSeconds: 120 })
    expect(documents.requests).toHaveLength(1)
    const sent = documents.requests[0]!.headers
    expect(Object.keys(sent).sort()).toEqual(['accept', 'connection', 'host', 'user-agent'])
  })

  it('opens no connection to a host that resolves to a private address', async () => {
    documents.answers.set('/client.json', json(claudeLike(doc())))
    for (const address of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1']) {
      const why = await refusal(fetchClientDocument(new URL(doc()), {
        resolve: documents.resolveTo(address), ca: documents.certificate,
      }))
      expect(why).toContain(`resolves to ${address}`)
    }
    expect(documents.connections).toBe(0)
    expect(documents.requests).toHaveLength(0)
  })

  it('opens no connection when any one of a name\'s addresses is private', async () => {
    const why = await refusal(fetchClientDocument(new URL(doc()), {
      resolve: async () => [{ address: '104.18.32.47', family: 4 }, { address: '127.0.0.1', family: 4 }],
      ca: documents.certificate,
    }))
    expect(why).toContain('127.0.0.1')
    expect(documents.connections).toBe(0)
  })

  it('opens no connection to an address written into the URL', async () => {
    const port = new URL(documents.origin).port
    await refusal(fetchClientDocument(new URL(`https://127.0.0.1:${port}/client.json`), {}))
    await refusal(fetchClientDocument(new URL(`https://[::1]:${port}/client.json`), {}))
    expect(documents.connections).toBe(0)
  })

  it('resolves the name once and connects to the address it checked', async () => {
    documents.answers.set('/client.json', json(claudeLike(doc())))
    let asked = 0
    const resolveTo = documents.resolveTo('127.0.0.1')
    await fetchClientDocument(new URL(doc()), {
      ...allowed(),
      resolve: async (hostname) => { asked += 1; return resolveTo(hostname) },
    })
    expect(asked).toBe(1)
    expect(documents.connections).toBe(1)
  })

  it('does not follow a redirect, even to a public address', async () => {
    documents.answers.set('/client.json', (_req, res) => {
      res.writeHead(302, { Location: `${documents.origin}/elsewhere.json` }).end()
    })
    documents.answers.set('/elsewhere.json', json(claudeLike(doc('/elsewhere.json'))))
    expect(await refusal(fetchClientDocument(new URL(doc()), allowed()))).toContain('redirect is not followed')
    expect(documents.requests.map((one) => one.path)).toEqual(['/client.json'])
  })

  it('refuses an answer that is not 200', async () => {
    expect(await refusal(fetchClientDocument(new URL(doc('/missing.json')), allowed()))).toContain('404')
  })

  it('refuses a document that says it is too big, without reading it', async () => {
    documents.answers.set('/client.json', (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': String(DOCUMENT_MAX_BYTES + 1) })
      res.write('{')
    })
    expect(await refusal(fetchClientDocument(new URL(doc()), allowed()))).toContain(`over the ${DOCUMENT_MAX_BYTES}`)
  })

  it('stops reading a document that grows past the limit without saying how big it is', async () => {
    let sent = 0
    documents.answers.set('/client.json', (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      const more = () => {
        if (res.destroyed || sent > 10 * 1024 * 1024) return
        sent += 1024
        res.write(' '.repeat(1024), () => setImmediate(more))
      }
      more()
    })
    expect(await refusal(fetchClientDocument(new URL(doc()), allowed()))).toContain(`over the ${DOCUMENT_MAX_BYTES} bytes`)
    expect(sent).toBeLessThan(1024 * 1024)
  })

  it('gives up on a document that is slow to arrive', async () => {
    documents.answers.set('/client.json', (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.write('{')
    })
    const started = Date.now()
    expect(await refusal(fetchClientDocument(new URL(doc()), { ...allowed(), timeoutMs: 300 }))).toContain('longer than 0.3 seconds')
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  it('refuses a document that is not served as JSON, or is not JSON', async () => {
    documents.answers.set('/page.html', (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' }).end('{}')
    })
    documents.answers.set('/broken.json', (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"client_id":')
    })
    expect(await refusal(fetchClientDocument(new URL(doc('/page.html')), allowed()))).toContain('not served as JSON')
    expect(await refusal(fetchClientDocument(new URL(doc('/broken.json')), allowed()))).toContain('not valid JSON')
  })

  it('refuses a certificate it does not trust', async () => {
    documents.answers.set('/client.json', json(claudeLike(doc())))
    const { ca: _ignored, ...untrusting } = allowed()
    expect(await refusal(fetchClientDocument(new URL(doc()), untrusting))).toContain('could not be fetched')
  })

  it('refuses plain http outright', async () => {
    expect(await refusal(fetchClientDocument(new URL('http://client.test/x.json'), allowed()))).toContain('https')
    expect(documents.connections).toBe(0)
  })
})
