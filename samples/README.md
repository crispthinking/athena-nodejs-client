# Athena SDK Samples

This directory contains example applications demonstrating various use cases of the Athena Classifier SDK.

## Configuration

All samples use a shared configuration system. Create a `.env` file in this directory by copying from the `.env.example` and filling in the reqiured configuration.

### Required
- `ATHENA_CLIENT_ID` - Your OAuth client ID
- `ATHENA_CLIENT_SECRET` - Your OAuth client secret  
- `ATHENA_AFFILIATE` - Your affiliate identifier

### Optional
- `ATHENA_ISSUER_URL` - OAuth issuer/authorization server URL (default: https://crispthinking.auth0.com/)
- `ATHENA_GRPC_ADDRESS` - gRPC service endpoint (default: trust.messages.crispthinking.com:443)
- `ATHENA_AUDIENCE` - OAuth audience parameter (default: crisp-athena-live)

## Available Samples

### [Check Single](./check-single/)
**Single Image Classification CLI Tool**

A command-line interface for classifying individual images. Features argument parsing, error handling, and formatted output.

- **Use Case**: Single image classification with CLI interface
- **Features**: Multiple image formats, verbose mode, affiliate override

### [Hash Server](./hash-server/)
**Continuous Image Classification Server**

A TypeScript server for continuous image classification with hash computation. Processes images in batches with real-time output.

- **Use Case**: Long-running classification service with hash computation
- **Features**: Continuous processing, MD5/SHA1 hashes, graceful shutdown
