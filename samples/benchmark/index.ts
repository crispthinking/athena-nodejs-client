#!/usr/bin/env node

/**
 * Athena gRPC benchmark harness.
 *
 * Splits a client-observed `classifySingle` call into the parts a consumer
 * actually pays for, so they can be compared against what the service reports
 * for itself:
 *
 *   prepare           local CPU — decode, resize to 448x448, hash, compress
 *   connect           DNS + TCP + TLS, on a cold connection
 *   listDeployments   a near-empty unary call on the warm channel (control)
 *   classifySingle    the real call, same channel, full payload
 *
 * `athena.classify_single.duration` in New Relic only covers time inside the
 * server's gRPC handler. Anything this harness measures outside that — local
 * preparation, handshake, and request upload — is invisible from the service
 * side, which is exactly the gap this tool exists to size.
 *
 * `--mode streaming` swaps that phased shape for a pipeline one: a fixed pool
 * of workers each read, prepare, classify and (optionally) sleep in a loop, so
 * local preparation and the RPC overlap the way they do in a real consumer.
 * That is the only mode that can show preparation and the RPC competing for
 * the same cores — see `streaming.ts`.
 *
 * Point it at an environment with `--env-file`; every other sample and the
 * functional suite read the same variables.
 */

import { createRequire } from 'module';
import { dirname, extname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';
import { readdir, readFile, writeFile } from 'fs/promises';
import { cpus, hostname } from 'os';

import { Command, Option } from 'commander';
import * as grpc from '@grpc/grpc-js';
import { discovery, clientCredentialsGrant } from 'openid-client';
// Resolved from the repo root, like @grpc/grpc-js — see the README caveats.
import sharp from 'sharp';
import {
  ClassifierServiceClient,
  computeHashesFromStream,
  HashType,
  ImageFormat,
  RequestEncoding,
  type ClassificationInput,
  type ClassificationOutput,
  type ClassifyRequest,
  type ClassifyResponse,
  type Deployment,
} from '@crispthinking/athena-classifier-sdk';

import { loadConfig, loadEnvFile, type BenchmarkConfig } from './config.js';
import { runStreamingPhase, type StreamingPhaseResult } from './streaming.js';
import { probeTransport, type TransportResult } from './transport.js';
import {
  bytes,
  ms,
  runPool,
  summarise,
  summaryHeader,
  summaryRow,
  type Summary,
} from './stats.js';

const require_ = createRequire(import.meta.url);
const moduleDir = dirname(fileURLToPath(import.meta.url));

const DEFAULT_IMAGE = resolve(moduleDir, '../hash-server/448x448.jpg');

interface CliOptions {
  envFile?: string;
  label: string;
  mode: 'phased' | 'streaming';
  dop: number;
  items: number;
  extraDelayMs: number;
  concurrencySampleMs: number;
  image: string;
  imageDir?: string;
  iterations: number;
  concurrency: number;
  warmup: number;
  connectSamples: number;
  encoding: 'uncompressed' | 'brotli';
  resize: boolean;
  keepaliveMs?: number;
  timeout: number;
  stream: boolean;
  streamDuration: number;
  json?: string;
  quiet: boolean;
}

interface CallOutcome {
  latencyMs: number;
  errorCode?: string;
}

interface ConnectivityTransition {
  atMs: number;
  from: string;
  to: string;
}

/**
 * Resolves the installed SDK version for the run record.
 *
 * Read via the resolved entry point rather than a `package.json` subpath
 * import, which the SDK's `exports` map does not expose.
 */
function sdkVersion(): string {
  try {
    const entry = require_.resolve('@crispthinking/athena-classifier-sdk');
    const pkg = require_(resolve(dirname(entry), '../package.json')) as {
      version?: string;
    };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Maps a gRPC error to a stable, readable code name. */
function errorCodeName(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'number'
  ) {
    const code = (error as { code: number }).code;
    return grpc.status[code] ?? `UNKNOWN_${code}`;
  }
  return error instanceof Error ? error.name : 'UNKNOWN';
}

/**
 * Acquires an access token via the client-credentials grant, timing OIDC
 * discovery and the token request separately.
 *
 * Both are one-off costs an integrator pays at startup rather than per call,
 * so they are reported but excluded from the call latencies.
 */
async function authenticate(config: BenchmarkConfig): Promise<{
  header: string;
  discoveryMs: number;
  tokenMs: number;
}> {
  const discoveryStart = performance.now();
  const issuer = await discovery(
    new URL(config.issuerUrl),
    config.clientId,
    config.clientSecret,
  );
  const discoveryMs = performance.now() - discoveryStart;

  const tokenStart = performance.now();
  const token = await clientCredentialsGrant(issuer, {
    audience: config.audience,
  });
  const tokenMs = performance.now() - tokenStart;

  return {
    header: `${token.token_type} ${token.access_token}`,
    discoveryMs,
    tokenMs,
  };
}

/**
 * Builds the metadata the SDK sends, so the benchmark exercises the same
 * headers a real client would.
 */
function buildMetadata(authHeader: string): grpc.Metadata {
  const metadata = new grpc.Metadata();
  metadata.set('x-client-version', `athena-nodejs-client/${sdkVersion()}`);
  metadata.set('x-client-language', 'nodejs');
  metadata.set('Authorization', authHeader);
  return metadata;
}

const IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.bmp',
  '.webp',
]);

/**
 * Collects image files from a directory tree, sorted for a stable run order.
 *
 * @throws If the directory contains no recognised image files.
 */
async function collectImages(dir: string): Promise<string[]> {
  const found: string[] = [];

  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = resolve(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        found.push(full);
      }
    }
  };

  await walk(resolve(dir));

  if (found.length === 0) {
    throw new Error(`No image files found under ${dir}`);
  }

  return found.sort();
}

/**
 * Prepares one classification input, timing the local work.
 *
 * This is everything `ClassifierSdk.classifySingle` does before it touches the
 * network: decode, optional resize to 448x448, hashing, and optional Brotli.
 */
async function prepareInput(
  image: Buffer,
  config: BenchmarkConfig,
  encoding: RequestEncoding,
  resize: boolean,
): Promise<{ input: ClassificationInput; elapsedMs: number }> {
  const start = performance.now();

  const { md5, sha1, data, format } = await computeHashesFromStream(
    image,
    encoding,
    resize
      ? ImageFormat.IMAGE_FORMAT_UNSPECIFIED
      : ImageFormat.IMAGE_FORMAT_JPEG,
    resize,
    [HashType.HASH_TYPE_MD5, HashType.HASH_TYPE_SHA1],
  );

  const hashes = [];
  if (md5 && md5.trim() !== '') {
    hashes.push({ value: md5, type: HashType.HASH_TYPE_MD5 });
  }
  if (sha1 && sha1.trim() !== '') {
    hashes.push({ value: sha1, type: HashType.HASH_TYPE_SHA1 });
  }

  const input: ClassificationInput = {
    affiliate: config.affiliate,
    correlationId: crypto.randomUUID(),
    data,
    format,
    encoding,
    hashes,
  };

  return { input, elapsedMs: performance.now() - start };
}

/** Promisified `classifySingle` on the raw generated client. */
function classifySingle(
  client: ClassifierServiceClient,
  input: ClassificationInput,
  metadata: grpc.Metadata,
  deadlineMs: number,
): Promise<ClassificationOutput> {
  return new Promise((resolvePromise, reject) => {
    client.classifySingle(
      input,
      metadata,
      { deadline: Date.now() + deadlineMs },
      (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolvePromise(response);
        }
      },
    );
  });
}

/** Promisified `listDeployments` — the near-empty control call. */
function listDeployments(
  client: ClassifierServiceClient,
  metadata: grpc.Metadata,
  deadlineMs: number,
): Promise<Deployment[]> {
  return new Promise((resolvePromise, reject) => {
    client.listDeployments(
      {},
      metadata,
      { deadline: Date.now() + deadlineMs },
      (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolvePromise(response?.deployments ?? []);
        }
      },
    );
  });
}

/**
 * Watches channel connectivity for the life of the run.
 *
 * Every departure from READY is a reconnect the client pays for and the
 * service never reports: a backend pod going away mid-run shows up here as
 * READY -> IDLE/TRANSIENT_FAILURE -> CONNECTING -> READY.
 *
 * @returns A stop function returning the transitions observed.
 */
function watchConnectivity(
  client: ClassifierServiceClient,
  startedAt: number,
): () => ConnectivityTransition[] {
  const channel = client.getChannel();
  const transitions: ConnectivityTransition[] = [];
  let stopped = false;

  const arm = (previous: grpc.connectivityState): void => {
    if (stopped) {
      return;
    }
    // Re-arm on a rolling deadline; an expiry is not a state change, so the
    // callback compares states rather than assuming one happened.
    channel.watchConnectivityState(previous, Date.now() + 30_000, () => {
      if (stopped) {
        return;
      }
      const current = channel.getConnectivityState(false);
      if (current !== previous) {
        transitions.push({
          atMs: performance.now() - startedAt,
          from: grpc.connectivityState[previous] as string,
          to: grpc.connectivityState[current] as string,
        });
      }
      arm(current);
    });
  };

  arm(channel.getConnectivityState(false));

  return () => {
    stopped = true;
    return transitions;
  };
}

/**
 * Drives the streaming `classify` path for a fixed duration, reporting how
 * long the stream took to establish, when the first response arrived, and how
 * many times it dropped.
 */
async function runStreamPhase(
  client: ClassifierServiceClient,
  metadata: grpc.Metadata,
  input: ClassificationInput,
  deploymentId: string,
  durationMs: number,
): Promise<{
  openMs: number;
  firstResponseMs: number | undefined;
  responses: number;
  drops: number;
  errors: string[];
}> {
  const start = performance.now();
  const stream = client.classify(metadata) as grpc.ClientDuplexStream<
    ClassifyRequest,
    ClassifyResponse
  >;

  let firstResponseMs: number | undefined;
  let responses = 0;
  let drops = 0;
  const errors: string[] = [];

  stream.on('data', () => {
    responses += 1;
    firstResponseMs ??= performance.now() - start;
  });
  stream.on('error', (error: Error) => {
    drops += 1;
    errors.push(error.message);
  });
  stream.on('close', () => {
    drops += 1;
  });

  const openMs = performance.now() - start;
  stream.write({ deploymentId, inputs: [input] });

  await new Promise((resolvePromise) => setTimeout(resolvePromise, durationMs));

  stream.end();
  // `close` fires on our own end() too; don't count the deliberate teardown.
  const observedDrops = Math.max(drops - 1, 0);

  return { openMs, firstResponseMs, responses, drops: observedDrops, errors };
}

/** Prints a labelled section heading. */
function heading(text: string): void {
  console.log(`\n${text}\n${'-'.repeat(text.length)}`);
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('athena-benchmark')
    .description(
      'Measures where time goes on an Athena classifySingle call: local ' +
        'preparation, TLS handshake, and the RPC itself.',
    )
    .option('-e, --env-file <path>', 'env file to load before reading config')
    .option(
      '-l, --label <name>',
      'label recorded in the JSON output',
      'unlabelled',
    )
    .addOption(
      new Option(
        '-m, --mode <mode>',
        'phased: prepare everything up front, then measure the RPC alone. ' +
          'streaming: a fixed worker pool interleaving prepare and RPC, the ' +
          'way a throughput-driven consumer does',
      )
        .choices(['phased', 'streaming'])
        .default('phased'),
    )
    .option(
      '--dop <count>',
      'streaming mode: worker pool size (degree of parallelism)',
      '8',
    )
    .option('--items <count>', 'streaming mode: items to push through', '300')
    .option(
      '--extra-delay-ms <ms>',
      'streaming mode: delay charged to each item after its RPC returns, ' +
        'standing in for a slower server',
      '0',
    )
    .option(
      '--concurrency-sample-ms <ms>',
      'streaming mode: how often to sample the in-flight prepare count',
      '50',
    )
    .option('-i, --image <path>', 'image to classify', DEFAULT_IMAGE)
    .option(
      '-d, --image-dir <path>',
      'directory of images to cycle through instead of a single image ' +
        '(searched recursively); gives a realistic payload mix',
    )
    .option('-n, --iterations <count>', 'classifySingle calls to make', '100')
    .option('-c, --concurrency <count>', 'calls in flight at once', '1')
    .option(
      '-w, --warmup <count>',
      'unmeasured calls before timing starts',
      '5',
    )
    .option('--connect-samples <count>', 'cold TLS handshakes to time', '10')
    .addOption(
      new Option('--encoding <encoding>', 'request encoding')
        .choices(['uncompressed', 'brotli'])
        .default('uncompressed'),
    )
    .option('--no-resize', 'send the image as-is (must already be 448x448)')
    .option('--keepalive-ms <ms>', 'set grpc.keepalive_time_ms on the channel')
    .option('--timeout <ms>', 'per-call deadline', '30000')
    .option('--stream', 'also exercise the streaming classify path', false)
    .option(
      '--stream-duration <ms>',
      'how long to hold the stream open',
      '30000',
    )
    .option('-j, --json <path>', 'write the full result as JSON')
    .option('-q, --quiet', 'suppress the console report', false);

  program.parse();
  const raw = program.opts();

  const options: CliOptions = {
    envFile: raw.envFile as string | undefined,
    label: raw.label as string,
    mode: raw.mode as 'phased' | 'streaming',
    dop: Number.parseInt(raw.dop as string, 10),
    items: Number.parseInt(raw.items as string, 10),
    extraDelayMs: Number.parseInt(raw.extraDelayMs as string, 10),
    concurrencySampleMs: Number.parseInt(raw.concurrencySampleMs as string, 10),
    image: raw.image as string,
    imageDir: raw.imageDir as string | undefined,
    iterations: Number.parseInt(raw.iterations as string, 10),
    concurrency: Number.parseInt(raw.concurrency as string, 10),
    warmup: Number.parseInt(raw.warmup as string, 10),
    connectSamples: Number.parseInt(raw.connectSamples as string, 10),
    encoding: raw.encoding as 'uncompressed' | 'brotli',
    resize: raw.resize as boolean,
    keepaliveMs:
      raw.keepaliveMs === undefined
        ? undefined
        : Number.parseInt(raw.keepaliveMs as string, 10),
    timeout: Number.parseInt(raw.timeout as string, 10),
    stream: raw.stream as boolean,
    streamDuration: Number.parseInt(raw.streamDuration as string, 10),
    json: raw.json as string | undefined,
    quiet: raw.quiet as boolean,
  };

  if (options.envFile !== undefined) {
    loadEnvFile(options.envFile);
  }

  const config = loadConfig();
  const encoding =
    options.encoding === 'brotli'
      ? RequestEncoding.REQUEST_ENCODING_BROTLI
      : RequestEncoding.REQUEST_ENCODING_UNCOMPRESSED;

  if (!options.quiet) {
    heading('Target');
    console.log(`  endpoint      ${config.grpcAddress}`);
    console.log(`  audience      ${config.audience}`);
    console.log(`  affiliate     ${config.affiliate}`);
    console.log(`  issuer        ${config.issuerUrl}`);
    console.log(
      options.imageDir === undefined
        ? `  image         ${options.image}`
        : `  images        ${options.imageDir}`,
    );
    console.log(
      `  encoding      ${options.encoding}${options.resize ? ', resized to 448x448' : ', not resized'}`,
    );
    console.log(`  mode          ${options.mode}`);
    if (options.mode === 'streaming') {
      console.log(
        `  pipeline      dop ${options.dop}, ${options.items} items, ` +
          `+${options.extraDelayMs} ms injected delay per item`,
      );
    }
    console.log(
      `  host cpu      ${cpus().length} logical cores, ` +
        `sharp.concurrency ${sharp.concurrency()}`,
    );
  }

  // ---- transport ---------------------------------------------------------
  const transport: TransportResult = await probeTransport(
    config.host,
    config.port,
    options.connectSamples,
    options.timeout,
  );

  // ---- auth --------------------------------------------------------------
  const auth = await authenticate(config);
  const metadata = buildMetadata(auth.header);

  // ---- prepare -----------------------------------------------------------
  const streamingMode = options.mode === 'streaming';

  const imagePaths =
    options.imageDir === undefined
      ? [resolve(options.image)]
      : await collectImages(options.imageDir);

  const prepareSamples: number[] = [];
  const inputs: ClassificationInput[] = [];

  if (streamingMode) {
    // Streaming mode prepares inside the worker loop — that overlap is the
    // whole point — so nothing is pre-prepared here. The warmup calls below
    // still need one real payload to put on the wire.
    const warmupInput = await prepareInput(
      await readFile(imagePaths[0] as string),
      config,
      encoding,
      options.resize,
    );
    inputs.push(warmupInput.input);
  } else {
    // Prepare every image once up front and cycle through the results during
    // the RPC phase. That keeps local CPU out of the measured call latency
    // while still putting a realistic mix of payloads on the wire: after the
    // resize to 448x448 raw BGR every uncompressed request is the same size,
    // but how well each one compresses depends entirely on the picture.
    for (const path of imagePaths) {
      const prepared = await prepareInput(
        await readFile(path),
        config,
        encoding,
        options.resize,
      );
      prepareSamples.push(prepared.elapsedMs);
      inputs.push(prepared.input);
    }

    // One image gives one prepare sample, which says nothing about spread;
    // take a few more. A corpus already has one per image.
    if (imagePaths.length === 1) {
      const only = await readFile(imagePaths[0] as string);
      for (let i = 1; i < Math.max(options.connectSamples, 1); i++) {
        const extra = await prepareInput(
          only,
          config,
          encoding,
          options.resize,
        );
        prepareSamples.push(extra.elapsedMs);
      }
    }
  }

  let payload = summarise(inputs.map((candidate) => candidate.data.length));

  /** Round-robins the prepared inputs, with a fresh correlation id per call. */
  const nextInput = (index: number): ClassificationInput => ({
    ...(inputs[index % inputs.length] as ClassificationInput),
    correlationId: crypto.randomUUID(),
  });

  // ---- channel -----------------------------------------------------------
  const channelOptions: Record<string, number> = {};
  if (options.keepaliveMs !== undefined) {
    channelOptions['grpc.keepalive_time_ms'] = options.keepaliveMs;
    channelOptions['grpc.keepalive_timeout_ms'] = 5000;
    channelOptions['grpc.keepalive_permit_without_calls'] = 1;
  }

  const client = new ClassifierServiceClient(
    config.grpcAddress,
    grpc.credentials.createSsl(),
    channelOptions,
  );

  const runStartedAt = performance.now();
  const stopWatching = watchConnectivity(client, runStartedAt);

  const errors: Record<string, number> = {};
  const recordError = (code: string): void => {
    errors[code] = (errors[code] ?? 0) + 1;
  };

  // ---- warmup ------------------------------------------------------------
  // Establishes the channel and gets the first-call costs (handshake, HTTP/2
  // settings exchange) out of the measured window.
  for (let i = 0; i < options.warmup; i++) {
    try {
      await classifySingle(client, nextInput(i), metadata, options.timeout);
    } catch (error) {
      recordError(`warmup:${errorCodeName(error)}`);
    }
  }

  let controlOutcomes: CallOutcome[] = [];
  let callOutcomes: CallOutcome[] = [];
  let streamingResult: StreamingPhaseResult | undefined;

  if (streamingMode) {
    // ---- streaming pipeline ----------------------------------------------
    streamingResult = await runStreamingPhase<ClassificationInput>({
      imagePaths,
      items: options.items,
      dop: options.dop,
      extraDelayMs: options.extraDelayMs,
      sampleIntervalMs: options.concurrencySampleMs,
      errorCodeName,
      readAndPrepare: async (path) => {
        const readStart = performance.now();
        const raw = await readFile(path);
        const readMs = performance.now() - readStart;
        const prepared = await prepareInput(
          raw,
          config,
          encoding,
          options.resize,
        );
        return {
          input: prepared.input,
          bytes: prepared.input.data.length,
          readMs,
        };
      },
      classify: async (input) => {
        await classifySingle(client, input, metadata, options.timeout);
      },
    });
    for (const [code, count] of Object.entries(streamingResult.errors)) {
      errors[code] = (errors[code] ?? 0) + count;
    }
    payload = streamingResult.payloadBytes;
  } else {
    // ---- control: listDeployments ----------------------------------------
    // Same channel, same auth, negligible payload. If this is fast while
    // classifySingle is slow, the cost is in shipping the request body.
    controlOutcomes = await runPool<CallOutcome>(
      Math.min(options.iterations, 50),
      options.concurrency,
      async () => {
        const start = performance.now();
        try {
          await listDeployments(client, metadata, options.timeout);
          return { latencyMs: performance.now() - start };
        } catch (error) {
          const code = errorCodeName(error);
          recordError(`listDeployments:${code}`);
          return { latencyMs: performance.now() - start, errorCode: code };
        }
      },
    );

    // ---- classifySingle --------------------------------------------------
    callOutcomes = await runPool<CallOutcome>(
      options.iterations,
      options.concurrency,
      async (index) => {
        const start = performance.now();
        try {
          await classifySingle(
            client,
            nextInput(index),
            metadata,
            options.timeout,
          );
          return { latencyMs: performance.now() - start };
        } catch (error) {
          const code = errorCodeName(error);
          recordError(`classifySingle:${code}`);
          return { latencyMs: performance.now() - start, errorCode: code };
        }
      },
    );
  }

  // ---- optional stream phase --------------------------------------------
  let streamResult: Awaited<ReturnType<typeof runStreamPhase>> | undefined;
  if (options.stream) {
    const deploymentId =
      process.env['ATHENA_DEPLOYMENT_ID'] ??
      process.env['VITE_ATHENA_DEPLOYMENT_ID'] ??
      (await listDeployments(client, metadata, options.timeout))[0]
        ?.deploymentId;

    if (deploymentId === undefined) {
      console.warn('\n! --stream skipped: no deployment id available');
    } else {
      streamResult = await runStreamPhase(
        client,
        metadata,
        nextInput(0),
        deploymentId,
        options.streamDuration,
      );
    }
  }

  const transitions = stopWatching();
  const totalDurationMs = performance.now() - runStartedAt;
  client.close();

  // ---- summarise ---------------------------------------------------------
  const successLatencies = callOutcomes
    .filter((outcome) => outcome.errorCode === undefined)
    .map((outcome) => outcome.latencyMs);
  const controlLatencies = controlOutcomes
    .filter((outcome) => outcome.errorCode === undefined)
    .map((outcome) => outcome.latencyMs);

  // In streaming mode `prepare` and `classifySingle` come from the pipeline
  // rather than from separate phases, so the standard table keeps its meaning
  // and two runs in different modes still diff on the same keys.
  const summaries: Record<string, Summary> = {
    prepare: streamingResult
      ? streamingResult.summaries.prepare
      : summarise(prepareSamples),
    connectDns: summarise(transport.samples.map((s) => s.dnsMs)),
    connectTcp: summarise(transport.samples.map((s) => s.tcpMs)),
    connectTls: summarise(transport.samples.map((s) => s.tlsMs)),
    connectTotal: summarise(transport.samples.map((s) => s.totalMs)),
    listDeployments: summarise(controlLatencies),
    classifySingle: streamingResult
      ? streamingResult.summaries.rpc
      : summarise(successLatencies),
  };

  const reconnects = transitions.filter(
    (transition) => transition.from === 'READY',
  ).length;

  const result = {
    label: options.label,
    timestamp: new Date().toISOString(),
    host: hostname(),
    durationMs: totalDurationMs,
    target: {
      grpcAddress: config.grpcAddress,
      host: config.host,
      port: config.port,
      audience: config.audience,
      affiliate: config.affiliate,
      issuerUrl: config.issuerUrl,
    },
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      sdkVersion: sdkVersion(),
      // Prepare cost is CPU-bound, so neither the prepare numbers nor the
      // concurrency knee mean anything without these two.
      cpuCount: cpus().length,
      sharpConcurrency: sharp.concurrency(),
      uvThreadpoolSize: process.env['UV_THREADPOOL_SIZE'] ?? 'default (4)',
    },
    options: {
      mode: options.mode,
      dop: options.dop,
      items: options.items,
      extraDelayMs: options.extraDelayMs,
      iterations: options.iterations,
      concurrency: options.concurrency,
      warmup: options.warmup,
      encoding: options.encoding,
      resize: options.resize,
      keepaliveMs: options.keepaliveMs ?? null,
      image: options.imageDir ?? options.image,
      imageCount: imagePaths.length,
    },
    payloadBytes: {
      images: payload.count,
      min: payload.min,
      p50: payload.p50,
      max: payload.max,
    },
    transportDetails: transport.details ?? null,
    transportFailures: transport.failures,
    auth: { discoveryMs: auth.discoveryMs, tokenMs: auth.tokenMs },
    summaries,
    errors,
    connectivity: { reconnects, transitions },
    stream: streamResult ?? null,
    streamingMode: streamingResult ?? null,
  };

  if (options.json !== undefined) {
    await writeFile(
      options.json,
      `${JSON.stringify(result, null, 2)}\n`,
      'utf8',
    );
  }

  if (options.quiet) {
    return;
  }

  heading('Connection');
  if (transport.details) {
    console.log(`  peer          ${transport.details.peer ?? 'unknown'}`);
    console.log(`  alpn          ${String(transport.details.alpnProtocol)}`);
    console.log(
      `  tls           ${transport.details.tlsProtocol ?? 'unknown'} / ${transport.details.cipher ?? 'unknown'}`,
    );
  }
  if (transport.failures.length > 0) {
    console.log(`  failures      ${transport.failures.length}`);
  }
  console.log(
    payload.min === payload.max
      ? `  payload       ${bytes(payload.p50)} per request (${payload.count} image(s))`
      : `  payload       ${bytes(payload.p50)} p50, ${bytes(payload.min)}–${bytes(payload.max)} over ${payload.count} images`,
  );
  console.log(
    `  auth          discovery ${ms(auth.discoveryMs)}, token ${ms(auth.tokenMs)} (one-off)`,
  );

  heading('Latency');
  console.log(summaryHeader());
  console.log(
    summaryRow('prepare (local CPU)', summaries['prepare'] as Summary),
  );
  console.log(summaryRow('connect: dns', summaries['connectDns'] as Summary));
  console.log(summaryRow('connect: tcp', summaries['connectTcp'] as Summary));
  console.log(summaryRow('connect: tls', summaries['connectTls'] as Summary));
  console.log(
    summaryRow('connect: total', summaries['connectTotal'] as Summary),
  );
  if ((summaries['listDeployments'] as Summary).count > 0) {
    console.log(
      summaryRow(
        'listDeployments (control)',
        summaries['listDeployments'] as Summary,
      ),
    );
  }
  console.log(
    summaryRow('classifySingle', summaries['classifySingle'] as Summary),
  );

  if (streamingResult) {
    heading('Streaming pipeline');
    console.log(summaryHeader());
    console.log(summaryRow('read (disk)', streamingResult.summaries.read));
    console.log(
      summaryRow('prepare (local CPU)', streamingResult.summaries.prepare),
    );
    console.log(summaryRow('rpc (successful)', streamingResult.summaries.rpc));
    console.log(
      summaryRow('rpc (incl. failures)', streamingResult.summaries.rpcAll),
    );
    console.log(summaryRow('injected delay', streamingResult.summaries.delay));
    console.log(summaryRow('total per item', streamingResult.summaries.total));
    console.log('');
    console.log(
      `  throughput    ${streamingResult.throughputPerSec.toFixed(2)} items/s` +
        ` (${streamingResult.completed} items in ${ms(streamingResult.wallMs)})`,
    );
    // The mechanism variable. If this does not move between runs, nothing
    // about the prepare numbers can be attributed to CPU contention.
    console.log(
      `  prepare conc. mean ${streamingResult.prepareConcurrency.mean.toFixed(2)},` +
        ` p50 ${streamingResult.prepareConcurrency.p50.toFixed(0)},` +
        ` p90 ${streamingResult.prepareConcurrency.p90.toFixed(0)},` +
        ` max ${streamingResult.prepareConcurrency.max.toFixed(0)}` +
        ` (${streamingResult.prepareConcurrency.samples} samples)`,
    );
    console.log(
      `  rpc conc.     mean ${streamingResult.rpcConcurrency.mean.toFixed(2)},` +
        ` max ${streamingResult.rpcConcurrency.max.toFixed(0)}`,
    );
    console.log(
      `  event loop    p50 ${ms(streamingResult.eventLoopDelayMs.p50)},` +
        ` p99 ${ms(streamingResult.eventLoopDelayMs.p99)},` +
        ` max ${ms(streamingResult.eventLoopDelayMs.max)}`,
    );
  }

  const classify = summaries['classifySingle'] as Summary;
  const control = summaries['listDeployments'] as Summary;
  if (!Number.isNaN(classify.p50) && !Number.isNaN(control.p50)) {
    heading('Attribution');
    console.log(`  round trip (control call)      p50 ${ms(control.p50)}`);
    console.log(
      `  classifySingle minus control   p50 ${ms(classify.p50 - control.p50)}` +
        ` = server processing + payload transfer`,
    );
    console.log(
      `  end-to-end incl. preparation   p50 ${ms((summaries['prepare'] as Summary).p50 + classify.p50)}`,
    );
    console.log('');
    console.log(
      '  Subtract athena.classify_single.duration from "classifySingle minus',
    );
    console.log(
      '  control" to isolate payload transfer. Percentiles are not additive, so',
    );
    console.log('  treat these as indicative and compare p50 to p50.');
  }

  heading('Stability');
  console.log(`  reconnects    ${reconnects} (departures from READY)`);
  console.log(`  transitions   ${transitions.length}`);
  for (const transition of transitions) {
    console.log(
      `    ${(transition.atMs / 1000).toFixed(1)}s  ${transition.from} -> ${transition.to}`,
    );
  }

  if (streamResult) {
    heading('Streaming classify');
    console.log(`  open          ${ms(streamResult.openMs)}`);
    console.log(
      `  first result  ${streamResult.firstResponseMs === undefined ? 'none' : ms(streamResult.firstResponseMs)}`,
    );
    console.log(`  responses     ${streamResult.responses}`);
    console.log(`  drops         ${streamResult.drops}`);
  }

  const errorEntries = Object.entries(errors);
  if (errorEntries.length > 0) {
    heading('Errors');
    for (const [code, count] of errorEntries) {
      console.log(`  ${code.padEnd(40)} ${count}`);
    }
  }

  if (options.json !== undefined) {
    console.log(`\nJSON written to ${options.json}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
