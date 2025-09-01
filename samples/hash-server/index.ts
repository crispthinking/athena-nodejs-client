import { ClassifierSdk, HashType, ImageFormat, RequestEncoding, type ClassifyImageInput } from '@crispthinking/athena-classifier-sdk';
import { randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { inspect } from 'util';


const sdk = new ClassifierSdk({
  authentication: {
    clientId: process.env.VITE_ATHENA_CLIENT_ID,
    clientSecret: process.env.VITE_ATHENA_CLIENT_SECRET,
    issuerUrl: process.env.VITE_OAUTH_ISSUER,
    scope: "manage:classify"
  },
  grpcAddress: 'csam-classification-messages.crispdev.com:443',
  affiliate: 'test-affiliate',
  deploymentId: 'node-js-client-test'
});

sdk.on('data', (data) => {
  for(const item of data.outputs)
  {
    console.log(inspect(item, { showHidden: false, colors: true, depth: null, maxArrayLength: null, showProxy: false }));
  }
});

await sdk.open();

// Enter loop to run until keypress entered.
process.stdin.on('data', async (data) => {
  const input = data.toString().trim();
  if (input === 'exit') {
    await sdk.close();
    process.exit(0);
  }
});

// Break if sigterm
process.on('SIGTERM', async () => {
  await sdk.close();
  process.exit(0);
});

while(true)
{
  const inputs = Array.from({ length: 3 }, () => ({
    data: createReadStream('448x448.jpg'),
    format: ImageFormat.JPEG,
    correlationId: randomUUID(),
    encoding: RequestEncoding.UNCOMPRESSED,
    includeHashes: [HashType.MD5, HashType.SHA1]
  } as ClassifyImageInput));

  await sdk.sendClassifyRequest(inputs);

  // Sleep for 10 seconds
  await new Promise((resolve) => setTimeout(resolve, Math.random() * 10000));
}
