# Athena Hash Server - Continuous Image Classification

A TypeScript server for continuous image classification using the Athena Classifier SDK. This sample demonstrates how to build a long-running classification service with hash computation and real-time processing.

## Features

- ✅ **Continuous classification** with automatic retry and reconnection
- 🔗 **Hash computation** (MD5, SHA1) for processed images
- 🖼️ **Batch processing** of multiple images per request
- ⚙️ **Environment-based configuration** with CLI deployment parameter
- 🚨 **Graceful shutdown** handling
- 📊 **Real-time output** with detailed classification results
- 🔄 **Automatic reconnection** on connection failures

## Installation

```bash
# Install dependencies
npm install

# Install tsx for TypeScript execution (if not already installed)
npm install tsx
```

## Configuration

Create a `.env` file in the samples directory with your Athena credentials:

```bash
# Required
ATHENA_CLIENT_ID=your-client-id
ATHENA_CLIENT_SECRET=your-client-secret
ATHENA_AFFILIATE=your-affiliate-name

# Optional (defaults provided)
# ATHENA_ISSUER_URL=https://crispthinking.auth0.com/  # Default: Crisp Auth0
# ATHENA_GRPC_ADDRESS=trust.messages.crispthinking.com:443  # Default: production
# ATHENA_AUDIENCE=crisp-athena-live                 # Default: live audience
```

Then source the environment:
```bash
source ../.env
```

## Usage

### Basic Usage
```bash
# Start the hash server with a deployment ID
npm start my-deployment-id

# Or run directly with node
npx tsx index.ts my-deployment-id
```

### Command Line Options
```bash
# Show help
npm start --help
npx tsx index.ts --help
```

## Example Output

```bash
$ npm start production-deployment

🚀 Athena Hash Server - Continuous Classification
==================================================
📋 Configuration:
   Deployment: production-deployment
   Affiliate: my-affiliate
   gRPC Address: trust.messages.crispthinking.com:443

🔧 Initializing Athena SDK...
✅ SDK initialized successfully
🔄 Starting continuous classification loop...
💡 Type "exit" and press Enter to stop

{
  correlationId: '12345-abcde-67890',
  classifications: [
    {
      score: 0.9250,
      label: 'safe_content'
    },
    {
      score: 0.0750,
      label: 'potential_concern'
    }
  ],
  hashes: {
    md5: 'a1b2c3d4e5f6789012345678901234567890',
    sha1: 'f1e2d3c4b5a69876543210987654321098765432'
  }
}
```

## How It Works

1. **Initialization**: Loads configuration from environment variables and CLI arguments
2. **SDK Setup**: Creates ClassifierSdk instance with authentication and deployment settings
3. **Continuous Loop**: Processes sample images in batches with random intervals
4. **Hash Computation**: Computes MD5 and SHA1 hashes for each processed image
5. **Real-time Output**: Displays classification results as they arrive
6. **Graceful Shutdown**: Handles SIGTERM and user input for clean shutdown

## Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `deployment-id` | Yes | Target deployment for classification |

## Environment Variables

### Required
- `ATHENA_CLIENT_ID` - Your OAuth client ID
- `ATHENA_CLIENT_SECRET` - Your OAuth client secret  
- `ATHENA_AFFILIATE` - Your affiliate identifier

### Optional
- `ATHENA_ISSUER_URL` - OAuth issuer/authorization server URL (default: https://crispthinking.auth0.com/)
- `ATHENA_GRPC_ADDRESS` - gRPC service endpoint (default: trust.messages.crispthinking.com:443)
- `ATHENA_AUDIENCE` - OAuth audience parameter (default: crisp-athena-live)

## Error Handling

The server provides comprehensive error handling:

- **Missing arguments**: Deployment ID validation
- **Missing credentials**: Environment variable validation  
- **Network issues**: Automatic reconnection and retry logic
- **Service errors**: Detailed error logging with correlation IDs
- **Graceful shutdown**: Clean resource cleanup on exit

## Development

### Testing with Different Deployments
```bash
# Development deployment
npm start dev-deployment

# Production deployment  
npm start prod-deployment

# Staging deployment
npm start staging-deployment
```

### Debugging
```bash
# Enable development mode for enhanced logging
NODE_ENV=development npm start my-deployment
```

## Integration

This hash server can be integrated into larger workflows:

```bash
# Run as background service
nohup npm start production-deployment > classifier.log 2>&1 &

# Docker deployment
docker run -e ATHENA_CLIENT_ID=xxx -e ATHENA_CLIENT_SECRET=xxx -e ATHENA_AFFILIATE=xxx my-hash-server production-deployment

# Systemd service
sudo systemctl start athena-hash-server
```

## Architecture

The hash server demonstrates several advanced SDK integration patterns:

1. **Long-running Service**: Continuous operation with graceful shutdown
2. **Batch Processing**: Multiple images per classification request
3. **Hash Computing**: MD5/SHA1 computation for image verification
4. **Event-driven Architecture**: Real-time processing with event listeners
5. **Configuration Management**: Environment-based configuration with CLI overrides
6. **Error Recovery**: Automatic reconnection and retry logic

## File Structure

```
hash-server/
├── index.ts           # Main server implementation
├── package.json       # Dependencies and scripts
├── tsconfig.json      # TypeScript configuration
├── README.md          # This documentation
└── 448x448.jpg        # Sample image for testing
```

## Performance Notes

- Processes images in batches of 3 for efficiency
- Random delays (0-10 seconds) between requests to simulate real-world usage
- Configurable hash types (MD5, SHA1) for different security requirements
- Automatic cleanup and resource management