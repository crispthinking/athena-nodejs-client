/**
 * OpenTelemetry setup, loaded before the application via `--import`.
 *
 * Nothing here is Athena-specific beyond the service name: the SDK emits
 * through the plain `@opentelemetry/api` global, so whatever provider is
 * registered first receives its spans and metrics. If you already run
 * OpenTelemetry, you do not need this file at all -- your existing setup will
 * pick the SDK up automatically.
 *
 * Set OTEL_EXPORTER_OTLP_ENDPOINT to send to a collector. With no endpoint
 * set, everything is printed to the console so the shape of the data is
 * visible without standing up any infrastructure.
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  ConsoleSpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import {
  ConsoleMetricExporter,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'athena-otel-sample',
  }),
  spanProcessors: [
    new SimpleSpanProcessor(
      endpoint ? new OTLPTraceExporter() : new ConsoleSpanExporter(),
    ),
  ],
  metricReader: new PeriodicExportingMetricReader({
    exporter: endpoint ? new OTLPMetricExporter() : new ConsoleMetricExporter(),
    exportIntervalMillis: Number(process.env.OTEL_METRIC_INTERVAL_MS ?? 15000),
  }),
});

sdk.start();

process.on('SIGTERM', () => void sdk.shutdown());
process.on('beforeExit', () => void sdk.shutdown());
