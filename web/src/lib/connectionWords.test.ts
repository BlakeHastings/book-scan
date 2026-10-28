import { describe, expect, it } from 'vitest'
import type { McpConnection } from './api'
import { NO_NAME, connectionSaid, disconnectAsked, isLoopback } from './connectionWords'

const TODAY = new Date('2026-10-28T15:00:00')

function one(over: { name?: string; redirectHost?: string } = {}): McpConnection {
  return {
    id: 'g1',
    client: { id: 'c1', name: over.name ?? 'Claude' },
    redirectHost: over.redirectHost ?? 'claude.ai',
    connectedAt: '2026-10-21T19:04:00',
    lastUsedAt: '2026-10-28T09:12:00',
  }
}

describe('what Settings says about a connection', () => {
  it('names where it connected through, and when, beside the name it gave', () => {
    const said = connectionSaid(one(), TODAY)
    expect(said.name).toBe('Claude')
    expect(said.host).toBe('claude.ai')
    expect(said.said).toBe('Connected on 21 October, last used today.')
  })

  it('says a program on somebody\'s own computer could have called itself anything', () => {
    const said = connectionSaid(one({ redirectHost: 'localhost:53682' }), TODAY)
    expect(said.said).toContain('localhost:53682 is a program on the computer')
    expect(said.said).toContain('could have given itself any name')
    expect(connectionSaid(one(), TODAY).said).not.toContain('any name')
  })

  it('does not leave a row with no name to read', () => {
    expect(connectionSaid(one({ name: '   ' }), TODAY).name).toBe(NO_NAME)
  })

  it('tells a loopback host from one that only starts like one', () => {
    expect(isLoopback('localhost:7777')).toBe(true)
    expect(isLoopback('127.0.0.1:9')).toBe(true)
    expect(isLoopback('[::1]:9')).toBe(true)
    expect(isLoopback('localhost.example.com')).toBe(false)
    expect(isLoopback('claude.ai')).toBe(false)
  })

  it('asks with the host in it and the books counted', () => {
    const asked = disconnectAsked(connectionSaid(one({ redirectHost: 'evil.example' }), TODAY), 1204)
    expect(asked.title).toBe('Disconnect Claude from your 1,204 books?')
    expect(asked.said).toContain('evil.example')
    expect(disconnectAsked(connectionSaid(one(), TODAY), null).title).toBe('Disconnect Claude?')
    expect(disconnectAsked(connectionSaid(one(), TODAY), 0).title).toBe('Disconnect Claude?')
  })
})
