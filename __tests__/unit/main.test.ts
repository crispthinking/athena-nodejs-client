import { describe, it, afterEach, beforeEach, vi, expect } from 'vitest';
import { classifyImage, computeHashesFromStream, ClassifyImageOptions } from '../../src/main.js';


import fs from 'fs';

describe('classifyImage function', () => {
  it('should classify Steamboat-willie.jpg and return responses (integration smoke test)', async () => {
    // This is a smoke test. You must have a running gRPC server at localhost:50051 for this to pass.
    // You may want to mock the gRPC client for true unit testing.
    const imagePath = __dirname + '/Steamboat-willie.jpg';
    const imageStream = fs.createReadStream(imagePath);
    const options: ClassifyImageOptions = {
      imageStream,
      deploymentId: 'test-deployment',
      affiliate: 'test-affiliate',
      correlationId: 'test-correlation',
      // encoding, format, grpcAddress use defaults
    };
    // This will fail if no server is running, but will exercise the code path.
    let error: any = null;
    try {
      const responses = await classifyImage(options);
      expect(Array.isArray(responses)).toBe(true);
    } catch (err) {
      error = err;
    }
    // Accept either a successful call or a connection error (for CI/dev convenience)
    if (error) {
      expect(error.message).toMatch(/connect|unavailable|ECONNREFUSED|14/);
    }
  });
});
