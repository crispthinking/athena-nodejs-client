import { randomUUID } from 'crypto';
import { Readable } from 'stream';
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
} from './generated/athena/models';
import * as grpc from '@grpc/grpc-js';
import {
  type IClassifierServiceClient,
  ClassifierServiceClient,
} from './generated/athena/athena.grpc-client';
import { EventEmitter } from 'events';
import { Empty } from './generated/google/protobuf/empty';
import {
  type AuthenticationOptions,
  AuthenticationManager,
} from './authenticationManager';
import { computeHashesFromStream } from './hashing';
import type TypedEventEmitter from 'typed-emitter';

/**
 * Options for the classifyImage method.
 * @property affiliate Optional affiliate identifier for the request.
 * @property correlationId Optional correlation ID for tracking the request.
 * @property imageStream The image data as a readable stream.
 * @property encoding Optional encoding type for the image data.
 * @property format Optional image format.
 * @property resize Optional flag to resize the image.
 * @property hashes Array of hash types to compute.
 */
export type ClassifyImageInput = {
  affiliate?: string;
  correlationId?: string;
  data: Readable | Buffer<ArrayBufferLike>;
  encoding?: ClassifyRequest['inputs'][number]['encoding'];
  includeHashes?: HashType[];
} & (ResizeImageInput | RawImageInput);

export type ResizeImageInput = {
  resize: true;
};

export type RawImageInput = {
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

export const defaultGrpcAddress = 'trust.messages.crispthinking.com:443';

/**
 * SDK for interacting with the Athena classification service via gRPC.
 * Emits events for data, error, open, and close.
 * @fires ClassifierSdk#open
 * @fires ClassifierSdk#error
 * @fires ClassifierSdk#close
 * @fires ClassifierSdk#data
 */
export class ClassifierSdk extends (EventEmitter as new () => TypedEventEmitter<ClassifierEvents>) {
  private grpcAddress: string;
  private client: IClassifierServiceClient;
  private classifierGrpcCall: grpc.ClientDuplexStream<
    ClassifyRequest,
    ClassifyResponse
  > | null = null;
  private options: ClassifierSdkOptions;
  private auth: AuthenticationManager;
  private keepAlive?: NodeJS.Timeout;
  private metadata?: grpc.Metadata;

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
  }: ClassifierSdkOptions) {
    super();
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
    };

    this.auth = new AuthenticationManager(this.options.authentication);
  }

  /**
   * Lists available deployments from the Athena service.
   * @returns Promise resolving to an array of deployments.
   */
  public async listDeployments(): Promise<Deployment[]> {
    const metadata = new grpc.Metadata();

    await this.auth.appendAuthorizationToMetadata(metadata);

    return new Promise<Deployment[]>((resolve, reject) => {
      this.client.listDeployments(Empty, metadata, (err, response) => {
        if (err) {
          reject(err);
        } else {
          resolve(response?.deployments || []);
        }
      });
    });
  }

  /**
   * Opens a gRPC stream to the Athena classification service.
   * Emits 'open' when ready, and sets up keep-alive and event listeners.
   * @returns Promise that resolves when the stream is open.
   */
  public async open(): Promise<void> {
    if (this.metadata === undefined) {
      this.metadata = new grpc.Metadata();

      this.metadata.set('x-client-version', 'athena-nodejs-client/0.1.0');
      this.metadata.set('x-client-language', 'nodejs');

      await this.auth.appendAuthorizationToMetadata(this.metadata);
    }

    this.classifierGrpcCall = this.client.classify(this.metadata);

    // Setup interval to keep the grpc client alive.
    this.keepAlive = setInterval(async () => {
      if (this.classifierGrpcCall && this.metadata) {
        try {
          await this.auth.appendAuthorizationToMetadata(this.metadata);
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

    for (const options of requests) {
      const {
        affiliate = this.options.affiliate,
        correlationId = randomUUID().toString(),
        data: inputData,
        includeHashes = [HashType.MD5, HashType.SHA1],
        encoding = RequestEncoding.UNCOMPRESSED,
      } = options;

      let inputFormat: ImageFormat = ImageFormat.UNSPECIFIED;

      if ('resize' in options === false) {
        inputFormat = options.format;
      }

      const { md5, sha1, data, format } = await computeHashesFromStream(
        inputData,
        encoding,
        inputFormat,
        'resize' in options,
        includeHashes,
      );

      const hashes: ImageHash[] = [];

      if (md5 && md5.trim() != '') {
        hashes.push({ value: md5, type: HashType.MD5 });
      }

      if (sha1 && sha1.trim() != '') {
        hashes.push({ value: sha1, type: HashType.SHA1 });
      }

      processedInputs.push({
        affiliate,
        correlationId,
        encoding,
        data,
        format,
        hashes,
      });
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
    const options = {
      affiliate: this.options.affiliate,
      correlationId: randomUUID().toString(),
      includeHashes: [HashType.MD5, HashType.SHA1],
      encoding: request.encoding,
    };

    let inputFormat: ImageFormat = ImageFormat.UNSPECIFIED;

    if ('resize' in request === false) {
      inputFormat = request.format;
    }

    const { md5, sha1, data, format } = await computeHashesFromStream(
      request.data,
      options.encoding,
      inputFormat,
      'resize' in request,
      options.includeHashes,
    );

    const hashes: ImageHash[] = [];

    if (md5 && md5.trim() != '') {
      hashes.push({ value: md5, type: HashType.MD5 });
    }

    if (sha1 && sha1.trim() != '') {
      hashes.push({ value: sha1, type: HashType.SHA1 });
    }

    const input: ClassificationInput = {
      affiliate: this.options.affiliate,
      correlationId: options.correlationId,
      data: data,
      format: format,
      encoding: options.encoding,
      hashes: hashes,
    };

    return new Promise<ClassificationOutput>((resolve, reject) => {
      this.client.classifySingle(input, (err, response) => {
        if (err) {
          reject(err);
        } else {
          resolve(response);
        }
      });
    });
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
}

export * from './generated/athena/models';
export * from './generated/athena/athena';
export * from './generated/athena/athena.grpc-client';
export * from './hashing';
