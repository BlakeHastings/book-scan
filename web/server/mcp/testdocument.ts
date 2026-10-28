/**
 * A local https server standing in for whoever publishes a client's metadata
 * document, which counts every connection and request it is sent, so a test
 * can prove that a refused fetch never reached it at all.
 *
 * Its certificate is self-signed for `client.test`, a name nothing resolves,
 * so a fetch reaches it only through the resolver a test hands the fetcher.
 *
 * Test support only; nothing the server runs imports this file.
 */

import { createServer, type Server } from 'node:https'
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { getCertificate } from '@vitejs/plugin-basic-ssl'

import type { DocumentFetchOptions, Resolved } from './client-document'

export const DOCUMENT_HOST = 'client.test'

export type Answer = (req: IncomingMessage, res: ServerResponse) => void

export interface DocumentServer {
  /** `https://client.test:<port>`, with no trailing slash. */
  origin: string
  certificate: string
  connections: number
  requests: { path: string; headers: IncomingHttpHeaders }[]
  /** What each path answers; anything else is a 404. */
  answers: Map<string, Answer>
  /** A resolver that answers `client.test`, and only it, with this address. */
  resolveTo(address: string): (hostname: string) => Promise<Resolved[]>
  close(): Promise<void>
}

export async function startDocumentServer(certDir: string): Promise<DocumentServer> {
  const certificate = await getCertificate(certDir, 'client-document-test', [DOCUMENT_HOST])
  const answers = new Map<string, Answer>()
  let server: Server | undefined
  const state: DocumentServer = {
    origin: '',
    certificate,
    connections: 0,
    requests: [],
    answers,
    resolveTo: (address) => async (hostname) => {
      if (hostname !== DOCUMENT_HOST) throw new Error(`no such host as ${hostname}`)
      return [{ address, family: address.includes(':') ? 6 : 4 }]
    },
    close: () => new Promise<void>((resolve) => {
      server?.closeAllConnections()
      server?.close(() => resolve())
    }),
  }
  server = createServer({ key: certificate, cert: certificate }, (req, res) => {
    state.requests.push({ path: req.url ?? '', headers: req.headers })
    const answer = answers.get(req.url ?? '')
    if (answer) answer(req, res)
    else res.writeHead(404).end()
  })
  server.on('connection', () => { state.connections += 1 })
  server.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server!.once('listening', resolve))
  state.origin = `https://${DOCUMENT_HOST}:${(server.address() as AddressInfo).port}`
  return state
}

/** Answer JSON, with whatever `Cache-Control` the test wants. */
export function json(body: unknown, cacheControl = 'public, max-age=300'): Answer {
  return (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': cacheControl })
    res.end(JSON.stringify(body))
  }
}

/** Options that reach this server and nothing else: its name, its certificate, and loopback let through. */
export function reaching(documents: DocumentServer, refuses: (address: string) => boolean): DocumentFetchOptions {
  return { resolve: documents.resolveTo('127.0.0.1'), refuses, ca: documents.certificate }
}
