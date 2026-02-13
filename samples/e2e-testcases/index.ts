#!/usr/bin/env npx tsx

/**
 * Athena E2E Test Cases Runner
 *
 * Runs shared end-to-end test cases from athena-protobufs/testcases/
 * through the Athena classification service and validates results
 * against expected outputs.
 */

import { ClassifierSdk, ImageFormat } from '@crispthinking/athena-classifier-sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ES module directory resolution
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Configuration loaded from environment variables
 */
const CONFIG = {
  clientId: process.env.ATHENA_CLIENT_ID,
  clientSecret: process.env.ATHENA_CLIENT_SECRET,
  affiliate: process.env.ATHENA_AFFILIATE,
  issuerUrl: process.env.ATHENA_ISSUER_URL || 'https://crispthinking.auth0.com/',
  grpcAddress: process.env.ATHENA_GRPC_ADDRESS || 'trust-messages-global.crispthinking.com:443',
  audience: process.env.ATHENA_AUDIENCE || 'crisp-athena-live'
};

/**
 * Test set paths relative to athena-protobufs/testcases/
 */
const TESTCASES_DIR = path.resolve(__dirname, '../../athena-protobufs/testcases');

const VALID_TESTSETS = ['integrator_sample', 'benign_model', 'live_model'] as const;
type TestSet = typeof VALID_TESTSETS[number];

/**
 * Expected outputs schema from testcases
 */
interface ExpectedOutputs {
  classification_labels: string[];
  images: [string, number[]][]; // [filename, weights[]]
}

/**
 * Comparison result for a single image
 */
interface ImageComparisonResult {
  filename: string;
  passed: boolean;
  differences: {
    label: string;
    expected: number;
    actual: number;
    diff: number;
  }[];
}

/**
 * Display usage information
 */
function showUsage(): void {
  console.log(`
🧪 Athena E2E Test Cases Runner

Usage:
  npx tsx index.ts [options]
  npm start [options]

Options:
  -h, --help                 Show this help message
  -t, --testset <name>       Test set to run (default: integrator_sample)
                             Valid: integrator_sample, benign_model, live_model
  -T, --tolerance <value>    Comparison tolerance (default: 0.0001)
  -v, --verbose              Enable verbose output
  -l, --list                 List available test sets and exit

Environment Variables (Required):
  ATHENA_CLIENT_ID           OAuth client ID
  ATHENA_CLIENT_SECRET       OAuth client secret
  ATHENA_AFFILIATE           Affiliate identifier

Environment Variables (Optional):
  ATHENA_ISSUER_URL          OAuth issuer URL (default: https://crispthinking.auth0.com/)
  ATHENA_GRPC_ADDRESS        gRPC service address (default: trust-messages-global.crispthinking.com:443)
  ATHENA_AUDIENCE            OAuth audience (default: crisp-athena-live)

Examples:
  # Run default test set
  npx tsx index.ts

  # Run specific test set with custom tolerance
  npx tsx index.ts --testset live_model --tolerance 0.01

  # Verbose output
  npx tsx index.ts --verbose

Setup:
  # Create environment file
  cp ../.env.example ../.env
  # Edit ../.env with your credentials
  # Source with auto-export
  set -a && source ../.env && set +a
`);
}

/**
 * Parse command line arguments
 */
function parseArgs(): { testset: TestSet; tolerance: number; verbose: boolean; list: boolean; help: boolean } {
  const args = process.argv.slice(2);
  const options = {
    testset: 'integrator_sample' as TestSet,
    tolerance: 0.0001,
    verbose: false,
    list: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '-v' || arg === '--verbose') {
      options.verbose = true;
    } else if (arg === '-l' || arg === '--list') {
      options.list = true;
    } else if (arg === '-t' || arg === '--testset') {
      const value = args[++i] as TestSet;
      if (!VALID_TESTSETS.includes(value)) {
        console.error(`Error: Invalid test set '${value}'. Valid options: ${VALID_TESTSETS.join(', ')}`);
        process.exit(2);
      }
      options.testset = value;
    } else if (arg === '-T' || arg === '--tolerance') {
      const value = parseFloat(args[++i]);
      if (isNaN(value) || value < 0) {
        console.error('Error: Tolerance must be a positive number');
        process.exit(2);
      }
      options.tolerance = value;
    }
  }

  return options;
}

/**
 * Validate configuration
 */
function validateConfig(): void {
  const missing: string[] = [];

  if (!CONFIG.clientId) missing.push('ATHENA_CLIENT_ID');
  if (!CONFIG.clientSecret) missing.push('ATHENA_CLIENT_SECRET');
  if (!CONFIG.affiliate) missing.push('ATHENA_AFFILIATE');

  if (missing.length > 0) {
    console.error(`Error: Missing required environment variables: ${missing.join(', ')}`);
    console.error('\nSet these variables or create a .env file. Run with --help for more info.');
    process.exit(2);
  }
}

/**
 * Load expected outputs from a test set
 */
function loadExpectedOutputs(testset: TestSet): ExpectedOutputs {
  const filePath = path.join(TESTCASES_DIR, testset, 'expected_outputs.json');

  if (!fs.existsSync(filePath)) {
    console.error(`Error: Expected outputs file not found: ${filePath}`);
    console.error('Make sure the athena-protobufs submodule is initialized.');
    process.exit(2);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content) as ExpectedOutputs;
}

/**
 * List available test sets and their image counts
 */
function listTestSets(): void {
  console.log('\nAvailable test sets:\n');

  for (const testset of VALID_TESTSETS) {
    const testsetPath = path.join(TESTCASES_DIR, testset);
    const expectedPath = path.join(testsetPath, 'expected_outputs.json');

    if (fs.existsSync(expectedPath)) {
      const data = loadExpectedOutputs(testset);
      console.log(`  ${testset}`);
      console.log(`    Images: ${data.images.length}`);
      console.log(`    Labels: ${data.classification_labels.join(', ')}`);
      console.log();
    } else {
      console.log(`  ${testset} (not available)`);
    }
  }
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
      return ImageFormat.IMAGE_FORMAT_PNG; // Default to PNG
  }
}

/**
 * Compare classification results with expected outputs
 */
function compareResults(
  labels: string[],
  expected: number[],
  actual: Map<string, number>,
  tolerance: number
): ImageComparisonResult['differences'] {
  const differences: ImageComparisonResult['differences'] = [];

  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    const expectedWeight = expected[i];
    const actualWeight = actual.get(label) ?? 0;
    const diff = Math.abs(expectedWeight - actualWeight);

    if (diff > tolerance) {
      differences.push({
        label,
        expected: expectedWeight,
        actual: actualWeight,
        diff,
      });
    }
  }

  return differences;
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  const options = parseArgs();

  if (options.help) {
    showUsage();
    process.exit(0);
  }

  if (options.list) {
    listTestSets();
    process.exit(0);
  }

  validateConfig();

  console.log('🧪 Athena E2E Test Cases Runner\n');

  // Load expected outputs
  const expectedOutputs = loadExpectedOutputs(options.testset);
  const { classification_labels: labels, images } = expectedOutputs;

  console.log('Configuration:');
  console.log(`  Test Set: ${options.testset}`);
  console.log(`  Tolerance: ${options.tolerance}`);
  console.log(`  Images: ${images.length}`);
  console.log(`  Labels: ${labels.join(', ')}`);
  console.log();

  // Initialize SDK
  const sdk = new ClassifierSdk({
    deploymentId: '',
    affiliate: CONFIG.affiliate!,
    grpcAddress: CONFIG.grpcAddress,
    authentication: {
      issuerUrl: CONFIG.issuerUrl,
      clientId: CONFIG.clientId!,
      clientSecret: CONFIG.clientSecret!,
      audience: CONFIG.audience,
    },
  });

  const results: ImageComparisonResult[] = [];
  const imagesDir = path.join(TESTCASES_DIR, options.testset, 'images');

  console.log('Running tests...\n');

  // Process each image
  for (const [filename, expectedWeights] of images) {
    const imagePath = path.join(imagesDir, filename);

    if (!fs.existsSync(imagePath)) {
      console.error(`  ⚠ ${filename} - Image not found (skipped)`);
      continue;
    }

    try {
      const response = await sdk.classifySingle({
        data: fs.createReadStream(imagePath),
        format: getImageFormat(filename),
      });

      if (response.error) {
        console.error(`  ✗ ${filename} - Classification error: ${response.error}`);
        results.push({ filename, passed: false, differences: [] });
        continue;
      }

      // Build actual weights map from response
      const actualWeights = new Map<string, number>();
      if (response.classifications) {
        for (const classification of response.classifications) {
          actualWeights.set(classification.label, classification.weight);
        }
      }

      // Compare results
      const differences = compareResults(labels, expectedWeights, actualWeights, options.tolerance);
      const passed = differences.length === 0;

      results.push({ filename, passed, differences });

      if (passed) {
        console.log(`  ✓ ${filename} - PASS`);
      } else {
        console.log(`  ✗ ${filename} - FAIL`);
        if (options.verbose) {
          for (const diff of differences) {
            console.log(`    Label '${diff.label}': expected ${diff.expected.toFixed(4)}, got ${diff.actual.toFixed(4)} (diff: ${diff.diff.toFixed(4)})`);
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ ${filename} - Error: ${message}`);
      results.push({ filename, passed: false, differences: [] });
    }
  }

  // Summary
  const passedCount = results.filter(r => r.passed).length;
  const totalCount = results.length;
  const percentage = totalCount > 0 ? ((passedCount / totalCount) * 100).toFixed(0) : '0';

  console.log(`\nResults: ${passedCount}/${totalCount} passed (${percentage}%)`);

  // Exit with appropriate code
  if (passedCount < totalCount) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(2);
});
