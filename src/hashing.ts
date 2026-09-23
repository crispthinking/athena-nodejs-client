import { Readable } from 'stream';
import { createRequire } from 'module';
import crypto from 'crypto';
import sharp from 'sharp';
import {
  HashType,
  ImageFormat,
  RequestEncoding,
} from './generated/athena/models.js';
import { buffer } from 'stream/consumers';
import { brotliCompress, constants as zlibConstants } from 'node:zlib';
import { promisify } from 'node:util';

const require_ = createRequire(import.meta.url);
const { cv } = require_('opencv-wasm');

const compressBrotli = promisify(brotliCompress);

/**
 * Brotli quality used for request payloads.
 *
 * The payload is a 448x448 raw BGR bitmap, which is highly compressible, so the
 * top of the quality range buys very little. On a representative image quality
 * 11 spends 2.2 s to reach 275 KiB; quality 5 spends 22 ms to reach 333 KiB.
 * Paying two seconds of CPU for a further 58 KiB is never the right trade when
 * the point of compressing is to get the request onto the wire sooner.
 */
const BROTLI_QUALITY = 5;

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
    srcMat.delete();

    const bgrMat = new cv.Mat(448, 448, cv.CV_8UC3);
    cv.cvtColor(dstMat, bgrMat, cv.COLOR_RGB2BGR);
    dstMat.delete();

    data = Buffer.from(bgrMat.data);
    bgrMat.delete();

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
    // Node's own Brotli, not the `brotli` npm package: that one is a pure-JS
    // port whose compress() is synchronous, so it blocked the event loop for
    // seconds per image. A caller with more than one request in flight saw
    // that as slow responses, because replies sat unread in the socket while
    // the loop was busy compressing. This runs on the libuv thread pool.
    data = await compressBrotli(data, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
        [zlibConstants.BROTLI_PARAM_SIZE_HINT]: data.length,
      },
    });
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
