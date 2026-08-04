import { describe, expect, it } from 'vitest'

import { isLoopbackHttps, otlpProtocol } from './otel'

describe('otlpProtocol', () => {
  it('speaks gRPC when the collector says so, which is what Aspire says', () => {
    // Exactly the environment an Aspire resource is handed. Getting this wrong
    // is not a degraded pipeline, it is no pipeline: the dashboard listens for
    // HTTP/2 only, and an http/protobuf exporter never gets past the TLS
    // handshake.
    const env = {
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://localhost:21047',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'grpc',
    }
    expect(otlpProtocol(env, 'TRACES')).toEqual({ protocol: 'grpc' })
    expect(otlpProtocol(env, 'METRICS')).toEqual({ protocol: 'grpc' })
  })

  it('defaults to http/protobuf when nothing says otherwise', () => {
    expect(otlpProtocol({}, 'TRACES')).toEqual({ protocol: 'http/protobuf' })
    expect(otlpProtocol({ OTEL_EXPORTER_OTLP_PROTOCOL: '  ' }, 'TRACES')).toEqual({
      protocol: 'http/protobuf',
    })
  })

  it('lets the signal specific setting win over the general one', () => {
    const env = {
      OTEL_EXPORTER_OTLP_PROTOCOL: 'grpc',
      OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: 'http/protobuf',
    }
    expect(otlpProtocol(env, 'TRACES')).toEqual({ protocol: 'http/protobuf' })
    expect(otlpProtocol(env, 'METRICS')).toEqual({ protocol: 'grpc' })
  })

  it('reports a protocol it cannot speak rather than guessing', () => {
    expect(otlpProtocol({ OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json' }, 'TRACES')).toEqual({
      unsupported: 'http/json',
    })
  })
})

describe('isLoopbackHttps', () => {
  it('accepts the loopback hosts a dashboard is served from', () => {
    expect(isLoopbackHttps('https://localhost:21047')).toBe(true)
    expect(isLoopbackHttps('https://127.0.0.1:21047')).toBe(true)
    expect(isLoopbackHttps('https://[::1]:21047')).toBe(true)
  })

  it('refuses anything that is not loopback over https', () => {
    expect(isLoopbackHttps('http://localhost:21047')).toBe(false)
    expect(isLoopbackHttps('https://collector.example:4317')).toBe(false)
    expect(isLoopbackHttps('not a url')).toBe(false)
  })

  it('is not fooled by a loopback address hidden in userinfo', () => {
    // The certificate relaxation hangs off this answer, so a host that only
    // looks local must not get it.
    expect(isLoopbackHttps('https://127.0.0.1:80@evil.example/')).toBe(false)
  })
})
