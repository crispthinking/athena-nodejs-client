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

Create a `.env` file in the samples directory with your Athena credentials as described in [the samples overview](../README.md).

Then source the environment:
```bash
set -a && source ../.env
```

## Usage

### Basic Usage
```bash
# Start the hash server with a deployment ID
npm start my-deployment-id

# Or run directly with node
npx tsx index.ts my-deployment-id
```

## How It Works

1. **Initialization**: Loads configuration from environment variables and CLI arguments
2. **SDK Setup**: Creates ClassifierSdk instance with authentication and deployment settings
3. **Continuous Loop**: Processes sample images in batches with random intervals
4. **Hash Computation**: Computes MD5 and SHA1 hashes for each processed image
5. **Real-time Output**: Displays classification results as they arrive
6. **Graceful Shutdown**: Handles SIGTERM and user input for clean shutdown

## Arguments

| Argument |  Description |
|----------|--------------|
| `deployment-id` | Target deployment for classification |

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

## Architecture

The hash server demonstrates several SDK integration patterns:

1. **Long-running Service**: Continuous operation with graceful shutdown
2. **Batch Processing**: Multiple images per classification request
3. **Hash Computing**: MD5/SHA1 computation for image verification
4. **Event-driven Architecture**: Real-time processing with event listeners
5. **Configuration Management**: Environment-based configuration with CLI overrides
6. **Error Recovery**: Automatic reconnection and retry logic
