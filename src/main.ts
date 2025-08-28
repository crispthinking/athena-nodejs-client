import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import {
  ClassifyRequest,
  ClassificationInput,
  HashType,
  RequestEncoding,
  ImageFormat,
  ImageHash,
  ClassifyResponse,
  Deployment,
} from './athena/athena.js';
import * as grpc from '@grpc/grpc-js';
import {
  IClassifierServiceClient,
  ClassifierServiceClient,
} from './athena/athena.grpc-client';
import { EventEmitter } from 'events';
import { Empty } from './athena/google/protobuf/empty';
import TypedEmitter from 'typed-emitter';
import {
  AuthenticationOptions,
  AuthenticationManager,
} from './authenticationManager';
import { computeHashesFromStream } from './hashing';

/**
 * Options for the classifyImage method.
 * @property affiliate Optional affiliate identifier for the request.
 * @property correlationId Optional correlation ID for tracking the request.
 * @property imageStream The image data as a readable stream.
 * @property encoding Optional encoding type for the image data.
 * @property format Optional image format.
 */
export interface ClassifyImageOptions {
  affiliate?: string;
  correlationId?: string;
  imageStream: Readable;
  encoding?: ClassifyRequest['inputs'][number]['encoding'];
  format?: ClassifyRequest['inputs'][number]['format'];
}

/**
 * Options for initializing the ClassifierSdk helper.
 * @property keepAliveInterval Optional interval (ms) for keep-alive pings.
 * @property grpcAddress Optional gRPC server address.
 * @property deploymentId Deployment ID to use for classification.
 * @property affiliate Affiliate identifier for requests.
 * @property authentication Authentication options for the SDK.
 */
export interface ClassifierHelperOptions {
  keepAliveInterval?: number;
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

// export the default endpoint of csam-classification-messages.crispdev.com so library consumers may use it.
export const defaultGrpcAddress =
  'csam-classification-messages.crispdev.com:443';

/**
 * SDK for interacting with the Athena classification service via gRPC.
 * Emits events for data, errors, open, and close.
 */
export class ClassifierSdk extends (EventEmitter as new () => TypedEmitter<ClassifierEvents>) {
  private grpcAddress: string;
  private client: IClassifierServiceClient;
  private classifierGrpcCall: grpc.ClientDuplexStream<
    ClassifyRequest,
    ClassifyResponse
  > | null = null;
  private options: ClassifierHelperOptions;
  private auth: AuthenticationManager;
  private keepAlive: NodeJS.Timeout;
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
  }: ClassifierHelperOptions) {
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
      if (this.classifierGrpcCall) {
        try {
          await this.auth.appendAuthorizationToMetadata(this.metadata);
          this.classifierGrpcCall.write({
            deploymentId: this.options.deploymentId,
            inputs: [],
          });
        } catch (error) {
          this.emit('error', error);
        }
      }
    }, this.options.keepAliveInterval ?? 10000);

    this.classifierGrpcCall.on('data', (data: ClassifyResponse) =>
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
  public async sendClassifyRequest(
    options: ClassifyImageOptions,
  ): Promise<void> {
    if (!this.classifierGrpcCall) {
      throw new Error('gRPC stream is not open. Call open() first.');
    }
    const {
      affiliate = this.options.affiliate,
      correlationId = randomUUID(),
      imageStream,
      encoding = RequestEncoding.UNCOMPRESSED,
      format = ImageFormat.UNSPECIFIED,
    } = options;

    const { md5, sha1, data } = await computeHashesFromStream(
      imageStream,
      encoding,
    );

    const hashes: ImageHash[] = [
      { value: md5, type: HashType.MD5 },
      { value: sha1, type: HashType.SHA1 },
    ];

    const input: ClassificationInput = {
      affiliate,
      correlationId,
      encoding,
      data,
      format,
      hashes,
    };

    const request: ClassifyRequest = {
      deploymentId: this.options.deploymentId,
      inputs: [input],
    };

    await new Promise<void>((resolve) => {
      if (this.classifierGrpcCall.write(request) == false) {
        this.classifierGrpcCall.once('drain', resolve);
      } else {
        resolve();
      }
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
}

export * from './athena/athena';
export * from './athena/athena.grpc-client';
export * from './hashing';
