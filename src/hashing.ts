import { Readable } from 'stream';
import { createRequire } from 'module';
import crypto from 'crypto';
import sharp from 'sharp';
import {
  HashType,
  ImageFormat,
  RequestEncoding,
} from './generated/athena/models.js';
import brotli from 'brotli';
import { buffer } from 'stream/consumers';

const require_ = createRequire(import.meta.url);
const { cv } = require_('opencv-wasm') as {
  cv: {
    Mat: new (
      rows: number,
      cols: number,
      type: number,
    ) => {
      data: Uint8Array;
      rows: number;
      cols: number;
      channels(): number;
      delete(): void;
    };
    Size: new (width: number, height: number) => unknown;
    CV_8UC3: number;
    INTER_LINEAR: number;
    resize(
      src: unknown,
      dst: unknown,
      size: unknown,
      fx: number,
      fy: number,
      interpolation: number,
    ): void;
  };
};

/**
 * Computes MD5 and SHA1 hashes from a readable stream and resizes any image data.
 * @param stream Node.js readable stream (e.g., fs.createReadStream)
 * @param encoding Encoding type for the image data (default is UNCOMPRESSED)
 * @param imageFormat Format of the input image (default is UNSPECIFIED)
 * @param resize Whether to resize the image to 448x448 pixels (default is false)
 * @param hashes Array of hash types to compute (default is [MD5, SHA1])
 * @returns {Promise<{md5?: string, sha1?: string, data: Buffer}>} Object containing MD5 hash, SHA1 hash, and resized image buffer
 */
export async function computeHashesFromStream(
  data: Readable | Buffer<ArrayBufferLike>,
  encoding: RequestEncoding = RequestEncoding.REQUEST_ENCODING_UNCOMPRESSED,
  imageFormat: ImageFormat = ImageFormat.IMAGE_FORMAT_UNSPECIFIED,
  resize: boolean = false,
  hashes: HashType[] = [HashType.HASH_TYPE_MD5, HashType.HASH_TYPE_SHA1],
): Promise<{
  md5?: string | undefined;
  sha1?: string | undefined;
  data: Buffer;
  format: ImageFormat;
}> {
  const md5 = crypto.createHash('md5');
  const sha1 = crypto.createHash('sha1');

  let stream: Readable;

  if (data instanceof Readable) {
    stream = data;
  } else {
    stream = Readable.from(data);
  }

  if (hashes.includes(HashType.HASH_TYPE_MD5)) {
    {
      stream.pipe(md5);
    }
  }

  if (hashes.includes(HashType.HASH_TYPE_SHA1)) {
    {
      stream.pipe(sha1);
    }
  }

  if (resize) {
    const rawBuffer = await buffer(stream);

    const decoded = await sharp(rawBuffer)
      .removeAlpha()
      .raw({ depth: 'uchar' })
      .toBuffer({ resolveWithObject: true });

    const { data: rgbPixels, info } = decoded;

    const srcMat = new cv.Mat(info.height, info.width, cv.CV_8UC3);
    srcMat.data.set(rgbPixels);

    const dstMat = new cv.Mat(448, 448, cv.CV_8UC3);
    cv.resize(srcMat, dstMat, new cv.Size(448, 448), 0, 0, cv.INTER_LINEAR);

    data = Buffer.from(dstMat.data);
    srcMat.delete();
    dstMat.delete();

    // Swap R and B channels in-place (RGB → BGR)
    for (let i = 0; i < data.length; i += 3) {
      const r = data[i]!;
      data[i] = data[i + 2]!; // R position gets B
      data[i + 2] = r; // B position gets R
    }
    imageFormat = ImageFormat.IMAGE_FORMAT_RAW_UINT8_BGR;
  } else {
    data = await buffer(stream);
    // use sharp to validate the image dimensions
    const metadata = await sharp(data).metadata();
    if (metadata.width !== 448 || metadata.height !== 448) {
      throw new Error('Image must be 448x448 pixels');
    }
  }

  if (encoding === RequestEncoding.REQUEST_ENCODING_BROTLI) {
    data = Buffer.from(brotli.compress(data));
  }

  return {
    md5: hashes.includes(HashType.HASH_TYPE_MD5)
      ? md5.digest('hex')
      : undefined,
    sha1: hashes.includes(HashType.HASH_TYPE_SHA1)
      ? sha1.digest('hex')
      : undefined,
    data,
    format: imageFormat,
  };
}
