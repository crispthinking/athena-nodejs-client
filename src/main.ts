
import crypto from 'crypto';
import { Readable } from 'stream';
import { ClassifyRequest, ClassificationInput, HashType, RequestEncoding, ImageFormat, ImageHash, ClassifyResponse } from './athena/athena.js';
import * as grpc from '@grpc/grpc-js';
import { IClassifierServiceClient, ClassifierServiceClient } from './athena/athena.grpc-client.js';

/**
 * Computes MD5 and SHA1 hashes from a readable stream.
 * Returns the hashes and the full buffer.
 * @param stream Node.js readable stream (e.g., fs.createReadStream)
 */
export function computeHashesFromStream(stream: Readable): Promise<{ md5: string; sha1: string; buffer: Buffer }> {
  return new Promise((resolve, reject) => {
    const md5 = crypto.createHash('md5');
    const sha1 = crypto.createHash('sha1');
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => {
      md5.update(chunk);
      sha1.update(chunk);
      chunks.push(chunk);
    });
    stream.on('end', () => {
      resolve({
        md5: md5.digest('hex'),
        sha1: sha1.digest('hex'),
        buffer: Buffer.concat(chunks),
      });
    });
    stream.on('error', reject);
  });
}

/**
 * Options for classifyImage
 */
export interface ClassifyImageOptions {
  imageStream: Readable;
  deploymentId: string;
  affiliate: string;
  correlationId: string;
  encoding?: number; // RequestEncoding enum
  format?: number;   // ImageFormat enum
  grpcAddress?: string;
}

/**
 * Sends a ClassifyRequest to the Athena ClassifierService with image data and hashes.
 * @param options ClassifyImageOptions
 * @returns Promise resolving to the array of ClassifyResponse messages
 */
export async function classifyImage(options: ClassifyImageOptions): Promise<ClassifyResponse[]> {
  const {
    imageStream,
    deploymentId,
    affiliate,
    correlationId,
    encoding = RequestEncoding.UNSPECIFIED,
    format = ImageFormat.UNSPECIFIED,
    grpcAddress = 'localhost:50051',
  } = options;

  const { md5, sha1, buffer } = await computeHashesFromStream(imageStream);

  const hashes: ImageHash[] = [
    { value: md5, type: HashType.MD5 },
    { value: sha1, type: HashType.SHA1 },
  ];

  const input: ClassificationInput = {
    affiliate,
    correlationId,
    encoding,
    data: buffer,
    format,
    hashes,
  };

  const request: ClassifyRequest = {
    deploymentId,
    inputs: [input],
  };

  // Set up the gRPC client
  const client: IClassifierServiceClient = new ClassifierServiceClient(grpcAddress, grpc.credentials.createInsecure());

  return new Promise((resolve, reject) => {
    const call = client.classify();
    call.write(request);
    call.end();
    const responses: ClassifyResponse[] = [];
    call.on('data', (response:ClassifyResponse) => responses.push(response));
    call.on('end', () => resolve(responses));
    call.on('error', reject);
  });
}
