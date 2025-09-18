# Athena Hello World

A minimal example demonstrating the Athena SDK's `classifySingle` method for image classification.

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set environment variables:**
   ```bash
   # Copy from parent samples directory
   cp ../.env .env
   # Edit .env with your credentials
   ```

3. **Run the example:**
   ```bash
   npm start
   ```

## What it does

This example:
- Loads a sample image (`image.jpg`)
- Uses the `classifySingle` method for synchronous classification
- Prints the classification results

## Code walkthrough

The example shows the minimal code needed to classify an image:

```javascript
import { ClassifierSdk, ImageFormat, RequestEncoding } from '@crispthinking/athena-classifier-sdk';

const sdk = new ClassifierSdk({
  deploymentId: '',  // Empty for classifySingle
  affiliate: process.env.ATHENA_AFFILIATE,
  // ... authentication config
});

const response = await sdk.classifySingle({
  data: fs.createReadStream('image.jpg'),
  format: ImageFormat.IMAGE_FORMAT_JPEG,
  encoding: RequestEncoding.REQUEST_ENCODING_UNCOMPRESSED,
});
```

## Key differences from streaming classification

- **No `sdk.open()`** - classifySingle doesn't require a persistent connection
- **Direct response** - Returns results immediately instead of via events
- **Synchronous** - Simple async/await pattern instead of event handling
- **Single image only** - Designed for one image at a time

## Environment Variables

Required:
- `ATHENA_CLIENT_ID` - Your OAuth client ID
- `ATHENA_CLIENT_SECRET` - Your OAuth client secret  
- `ATHENA_AFFILIATE` - Your affiliate identifier

Optional:
- `ATHENA_GRPC_ADDRESS` - gRPC endpoint (default: trust.messages.crispthinking.com:443)
- `ATHENA_AUDIENCE` - OAuth audience (default: crisp-athena-live)