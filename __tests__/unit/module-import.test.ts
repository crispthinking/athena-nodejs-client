import { describe, it, expect } from 'vitest';

describe('Module Import Tests', () => {
  describe('ESM Import', () => {
    it('should import the main module successfully', async () => {
      // Test dynamic import
      const module = await import('../../src/index.js');
      expect(module).toBeDefined();
      expect(typeof module).toBe('object');
    });

    it('should export all expected classes and types', async () => {
      const module = await import('../../src/index.js');

      // Main SDK class
      expect(module.ClassifierSdk).toBeDefined();
      expect(typeof module.ClassifierSdk).toBe('function');

      // gRPC client
      expect(module.ClassifierServiceClient).toBeDefined();
      expect(typeof module.ClassifierServiceClient).toBe('function');

      // Enums
      expect(module.HashType).toBeDefined();
      expect(module.ImageFormat).toBeDefined();
      expect(module.RequestEncoding).toBeDefined();
      expect(module.ErrorCode).toBeDefined();

      // Types should be available for TypeScript (interfaces don't exist at runtime)
      // We can't test interfaces directly, but we can test that they compile
    });

    it('should have correct enum values', async () => {
      const module = await import('../../src/index.js');

      // Test HashType enum values
      expect(module.HashType.HASH_TYPE_MD5).toBe(1);
      expect(module.HashType.HASH_TYPE_SHA1).toBe(2);
      expect(module.HashType.HASH_TYPE_UNKNOWN).toBe(0);

      // Test ImageFormat enum values
      expect(module.ImageFormat.IMAGE_FORMAT_UNSPECIFIED).toBe(0);
      expect(module.ImageFormat.IMAGE_FORMAT_JPEG).toBe(2);
      expect(module.ImageFormat.IMAGE_FORMAT_PNG).toBe(5);

      // Test RequestEncoding enum values
      expect(module.RequestEncoding.REQUEST_ENCODING_UNSPECIFIED).toBe(0);
      expect(module.RequestEncoding.REQUEST_ENCODING_UNCOMPRESSED).toBe(1);
      expect(module.RequestEncoding.REQUEST_ENCODING_BROTLI).toBe(2);

      // Test ErrorCode enum values
      expect(module.ErrorCode.ERROR_CODE_UNSPECIFIED).toBe(0);
      expect(module.ErrorCode.ERROR_CODE_IMAGE_TOO_LARGE).toBe(2);
    });

    it('should allow creating SDK instance with correct configuration', async () => {
      const module = await import('../../src/index.js');

      const sdk = new module.ClassifierSdk({
        deploymentId: 'test-deployment',
        affiliate: 'test-affiliate',
        authentication: {
          issuerUrl: 'https://test-issuer.com',
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
          scope: 'manage:classify',
        },
      });

      expect(sdk).toBeDefined();
      expect(sdk).toBeInstanceOf(module.ClassifierSdk);
    });
  });

  describe('Compatibility', () => {
    it('should be compatible with Node.js ESM module resolution', async () => {
      // Test that all relative imports resolve correctly
      const module = await import('../../src/index.js');

      // Verify we can access nested exports
      expect(module.computeHashesFromStream).toBeDefined();
      expect(typeof module.computeHashesFromStream).toBe('function');
    });

    it('should export the correct package structure for consumers', async () => {
      const module = await import('../../src/index.js');

      // Test that the module exports match what consumers expect
      const exportedKeys = Object.keys(module);

      // Should include the main SDK class
      expect(exportedKeys).toContain('ClassifierSdk');

      // Should include the gRPC client
      expect(exportedKeys).toContain('ClassifierServiceClient');

      // Should include all enums
      expect(exportedKeys).toContain('HashType');
      expect(exportedKeys).toContain('ImageFormat');
      expect(exportedKeys).toContain('RequestEncoding');
      expect(exportedKeys).toContain('ErrorCode');

      // Should include utility functions
      expect(exportedKeys).toContain('computeHashesFromStream');

      // Should include generated types/interfaces (these are exported for TypeScript)
      expect(exportedKeys).toContain('ClassifyRequest');
      expect(exportedKeys).toContain('ClassifyResponse');
      expect(exportedKeys).toContain('ClassificationInput');
      expect(exportedKeys).toContain('ClassificationOutput');
    });
  });
});
