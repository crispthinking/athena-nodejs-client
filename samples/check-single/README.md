# Athena Check Single - Image Classification CLI

A command-line tool for classifying individual images using the Athena Classifier SDK. This sample demonstrates how to build a production-ready CLI application with the SDK.

## Features

- ✅ **Single image classification** with detailed results
- 🖼️ **Multiple image format support** (JPEG, PNG, GIF, BMP, WebP)
- 🔧 **Command-line argument parsing** with validation
- 📊 **Formatted output** with verbose mode
- ⚙️ **Environment-based configuration**
- 🚨 **Comprehensive error handling**
- 📋 **Deployment verification**
- ⏱️ **Timeout protection**

## Installation

```bash
# Install dependencies
npm install

# Or install from parent directory
npm install ../../
```

## Configuration

Create a `.env` file in the samples directory with your Athena credentials:

```bash
# Required
ATHENA_CLIENT_ID=your-client-id
ATHENA_CLIENT_SECRET=your-client-secret
ATHENA_AFFILIATE=your-affiliate

# Optional (defaults provided)
# ATHENA_ISSUER_URL=https://crispthinking.auth0.com/  # Default: Crisp Auth0
# ATHENA_GRPC_ADDRESS=trust.messages.crispthinking.com:443  # Default: production
# ATHENA_AUDIENCE=crisp-athena-live                 # Default: live audience
```

Then source the environment:
```bash
# Option 1: Auto-export all variables (recommended)
set -a; source .env; set +a

# Option 2: Export specific variables
export $(cat .env | grep -v '^#' | xargs)

# Option 3: Source and manually export (if needed)
source .env && export ATHENA_CLIENT_ID ATHENA_CLIENT_SECRET ATHENA_AFFILIATE
```

## Usage

### Basic Usage
```bash
# Classify a single image
node index.js ./my-image.jpg

# Using npm script
npm start ./my-image.jpg
```

### Advanced Usage
```bash
# Verbose output with detailed information
node index.js ./image.png --verbose

# Force image format (useful for files without extensions)
node index.js ./image --format jpeg

# Override affiliate
node index.js ./image.jpg --affiliate different-affiliate
```

### Command Line Options

| Option | Description |
|--------|-------------|
| `-h, --help` | Show help message |
| `-v, --verbose` | Enable verbose output with detailed logs |
| `-f, --format <format>` | Force image format (jpeg\|png\|gif\|bmp\|webp) |
| `-a, --affiliate <name>` | Override affiliate name |

## Examples

### Basic Classification
```bash
$ node index.js ./test-image.jpg

🚀 Athena Single Image Classification
========================================
🔧 Initializing Athena SDK...
📁 Loading image...
🔗 Connecting to Athena service...
🔍 Classifying image...

📊 Classification Results:
==================================================

🔍 Result 1:
   Correlation ID: 12345-abcde-67890
   ✅ Classifications:
      1. Score: 0.9250
         Label: safe_content
      2. Score: 0.0750
         Label: potential_concern

✅ Classification completed successfully
```

### Verbose Output
```bash
$ node index.js ./image.png --verbose

🚀 Athena Single Image Classification
========================================
📋 Configuration:
   Image: ./image.png
   Deployment: 
   Affiliate: my-affiliate
   gRPC Address: trust.messages.crispthinking.com:443

🔧 Initializing Athena SDK...
📁 Loading image...
   File size: 342 KB
   Format: IMAGE_FORMAT_PNG
🔗 Connecting to Athena service...
📋 Listing available deployments...
   Found 3 deployments
   ✅ Target deployment '' is available
🔍 Classifying image...
...
```

### Error Handling
```bash
$ node index.js ./nonexistent.jpg

❌ Configuration errors:
   • Image file does not exist: ./nonexistent.jpg

Use --help for usage information
```

## Supported Image Formats

The tool automatically detects image format from file extensions:

- **JPEG**: `.jpg`, `.jpeg`
- **PNG**: `.png`
- **GIF**: `.gif`
- **BMP**: `.bmp`
- **WebP**: `.webp`

Use `--format` to override automatic detection.

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

The tool provides clear error messages for common issues:

- **Missing arguments**: Image path is required
- **File not found**: Image file validation
- **Invalid format**: Unsupported image formats
- **Missing credentials**: Environment variable validation
- **Network issues**: Connection and authentication errors
- **Service errors**: Classification failures with correlation IDs

## Development

### Testing with Different Environments
```bash
# Development environment
ATHENA_GRPC_ADDRESS=athena-dev.example.com node index.js ./test.jpg
```

### Debugging
```bash
# Enable development mode for stack traces
NODE_ENV=development node index.js ./test.jpg
```

## Integration

This CLI tool can be integrated into larger workflows:

```bash
# Process multiple images
for image in *.jpg; do
  node index.js "$image" --verbose
done

# Use in scripts
if node index.js ./suspicious-image.jpg; then
  echo "Image classified successfully"
else
  echo "Classification failed"
fi
```

## Architecture

The CLI demonstrates several SDK integration patterns:

1. **Configuration Management**: Environment-based configuration with validation
2. **Error Handling**: Comprehensive error catching and user-friendly messages
3. **Stream Processing**: Using streams for efficient image handling
4. **Event-Driven Results**: Handling asynchronous classification results
5. **Resource Management**: Proper connection lifecycle management

This sample serves as a template for building production CLI tools with the Athena SDK.