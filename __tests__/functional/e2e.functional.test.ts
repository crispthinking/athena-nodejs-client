import { describe, it, beforeAll } from 'vitest';
import { ClassifierSdk, ImageFormat } from '../../src';
import fs from 'fs';
import path from 'path';

/**
 * Expected outputs schema from testcases
 */
interface ExpectedOutputs {
  classification_labels: string[];
  images: [string, number[]][]; // [filename, weights[]]
}

/**
 * Determine image format from filename extension
 */
function getImageFormat(filename: string): ImageFormat {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return ImageFormat.IMAGE_FORMAT_JPEG;
    case '.png':
      return ImageFormat.IMAGE_FORMAT_PNG;
    case '.gif':
      return ImageFormat.IMAGE_FORMAT_GIF;
    case '.bmp':
      return ImageFormat.IMAGE_FORMAT_BMP;
    case '.webp':
      return ImageFormat.IMAGE_FORMAT_WEBP;
    default:
      return ImageFormat.IMAGE_FORMAT_PNG;
  }
}

/**
 * Default tolerance for floating-point comparisons.
 * See athena-protobufs/testcases/README.md for guidance:
 * - 1e-4 (0.0001) for exact model match
 * - 1e-2 (0.01) for model version drift
 * - 0.05 (5%) for behavioral validation
 */
const DEFAULT_TOLERANCE = 0.0001;

describe('E2E Test Cases', () => {
  const testcasesDir = path.resolve(__dirname, '../../athena-protobufs/testcases');
  const testset = 'integrator_sample';
  const tolerance = parseFloat(process.env.E2E_TOLERANCE ?? '') || DEFAULT_TOLERANCE;

  let sdk: ClassifierSdk;
  let expectedOutputs: ExpectedOutputs;
  let imagesDir: string;

  beforeAll(() => {
    // Initialize SDK with environment configuration
    sdk = new ClassifierSdk({
      deploymentId: process.env.VITE_ATHENA_DEPLOYMENT_ID ?? '',
      affiliate: process.env.VITE_ATHENA_AFFILIATE ?? '',
      grpcAddress:
        process.env.VITE_ATHENA_GRPC_ADDRESS ??
        'trust-messages-global.crispthinking.com:443',
      authentication: {
        issuerUrl:
          process.env.VITE_OAUTH_ISSUER ?? 'https://crispthinking.auth0.com/',
        clientId: process.env.VITE_ATHENA_CLIENT_ID ?? '',
        clientSecret: process.env.VITE_ATHENA_CLIENT_SECRET ?? '',
        audience: (process.env.VITE_ATHENA_AUDIENCE as 'crisp-athena-live' | 'crisp-athena-dev' | 'crisp-athena-qa') ?? 'crisp-athena-live',
        scope: 'manage:classify',
      },
    });

    // Load expected outputs
    const expectedOutputsPath = path.join(
      testcasesDir,
      testset,
      'expected_outputs.json',
    );
    expectedOutputs = JSON.parse(
      fs.readFileSync(expectedOutputsPath, 'utf-8'),
    ) as ExpectedOutputs;
    imagesDir = path.join(testcasesDir, testset, 'images');
  });

  describe(`${testset} testcases`, () => {
    it('should load expected outputs correctly', ({ expect }) => {
      expect(expectedOutputs).toBeDefined();
      expect(expectedOutputs.classification_labels).toBeInstanceOf(Array);
      expect(expectedOutputs.classification_labels.length).toBeGreaterThan(0);
      expect(expectedOutputs.images).toBeInstanceOf(Array);
      expect(expectedOutputs.images.length).toBeGreaterThan(0);
    });

    it('should have all test images available', ({ expect }) => {
      for (const [filename] of expectedOutputs.images) {
        const imagePath = path.join(imagesDir, filename);
        expect(
          fs.existsSync(imagePath),
          `Image not found: ${filename}`,
        ).toBe(true);
      }
    });

    it('should classify all images and match expected outputs', async ({
      expect,
      annotate,
    }) => {
      const labels = expectedOutputs.classification_labels;
      const failures: {
        filename: string;
        differences: { label: string; expected: number; actual: number; diff: number }[];
      }[] = [];

      annotate(`Running ${expectedOutputs.images.length} test images with tolerance ${tolerance}`);

      for (const [filename, expectedWeights] of expectedOutputs.images) {
        const imagePath = path.join(imagesDir, filename);

        const response = await sdk.classifySingle({
          data: fs.createReadStream(imagePath),
          format: getImageFormat(filename),
        });

        expect(response.error, `Classification error for ${filename}`).toBeNull();

        // Build actual weights map
        const actualWeights = new Map<string, number>();
        if (response.classifications) {
          for (const classification of response.classifications) {
            actualWeights.set(classification.label, classification.weight);
          }
        }

        // Compare each label
        const differences: { label: string; expected: number; actual: number; diff: number }[] = [];
        for (let i = 0; i < labels.length; i++) {
          const label = labels[i];
          const expected = expectedWeights[i];
          const actual = actualWeights.get(label) ?? 0;
          const diff = Math.abs(expected - actual);

          if (diff > tolerance) {
            differences.push({ label, expected, actual, diff });
          }
        }

        if (differences.length > 0) {
          failures.push({ filename, differences });
        }
      }

      // Report all failures at once for better test output
      if (failures.length > 0) {
        const failureDetails = failures
          .map(
            (f) =>
              `${f.filename}:\n${f.differences
                .map(
                  (d) =>
                    `  - ${d.label}: expected ${d.expected.toFixed(4)}, got ${d.actual.toFixed(4)} (diff: ${d.diff.toFixed(4)})`,
                )
                .join('\n')}`,
          )
          .join('\n\n');

        annotate(`Failures:\n${failureDetails}`);
      }

      expect(
        failures.length,
        `${failures.length} images failed classification comparison`,
      ).toBe(0);
    }, 120000); // 2 minute timeout for all images
  });
});
