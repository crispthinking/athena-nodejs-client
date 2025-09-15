import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClassifierSdk, ImageFormat } from '../../src';

// Mock the dependencies
vi.mock('@grpc/grpc-js');
vi.mock('../../src/authenticationManager');

describe('ClassifierSdk', () => {
  let sdk: ClassifierSdk;

  beforeEach(() => {
    sdk = new ClassifierSdk({
      deploymentId: 'test-deployment',
      affiliate: 'test-affiliate',
      authentication: {
        issuerUrl: 'https://test-issuer.com',
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        scope: 'manage:classify',
      },
    });
  });

  describe('constructor', () => {
    it('should create a ClassifierSdk instance with valid configuration', () => {
      expect(sdk).toBeDefined();
      expect(sdk).toBeInstanceOf(ClassifierSdk);
    });

    it('should accept optional grpcAddress configuration', () => {
      const customSdk = new ClassifierSdk({
        deploymentId: 'test-deployment',
        affiliate: 'test-affiliate',
        grpcAddress: 'custom-host:9000',
        authentication: {
          issuerUrl: 'https://test-issuer.com',
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
          scope: 'manage:classify',
        },
      });

      expect(customSdk).toBeDefined();
      expect(customSdk).toBeInstanceOf(ClassifierSdk);
    });

    it('should accept optional keepAliveInterval configuration', () => {
      const customSdk = new ClassifierSdk({
        deploymentId: 'test-deployment',
        affiliate: 'test-affiliate',
        keepAliveInterval: 5000,
        authentication: {
          issuerUrl: 'https://test-issuer.com',
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
          scope: 'manage:classify',
        },
      });

      expect(customSdk).toBeDefined();
      expect(customSdk).toBeInstanceOf(ClassifierSdk);
    });
  });

  describe('ImageFormat enum', () => {
    it('should have all expected image formats', () => {
      expect(ImageFormat.IMAGE_FORMAT_PNG).toBeDefined();
      expect(ImageFormat.IMAGE_FORMAT_JPEG).toBeDefined();
      expect(ImageFormat.IMAGE_FORMAT_RAW_UINT8).toBeDefined();
    });

    it('should have correct values for image formats', () => {
      expect(typeof ImageFormat.IMAGE_FORMAT_PNG).toBe('number');
      expect(typeof ImageFormat.IMAGE_FORMAT_JPEG).toBe('number');
      expect(typeof ImageFormat.IMAGE_FORMAT_RAW_UINT8).toBe('number');
    });
  });

  describe('event handling', () => {
    it('should be an event emitter', () => {
      expect(typeof sdk.on).toBe('function');
      expect(typeof sdk.emit).toBe('function');
      expect(typeof sdk.once).toBe('function');
      expect(typeof sdk.off).toBe('function');
    });

    it('should handle event listener registration', () => {
      const mockHandler = vi.fn();

      sdk.on('data', mockHandler);
      sdk.on('error', mockHandler);

      expect(sdk.listenerCount('data')).toBe(1);
      expect(sdk.listenerCount('error')).toBe(1);
    });

    it('should handle event listener removal', () => {
      const mockHandler = vi.fn();

      sdk.on('data', mockHandler);
      expect(sdk.listenerCount('data')).toBe(1);

      sdk.off('data', mockHandler);
      expect(sdk.listenerCount('data')).toBe(0);
    });
  });

  describe('API methods', () => {
    it('should have listDeployments method', () => {
      expect(typeof sdk.listDeployments).toBe('function');
    });

    it('should have open method', () => {
      expect(typeof sdk.open).toBe('function');
    });

    it('should have close method', () => {
      expect(typeof sdk.close).toBe('function');
    });

    it('should have sendClassifyRequest method', () => {
      expect(typeof sdk.sendClassifyRequest).toBe('function');
    });

    it('should have classifySingle method', () => {
      expect(typeof sdk.classifySingle).toBe('function');
    });

    it('should throw error when sendClassifyRequest called without open', async () => {
      const input = {
        data: Buffer.from('test'),
        format: ImageFormat.IMAGE_FORMAT_PNG,
      };

      await expect(sdk.sendClassifyRequest(input)).rejects.toThrow(
        'gRPC stream is not open',
      );
    });
  });

  describe('connection lifecycle', () => {
    it('should handle open/close operations', async () => {
      // Mock the underlying gRPC operations
      const mockOpen = vi.spyOn(sdk, 'open').mockResolvedValue(void 0);
      const mockClose = vi.spyOn(sdk, 'close').mockReturnValue(void 0);

      await sdk.open();
      expect(mockOpen).toHaveBeenCalled();

      sdk.close();
      expect(mockClose).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle connection errors gracefully', () => {
      const mockErrorHandler = vi.fn();
      sdk.on('error', mockErrorHandler);

      // Simulate an error
      sdk.emit('error', new Error('Connection failed'));

      expect(mockErrorHandler).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});
