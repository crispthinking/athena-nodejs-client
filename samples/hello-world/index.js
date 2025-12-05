import { ClassifierSdk, ImageFormat, RequestEncoding } from '@crispthinking/athena-classifier-sdk';
import fs from 'fs';

async function main() {
  const sdk = new ClassifierSdk({
    deploymentId: '',
    affiliate: process.env.ATHENA_AFFILIATE,
    grpcAddress: process.env.ATHENA_GRPC_ADDRESS || 'trust-messages-global.crispthinking.com:443',
    authentication: {
      issuerUrl: 'https://crispthinking.auth0.com/',
      clientId: process.env.ATHENA_CLIENT_ID || '<your client id>',
      clientSecret: process.env.ATHENA_CLIENT_SECRET || '<a secure secret>',
      audience: process.env.ATHENA_AUDIENCE || 'crisp-athena-live'
    }
  });

  try {
    // Send image for classification
    const response = await sdk.classifySingle({
      data: fs.createReadStream('image.jpg'),
      format: ImageFormat.IMAGE_FORMAT_JPEG,
      encoding: RequestEncoding.REQUEST_ENCODING_UNCOMPRESSED,
    });

    console.log('Response:', response);
  } catch (error) {
    console.error('Classification failed:', error.message);
    process.exit(1);
  }
}

main();
