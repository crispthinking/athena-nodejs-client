import { describe, it,} from 'vitest';
import { ClassifierSdk, ClassifyImageOptions, ClassifyResponse, ImageFormat } from '../../src/main';
import fs from 'fs';
import { randomUUID } from 'crypto';

describe('classifierHelper', () => {
  it('should listDeployments and return responses using stubbed api)', async ({expect}) => {
      // This is a smoke test. You must have a running gRPC server at localhost:50051 for this to pass.
      // You may want to mock the gRPC client for true unit testing.
      const sdk = new ClassifierSdk({
        deploymentId: process.env.VITE_ATHENA_DEPLOYMENT_ID,
        affiliate: process.env.VITE_ATHENA_AFFILIATE,
        authentication: {
          issuerUrl: process.env.VITE_OAUTH_ISSUER,
          clientId: process.env.VITE_ATHENA_CLIENT_ID,
          clientSecret: process.env.VITE_ATHENA_CLIENT_SECRET,
          scope: 'manage:classify'
        }
      });
       // This will fail if no server is running, but will exercise the code path.
    let error: any = null;
    try {
      const responses = await sdk.listDeployments();
      expect(Array.isArray(responses)).toBe(true);
    } catch (err) {
      error = err;
    }
    // Assert error is unset
    expect(error).toBeNull();
  }, 10000)
});

describe('classifyImage function', () => {
  it('should classify Steamboat-willie.jpg and return responses (integration smoke test)', async ({expect}) => {
    // This is a smoke test. You must have a running gRPC server at localhost:50051 for this to pass.
    // You may want to mock the gRPC client for true unit testing.
    const imagePath = __dirname + '/Steamboat-willie.jpg';
    const sdk = new ClassifierSdk({
        deploymentId: process.env.VITE_ATHENA_DEPLOYMENT_ID,
        affiliate: process.env.VITE_ATHENA_AFFILIATE,
        authentication: {
          issuerUrl: process.env.VITE_OAUTH_ISSUER,
          clientId: process.env.VITE_ATHENA_CLIENT_ID,
          clientSecret: process.env.VITE_ATHENA_CLIENT_SECRET,
          scope: 'manage:classify'
        }
    });

    const correlationId = randomUUID();

    // Create a promise to wrap the event emitter event 'data'
    const promise = new Promise<ClassifyResponse>((resolve, reject) => {
      sdk.once('data', (data) => {
        const byCorrelationId = data.outputs.filter(o => o.correlationId === correlationId);
        if (byCorrelationId.length > 0) {
          resolve(data);
        }
        sdk.close();
      });
      sdk.once('error', (err) => {
        reject(err);
      });
    });

    // This will fail if no server is running, but will exercise the code path.
    let error: any = undefined;

    await sdk.open();

    const imageStream = fs.createReadStream(imagePath);
    const options: ClassifyImageOptions = {
      imageStream,
      format: ImageFormat.PNG,
      correlationId
    };
    try {
      await sdk.sendClassifyRequest(options);
    } catch (err) {
      error = err;
    }

    // Wait for classifier to process some data....
    const first = await promise;

    expect(first).toBeDefined();

    const byCorrelationId = first.outputs.filter(o => o.correlationId === correlationId);

    expect(byCorrelationId.length).toBeGreaterThan(0);

    // Accept either a successful call or a connection error (for CI/dev convenience)
    expect(error).toBeUndefined();
  }, 120000);
});
