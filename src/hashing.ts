import { Readable } from "stream";
import crypto from 'crypto';
import sharp from 'sharp'

/**
 * Computes MD5 and SHA1 hashes from a readable stream and resizes any image data.
 * @param stream Node.js readable stream (e.g., fs.createReadStream)
 * @returns {Promise<{md5: string, sha1: string, data: Buffer}>} Object containing MD5 hash, SHA1 hash, and resized image buffer
 */
export async function computeHashesFromStream(stream: Readable): Promise<{ md5: string; sha1: string; data: Buffer }> {

  const md5 = crypto.createHash('md5');
  const sha1 = crypto.createHash('sha1');
  const resizer = sharp()
    .resize(448, 448)
    .raw({ depth: 'uint'});

  stream.pipe(md5);
  stream.pipe(sha1);
  stream.pipe(resizer);

  const data = await resizer.toBuffer();

  return {
      md5: md5.digest('hex'),
      sha1: sha1.digest('hex'),
      data
  }
}
