/**
 * The #60 repro: a second phone got "no camera devices" with no way forward.
 * These pin the three cases the issue asks to be told apart, plus the
 * fallback when the browser will not even say which one it is.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { currentOrigin, diagnoseCameraFailure } from './scanner'

function notAllowedError(): DOMException {
  return new DOMException('denied', 'NotAllowedError')
}

function notFoundError(): DOMException {
  return new DOMException('no device', 'NotFoundError')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('currentOrigin', () => {
  it('reads the protocol and host actually loaded', () => {
    vi.stubGlobal('location', { protocol: 'https:', host: '192.168.1.20:5173' })
    expect(currentOrigin()).toBe('https://192.168.1.20:5173')
  })

  it('falls back to a plain phrase when there is no location at all', () => {
    expect(currentOrigin()).toBe('this address')
  })
})

describe('diagnoseCameraFailure', () => {
  it('reports an insecure context ahead of anything else', async () => {
    // A phone that reached the plain-HTTP address is refused a camera before
    // getUserMedia even runs, so this must win regardless of what error (if
    // any) is passed in.
    vi.stubGlobal('window', { isSecureContext: false })
    vi.stubGlobal('location', { protocol: 'http:', host: '192.168.1.20:5173' })

    const result = await diagnoseCameraFailure(notAllowedError())
    expect(result.reason).toBe('insecure-context')
    expect(result.message).toContain('http://192.168.1.20:5173')
    expect(result.message).toContain('https')
  })

  it('distinguishes a denied permission using permissions.query alone', async () => {
    // No error was even thrown, which is the enumerate-yields-nothing path:
    // permissions.query can say the site is blocked before a tap happens.
    vi.stubGlobal('window', { isSecureContext: true })
    vi.stubGlobal('location', { protocol: 'https:', host: 'lvh.me:5173' })
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: vi.fn() },
      permissions: { query: vi.fn().mockResolvedValue({ state: 'denied' }) },
    })

    const result = await diagnoseCameraFailure()
    expect(result.reason).toBe('permission-denied')
    expect(result.message).toContain('lvh.me:5173')
    expect(result.message).toMatch(/Website Settings|Website Data/)
  })

  it('falls back to the error name when permissions.query is unsupported', async () => {
    vi.stubGlobal('window', { isSecureContext: true })
    vi.stubGlobal('location', { protocol: 'https:', host: '10.0.0.5:5173' })
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: vi.fn() },
      // No `permissions` at all: some engines never had it for camera.
    })

    const result = await diagnoseCameraFailure(notAllowedError())
    expect(result.reason).toBe('permission-denied')
  })

  it('reports a genuinely missing camera separately from a denied one', async () => {
    vi.stubGlobal('window', { isSecureContext: true })
    vi.stubGlobal('location', { protocol: 'https:', host: 'localhost:5173' })
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: vi.fn() },
      permissions: { query: vi.fn().mockResolvedValue({ state: 'granted' }) },
    })

    const result = await diagnoseCameraFailure(notFoundError())
    expect(result.reason).toBe('no-camera')
    expect(result.message).not.toContain('denied')
  })

  it('names the browser as unsupported when there is no mediaDevices at all', async () => {
    vi.stubGlobal('window', { isSecureContext: true })
    vi.stubGlobal('location', { protocol: 'https:', host: 'localhost:5173' })
    vi.stubGlobal('navigator', {})

    const result = await diagnoseCameraFailure()
    expect(result.reason).toBe('unsupported')
  })
})
