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

if (!endpoint) {
  // Not under Aspire. Do nothing at all: a dev server started by hand should
  // not spend its time retrying an exporter that was never going to connect.
  console.log('[otel] no OTEL_EXPORTER_OTLP_ENDPOINT, telemetry disabled')
} else {
  // The Aspire dashboard serves OTLP over HTTPS with a local development
  // certificate, which Node rejects by default. Only relax that for a
  // loopback endpoint, so this can never silently weaken TLS against a real
  // remote collector.
  const isLoopback = /^https:\/\/(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(endpoint)
  if (isLoopback && !process.env.NODE_TLS_REJECT_UNAUTHORIZED) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  }

  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter(),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
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

  const shutdown = () => {
    sdk
      .shutdown()
      .catch((err: unknown) => console.error('[otel] shutdown failed', err))
      .finally(() => process.exit(0))
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}
