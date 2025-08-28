# Athena NodeJS SDK

This repository contains the NodeJS SDK.

## Overview
Athena is a gRPC-based image classification service designed for CSAM (Child Sexual Abuse Material) detection by Crisp. The service provides real-time image classification through bidirectional streaming with session-based deployment management and multi-affiliate support.

## Features

- **Real-time Classification**: Bidirectional streaming for immediate image processing
- **Session Management**: Deployment-based grouping enables collaborative processing
- **Multi-format Support**: Supports JPEG, PNG, WebP, TIFF, and many other image formats
- **Compression**: Optional Brotli compression for bandwidth optimization
- **Error Handling**: Comprehensive error codes and detailed error messages
- **Monitoring**: Active deployment tracking and backlog monitoring

## Contributing

## Regenerating the TypeScript gRPC Client

This project uses [`@protobuf-ts/plugin`](https://github.com/timostamm/protobuf-ts) to generate TypeScript-native gRPC clients and message types for use with `@grpc/grpc-js`.

### How to update the generated client code

1. **Ensure dependencies are installed:**
	```sh
	npm install --save-dev @protobuf-ts/plugin
	npm install --save @grpc/grpc-js
	```

2. **Run the following command to regenerate the client and types:**
	```sh
	npx protoc \
	  --plugin=protoc-gen-ts=./node_modules/.bin/protoc-gen-ts \
	  --ts_out=client_grpc1:./src/athena \
	  --proto_path=./athena-protobufs/athena \
	  ./athena-protobufs/athena/athena.proto
	```
	- This will generate `.ts` files in `src/athena/` including a gRPC client compatible with `@grpc/grpc-js`.

3. **Update your imports in your code as needed:**
	- The main client will be in `src/athena/athena.grpc-client.ts`.
	- Message types and enums are in `src/athena/athena.ts`.

### Notes
- If you add or change proto files, rerun the above command to keep the TypeScript client in sync.
- If you see TypeScript errors about missing modules, ensure your `tsconfig.json` includes the `src/athena` directory and restart your IDE/tsserver.

---
