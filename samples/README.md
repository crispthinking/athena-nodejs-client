# Athena SDK Samples

This directory contains example applications demonstrating various use cases of the Athena Classifier SDK.

## Configuration

All samples use a shared configuration system. Create a `.env` file in this directory:

```bash
# Copy the example configuration
cp .env.example .env

# Edit with your credentials
# Required
ATHENA_CLIENT_ID=your-client-id
ATHENA_CLIENT_SECRET=your-client-secret
ATHENA_AFFILIATE=your-affiliate-name

# Optional (defaults provided)
# ATHENA_ISSUER_URL=https://crispthinking.auth0.com/
# ATHENA_GRPC_ADDRESS=trust.messages.crispthinking.com:443
# ATHENA_AUDIENCE=crisp-athena-live

# Source the environment with auto-export
set -a; source .env; set +a
```

## Available Samples

### 🔍 [check-single](./check-single/)
**Single Image Classification CLI Tool**

A production-ready command-line interface for classifying individual images. Features comprehensive argument parsing, error handling, and formatted output.

- **Use Case**: Single image classification with CLI interface
- **Features**: Multiple image formats, verbose mode, affiliate override
- **Configuration**: Uses shared .env, no deployment ID needed (always empty for classifySingle)
- **Best For**: Batch processing, scripting, development testing

```bash
cd check-single
npm install
node index.js ./my-image.jpg --verbose
```

### � [hash-server](./hash-server/)
**Continuous Image Classification Server**

A TypeScript server for continuous image classification with hash computation. Processes images in batches with real-time output.

- **Use Case**: Long-running classification service with hash computation
- **Features**: Continuous processing, MD5/SHA1 hashes, graceful shutdown
- **Configuration**: Uses shared .env, requires deployment ID as CLI parameter
- **Best For**: Production services, continuous monitoring, batch processing

```bash
cd hash-server
npm install
npm start my-deployment-id
```

```bash
cd hash-server
npm install
npm start
```

## Quick Start

1. **Choose a sample** based on your use case
2. **Navigate to the sample directory**
3. **Install dependencies**: `npm install`
4. **Configure environment** variables (see each sample's README)
5. **Run the sample**: `npm start` or `node index.js`

## Common Setup

All samples require Athena service credentials. Create a `.env` file in each sample directory:

```bash
# Copy the template
cp .env.example .env

# Edit with your credentials (minimum required)
ATHENA_CLIENT_ID=your-client-id
ATHENA_CLIENT_SECRET=your-client-secret
ATHENA_AFFILIATE=your-affiliate

# Optional: Most samples use sensible defaults
# ATHENA_DEPLOYMENT_ID=your-deployment-id          # Default: empty (for classifySingle)
# ATHENA_ISSUER_URL=https://crispthinking.auth0.com/  # Default: Crisp Auth0

# Source the environment
source .env
```

## Sample Comparison

| Sample | Type | Complexity | Use Case |
|--------|------|------------|----------|
| check-single | CLI | Simple | Single image classification |
| hash-server | Web Server | Medium | Image hashing service |

## Development

### Creating New Samples

1. Create a new directory under `samples/`
2. Add a `package.json` with SDK dependency: `"@crispthinking/athena-classifier-sdk": "file:../../"`
3. Include comprehensive README with usage examples
4. Add environment template (`.env.example`)
5. Include proper error handling and logging

### Testing Samples

```bash
# Test all samples
for sample in */; do
  echo "Testing $sample"
  cd "$sample" && npm install && npm test
  cd ..
done
```

## Support

- **Documentation**: See individual sample READMEs
- **Issues**: Report problems in the main repository
- **Examples**: Each sample includes comprehensive usage examples