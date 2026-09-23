/**
 * Classifies a handful of images with OpenTelemetry switched on, so the spans
 * and metrics the SDK emits can be seen end to end.
 *
 * Run with two workers to make the interesting case visible: the RPC span and
 * the server's own reported duration should agree closely, and where they do
 * not, `athena.event_loop.busy_ms` on the RPC span says how much of the call
 * this process spent too busy to read the reply.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  ClassifierSdk,
  HashType,
  parseAudience,
  RequestEncoding,
} from '@crispthinking/athena-classifier-sdk';

if (process.env.ATHENA_ENV_FILE) {
  process.loadEnvFile(process.env.ATHENA_ENV_FILE);
}

const imageDir = process.env.ATHENA_IMAGE_DIR;
if (!imageDir) {
  throw new Error('Set ATHENA_IMAGE_DIR to a directory of images.');
}
const images = readdirSync(imageDir)
  .slice(0, 8)
  .map((f) => readFileSync(join(imageDir, f)));

const sdk = new ClassifierSdk({
  deploymentId: process.env.ATHENA_DEPLOYMENT_ID,
  affiliate: process.env.ATHENA_AFFILIATE,
  monitorEventLoop: true,
  authentication: {
    issuerUrl: process.env.ATHENA_ISSUER_URL,
    clientId: process.env.ATHENA_CLIENT_ID,
    clientSecret: process.env.ATHENA_CLIENT_SECRET,
    audience: parseAudience(process.env.ATHENA_AUDIENCE),
  },
});

const encoding =
  process.env.ATHENA_ENCODING === 'brotli'
    ? RequestEncoding.REQUEST_ENCODING_BROTLI
    : RequestEncoding.REQUEST_ENCODING_UNCOMPRESSED;

const workers = Number(process.env.ATHENA_WORKERS ?? 2);
const total = Number(process.env.ATHENA_ITEMS ?? 8);

let next = 0;
await Promise.all(
  Array.from({ length: workers }, async () => {
    while (true) {
      const i = next++;
      if (i >= total) return;
      const result = await sdk.classifySingle({
        correlationId: randomUUID(),
        data: images[i % images.length],
        encoding,
        includeHashes: [HashType.HASH_TYPE_MD5, HashType.HASH_TYPE_SHA1],
      });
      console.log(
        `classified ${result.correlationId} -> ${
          result.classifications?.length ?? 0
        } classification(s)`,
      );
    }
  }),
);

sdk.close();
