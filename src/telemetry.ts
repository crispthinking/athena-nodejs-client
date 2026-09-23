/**
 * OpenTelemetry instrumentation for the Athena client.
 *
 * The SDK depends only on `@opentelemetry/api`, which is inert until the host
 * application registers a provider. An integrator who does nothing pays for a
 * handful of no-op calls; one who already runs OpenTelemetry gets the spans and
 * metrics below with no configuration beyond their existing setup.
 *
 * The decomposition exists to answer one question: when a classification is
 * slow, was it our image preparation, our authentication, the wire, or the
 * caller's own event loop? Those four are separately reported because from
 * outside the process they are indistinguishable — a blocked event loop makes
 * a healthy server look slow, since the response sits unread in the socket
 * while the timer around the call keeps running.
 */

import {
  context,
  metrics,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Histogram,
  type Meter,
  type MeterProvider,
  type Span,
  type Tracer,
} from '@opentelemetry/api';
import {
  monitorEventLoopDelay,
  performance,
  type EventLoopUtilization,
  type IntervalHistogram,
} from 'node:perf_hooks';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const packageJson = require_('../package.json') as { version?: string };

/** Instrumentation scope name, as it appears on every span and metric. */
export const INSTRUMENTATION_SCOPE = '@crispthinking/athena-classifier-sdk';

/** Instrumentation scope version, taken from the installed package. */
export const INSTRUMENTATION_VERSION = packageJson.version ?? 'unknown';

/**
 * Attribute keys set by this SDK.
 *
 * Names outside the `athena.*` prefix follow OpenTelemetry semantic
 * conventions so they line up with whatever else the host already collects.
 */
export const AthenaAttributes = {
  /** Deployment the request was classified against. */
  deploymentId: 'athena.deployment_id',
  /** Affiliate the request was attributed to. */
  affiliate: 'athena.affiliate',
  /** Caller-supplied or generated correlation id, for joining to our logs. */
  correlationId: 'athena.correlation_id',
  /** Wire encoding: `uncompressed` or `brotli`. */
  encoding: 'athena.request.encoding',
  /** Whether the SDK resized the image rather than the caller. */
  resize: 'athena.request.resize',
  /** Bytes handed to the SDK before any decoding. */
  sourceBytes: 'athena.image.source_bytes',
  /** Source image width in pixels, before the SDK resized it. */
  sourceWidth: 'athena.image.source_width',
  /** Source image height in pixels, before the SDK resized it. */
  sourceHeight: 'athena.image.source_height',
  /** Bytes actually sent in the request, after resize and any compression. */
  payloadBytes: 'athena.request.payload_bytes',
  /**
   * Fraction of this RPC's wall time, 0 to 1, that the event loop spent busy
   * rather than waiting for I/O.
   *
   * Measured per call, from a snapshot taken when the RPC starts, so
   * concurrent calls each get their own window. A healthy call spends almost
   * all of its time idle, waiting on the network; a value near 1 means the
   * loop was occupied for most of the call and could not have read the
   * response promptly even if it had arrived.
   */
  eventLoopUtilization: 'athena.event_loop.utilization',
  /**
   * Milliseconds the event loop was busy during this RPC.
   *
   * The same measurement as the utilization, in the units of the RPC duration
   * it sits beside. If a 4000 ms call shows 3800 ms busy, the service did not
   * take 4000 ms: this process was occupied for nearly all of it, so the
   * reply sat unread in the socket.
   */
  eventLoopBusy: 'athena.event_loop.busy_ms',
  /** gRPC status code name when a call fails. */
  grpcStatus: 'rpc.grpc.status_code',
  /** Target host or IP address. */
  serverAddress: 'server.address',
  /** Target port number. */
  serverPort: 'server.port',
} as const;

let tracerInstance: Tracer | undefined;

function meterProvider(): MeterProvider {
  return metrics.getMeterProvider();
}

/**
 * Returns the tracer, created on first use.
 *
 * `trace.getTracer` hands back a proxy that binds to whichever provider is
 * registered later, so caching it here is safe even if the host sets
 * OpenTelemetry up after importing the SDK.
 */
function tracer(): Tracer {
  tracerInstance ??= trace.getTracer(
    INSTRUMENTATION_SCOPE,
    INSTRUMENTATION_VERSION,
  );
  return tracerInstance;
}

/**
 * Returns the meter, created on first use.
 *
 * Unlike the tracer this is resolved lazily on every use rather than cached:
 * the metrics API has no upgrading proxy, so a meter taken before the host
 * registers its provider would stay a no-op forever.
 */
function meter(): Meter {
  return metrics.getMeter(INSTRUMENTATION_SCOPE, INSTRUMENTATION_VERSION);
}

interface Instruments {
  classifyDuration: Histogram;
  prepareDuration: Histogram;
  authDuration: Histogram;
  rpcDuration: Histogram;
  rpcLoopUtilization: Histogram;
  payloadSize: Histogram;
}

let instruments: Instruments | undefined;
let instrumentsProvider: MeterProvider | undefined;

/**
 * Returns the metric instruments, created on first use.
 *
 * Durations are milliseconds rather than the seconds OpenTelemetry usually
 * prefers, so they can be compared directly against the server-side
 * `athena.classify_single.duration` an integrator is likely to be shown when
 * they raise a latency question with us.
 */
function getInstruments(): Instruments {
  ensureEventLoopGaugeRegistered();
  const currentProvider = meterProvider();
  if (instruments !== undefined && instrumentsProvider === currentProvider) {
    return instruments;
  }

  instrumentsProvider = currentProvider;
  const currentMeter = meter();
  instruments = {
    classifyDuration: currentMeter.createHistogram(
      'athena.client.classify_single.duration',
      {
        unit: 'ms',
        description:
          'End-to-end duration of classifySingle as the caller observes it, ' +
          'covering preparation, authentication and the RPC.',
      },
    ),
    prepareDuration: currentMeter.createHistogram(
      'athena.client.prepare.duration',
      {
        unit: 'ms',
        description:
          'Time spent decoding, resizing, hashing and compressing the image ' +
          'before it goes on the wire. This is local CPU.',
      },
    ),
    authDuration: currentMeter.createHistogram('athena.client.auth.duration', {
      unit: 'ms',
      description:
        'Time spent acquiring or refreshing an access token. Zero for the ' +
        'common case of a cached, unexpired token.',
    }),
    rpcDuration: currentMeter.createHistogram('athena.client.rpc.duration', {
      unit: 'ms',
      description:
        'Duration of the gRPC call alone, excluding image preparation and ' +
        'authentication. Compare against the server-reported duration: the ' +
        'difference is network transfer plus any time the event loop was too ' +
        'busy to read the response.',
    }),
    rpcLoopUtilization: currentMeter.createHistogram(
      'athena.client.rpc.event_loop_utilization',
      {
        unit: '1',
        description:
          'Fraction of each RPC during which the calling process was busy ' +
          'rather than waiting on the network. High values mean the ' +
          'measured RPC duration is inflated by the caller, not the service.',
        advice: {
          explicitBucketBoundaries: [
            0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99,
          ],
        },
      },
    ),
    payloadSize: currentMeter.createHistogram(
      'athena.client.request.payload_size',
      {
        unit: 'By',
        description: 'Size of the request body actually sent.',
      },
    ),
  };
  return instruments;
}

/**
 * Runs `fn` inside a new span, recording any thrown error against it.
 *
 * @param name Span name.
 * @param kind Span kind.
 * @param attributes Attributes to set when the span opens.
 * @param fn Work to run; receives the span so it can add late attributes.
 * @returns Whatever `fn` resolves to.
 */
export async function withSpan<T>(
  name: string,
  kind: SpanKind,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const span = tracer().startSpan(name, { kind, attributes });
  const active = trace.setSpan(context.active(), span);
  try {
    return await context.with(active, () => fn(span));
  } catch (error) {
    recordError(span, error);
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Marks a span as failed and attaches the error.
 *
 * @param span Span to mark.
 * @param error Thrown value; a gRPC error's status code is pulled out if present.
 */
export function recordError(span: Span, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof Error) {
    span.recordException(error);
  }
  const code = (error as { code?: unknown } | undefined)?.code;
  if (typeof code === 'number' || typeof code === 'string') {
    span.setAttribute(AthenaAttributes.grpcStatus, code);
  }
  span.setStatus({ code: SpanStatusCode.ERROR, message });
}

/** Records the end-to-end classifySingle duration. */
export function recordClassifyDuration(ms: number, attrs: Attributes): void {
  getInstruments().classifyDuration.record(ms, attrs);
}

/** Records time spent preparing an image, and the resulting payload size. */
export function recordPrepare(
  ms: number,
  payloadBytes: number | undefined,
  attrs: Attributes,
): void {
  const { prepareDuration, payloadSize } = getInstruments();
  prepareDuration.record(ms, attrs);
  if (payloadBytes !== undefined) {
    payloadSize.record(payloadBytes, attrs);
  }
}

/** Records time spent acquiring or refreshing a token. */
export function recordAuth(ms: number, attrs: Attributes): void {
  getInstruments().authDuration.record(ms, attrs);
}

/** Records the duration of the gRPC call alone. */
export function recordRpc(ms: number, attrs: Attributes): void {
  getInstruments().rpcDuration.record(ms, attrs);
}

let loopHistogram: IntervalHistogram | undefined;
let loopGaugeProvider: MeterProvider | undefined;

function ensureEventLoopGaugeRegistered(): void {
  if (loopHistogram === undefined) {
    return;
  }

  const currentProvider = meterProvider();
  if (loopGaugeProvider !== currentProvider) {
    loopGaugeProvider = currentProvider;
    const gauge = meter().createObservableGauge(
      'athena.client.event_loop.delay',
      {
        unit: 'ms',
        description:
          'Event-loop delay in the calling process since the previous ' +
          'collection. A large max means at least one long stall in that ' +
          'interval; every call in flight across it was inflated by the ' +
          'stall, including ones the server answered promptly.',
      },
    );
    gauge.addCallback((result) => {
      const current = loopHistogram;
      if (current === undefined) {
        return;
      }
      result.observe(current.mean / 1e6, { 'athena.statistic': 'mean' });
      result.observe(current.percentile(50) / 1e6, {
        'athena.statistic': 'p50',
      });
      result.observe(current.percentile(99) / 1e6, {
        'athena.statistic': 'p99',
      });
      result.observe(current.max / 1e6, { 'athena.statistic': 'max' });
      // Reset here and nowhere else. The collection callback is the only
      // reader of this histogram, so each export covers exactly the interval
      // since the last one. Without it every statistic is a process-lifetime
      // value, and a single stall at startup pins `max` forever.
      current.reset();
    });
  }
}

/**
 * Starts watching event-loop delay, and publishes it as a gauge.
 *
 * Node reports this from the timer thread, so it keeps measuring while
 * JavaScript is blocked — which is the entire point, since a blocked loop is
 * invisible to any measurement taken from inside that loop. The underlying
 * timer does not hold the event loop open, so enabling this never stops a
 * process from exiting.
 */
export function enableEventLoopMonitoring(): void {
  if (loopHistogram === undefined) {
    loopHistogram = monitorEventLoopDelay({ resolution: 10 });
    loopHistogram.enable();
  }

  ensureEventLoopGaugeRegistered();
}

/** Stops watching event-loop delay. */
export function disableEventLoopMonitoring(): void {
  loopHistogram?.disable();
  loopHistogram = undefined;
}

/**
 * Snapshots event-loop utilization at the start of an RPC.
 *
 * Deliberately independent of {@link enableEventLoopMonitoring}. That starts
 * a sampling timer, which is why it is opt-in; utilization starts nothing and
 * only reads two counters libuv already maintains, so it costs the same as
 * the no-op API calls around it and is always on.
 *
 * @returns An opaque snapshot to hand back when the RPC finishes.
 */
export function beginEventLoopWindow(): EventLoopUtilization {
  return performance.eventLoopUtilization();
}

/**
 * Records how busy the event loop was across an RPC.
 *
 * Utilization is a delta against the snapshot taken when the RPC started,
 * so each call measures its own window and concurrent calls cannot disturb
 * one another -- unlike a shared delay histogram, which one call cannot reset
 * without corrupting the reading for every other call in flight.
 *
 * @param span RPC span to annotate.
 * @param start Snapshot from {@link beginEventLoopWindow}.
 * @param attributes Metric attributes for the utilization histogram.
 */
export function endEventLoopWindow(
  span: Span,
  start: EventLoopUtilization | undefined,
  attributes: Attributes,
): void {
  if (start === undefined) {
    return;
  }
  const window = performance.eventLoopUtilization(start);
  span.setAttribute(
    AthenaAttributes.eventLoopUtilization,
    Math.round(window.utilization * 1000) / 1000,
  );
  span.setAttribute(AthenaAttributes.eventLoopBusy, Math.round(window.active));
  getInstruments().rpcLoopUtilization.record(window.utilization, attributes);
}

export function grpcTargetAttributes(target: string): Attributes {
  const normalizedTarget = target.replace(/^[a-z][a-z0-9+.-]*:\/\/\/?/iu, '');

  if (normalizedTarget.startsWith('[')) {
    const endBracket = normalizedTarget.indexOf(']');
    if (endBracket > 0) {
      const address = normalizedTarget.slice(1, endBracket);
      if (normalizedTarget.at(endBracket + 1) === ':') {
        const port = parsePort(normalizedTarget.slice(endBracket + 2));
        return buildTargetAttributes(address, port);
      }
      return buildTargetAttributes(address);
    }
  }

  const lastColon = normalizedTarget.lastIndexOf(':');
  if (lastColon > 0 && normalizedTarget.indexOf(':') === lastColon) {
    const address = normalizedTarget.slice(0, lastColon);
    const port = parsePort(normalizedTarget.slice(lastColon + 1));
    return buildTargetAttributes(address, port);
  }

  return buildTargetAttributes(normalizedTarget);
}

function buildTargetAttributes(address: string, port?: number): Attributes {
  return port === undefined
    ? { [AthenaAttributes.serverAddress]: address }
    : {
        [AthenaAttributes.serverAddress]: address,
        [AthenaAttributes.serverPort]: port,
      };
}

function parsePort(value: string): number | undefined {
  if (!/^\d+$/u.test(value)) {
    return undefined;
  }

  const port = Number.parseInt(value, 10);
  return Number.isSafeInteger(port) && port >= 0 && port <= 65_535
    ? port
    : undefined;
}

/**
 * Maps the wire encoding enum to a stable, readable attribute value.
 *
 * The numeric enum would be meaningless in a trace viewer, and would silently
 * change meaning if the protobuf ever renumbered.
 *
 * @param encoding Encoding value from the request.
 * @returns `uncompressed`, `brotli`, or `unspecified`.
 */
export function encodingName(encoding: number | undefined): string {
  switch (encoding) {
    case 1:
      return 'uncompressed';
    case 2:
      return 'brotli';
    default:
      return 'unspecified';
  }
}

export { SpanKind };
