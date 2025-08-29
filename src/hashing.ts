import { Readable } from 'stream';
import crypto from 'crypto';
import sharp from 'sharp';
import { ImageFormat, RequestEncoding } from '.';
import brotli from 'brotli';
import { buffer } from 'stream/consumers';

/**
 * Computes MD5 and SHA1 hashes from a readable stream and resizes any image data.
 * @param stream Node.js readable stream (e.g., fs.createReadStream)
 * @param encoding Encoding type for the image data (default is UNCOMPRESSED)
 * @param imageFormat Format of the input image (default is UNSPECIFIED)
 * @param resize Whether to resize the image to 448x448 pixels (default is false
 * @returns {Promise<{md5: string, sha1: string, data: Buffer}>} Object containing MD5 hash, SHA1 hash, and resized image buffer
 */
export async function computeHashesFromStream(
  stream: Readable,
  encoding: RequestEncoding = RequestEncoding.UNCOMPRESSED,
  imageFormat: ImageFormat = ImageFormat.UNSPECIFIED,
  resize: boolean = false,
): Promise<{ md5: string; sha1: string; data: Buffer; format: ImageFormat }> {
  const md5 = crypto.createHash('md5');
  const sha1 = crypto.createHash('sha1');

  let data: Buffer<ArrayBufferLike>;

  stream.pipe(md5);
  stream.pipe(sha1);

  if (resize) {
    const resizer = sharp().resize(448, 448).raw({ depth: 'uint' });
    stream.pipe(resizer);
    data = await resizer.toBuffer();
    imageFormat = ImageFormat.RAW_UINT8;
  } else {
    data = await buffer(stream);
  }

  if (encoding === RequestEncoding.BROTLI) {
    data = Buffer.from(await brotli.compress(data));
  }

  return {
    md5: md5.digest('hex'),
    sha1: sha1.digest('hex'),
    data,
    format: imageFormat,
  };
}
