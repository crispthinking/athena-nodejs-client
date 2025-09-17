#!/usr/bin/env node

/**
 * Athena Check Single - CLI tool for single image classification
 *
 * A command-line interface for classifying individual images using the
 * Athena Classifier SDK's classifySingle method. Supports various image
 * formats and provides detailed classification results with proper error handling.
 * Uses synchronous classification for immediate results.
 */

import { ClassifierSdk, ImageFormat, RequestEncoding } from '@crispthinking/athena-classifier-sdk';
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
  grpcAddress: process.env.ATHENA_GRPC_ADDRESS || 'trust.messages.crispthinking.com:443',
  audience: process.env.ATHENA_AUDIENCE || 'crisp-athena-live'
};

/**
 * Supported image formats mapping
 */
const IMAGE_FORMATS = {
  '.jpg': ImageFormat.IMAGE_FORMAT_JPEG,
  '.jpeg': ImageFormat.IMAGE_FORMAT_JPEG,
  '.png': ImageFormat.IMAGE_FORMAT_PNG,
  '.gif': ImageFormat.IMAGE_FORMAT_GIF,
  '.bmp': ImageFormat.IMAGE_FORMAT_BMP,
  '.webp': ImageFormat.IMAGE_FORMAT_WEBP
};

/**
 * Display usage information
 */
function showUsage() {
  console.log(`
🔍 Athena Check Single - Image Classification CLI

Usage:
  node index.js <image-path> [options]
  npm start <image-path> [options]

Arguments:
  image-path              Path to the image file to classify

Options:
  -h, --help             Show this help message
  -v, --verbose          Enable verbose output
  -f, --format <format>  Force image format (jpeg|png|gif|bmp|webp)
  -a, --affiliate <name> Override affiliate name

Environment Variables (Required):
  ATHENA_CLIENT_ID       OAuth client ID
  ATHENA_CLIENT_SECRET   OAuth client secret
  ATHENA_AFFILIATE       Affiliate identifier

Environment Variables (Optional):
  ATHENA_ISSUER_URL      OAuth issuer URL (default: https://crispthinking.auth0.com/)
  ATHENA_GRPC_ADDRESS    gRPC service address (default: trust.messages.crispthinking.com:443)
  ATHENA_AUDIENCE        OAuth audience (default: crisp-athena-live)

Examples:
  # Basic usage
  node index.js ./my-image.jpg

  # With verbose output
  node index.js ./image.png --verbose

  # Force image format
  node index.js ./image --format jpeg

Setup:
  # Create environment file
  cp ../.env.example .env
  # Edit .env with your credentials
  # Source with auto-export
  set -a; source .env; set +a
`);
}

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    imagePath: null,
    verbose: false,
    help: false,
    format: null,
    affiliate: null
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '-v':
      case '--verbose':
        options.verbose = true;
        break;
      case '-f':
      case '--format':
        options.format = args[++i];
        break;
      case '-a':
      case '--affiliate':
        options.affiliate = args[++i];
        break;
      default:
        if (!options.imagePath && !arg.startsWith('-')) {
          options.imagePath = arg;
        } else if (arg.startsWith('-')) {
          console.error(`❌ Unknown option: ${arg}`);
          process.exit(1);
        }
    }
  }

  return options;
}

/**
 * Validate configuration and arguments
 */
function validateConfig(options) {
  const errors = [];

  // Check required arguments
  if (!options.imagePath) {
    errors.push('Image path is required');
  }

  // Check if image file exists
  if (options.imagePath && !fs.existsSync(options.imagePath)) {
    errors.push(`Image file does not exist: ${options.imagePath}`);
  }

  // Check required environment variables
  const requiredEnvVars = ['clientId', 'clientSecret', 'affiliate'];
  for (const envVar of requiredEnvVars) {
    if (!CONFIG[envVar]) {
      const envVarName = `ATHENA_${envVar.replace(/([A-Z])/g, '_$1').toUpperCase()}`;
      errors.push(`Missing environment variable: ${envVarName}`);
    }
  }

  // Validate image format if specified
  if (options.format) {
    const validFormats = ['jpeg', 'png', 'gif', 'bmp', 'webp'];
    if (!validFormats.includes(options.format.toLowerCase())) {
      errors.push(`Invalid format: ${options.format}. Valid formats: ${validFormats.join(', ')}`);
    }
  }

  return errors;
}

/**
 * Determine image format from file extension or override
 */
function getImageFormat(imagePath, formatOverride) {
  if (formatOverride) {
    const format = formatOverride.toLowerCase();
    switch (format) {
      case 'jpeg':
      case 'jpg':
        return ImageFormat.IMAGE_FORMAT_JPEG;
      case 'png':
        return ImageFormat.IMAGE_FORMAT_PNG;
      case 'gif':
        return ImageFormat.IMAGE_FORMAT_GIF;
      case 'bmp':
        return ImageFormat.IMAGE_FORMAT_BMP;
      case 'webp':
        return ImageFormat.IMAGE_FORMAT_WEBP;
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  const ext = path.extname(imagePath).toLowerCase();
  const format = IMAGE_FORMATS[ext];

  if (!format) {
    throw new Error(`Unsupported file extension: ${ext}. Use --format to override.`);
  }

  return format;
}

/**
 * Format classification results for display
 */
function formatResults(result, verbose = false) {
  console.log('\n📊 Classification Results:');
  console.log('='.repeat(50));

  if (result.globalError) {
    console.log('❌ Global Error:', result.globalError);
    return;
  }

  if (!result.outputs || result.outputs.length === 0) {
    console.log('⚠️  No classification outputs received');
    return;
  }

  result.outputs.forEach((output, index) => {
    console.log(`\n🔍 Result ${index + 1}:`);
    console.log(`   Correlation ID: ${output.correlationId}`);

    if (output.error) {
      console.log('   ❌ Error:', output.error);
    }

    if (output.classifications && output.classifications.length > 0) {
      console.log('   ✅ Classifications:');
      output.classifications.forEach((classification, classIndex) => {
        console.log(`      ${classIndex + 1}. Score: ${classification.score?.toFixed(4) || 'N/A'}`);
        if (classification.label) {
          console.log(`         Label: ${classification.label}`);
        }
        if (verbose && classification.confidence) {
          console.log(`         Confidence: ${classification.confidence}`);
        }
      });
    } else {
      console.log('   ⚠️  No classifications found');
    }

    if (verbose && output.metadata) {
      console.log('   📋 Metadata:', JSON.stringify(output.metadata, null, 2));
    }
  });
}

/**
 * Main classification function using the synchronous classifySingle method
 */
async function classifyImage(options) {
  const deploymentId = ''; // Always empty for classifySingle
  const affiliate = options.affiliate || CONFIG.affiliate;

  console.log('🚀 Athena Single Image Classification');
  console.log('='.repeat(40));

  if (options.verbose) {
    console.log('📋 Configuration:');
    console.log(`   Image: ${options.imagePath}`);
    console.log(`   Deployment: ${deploymentId}`);
    console.log(`   Affiliate: ${affiliate}`);
    console.log(`   gRPC Address: ${CONFIG.grpcAddress}`);
    console.log('');
  }

  // Initialize SDK
  console.log('🔧 Initializing Athena SDK...');
  const sdk = new ClassifierSdk({
    deploymentId,
    affiliate,
    grpcAddress: CONFIG.grpcAddress,
    authentication: {
      issuerUrl: CONFIG.issuerUrl,
      clientId: CONFIG.clientId,
      clientSecret: CONFIG.clientSecret,
      audience: CONFIG.audience
    }
  });

  try {
    // Read and prepare image
    console.log('📁 Loading image...');
    const imageBuffer = fs.readFileSync(options.imagePath);
    const imageFormat = getImageFormat(options.imagePath, options.format);
    const imageStats = fs.statSync(options.imagePath);

    if (options.verbose) {
      console.log(`   File size: ${Math.round(imageStats.size / 1024)} KB`);
      console.log(`   Format: ${Object.keys(ImageFormat)[Object.values(ImageFormat).indexOf(imageFormat)]}`);
    }

    // Open connection and classify
    console.log('🔗 Connecting to Athena service...');
    // Note: classifySingle doesn't require opening a streaming connection

    console.log('🔍 Classifying image...');

        // Send classification request using classifySingle
    const result = await sdk.classifySingle({
      data: fs.createReadStream(options.imagePath),
      format: imageFormat,
      encoding: RequestEncoding.REQUEST_ENCODING_UNCOMPRESSED,
    });

    // Return the classification output directly
    return { outputs: [result] };

  } catch (error) {
    throw error;
  }
}

/**
 * Main entry point
 */
async function main() {
  try {
    const options = parseArgs();

    if (options.help) {
      showUsage();
      process.exit(0);
    }

    const errors = validateConfig(options);
    if (errors.length > 0) {
      console.error('❌ Configuration errors:');
      errors.forEach(error => console.error(`   • ${error}`));
      console.error('\nUse --help for usage information');
      process.exit(1);
    }

    const result = await classifyImage(options);
    formatResults(result, options.verbose);

    console.log('\n✅ Classification completed successfully');
    process.exit(0);

  } catch (error) {
    console.error(`\n❌ Classification failed: ${error.message}`);
    if (process.env.NODE_ENV === 'development') {
      console.error('Stack trace:', error.stack);
    }
    process.exit(1);
  }
}

// Run the CLI
main();
