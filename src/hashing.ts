import { Readable } from 'stream';
import crypto from 'crypto';
import sharp from 'sharp';
import {
  HashType,
  ImageFormat,
  RequestEncoding,
} from './generated/athena/models';
import brotli from 'brotli';
import { buffer } from 'stream/consumers';

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
  encoding: RequestEncoding = RequestEncoding.UNCOMPRESSED,
  imageFormat: ImageFormat = ImageFormat.UNSPECIFIED,
  resize: boolean = false,
  hashes: HashType[] = [HashType.MD5, HashType.SHA1],
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

  if (hashes.includes(HashType.MD5)) {
    {
      stream.pipe(md5);
    }
  }

  if (hashes.includes(HashType.SHA1)) {
    {
      stream.pipe(sha1);
    }
  }

  if (resize) {
    const resizer = sharp().resize(448, 448).raw({ depth: 'char' });
    stream.pipe(resizer);
    data = await resizer.toBuffer();
    imageFormat = ImageFormat.RAW_UINT8;
  } else {
    data = await buffer(stream);
    // use sharp to validate the image dimensions
    const metadata = await sharp(data).metadata();
    if (metadata.width !== 448 || metadata.height !== 448) {
      throw new Error('Image must be 448x448 pixels');
    }
  }

  if (encoding === RequestEncoding.BROTLI) {
    data = Buffer.from(await brotli.compress(data));
  }

  return {
    md5: hashes.includes(HashType.MD5) ? md5.digest('hex') : undefined,
    sha1: hashes.includes(HashType.SHA1) ? sha1.digest('hex') : undefined,
    data,
    format: imageFormat,
  };
}
