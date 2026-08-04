/**
 * Pure decisions about how telemetry leaves this process.
 *
 * Separate from instrumentation.ts on purpose. That file exists for its side
 * effects and has to run before anything else loads, so a test cannot import
 * it without starting an SDK. Nothing here has a side effect, so the choices
 * it makes are testable on their own.
 */

/** The OTLP wire protocols this server knows how to speak. */
export type OtlpProtocol = 'grpc' | 'http/protobuf'

/**
 * Either a protocol this server can speak, or the unrecognised value that was
 * asked for. Reported rather than swallowed: a collector that wants something
 * we cannot send is exactly the kind of thing that otherwise goes unnoticed.
 */
export type ProtocolChoice = { protocol: OtlpProtocol } | { unsupported: string }

/**
 * Which protocol to speak, per the OpenTelemetry environment specification:
 * the signal specific variable wins, then the general one, and an unset value
 * means http/protobuf.
 *
 * This matters more than it looks. The Aspire dashboard receives OTLP over
 * gRPC only and says so by setting `OTEL_EXPORTER_OTLP_PROTOCOL=grpc`. Point
 * an http/protobuf exporter at that endpoint and it speaks HTTP/1.1 to an
 * HTTP/2 only listener: the TLS handshake ends in `no_application_protocol`,
 * every export dies as `socket hang up`, and the exporter retries in silence.
 */
export function otlpProtocol(
  env: Record<string, string | undefined>,
  signal: 'TRACES' | 'METRICS',
): ProtocolChoice {
  const specific = env[`OTEL_EXPORTER_OTLP_${signal}_PROTOCOL`]
  const general = env['OTEL_EXPORTER_OTLP_PROTOCOL']
  const raw = (specific ?? general ?? '').trim()

  if (raw === '') return { protocol: 'http/protobuf' }
  if (raw === 'grpc' || raw === 'http/protobuf') return { protocol: raw }
  return { unsupported: raw }
}

/**
 * True only when the endpoint's actual host is loopback over HTTPS.
 *
 * Parsed rather than pattern matched. A regex over the whole URL is fooled by
 * userinfo: `https://127.0.0.1:80@evil.example/` reads as local and is not.
 * URL.hostname is the host the request will really go to.
 *
 * An IPv6 literal keeps its brackets in `URL.hostname`, so both spellings are
 * listed. Only one of them can ever match, and matching neither would silently
 * cost the loopback exemption.
 */
export function isLoopbackHttps(url: string): boolean {
  try {
    const { hostname, protocol } = new URL(url)
    if (protocol !== 'https:') return false
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '[::1]'
    )
  } catch {
    return false
  }
}
