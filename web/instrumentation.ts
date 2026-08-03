/**
 * OpenTelemetry wiring for the API server.
 *
 * Loaded with `--import` before anything else so the auto-instrumentations can
 * patch http, express and the SQLite driver before those modules are required.
 * Importing this from inside server/index.ts would be too late for some of
 * them.
 *
 * Aspire injects OTEL_EXPORTER_OTLP_ENDPOINT and OTEL_SERVICE_NAME into every
 * resource it manages, so there is nothing to configure here. Run the server
 * outside Aspire and no endpoint is set, in which case this stays dormant
 * rather than failing or spraying connection errors.
 */

import { NodeSDK } from '@opentelemetry/sdk-node'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto'
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT

/**
 * True only when the endpoint's actual host is loopback.
 *
 * Parsed rather than pattern matched. A regex over the whole URL is fooled by
 * userinfo: `https://127.0.0.1:80@evil.example/` reads as local and is not.
 * URL.hostname is the host the request will really go to.
 */
function isLoopback(url: string): boolean {
  try {
    const { hostname, protocol } = new URL(url)
    if (protocol !== 'https:') return false
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  } catch {
    return false
  }
}

if (!endpoint) {
  // Not under Aspire. Do nothing at all: a dev server started by hand should
  // not spend its time retrying an exporter that was never going to connect.
  console.log('[otel] no OTEL_EXPORTER_OTLP_ENDPOINT, telemetry disabled')
} else {
  // The Aspire dashboard serves OTLP over HTTPS with a local development
  // certificate that Node will not trust.
  //
  // Relaxing verification is scoped to these two exporters through their own
  // agent. Setting NODE_TLS_REJECT_UNAUTHORIZED would apply process-wide and
  // per-connection, so the server's real outbound calls to openlibrary.org and
  // googleapis.com would also stop verifying certificates. That is a genuine
  // downgrade of production behaviour to make a local dashboard work.
  const insecureLocal = isLoopback(endpoint)
  const agent = insecureLocal ? { rejectUnauthorized: false } : undefined

  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter({ httpAgentOptions: agent }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ httpAgentOptions: agent }),
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Noise. Every file read the OCR pipeline does would become a span.
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  })

  sdk.start()
  console.log(`[otel] exporting to ${endpoint}`)

  // Flush pending spans on the way out, but preserve the exit code. Forcing
  // process.exit(0) here would turn a crashed server into a clean one and hide
  // the failure from Aspire.
  const shutdown = (signal: NodeJS.Signals) => {
    sdk
      .shutdown()
      .catch((err: unknown) => console.error('[otel] shutdown failed', err))
      .finally(() => {
        process.removeAllListeners(signal)
        process.kill(process.pid, signal)
      })
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
}
