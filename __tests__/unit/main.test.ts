import { describe, it, } from 'vitest';
import { ClassificationOutput, ClassifierSdk, ClassifyImageInput, ImageFormat } from '../../src';
import fs from 'fs';
import { randomUUID } from 'crypto';

describe('ClassifierSdk', () => {
  describe('listDeployments', () => {
    it('should listDeployments and return responses (smoke test)', async ({ expect }) => {
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

  describe('classifyImage', () => {
    it('should classify 10 images in a single request and return responses (integration smoke test)', async ({ expect, annotate }) => {
      // This is a smoke test. You must have a running gRPC server at localhost:50051 for this to pass.
      // You may want to mock the gRPC client for true unit testing.
      const imagePath = __dirname + '/448x448.jpg';
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

      // Generate 10 unique correlationIds
      const correlationIds = Array.from({ length: 10 }, () => randomUUID().toString());

      correlationIds.sort((a, b) => a.localeCompare(b));

      annotate(`Correlation IDs: ${correlationIds.join(', ')}`);

      // Create 10 input objects, each with a new stream and unique correlationId
      const inputs: ClassifyImageInput[] = correlationIds.map((correlationId) => ({
        imageStream: fs.createReadStream(imagePath),
        format: ImageFormat.PNG,
        correlationId
      }));

      // Create a promise to wrap the event emitter event 'data'
      const promise = new Promise<ClassificationOutput[]>((resolve, reject) => {
        const results: ClassificationOutput[] = [];

        sdk.on('data', (data) => {
          if (data.globalError) {
            reject(data.globalError);
          }

          // Check that all correlationIds are present in the outputs
          for (const result of data.outputs) {
            if (correlationIds.includes(result.correlationId)) {
              results.push(result);
            }
          }
          if (results.length == correlationIds.length) {
            resolve(results);
          }
        });
        sdk.once('error', (err) => {
          reject(err);
        });
      });

      let error: any = undefined;

      await sdk.open();

      try {
        await sdk.sendClassifyRequest(inputs);
      } catch (err) {
        error = err;
      }

      // Wait for classifier to process some data....
      const outputs = await promise;
      sdk.close();

      expect(error).toBeUndefined();

      outputs.sort((a, b) => a.correlationId.localeCompare(b.correlationId));

      expect(outputs).toBeDefined();
      // Check that all correlationIds are present in the outputs
      expect(outputs.length).toBe(correlationIds.length);

      const expectedOutputs = correlationIds.map(id => (
        {
          correlationId: id,
          classifications: expect.toBeOneOf([expect.arrayContaining([
            {
              label: expect.any(String),
              weight: expect.any(Number)
            }
          ]), []])
        }
      ));

      expect(outputs).toMatchObject(expectedOutputs);
    }, 120000);

    it('should classify with raw uint8 resize return responses (integration smoke test)', async ({ expect, annotate }) => {

      const imagePath = __dirname + '/448x448.jpg';
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

      annotate(`Correlation IDs: ${correlationId}`);

      // Create a promise to wrap the event emitter event 'data'
      const promise = new Promise<ClassificationOutput[]>((resolve, reject) => {
        // Add a timeout to reject the promise if no data is received in 30 seconds
        const timeout = setTimeout(() => {
          reject(new Error('Timeout waiting for classification response'));
        }, 30000);

        sdk.on('data', (data) => {
          const byCorrelationId = data.outputs.filter(o => o.correlationId === correlationId);
          if (byCorrelationId.length > 0) {
            clearTimeout(timeout);
            resolve(byCorrelationId);
          }
        });
        sdk.once('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      // This will fail if no server is running, but will exercise the code path.
      let error: any = undefined;

      await sdk.open();

      const imageStream = fs.createReadStream(imagePath);
      const options: ClassifyImageInput = {
        imageStream,
        correlationId,
        resize: true,
      };
      try {
        await sdk.sendClassifyRequest(options);
      } catch (err) {
        error = err;
      }

      // Wait for classifier to process some data....
      const first = await promise;
      sdk.close();

      expect(first).toBeDefined();
      expect(first).toMatchObject([
        {
          correlationId,
          classifications: expect.toBeOneOf([expect.arrayContaining([
            {
              label: expect.any(String),
              weight: expect.any(Number)
            }
          ]), []])
        } as ClassificationOutput
      ]);

      // Accept either a successful call or a connection error (for CI/dev convenience)
      expect(error).toBeUndefined();
    }, 120000);

    it('should classify return responses (integration smoke test)', async ({ expect, annotate }) => {
      // This is a smoke test. You must have a running gRPC server at localhost:50051 for this to pass.
      // You may want to mock the gRPC client for true unit testing.
      const imagePath = __dirname + '/448x448.jpg';
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

      annotate(`Correlation IDs: ${correlationId}`);

      // Create a promise to wrap the event emitter event 'data'
      const promise = new Promise<ClassificationOutput[]>((resolve, reject) => {
        // Add a timeout to reject the promise if no data is received in 30 seconds
        const timeout = setTimeout(() => {
          reject(new Error('Timeout waiting for classification response'));
        }, 30000);

        sdk.on('data', (data) => {
          const byCorrelationId = data.outputs.filter(o => o.correlationId === correlationId);
          if (byCorrelationId.length > 0) {
            clearTimeout(timeout);
            resolve(byCorrelationId);
          }
        });
        sdk.once('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      // This will fail if no server is running, but will exercise the code path.
      let error: any = undefined;

      await sdk.open();

      const imageStream = fs.createReadStream(imagePath);
      const options: ClassifyImageInput = {
        imageStream,
        correlationId,
        format: ImageFormat.JPEG,
      };
      try {
        await sdk.sendClassifyRequest(options);
      } catch (err) {
        error = err;
      }

      // Wait for classifier to process some data....
      const first = await promise;
      sdk.close();

      expect(first).toBeDefined();
      expect(first).toMatchObject([
        {
          correlationId,
          classifications: expect.toBeOneOf([expect.arrayContaining([
            {
              label: expect.any(String),
              weight: expect.any(Number)
            }
          ]), []])
        } as ClassificationOutput
      ]);

      // Accept either a successful call or a connection error (for CI/dev convenience)
      expect(error).toBeUndefined();
    }, 120000);
  });


});
