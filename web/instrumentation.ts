/**
 * OpenTelemetry wiring for the API server.
 *
 * Loaded with `--import` before anything else so the auto-instrumentations can
 * patch http, express and the SQLite driver before those modules are required.
 * Importing this from inside server/index.ts would be too late for some of
 * them.
 *
 * Aspire injects OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_PROTOCOL,
 * OTEL_EXPORTER_OTLP_HEADERS and OTEL_SERVICE_NAME into every resource it
 * manages, so there is nothing to configure here beyond obeying them. Run the
 * server outside Aspire and no endpoint is set, in which case this stays
 * dormant rather than failing or spraying connection errors.
 */

import { NodeSDK, api, core, tracing } from '@opentelemetry/sdk-node'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { PeriodicExportingMetricReader, type PushMetricExporter } from '@opentelemetry/sdk-metrics'

import { isLoopbackHttps, otlpProtocol, type OtlpProtocol } from './server/otel'

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT

/**
 * Say what the far end did with the first batch of spans, then stay quiet.
 *
 * The point of exporting at all is to be able to say "the request I just made
 * produced these spans". An OTLP exporter that cannot reach its collector does
 * not crash and does not complain above info level: it retries until the batch
 * times out, drops it, and the process carries on looking healthy. That
 * silence is what let a broken pipeline pass for a working one, so the first
 * answer from the far end is stated out loud whichever way it goes.
 */
function announceFirstExport(
  exporter: tracing.SpanExporter,
  describe: string,
): tracing.SpanExporter {
  let announced = false
  const report = (result: core.ExportResult) => {
    if (announced) return
    announced = true
    if (result.code === core.ExportResultCode.SUCCESS) {
      console.log(`[otel] ${describe} accepted the first batch of spans`)
    } else {
      console.error(
        `[otel] ${describe} REJECTED the first batch of spans, telemetry is not arriving:`,
        result.error?.message ?? result.error,
      )
    }
  }

  return {
    export: (spans, resultCallback) =>
      exporter.export(spans, (result) => {
        report(result)
        resultCallback(result)
      }),
    shutdown: () => exporter.shutdown(),
    forceFlush: () => exporter.forceFlush?.() ?? Promise.resolve(),
  }
}

/** OTEL_LOG_LEVEL, the standard name for how much the SDK should say. Errors only when unset. */
function diagLevel(requested: string | undefined): api.DiagLogLevel {
  const levels: Record<string, api.DiagLogLevel> = {
    none: api.DiagLogLevel.NONE,
    error: api.DiagLogLevel.ERROR,
    warn: api.DiagLogLevel.WARN,
    info: api.DiagLogLevel.INFO,
    debug: api.DiagLogLevel.DEBUG,
    verbose: api.DiagLogLevel.VERBOSE,
    all: api.DiagLogLevel.ALL,
  }
  return levels[requested?.trim().toLowerCase() ?? ''] ?? api.DiagLogLevel.ERROR
}

/** The protocol asked for, or http/protobuf with a complaint if it is one we cannot speak. */
function chosenProtocol(signal: 'TRACES' | 'METRICS'): OtlpProtocol {
  const choice = otlpProtocol(process.env, signal)
  if ('protocol' in choice) return choice.protocol
  console.error(
    `[otel] ${signal} collector asked for "${choice.unsupported}", which this server cannot speak. Falling back to http/protobuf, which it may well refuse.`,
  )
  return 'http/protobuf'
}

if (!endpoint) {
  // Not under Aspire. Do nothing at all: a dev server started by hand should
  // not spend its time retrying an exporter that was never going to connect.
  console.log('[otel] no OTEL_EXPORTER_OTLP_ENDPOINT, telemetry disabled')
} else {
  // Errors only by default. A failed export is reported at info level, which
  // is far too low to leave on, so announceFirstExport covers that case
  // instead. This catches the rest: a malformed endpoint, a header that will
  // not parse, an instrumentation that throws while loading.
  //
  // OTEL_LOG_LEVEL raises it, which is the standard variable and the thing to
  // reach for when telemetry is misbehaving. `OTEL_LOG_LEVEL=debug` narrates
  // every export attempt.
  api.diag.setLogger(
    {
      error: (...args: unknown[]) => console.error('[otel]', ...args),
      warn: (...args: unknown[]) => console.warn('[otel]', ...args),
      info: (...args: unknown[]) => console.log('[otel]', ...args),
      debug: (...args: unknown[]) => console.log('[otel]', ...args),
      verbose: (...args: unknown[]) => console.log('[otel]', ...args),
    },
    diagLevel(process.env.OTEL_LOG_LEVEL),
  )

  const tracesProtocol = chosenProtocol('TRACES')
  const metricsProtocol = chosenProtocol('METRICS')

  // The Aspire dashboard serves OTLP over HTTPS with a local development
  // certificate that Node will not trust.
  //
  // Relaxing verification stays scoped to these two exporters: an agent of
  // their own on the HTTP transport, channel credentials of their own on the
  // gRPC one. Setting NODE_TLS_REJECT_UNAUTHORIZED would apply process-wide
  // and per-connection, so the server's real outbound calls to openlibrary.org
  // and googleapis.com would also stop verifying certificates. That is a
  // genuine downgrade of production behaviour to make a local dashboard work.
  const insecureLocal = isLoopbackHttps(endpoint)
  const httpAgentOptions = insecureLocal ? { rejectUnauthorized: false } : undefined

  // Constructed before any exporter, because building the instrumentations is
  // what installs the require hooks that patch http, express and the rest.
  // The gRPC exporter drags in @grpc/grpc-js, which reaches for node's own
  // modules on the way in, and whatever loads ahead of the hooks loads
  // unpatched.
  const instrumentations = getNodeAutoInstrumentations({
    // Noise. Every file read the OCR pipeline does would become a span.
    '@opentelemetry/instrumentation-fs': { enabled: false },
  })

  /**
   * Channel credentials for the gRPC transport.
   *
   * `createSsl` with no root certificate verifies against node's bundled
   * roots, which a development certificate can never chain to. Undefined off
   * loopback, which leaves the exporter on its ordinary verified path.
   */
  const grpcCredentials = async () => {
    if (!insecureLocal) return undefined
    const { credentials } = await import('@grpc/grpc-js')
    return credentials.createSsl(null, null, null, { rejectUnauthorized: false })
  }

  let traceExporter: tracing.SpanExporter
  if (tracesProtocol === 'grpc') {
    const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-grpc')
    traceExporter = new OTLPTraceExporter({ credentials: await grpcCredentials() })
  } else {
    const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-proto')
    traceExporter = new OTLPTraceExporter({ httpAgentOptions })
  }

  let metricExporter: PushMetricExporter
  if (metricsProtocol === 'grpc') {
    const { OTLPMetricExporter } = await import('@opentelemetry/exporter-metrics-otlp-grpc')
    metricExporter = new OTLPMetricExporter({ credentials: await grpcCredentials() })
  } else {
    const { OTLPMetricExporter } = await import('@opentelemetry/exporter-metrics-otlp-proto')
    metricExporter = new OTLPMetricExporter({ httpAgentOptions })
  }

  const sdk = new NodeSDK({
    traceExporter: announceFirstExport(traceExporter, `${endpoint} over ${tracesProtocol}`),
    metricReaders: [new PeriodicExportingMetricReader({ exporter: metricExporter })],
    instrumentations,
  })

  sdk.start()
  console.log(`[otel] exporting to ${endpoint} over ${tracesProtocol}`)

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
