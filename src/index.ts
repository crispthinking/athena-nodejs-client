import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { createRequire } from 'module';
import {
  ClassifyRequest,
  ClassificationInput,
  HashType,
  RequestEncoding,
  ImageHash,
  ClassifyResponse,
  Deployment,
  ImageFormat,
  ClassificationOutput,
} from './generated/athena/models.js';
import * as grpc from '@grpc/grpc-js';
import { ClassifierServiceClient } from './generated/athena/athena.js';
import { EventEmitter } from 'events';
import { Empty } from './generated/google/protobuf/empty.js';
import {
  type AuthenticationOptions,
  AuthenticationManager,
} from './authenticationManager.js';
import { computeHashesFromStream } from './hashing.js';
import {
  annotateEventLoopDelay,
  AthenaAttributes,
  enableEventLoopMonitoring,
  encodingName,
  recordClassifyDuration,
  recordPrepare,
  recordRpc,
  SpanKind,
  withSpan,
} from './telemetry.js';
import type { Attributes } from '@opentelemetry/api';

/**
 * Options for the classifyImage method.
 * @property affiliate Optional affiliate identifier for the request.
 * @property correlationId Optional correlation ID for tracking the request.
 * @property data The image data as a readable stream or buffer.
 * @property encoding Optional encoding type for the image data.
 * @property format Optional image format.
 * @property resize Optional flag to resize the image.
 * @property includeHashes Array of hash types to compute.
 */
export type ClassifyImageInput = {
  affiliate?: string;
  correlationId?: string;
  data: Readable | Buffer<ArrayBufferLike>;
  encoding?: ClassifyRequest['inputs'][number]['encoding'];
  includeHashes?: HashType[];
} & (ResizeImageInput | RawImageInput);

export type ResizeImageInput = {
  resize?: true;
};

export type RawImageInput = {
  resize: false;
  format: ClassifyRequest['inputs'][number]['format'];
};

/**
 * Options for initializing the ClassifierSdk.
 * @property keepAliveInterval Optional interval (ms) for keep-alive pings.
 * @property grpcAddress Optional gRPC server address.
 * @property deploymentId Deployment ID to use for classification.
 * @property affiliate Affiliate identifier for requests.
 * @property authentication Authentication options for the SDK.
 */
export interface ClassifierSdkOptions {
  keepAliveInterval?: number | undefined;
  grpcAddress?: string;
  deploymentId: string;
  /**
   * Whether to watch event-loop delay and publish it as a metric.
   *
   * On by default. The measurement comes from Node's timer thread, costs a
   * single unreferenced timer, and is the only signal that distinguishes a
   * slow service from a caller too busy to read the reply. Set to false to
   * opt out entirely.
   */
  monitorEventLoop?: boolean;
  affiliate: string;
  authentication: AuthenticationOptions;
}

/**
 * Event types emitted by the ClassifierSdk.
 * @property error Emitted when an error occurs.
 * @property data Emitted when classification data is received.
 * @property close Emitted when the gRPC stream is closed.
 * @property open Emitted when the gRPC stream is opened.
 */
export type ClassifierEvents = {
  error: (err: Error) => void;
  data: (data: ClassifyResponse) => void;
  close: () => void;
  open: () => void;
};

export const defaultGrpcAddress = 'api.athena-risk-intelligence.com:443';

/**
 * SDK for interacting with the Athena classification service via gRPC.
 * Emits events for data, error, open, and close.
 * @fires ClassifierSdk#open
 * @fires ClassifierSdk#error
 * @fires ClassifierSdk#close
 * @fires ClassifierSdk#data
 */
export class ClassifierSdk extends EventEmitter {
  private grpcAddress: string;
  private client: ClassifierServiceClient;
  private classifierGrpcCall: grpc.ClientDuplexStream<
    ClassifyRequest,
    ClassifyResponse
  > | null = null;
  private options: ClassifierSdkOptions;
  private auth: AuthenticationManager;
  private keepAlive?: NodeJS.Timeout;
  private static clientVersion: string | null = null;

  /**
   * Helper method to process an image input and return a complete ClassificationInput.
   * Extracts default values, computes hashes, and prepares data for gRPC calls.
   * @param input The image input to process.
   * @returns Complete ClassificationInput ready to send to the service.
   */
  private async processImageInput(
    input: ClassifyImageInput,
  ): Promise<ClassificationInput> {
    const {
      affiliate = this.options.affiliate,
      correlationId = randomUUID().toString(),
      encoding = RequestEncoding.REQUEST_ENCODING_UNCOMPRESSED,
      includeHashes = [HashType.HASH_TYPE_MD5, HashType.HASH_TYPE_SHA1],
    } = input;

    const shouldResize = input.resize !== false;
    const inputFormat: ImageFormat =
      'format' in input ? input.format : ImageFormat.IMAGE_FORMAT_UNSPECIFIED;

    const { md5, sha1, data, format } = await withSpan(
      'Athena.prepareImage',
      SpanKind.INTERNAL,
      {
        [AthenaAttributes.correlationId]: correlationId,
        [AthenaAttributes.encoding]: encodingName(encoding),
        [AthenaAttributes.resize]: shouldResize,
      },
      async (span) => {
        const started = performance.now();
        const result = await computeHashesFromStream(
          input.data,
          encoding,
          inputFormat,
          shouldResize,
          includeHashes,
        );
        const elapsed = performance.now() - started;

        const attributes: Attributes = {
          [AthenaAttributes.encoding]: encodingName(encoding),
          [AthenaAttributes.resize]: shouldResize,
        };
        if (result.sourceBytes !== undefined) {
          span.setAttribute(AthenaAttributes.sourceBytes, result.sourceBytes);
        }
        if (result.sourceWidth !== undefined) {
          span.setAttribute(AthenaAttributes.sourceWidth, result.sourceWidth);
        }
        if (result.sourceHeight !== undefined) {
          span.setAttribute(AthenaAttributes.sourceHeight, result.sourceHeight);
        }
        span.setAttribute(AthenaAttributes.payloadBytes, result.data.length);
        recordPrepare(elapsed, result.data.length, attributes);
        return result;
      },
    );

    const hashes: ImageHash[] = [];

    if (md5 && md5.trim() !== '') {
      hashes.push({ value: md5, type: HashType.HASH_TYPE_MD5 });
    }

    if (sha1 && sha1.trim() !== '') {
      hashes.push({ value: sha1, type: HashType.HASH_TYPE_SHA1 });
    }

    return {
      affiliate,
      correlationId,
      data,
      format,
      encoding,
      hashes,
    };
  }

  /**
   * Constructs a new ClassifierSdk instance.
   * @param options Configuration options for the SDK.
   */
  constructor({
    grpcAddress = defaultGrpcAddress,
    keepAliveInterval,
    deploymentId,
    affiliate,
    authentication,
    monitorEventLoop = true,
  }: ClassifierSdkOptions) {
    super();
    if (monitorEventLoop) {
      enableEventLoopMonitoring();
    }
    this.grpcAddress = grpcAddress;
    this.client = new ClassifierServiceClient(
      this.grpcAddress,
      grpc.credentials.createSsl(),
    );
    this.options = {
      grpcAddress,
      keepAliveInterval,
      deploymentId,
      affiliate,
      authentication,
      monitorEventLoop,
    };

    this.auth = new AuthenticationManager(this.options.authentication);
  }

  /**
   * Creates fresh metadata with standard headers and authentication.
   * @returns Promise resolving to configured metadata.
   */
  private async createMetadata(): Promise<grpc.Metadata> {
    const metadata = new grpc.Metadata();

    // Lazy load version on first use
    if (ClassifierSdk.clientVersion === null) {
      try {
        const require = createRequire(import.meta.url);
        const packageJson = require('../package.json');
        ClassifierSdk.clientVersion = packageJson.version ?? 'unknown';
      } catch {
        ClassifierSdk.clientVersion = 'unknown';
      }
    }

    metadata.set(
      'x-client-version',
      `athena-nodejs-client/${ClassifierSdk.clientVersion}`,
    );
    metadata.set('x-client-language', 'nodejs');
    await this.auth.appendAuthorizationToMetadata(metadata);
    return metadata;
  }

  /**
   * Lists available deployments from the Athena service.
   * @returns Promise resolving to an array of deployments.
   */
  public async listDeployments(): Promise<Deployment[]> {
    return withSpan(
      'Athena.listDeployments',
      SpanKind.CLIENT,
      { [AthenaAttributes.serverAddress]: this.grpcAddress },
      async () => {
        const metadata = await this.createMetadata();

        return new Promise<Deployment[]>((resolve, reject) => {
          this.client.listDeployments(Empty, metadata, (err, response) => {
            if (err) {
              reject(err);
            } else {
              resolve(response?.deployments || []);
            }
          });
        });
      },
    );
  }

  /**
   * Opens a gRPC stream to the Athena classification service.
   * Emits 'open' when ready, and sets up keep-alive and event listeners.
   * @returns Promise that resolves when the stream is open.
   */
  public async open(): Promise<void> {
    const metadata = await this.createMetadata();

    this.classifierGrpcCall = this.client.classify(metadata);

    // Setup interval to keep the grpc client alive.
    this.keepAlive = setInterval(async () => {
      if (this.classifierGrpcCall) {
        try {
          this.classifierGrpcCall.write({
            deploymentId: this.options.deploymentId,
            inputs: [],
          });
        } catch (err) {
          if (err && err instanceof Error) {
            this.emit('error', err);
          } else {
            console.log(err);
          }
        }
      }
    }, this.options.keepAliveInterval ?? 10000);

    this.classifierGrpcCall.on('data', (data: ClassifyResponse) =>
      /**
       * Data event
       *
       * @event ClassifierEvents#data
       * @type {ClassifyResponse}
       * @description Emitted when a classification response is received.
       * @param {ClassifyResponse} data The classification response data.
       * @property {string} data.deploymentId The ID of the deployment.
       * @property {ClassificationResult[]} data.results The classification results.
       */
      this.emit('data', data),
    );
    this.classifierGrpcCall.on('error', (err: Error) =>
      this.emit('error', err),
    );

    this.classifierGrpcCall.on('end', () => {
      if (this.keepAlive) {
        clearInterval(this.keepAlive);
      }
      this.classifierGrpcCall = null;
      this.emit('close');
    });

    this.classifierGrpcCall.on('close', () => {
      if (this.keepAlive) {
        clearInterval(this.keepAlive);
      }
      this.emit('close');
      this.classifierGrpcCall = null;
    });

    this.emit('open');
  }

  /**
   * Sends a classify request for an image to the Athena service.
   * @param options Options for the image classification request.
   * @throws Error if the gRPC stream is not open.
   * @returns Promise that resolves when the request is sent.
   */
  /**
   * Sends one or more classify requests for images to the Athena service.
   * @param request Single input or array of image classification request options.
   * @throws Error if the gRPC stream is not open.
   * @returns Promise that resolves when the request is sent.
   */
  public async sendClassifyRequest(
    request: ClassifyImageInput | ClassifyImageInput[],
  ): Promise<void> {
    if (!this.classifierGrpcCall) {
      throw new Error('gRPC stream is not open. Call open() first.');
    }

    const requests: ClassifyImageInput[] = Array.isArray(request)
      ? request
      : [request];

    const processedInputs: ClassificationInput[] = [];

    for (const request of requests) {
      const input = await this.processImageInput(request);
      processedInputs.push(input);
    }

    const classifyRequest: ClassifyRequest = {
      deploymentId: this.options.deploymentId,
      inputs: processedInputs,
    };

    await new Promise<void>((resolve) => {
      if (
        this.classifierGrpcCall &&
        this.classifierGrpcCall.write(classifyRequest) == false
      ) {
        this.classifierGrpcCall.once('drain', resolve);
      } else {
        resolve();
      }
    });
  }

  public async classifySingle(
    request: ClassifyImageInput,
  ): Promise<ClassificationOutput> {
    return withSpan(
      'Athena.classifySingle',
      SpanKind.CLIENT,
      {
        [AthenaAttributes.serverAddress]: this.grpcAddress,
        [AthenaAttributes.deploymentId]: this.options.deploymentId,
        [AthenaAttributes.affiliate]:
          request.affiliate ?? this.options.affiliate,
      },
      async (span) => {
        const started = performance.now();
        const input = await this.processImageInput(request);
        const metadata = await this.createMetadata();

        span.setAttribute(AthenaAttributes.correlationId, input.correlationId);
        span.setAttribute(AthenaAttributes.payloadBytes, input.data.length);

        const attributes: Attributes = {
          [AthenaAttributes.deploymentId]: this.options.deploymentId,
          [AthenaAttributes.encoding]: encodingName(input.encoding),
        };

        // The RPC gets a span of its own so it can be compared against the
        // duration the server reports for the same call. A gap between the
        // two is network transfer, or time this process spent unable to read
        // the response -- not time the service spent working.
        const response = await withSpan(
          'Athena.rpc classifySingle',
          SpanKind.CLIENT,
          {
            [AthenaAttributes.serverAddress]: this.grpcAddress,
            [AthenaAttributes.correlationId]: input.correlationId,
            [AthenaAttributes.payloadBytes]: input.data.length,
          },
          async (rpcSpan) => {
            const rpcStarted = performance.now();
            try {
              return await new Promise<ClassificationOutput>(
                (resolve, reject) => {
                  this.client.classifySingle(
                    input,
                    metadata,
                    (err, response) => {
                      if (err) {
                        reject(err);
                      } else {
                        resolve(response);
                      }
                    },
                  );
                },
              );
            } finally {
              recordRpc(performance.now() - rpcStarted, attributes);
              annotateEventLoopDelay(rpcSpan);
            }
          },
        );

        recordClassifyDuration(performance.now() - started, attributes);
        return response;
      },
    );
  }

  /**
   * Closes the gRPC stream and cleans up resources.
   * Emits 'close' event.
   */
  public close(): void {
    if (this.classifierGrpcCall) {
      if (this.keepAlive) {
        clearInterval(this.keepAlive);
      }
      this.classifierGrpcCall.end();
      this.classifierGrpcCall = null;
      this.emit('close');
    }
  }

  public override on<U extends keyof ClassifierEvents>(
    event: U,
    listener: ClassifierEvents[U],
  ): this {
    return super.on(event, listener);
  }

  public override once<U extends keyof ClassifierEvents>(
    event: U,
    listener: ClassifierEvents[U],
  ): this {
    return super.once(event, listener);
  }

  public override off<U extends keyof ClassifierEvents>(
    event: U,
    listener: ClassifierEvents[U],
  ): this {
    return super.off(event, listener);
  }

  public override emit<U extends keyof ClassifierEvents>(
    event: U,
    ...args: Parameters<ClassifierEvents[U]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

export * from './generated/athena/models.js';
export { ClassifierServiceClient } from './generated/athena/athena.js';
export * from './hashing.js';
export {
  type AuthenticationOptions,
  type AthenaAudience,
  VALID_AUDIENCES,
  parseAudience,
} from './authenticationManager.js';
