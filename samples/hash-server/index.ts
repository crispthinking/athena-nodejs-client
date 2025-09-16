import { ClassifierSdk, HashType, ImageFormat, RequestEncoding, type ClassifyImageInput } from '@crispthinking/athena-classifier-sdk';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import type { MulterError } from 'multer';
import { randomUUID } from 'crypto';
import { createReadStream, unlinkSync } from 'fs';
import { extname } from 'path';

/**
 * Configuration loaded from environment variables
 */
const CONFIG = {
  clientId: process.env.ATHENA_CLIENT_ID,
  clientSecret: process.env.ATHENA_CLIENT_SECRET,
  affiliate: process.env.ATHENA_AFFILIATE,
  issuerUrl: process.env.ATHENA_ISSUER_URL || 'https://crispthinking.auth0.com/',
  grpcAddress: process.env.ATHENA_GRPC_ADDRESS || 'trust.messages.crispthinking.com:443',
  audience: process.env.ATHENA_AUDIENCE || 'crisp-athena-live',
  port: parseInt(process.env.PORT || '3000')
};

/**
 * Image format mapping
 */
const IMAGE_FORMATS: Record<string, ImageFormat> = {
  '.jpg': ImageFormat.IMAGE_FORMAT_JPEG,
  '.jpeg': ImageFormat.IMAGE_FORMAT_JPEG,
  '.png': ImageFormat.IMAGE_FORMAT_PNG,
  '.gif': ImageFormat.IMAGE_FORMAT_GIF,
  '.bmp': ImageFormat.IMAGE_FORMAT_BMP,
  '.webp': ImageFormat.IMAGE_FORMAT_WEBP
};

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('❌ Deployment ID is required');
    console.error('Usage: npm start <deployment-id> [port]');
    console.error('   or: node index.js <deployment-id> [port]');
    process.exit(1);
  }

  if (args[0] === '--help' || args[0] === '-h') {
    console.log(`
🔧 Athena Hash Server - HTTP Image Classification Server

Usage:
  npm start <deployment-id> [port]
  node index.js <deployment-id> [port]

Arguments:
  deployment-id           Target deployment for classification
  port                   HTTP server port (default: 3000, or PORT env var)

Environment Variables (Required):
  ATHENA_CLIENT_ID        OAuth client ID
  ATHENA_CLIENT_SECRET    OAuth client secret
  ATHENA_AFFILIATE        Affiliate identifier

Environment Variables (Optional):
  ATHENA_ISSUER_URL       OAuth issuer URL (default: https://crispthinking.auth0.com/)
  ATHENA_GRPC_ADDRESS     gRPC service address (default: trust.messages.crispthinking.com:443)
  ATHENA_AUDIENCE         OAuth audience (default: crisp-athena-live)
  PORT                   HTTP server port (default: 3000)

API Endpoints:
  POST /classify          Upload and classify images
  GET  /health           Health check endpoint
  GET  /                 API documentation

Setup:
  # Create environment file
  cp ../.env.example .env
  # Edit .env with your credentials
  # Source with auto-export
  set -a; source .env; set +a

Examples:
  npm start my-deployment-id
  npm start my-deployment-id 8080

  # Test with curl
  curl -X POST -F "image=@test.jpg" http://localhost:3000/classify
`);
    process.exit(0);
  }

  return {
    deploymentId: args[0],
    port: args[1] ? parseInt(args[1]) : CONFIG.port
  };
}

/**
 * Validate configuration
 */
function validateConfig() {
  const errors = [];
  const requiredEnvVars: (keyof typeof CONFIG)[] = ['clientId', 'clientSecret', 'affiliate'];

  for (const envVar of requiredEnvVars) {
    if (!CONFIG[envVar]) {
      const envVarName = `ATHENA_${envVar.replace(/([A-Z])/g, '_$1').toUpperCase()}`;
      errors.push(`Missing environment variable: ${envVarName}`);
    }
  }

  if (errors.length > 0) {
    console.error('❌ Configuration errors:');
    for (const error of errors) {
      console.error(`   • ${error}`);
    }
    console.error('\nUse --help for usage information');
    process.exit(1);
  }
}

/**
 * Get image format from file extension
 */
function getImageFormat(filename: string): ImageFormat | null {
  const ext = extname(filename).toLowerCase();
  return IMAGE_FORMATS[ext] || null;
}

// Parse arguments and validate configuration
const options = parseArgs();
validateConfig();

console.log('🚀 Athena Hash Server - HTTP Image Classification');
console.log('='.repeat(60));
console.log(`📋 Configuration:`);
console.log(`   Deployment: ${options.deploymentId}`);
console.log(`   Affiliate: ${CONFIG.affiliate}`);
console.log(`   gRPC Address: ${CONFIG.grpcAddress}`);
console.log(`   HTTP Port: ${options.port}`);
console.log('');

// Initialize SDK with environment configuration
const sdk = new ClassifierSdk({
  authentication: {
    clientId: CONFIG.clientId!,
    clientSecret: CONFIG.clientSecret!,
    issuerUrl: CONFIG.issuerUrl!,
    audience: CONFIG.audience! as 'crisp-athena-live' | 'crisp-athena-dev' | 'crisp-athena-qa'
  },
  grpcAddress: CONFIG.grpcAddress!,
  affiliate: CONFIG.affiliate!,
  deploymentId: options.deploymentId!
});

// Configure multer for file uploads
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 10 // Max 10 files per request
  },
  fileFilter: (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    const format = getImageFormat(file.originalname);
    if (format) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported image format. Supported: jpg, jpeg, png, gif, bmp, webp'));
    }
  }
});

// Initialize Express app
const app = express();

// Middleware
app.use(express.json());

// Classification endpoint
app.post('/', upload.array('image'), async (req: Request, res: Response) => {
  try {
    // Defensive: Multer should always provide an array here, but check to prevent type confusion.
    if (!Array.isArray(req.files)) {
      return res.status(400).json({
        error: 'Invalid files payload',
        message: 'The "image" field must be an array of files'
      });
    }
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      return res.status(400).json({
        error: 'No images provided',
        message: 'Please upload one or more images using the "image" field'
      });
    }

    console.log(`📁 Processing ${files.length} image(s)...`);

    // Prepare classification inputs
    const inputs: ClassifyImageInput[] = files.map(file => {
      const format = getImageFormat(file.originalname);
      if (!format) {
        throw new Error(`Unsupported format for file: ${file.originalname}`);
      }

      return {
        data: createReadStream(file.path),
        format,
        correlationId: randomUUID(),
        encoding: RequestEncoding.REQUEST_ENCODING_UNCOMPRESSED,
        includeHashes: [HashType.HASH_TYPE_MD5, HashType.HASH_TYPE_SHA1]
      };
    });

    // Send classification request
    await sdk.sendClassifyRequest(inputs);

    // Return results
    res.json({
      success: true,
      totalImages: files.length,
      correlationIds: inputs.map(input => input.correlationId),
      processedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Classification error:', error);

    // Clean up temporary files on error
    if (req.files) {
      (req.files as Express.Multer.File[]).forEach(file => {
        try {
          unlinkSync(file.path);
        } catch (err) {
          console.warn(`Failed to cleanup temp file: ${file.path}`);
        }
      });
    }

    res.status(500).json({
      error: 'Classification failed',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    });
  }
});

// Error handling middleware
app.use((error: any, req: Request, res: Response, next: NextFunction) => {
  console.error('❌ Server error:', error);

  if (error instanceof Error && 'code' in error) {
    const multerError = error as MulterError;
    if (multerError.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large', message: 'Maximum file size is 10MB' });
    }
    if (multerError.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Too many files', message: 'Maximum 10 files per request' });
    }
  }  res.status(500).json({
    error: 'Internal server error',
    message: error.message || 'Unknown error occurred'
  });
});

// Initialize SDK and start server
async function startServer() {
  try {
    console.log('🔧 Initializing Athena SDK...');
    await sdk.open();
    console.log('✅ SDK initialized successfully');

    sdk.on('error', (err) => {
      console.error('❌ SDK error:', err);
    });

    sdk.on('data', (response) => {
      if (response.globalError) {
        console.error('❌ Classification error:', response.globalError);
      }

      for (const output of response.outputs) {
        if (output.error) {
          console.error(`❌ Error for correlationId ${output.correlationId}:`, output.error);
        } else {
          console.log(`✅ Result for correlationId ${output.correlationId}:`, {

            classifications: output.classifications
          });
        }
      }
    });

    const server = app.listen(options.port, () => {
      console.log(`🌐 HTTP server listening on port ${options.port}`);
      console.log('');
      console.log('💡 Example usage:');
      console.log(`   curl -X POST -F "image=@test.jpg" http://localhost:${options.port}/`);
      console.log('');
      console.log('⏹️  Press Ctrl+C to stop');
    });

    // Graceful shutdown handling
    const shutdown = async () => {
      console.log('\n🛑 Shutting down server...');
      server.close(() => {
        console.log('✅ HTTP server closed');
      });

      try {
        await sdk.close();
        console.log('✅ SDK closed');

      } catch (error) {
        console.error('❌ Error closing SDK:', error);
      }

      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer().catch(console.error);
