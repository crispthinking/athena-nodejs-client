/**
 * Streaming (pipeline) mode for the benchmark harness.
 *
 * The default phased run prepares every image up front and only then measures
 * the RPC. That is the right shape for attributing *server* time — local CPU is
 * deliberately kept outside the measured window — but it is structurally blind
 * to the interaction a throughput-driven consumer actually hits, where
 * preparation and the RPC run concurrently in the same process and compete for
 * the same cores.
 *
 * This mode reproduces that consumer: a fixed pool of workers, each looping
 * read -> prepare -> RPC -> optional delay, pulling the next image only once it
 * has finished the previous one. Preparation is CPU-bound (a sharp decode plus
 * a synchronous OpenCV resize on the main thread), so the number of items being
 * prepared at the same instant is the variable that decides per-image prepare
 * cost. It is therefore sampled and reported rather than assumed: without it a
 * change in prepare latency cannot be attributed to contention at all.
 */

import { monitorEventLoopDelay, performance } from 'perf_hooks';
import { setTimeout as delay } from 'timers/promises';

import { summarise, type Summary } from './stats.js';

/** Distribution of an observed in-flight count over the life of a run. */
export interface ConcurrencySummary {
  samples: number;
  mean: number;
  p50: number;
  p90: number;
  max: number;
}

/** Event loop delay over the run, in milliseconds. */
export interface EventLoopDelay {
  mean: number;
  p50: number;
  p99: number;
  max: number;
}

/**
 * Inputs to a streaming run.
 *
 * `readAndPrepare` and `classify` are supplied by the caller so this module
 * stays free of SDK and gRPC imports; the timing, the in-flight accounting and
 * the delay injection all live here.
 */
export interface StreamingPhaseOptions<TInput> {
  /** Corpus to cycle through; workers pull from it round-robin. */
  imagePaths: string[];
  /** Total items to push through the pipeline. */
  items: number;
  /** Fixed worker count — the degree of parallelism under test. */
  dop: number;
  /** Extra delay charged to each item after its RPC returns. */
  extraDelayMs: number;
  /** How often to sample the in-flight counters. */
  sampleIntervalMs: number;
  /**
   * Reads one image from disk and prepares it for classification, reporting
   * how much of that was the disk read so the CPU share can be separated.
   */
  readAndPrepare: (
    path: string,
  ) => Promise<{ input: TInput; bytes: number; readMs: number }>;
  /** Issues the classify RPC for a prepared input. */
  classify: (input: TInput, index: number) => Promise<void>;
  /** Maps a thrown value to a stable error code for the error tally. */
  errorCodeName: (error: unknown) => string;
}

/** Everything a streaming run measured, ready to print or serialise. */
export interface StreamingPhaseResult {
  dop: number;
  items: number;
  completed: number;
  succeeded: number;
  extraDelayMs: number;
  wallMs: number;
  throughputPerSec: number;
  summaries: {
    read: Summary;
    prepare: Summary;
    rpc: Summary;
    rpcAll: Summary;
    delay: Summary;
    total: Summary;
  };
  payloadBytes: Summary;
  prepareConcurrency: ConcurrencySummary;
  rpcConcurrency: ConcurrencySummary;
  eventLoopDelayMs: EventLoopDelay;
  errors: Record<string, number>;
}

/** Summarises a series of sampled in-flight counts. */
function summariseConcurrency(samples: number[]): ConcurrencySummary {
  const summary = summarise(samples);
  return {
    samples: summary.count,
    mean: summary.mean,
    p50: summary.p50,
    p90: summary.p90,
    max: summary.max,
  };
}

/**
 * Runs a fixed pool of workers through the corpus, timing each stage of every
 * item separately.
 *
 * The injected delay is charged *inside* the item's total, because it stands in
 * for a genuinely slower server: the old stack really did hold the caller for
 * that long, and the point of the experiment is what the rest of the pipeline
 * does while a worker is parked there.
 *
 * @param options Corpus, pool size, delay and the prepare/classify callbacks.
 * @returns Per-stage percentiles, throughput, observed prepare concurrency and
 *   event loop delay for the run.
 */
export async function runStreamingPhase<TInput>(
  options: StreamingPhaseOptions<TInput>,
): Promise<StreamingPhaseResult> {
  const readSamples: number[] = [];
  const prepareSamples: number[] = [];
  const rpcSamples: number[] = [];
  const rpcAllSamples: number[] = [];
  const delaySamples: number[] = [];
  const totalSamples: number[] = [];
  const payloadSamples: number[] = [];
  const errors: Record<string, number> = {};

  let inFlightPrepare = 0;
  let inFlightRpc = 0;
  const prepareConcurrencySamples: number[] = [];
  const rpcConcurrencySamples: number[] = [];

  let completed = 0;
  let succeeded = 0;
  let next = 0;

  // resolution 10ms: fine enough to see a blocked loop, coarse enough that the
  // histogram itself is not a meaningful part of the load.
  const loopDelay = monitorEventLoopDelay({ resolution: 10 });
  loopDelay.enable();

  const sampler = setInterval(() => {
    prepareConcurrencySamples.push(inFlightPrepare);
    rpcConcurrencySamples.push(inFlightRpc);
  }, options.sampleIntervalMs);

  const startedAt = performance.now();

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= options.items) {
        return;
      }

      const path = options.imagePaths[
        index % options.imagePaths.length
      ] as string;

      const itemStart = performance.now();

      // The read is inside the prepare window and inside the in-flight count:
      // a real pipeline pulls bytes off disk as part of getting an image
      // ready. It is reported separately as well, because it shares libuv's
      // thread pool with sharp's decode and so stops being a rounding error
      // exactly when the machine is saturated.
      inFlightPrepare += 1;
      let prepared: { input: TInput; bytes: number; readMs: number };
      try {
        prepared = await options.readAndPrepare(path);
      } catch (error) {
        inFlightPrepare -= 1;
        const code = options.errorCodeName(error);
        errors[`prepare:${code}`] = (errors[`prepare:${code}`] ?? 0) + 1;
        completed += 1;
        continue;
      }
      inFlightPrepare -= 1;

      const prepareEnd = performance.now();
      const prepareMs = prepareEnd - itemStart;

      inFlightRpc += 1;
      let errorCode: string | undefined;
      try {
        await options.classify(prepared.input, index);
      } catch (error) {
        errorCode = options.errorCodeName(error);
        errors[`classifySingle:${errorCode}`] =
          (errors[`classifySingle:${errorCode}`] ?? 0) + 1;
      } finally {
        inFlightRpc -= 1;
      }
      const rpcEnd = performance.now();

      if (options.extraDelayMs > 0) {
        await delay(options.extraDelayMs);
      }
      const delayEnd = performance.now();

      completed += 1;
      // `rpc` is the like-for-like number to put next to the server's own
      // histogram, so it counts successes only. `rpcAll` includes failures
      // because a worker is parked for the whole call either way, and that
      // park is what frees the CPU for the other workers.
      rpcAllSamples.push(rpcEnd - prepareEnd);
      if (errorCode === undefined) {
        succeeded += 1;
        rpcSamples.push(rpcEnd - prepareEnd);
        payloadSamples.push(prepared.bytes);
      }
      readSamples.push(prepared.readMs);
      prepareSamples.push(prepareMs);
      delaySamples.push(delayEnd - rpcEnd);
      totalSamples.push(delayEnd - itemStart);
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(options.dop, 1) }, () => worker()),
  );

  const wallMs = performance.now() - startedAt;
  clearInterval(sampler);
  loopDelay.disable();

  return {
    dop: options.dop,
    items: options.items,
    completed,
    succeeded,
    extraDelayMs: options.extraDelayMs,
    wallMs,
    throughputPerSec: wallMs > 0 ? completed / (wallMs / 1000) : Number.NaN,
    summaries: {
      read: summarise(readSamples),
      prepare: summarise(prepareSamples),
      rpc: summarise(rpcSamples),
      rpcAll: summarise(rpcAllSamples),
      delay: summarise(delaySamples),
      total: summarise(totalSamples),
    },
    payloadBytes: summarise(payloadSamples),
    prepareConcurrency: summariseConcurrency(prepareConcurrencySamples),
    rpcConcurrency: summariseConcurrency(rpcConcurrencySamples),
    eventLoopDelayMs: {
      // The histogram counts in nanoseconds.
      mean: loopDelay.mean / 1e6,
      p50: loopDelay.percentile(50) / 1e6,
      p99: loopDelay.percentile(99) / 1e6,
      max: loopDelay.max / 1e6,
    },
    errors,
  };
}
