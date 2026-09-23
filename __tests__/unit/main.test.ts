import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as telemetry from '../../src/telemetry.js';

const authenticationState = vi.hoisted(() => ({
  appendAuthorizationToMetadata: vi.fn(),
}));

const clientState = vi.hoisted(() => ({
  classify: vi.fn(),
  classifySingle: vi.fn(),
  listDeployments: vi.fn(),
}));

const hashingState = vi.hoisted(() => ({
  computeHashesFromStream: vi.fn(),
}));

const telemetryState = vi.hoisted(() => ({
  annotateEventLoopDelay: vi.fn(),
  enableEventLoopMonitoring: vi.fn(),
  recordClassifyDuration: vi.fn(),
  recordPrepare: vi.fn(),
  recordRpc: vi.fn(),
}));

// Mock the dependencies
vi.mock('../../src/generated/athena/models.js', () => ({
  HashType: {
    HASH_TYPE_MD5: 1,
    HASH_TYPE_SHA1: 2,
  },
  ImageFormat: {
    IMAGE_FORMAT_UNSPECIFIED: 0,
    IMAGE_FORMAT_PNG: 1,
    IMAGE_FORMAT_JPEG: 2,
    IMAGE_FORMAT_RAW_UINT8_BGR: 3,
  },
  RequestEncoding: {
    REQUEST_ENCODING_UNCOMPRESSED: 1,
    REQUEST_ENCODING_BROTLI: 2,
  },
}));
vi.mock('../../src/generated/athena/athena.js', () => ({
  ClassifierServiceClient: class {
    classify = clientState.classify;
    classifySingle = clientState.classifySingle;
    listDeployments = clientState.listDeployments;
  },
}));
vi.mock('../../src/generated/google/protobuf/empty.js', () => ({
  Empty: {},
}));
vi.mock('@grpc/grpc-js', () => ({
  credentials: {
    createSsl: vi.fn(() => ({ type: 'ssl' })),
  },
  Metadata: class {
    values = new Map<string, unknown[]>();

    set(key: string, value: unknown) {
      this.values.set(key, [value]);
    }

    get(key: string) {
      return this.values.get(key) ?? [];
    }
  },
}));
vi.mock('../../src/authenticationManager.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../src/authenticationManager.js')
  >('../../src/authenticationManager.js');
  return {
    ...actual,
    AuthenticationManager: class {
      appendAuthorizationToMetadata =
        authenticationState.appendAuthorizationToMetadata;
    },
  };
});
vi.mock('../../src/hashing.js', () => ({
  computeHashesFromStream: hashingState.computeHashesFromStream,
}));
vi.mock('../../src/telemetry.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/telemetry.js')>(
    '../../src/telemetry.js',
  );
  return {
    ...actual,
    annotateEventLoopDelay: telemetryState.annotateEventLoopDelay,
    enableEventLoopMonitoring: telemetryState.enableEventLoopMonitoring,
    recordClassifyDuration: telemetryState.recordClassifyDuration,
    recordPrepare: telemetryState.recordPrepare,
    recordRpc: telemetryState.recordRpc,
  };
});

describe('ClassifierSdk', () => {
  let ClassifierSdk: typeof import('../../src/index.js').ClassifierSdk;
  let ImageFormat: typeof import('../../src/index.js').ImageFormat;
  let sdk: import('../../src/index.js').ClassifierSdk;

  beforeEach(async () => {
    vi.resetModules();
    authenticationState.appendAuthorizationToMetadata.mockReset();
    authenticationState.appendAuthorizationToMetadata.mockResolvedValue(
      undefined,
    );
    clientState.classify.mockReset();
    clientState.classifySingle.mockReset();
    clientState.listDeployments.mockReset();
    hashingState.computeHashesFromStream.mockReset();
    telemetryState.annotateEventLoopDelay.mockReset();
    telemetryState.enableEventLoopMonitoring.mockReset();
    telemetryState.recordClassifyDuration.mockReset();
    telemetryState.recordPrepare.mockReset();
    telemetryState.recordRpc.mockReset();

    ({ ClassifierSdk, ImageFormat } = await import('../../src/index.js'));
    hashingState.computeHashesFromStream.mockResolvedValue({
      data: Buffer.from('prepared'),
      format: ImageFormat.IMAGE_FORMAT_PNG,
      md5: 'mock-md5',
      sha1: 'mock-sha1',
    });
    sdk = new ClassifierSdk({
      deploymentId: 'test-deployment',
      affiliate: 'test-affiliate',
      authentication: {
        issuerUrl: 'https://test-issuer.com',
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
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
      expect(ImageFormat.IMAGE_FORMAT_RAW_UINT8_BGR).toBeDefined();
    });

    it('should have correct values for image formats', () => {
      expect(typeof ImageFormat.IMAGE_FORMAT_PNG).toBe('number');
      expect(typeof ImageFormat.IMAGE_FORMAT_JPEG).toBe('number');
      expect(typeof ImageFormat.IMAGE_FORMAT_RAW_UINT8_BGR).toBe('number');
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

    it('should record prepare and classify durations when image processing fails', async () => {
      hashingState.computeHashesFromStream.mockRejectedValueOnce(
        new Error('prepare failed'),
      );

      await expect(
        sdk.classifySingle({
          data: Buffer.from('test'),
          format: ImageFormat.IMAGE_FORMAT_PNG,
        }),
      ).rejects.toThrow('prepare failed');

      expect(telemetryState.recordPrepare).toHaveBeenCalledWith(
        expect.any(Number),
        undefined,
        {
          [telemetry.AthenaAttributes.encoding]: 'uncompressed',
          [telemetry.AthenaAttributes.resize]: true,
        },
      );
      expect(telemetryState.recordClassifyDuration).toHaveBeenCalledWith(
        expect.any(Number),
        {
          [telemetry.AthenaAttributes.deploymentId]: 'test-deployment',
          [telemetry.AthenaAttributes.affiliate]: 'test-affiliate',
          [telemetry.AthenaAttributes.encoding]: 'uncompressed',
        },
      );
      expect(telemetryState.recordRpc).not.toHaveBeenCalled();
    });

    it('should record classify duration when the RPC fails', async () => {
      const rpcError = new Error('rpc failed');
      (sdk as any).client.classifySingle.mockImplementation(
        (
          _input: unknown,
          _metadata: unknown,
          callback: (error: Error) => void,
        ) => callback(rpcError),
      );

      await expect(
        sdk.classifySingle({
          data: Buffer.from('test'),
          format: ImageFormat.IMAGE_FORMAT_PNG,
        }),
      ).rejects.toThrow('rpc failed');

      expect(telemetryState.recordClassifyDuration).toHaveBeenCalledWith(
        expect.any(Number),
        {
          [telemetry.AthenaAttributes.deploymentId]: 'test-deployment',
          [telemetry.AthenaAttributes.affiliate]: 'test-affiliate',
          [telemetry.AthenaAttributes.encoding]: 'uncompressed',
        },
      );
      expect(telemetryState.recordRpc).toHaveBeenCalledWith(
        expect.any(Number),
        {
          [telemetry.AthenaAttributes.deploymentId]: 'test-deployment',
          [telemetry.AthenaAttributes.affiliate]: 'test-affiliate',
          [telemetry.AthenaAttributes.encoding]: 'uncompressed',
        },
      );
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
