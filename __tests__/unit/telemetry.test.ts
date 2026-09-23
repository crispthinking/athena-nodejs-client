import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ROOT_CONTEXT,
  context,
  metrics,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';

const telemetryState = vi.hoisted(() => {
  const histogram = {
    disable: vi.fn(),
    enable: vi.fn(),
    max: 20e6,
    mean: 12e6,
    percentile: vi.fn((value: number) => (value === 50 ? 5e6 : 15e6)),
    reset: vi.fn(),
  };

  return {
    histogram,
    monitorEventLoopDelay: vi.fn(() => histogram),
  };
});

vi.mock('node:perf_hooks', () => ({
  monitorEventLoopDelay: telemetryState.monitorEventLoopDelay,
}));

type MockSpan = {
  attributes: Record<string, unknown>;
  ended: boolean;
  exceptions: unknown[];
  kind: SpanKind;
  name: string;
  parent?: MockSpan;
  status?: { code: SpanStatusCode; message?: string };
  end: () => void;
  recordException: (error: unknown) => void;
  setAttribute: (key: string, value: unknown) => MockSpan;
  setStatus: (status: { code: SpanStatusCode; message?: string }) => void;
};

type MetricRecord = {
  attributes?: Record<string, unknown>;
  name: string;
  value: number;
};

describe('telemetry', () => {
  let metricRecords: MetricRecord[] = [];
  let observableGaugeCallbacks: ((result: { observe: (value: number, attributes?: Record<string, unknown>) => void }) => void)[] = [];
  let spans: MockSpan[] = [];
  let providerMetricRecords: MetricRecord[] = [];

  function createStandaloneSpan(name: string): MockSpan {
    const span: MockSpan = {
      name,
      kind: SpanKind.CLIENT,
      attributes: {},
      exceptions: [],
      ended: false,
      end: () => undefined,
      recordException: () => undefined,
      setAttribute(key: string, value: unknown) {
        span.attributes[key] = value;
        return span;
      },
      setStatus: () => undefined,
    };
    return span;
  }

  async function loadTelemetryModule() {
    vi.resetModules();
    telemetryState.monitorEventLoopDelay.mockClear();
    telemetryState.histogram.enable.mockClear();
    telemetryState.histogram.disable.mockClear();
    telemetryState.histogram.percentile.mockClear();
    telemetryState.histogram.reset.mockClear();

    metricRecords = [];
    providerMetricRecords = [];
    observableGaugeCallbacks = [];
    spans = [];

    trace.disable();
    metrics.disable();
    context.disable();

    let activeContext = ROOT_CONTEXT;

    trace.setGlobalTracerProvider({
      getTracer() {
        return {
          startSpan(name: string, options?: { attributes?: Record<string, unknown>; kind?: SpanKind }) {
            const span: MockSpan = {
              name,
              kind: options?.kind ?? SpanKind.INTERNAL,
              attributes: { ...(options?.attributes ?? {}) },
              exceptions: [],
              parent: trace.getSpan(context.active()) as
                | unknown
                | MockSpan
                | undefined,
              ended: false,
              end() {
                span.ended = true;
              },
              recordException(error: unknown) {
                span.exceptions.push(error);
              },
              setAttribute(key: string, value: unknown) {
                span.attributes[key] = value;
                return span;
              },
              setStatus(status: { code: SpanStatusCode; message?: string }) {
                span.status = status;
              },
            };
            spans.push(span);
            return span as never;
          },
        } as never;
      },
    } as never);

    metrics.setGlobalMeterProvider({
      getMeter() {
        return {
          createHistogram(name: string) {
            return {
              record(value: number, attributes?: Record<string, unknown>) {
                providerMetricRecords.push({ name, value, attributes });
              },
            };
          },
          createObservableGauge() {
            return {
              addCallback(
                callback: (result: {
                  observe: (
                    value: number,
                    attributes?: Record<string, unknown>,
                  ) => void;
                }) => void,
              ) {
                observableGaugeCallbacks.push(callback);
              },
            };
          },
        } as never;
      },
    } as never);

    context.setGlobalContextManager({
      active() {
        return activeContext;
      },
      with(contextValue, fn, thisArg, ...args) {
        const previousContext = activeContext;
        activeContext = contextValue;
        const restore = () => {
          activeContext = previousContext;
        };
        try {
          const result = fn.call(thisArg, ...args);
          if (
            result !== null &&
            typeof result === 'object' &&
            'finally' in result &&
            typeof result.finally === 'function'
          ) {
            return result.finally(restore);
          }
          restore();
          return result;
        } catch (error) {
          restore();
          throw error;
        }
      },
      bind(target) {
        return target;
      },
      enable() {
        return this;
      },
      disable() {
        activeContext = ROOT_CONTEXT;
        return this;
      },
    } as never);

    return import('../../src/telemetry.js');
  }

  beforeEach(() => {
    trace.disable();
    metrics.disable();
    context.disable();
  });

  afterEach(() => {
    trace.disable();
    metrics.disable();
    context.disable();
  });

  it('creates nested spans with the active parent and requested kinds', async () => {
    const telemetry = await loadTelemetryModule();

    await telemetry.withSpan(
      'outer',
      SpanKind.CLIENT,
      { outer: true },
      async (outerSpan) => {
        expect(trace.getSpan(context.active())).toBe(outerSpan);

        await telemetry.withSpan(
          'inner',
          SpanKind.INTERNAL,
          { inner: true },
          async (innerSpan) => {
            expect(trace.getSpan(context.active())).toBe(innerSpan);
            return 'ok';
          },
        );

        expect(trace.getSpan(context.active())).toBe(outerSpan);
        return 'done';
      },
    );

    expect(spans).toHaveLength(2);
    expect(spans[0]).toMatchObject({
      name: 'outer',
      kind: SpanKind.CLIENT,
      attributes: { outer: true },
      ended: true,
    });
    expect(spans[1]).toMatchObject({
      name: 'inner',
      kind: SpanKind.INTERNAL,
      attributes: { inner: true },
      parent: spans[0],
      ended: true,
    });
  });

  it('records span errors and gRPC status codes', async () => {
    const telemetry = await loadTelemetryModule();
    const error = Object.assign(new Error('classification failed'), {
      code: 14,
    });

    await expect(
      telemetry.withSpan(
        'rpc',
        SpanKind.CLIENT,
        { request: 'test' },
        async () => {
          throw error;
        },
      ),
    ).rejects.toThrow('classification failed');

    expect(spans).toHaveLength(1);
    expect(spans[0].exceptions).toEqual([error]);
    expect(spans[0].attributes[telemetry.AthenaAttributes.grpcStatus]).toBe(14);
    expect(spans[0].status).toEqual({
      code: SpanStatusCode.ERROR,
      message: 'classification failed',
    });
    expect(spans[0].ended).toBe(true);
  });

  it('records telemetry metrics for both success and failure paths', async () => {
    const telemetry = await loadTelemetryModule();

    telemetry.recordClassifyDuration(42, { outcome: 'success' });
    telemetry.recordPrepare(11, 256, { outcome: 'success' });
    telemetry.recordAuth(5, { outcome: 'failure' });
    telemetry.recordRpc(7, { outcome: 'failure' });

    expect(providerMetricRecords).toEqual([
      {
        name: 'athena.client.classify_single.duration',
        value: 42,
        attributes: { outcome: 'success' },
      },
      {
        name: 'athena.client.prepare.duration',
        value: 11,
        attributes: { outcome: 'success' },
      },
      {
        name: 'athena.client.request.payload_size',
        value: 256,
        attributes: { outcome: 'success' },
      },
      {
        name: 'athena.client.auth.duration',
        value: 5,
        attributes: { outcome: 'failure' },
      },
      {
        name: 'athena.client.rpc.duration',
        value: 7,
        attributes: { outcome: 'failure' },
      },
    ]);
  });

  it('starts emitting metrics after a meter provider is registered later', async () => {
    vi.resetModules();
    trace.disable();
    metrics.disable();
    context.disable();

    const telemetry = await import('../../src/telemetry.js');
    telemetry.recordClassifyDuration(1, { phase: 'before-provider' });

    metricRecords = [];
    metrics.setGlobalMeterProvider({
      getMeter() {
        return {
          createHistogram(name: string) {
            return {
              record(value: number, attributes?: Record<string, unknown>) {
                metricRecords.push({ name, value, attributes });
              },
            };
          },
          createObservableGauge() {
            return {
              addCallback: () => undefined,
            };
          },
        } as never;
      },
    } as never);

    telemetry.recordClassifyDuration(2, { phase: 'after-provider' });

    expect(metricRecords).toEqual([
      {
        name: 'athena.client.classify_single.duration',
        value: 2,
        attributes: { phase: 'after-provider' },
      },
    ]);
  });

  it('registers the event-loop gauge after a meter provider is registered later', async () => {
    vi.resetModules();
    trace.disable();
    metrics.disable();
    context.disable();
    telemetryState.monitorEventLoopDelay.mockClear();

    const telemetry = await import('../../src/telemetry.js');
    telemetry.enableEventLoopMonitoring();

    expect(telemetryState.monitorEventLoopDelay).toHaveBeenCalledTimes(1);
    expect(observableGaugeCallbacks).toHaveLength(0);

    metrics.setGlobalMeterProvider({
      getMeter() {
        return {
          createHistogram() {
            return {
              record: () => undefined,
            };
          },
          createObservableGauge() {
            return {
              addCallback(
                callback: (result: {
                  observe: (
                    value: number,
                    attributes?: Record<string, unknown>,
                  ) => void;
                }) => void,
              ) {
                observableGaugeCallbacks.push(callback);
              },
            };
          },
        } as never;
      },
    } as never);

    telemetry.enableEventLoopMonitoring();

    expect(telemetryState.monitorEventLoopDelay).toHaveBeenCalledTimes(1);
    expect(observableGaugeCallbacks).toHaveLength(1);
  });

  it('enables and disables event-loop monitoring', async () => {
    const telemetry = await loadTelemetryModule();

    telemetry.enableEventLoopMonitoring();

    expect(telemetryState.monitorEventLoopDelay).toHaveBeenCalledWith({
      resolution: 10,
    });
    expect(telemetryState.histogram.enable).toHaveBeenCalledTimes(1);
    expect(observableGaugeCallbacks).toHaveLength(1);

    const observed: {
      attributes?: Record<string, unknown>;
      value: number;
    }[] = [];
    observableGaugeCallbacks[0]!({
      observe(value: number, attributes?: Record<string, unknown>) {
        observed.push({ value, attributes });
      },
    });

    expect(observed).toEqual([
      { value: 12, attributes: { 'athena.statistic': 'mean' } },
      { value: 5, attributes: { 'athena.statistic': 'p50' } },
      { value: 15, attributes: { 'athena.statistic': 'p99' } },
      { value: 20, attributes: { 'athena.statistic': 'max' } },
    ]);

    const activeSpan = spans[0] ?? createStandaloneSpan('rpc');
    telemetry.annotateEventLoopDelay(activeSpan as never);
    expect(activeSpan.attributes[telemetry.AthenaAttributes.eventLoopMaxDelay]).toBe(
      20,
    );
    expect(telemetryState.histogram.reset).toHaveBeenCalledTimes(1);

    telemetry.disableEventLoopMonitoring();
    expect(telemetryState.histogram.disable).toHaveBeenCalledTimes(1);

    const disabledSpan = createStandaloneSpan('disabled');
    telemetry.annotateEventLoopDelay(disabledSpan as never);
    expect(disabledSpan.attributes).toEqual({});

    telemetry.enableEventLoopMonitoring();
    expect(telemetryState.monitorEventLoopDelay).toHaveBeenCalledTimes(2);
    expect(observableGaugeCallbacks).toHaveLength(1);
  });
});
