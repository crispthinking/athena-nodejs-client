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
- **OpenTelemetry**: Optional traces and metrics separating local preparation, authentication and wire time

## Observability

The SDK is instrumented with OpenTelemetry. It depends only on
`@opentelemetry/api`, which is inert until your application registers a
provider, so there is nothing to switch on and no cost if you do not use it.
Event-loop delay monitoring is additionally opt-in via `monitorEventLoop: true`.

When a provider is present you get a span tree per call:

```
Athena.classifySingle                 total, as your code experiences it
├── Athena.prepareImage               decode, resize, hash, compress
├── Athena.authenticate               only when a token is actually fetched
└── Athena.rpc classifySingle         the gRPC call on its own
```

and histograms for each of those stages, the request payload size, and, when
enabled, a gauge for event-loop delay in the calling process.

The split exists because those stages are indistinguishable from outside. In
particular, a synchronous CPU block anywhere in your process inflates the
measured duration of every Athena call in flight at the time — the response has
arrived and is waiting in the socket, but nothing can read it until the event
loop is free. Comparing `athena.client.rpc.duration` against the duration we
report for the same `athena.correlation_id`, with
`athena.event_loop.max_delay_ms` alongside it, tells you whether time went to
the network, to us, or to your own loop.

See [samples/opentelemetry](./samples/opentelemetry/) for a runnable setup and
the full attribute reference.

# Contributing

## Code Quality and Pre-commit Hooks

This project uses pre-commit hooks to ensure code quality and consistency. The hooks run linting, formatting, and type checking before each commit.

### Setting up Pre-commit Hooks

1. **Install pre-commit** (if not already installed):
   ```sh
   uvx pre-commit --help
   ```
   Or install globally:
   ```sh
   uv tool install pre-commit
   ```

2. **Install the hooks**:
   ```sh
   uvx pre-commit install
   ```

3. **Run all quality checks manually**:
   ```sh
   npm run lint:all
   ```

### What the Pre-commit Hooks Check

- **ESLint**: Code quality and style issues
- **Prettier**: Code formatting consistency
- **TypeScript**: Type checking and compilation
- **File checks**: Trailing whitespace, file endings, large files, etc.
- **Submodule status**: Ensures submodules are properly tracked

### Manual Quality Checks

You can run individual checks manually:

```sh
# Run ESLint
npm run lint

# Check Prettier formatting
npm run prettier:check

# Fix Prettier formatting
npm run prettier

# TypeScript type checking
npx tsc --noEmit

# Run all checks at once
npm run lint:all
```

## Updating the Protobuf definitions

Protobufs are stored as a git submodule from the [@crispthinking/athena-protobufs](https://github.com/crispthinking/athena-protobufs.git) repository.

To update the protobuf definitions for client generation:

1. **Update the submodule to the latest version:**
   ```sh
   git submodule update --remote athena-protobufs
   ```

2. **Or update to a specific commit:**
   ```sh
   cd athena-protobufs
   git checkout <commit-sha>
   cd ..
   git add athena-protobufs
   git commit -m "Update protobuf definitions to <commit-sha>"
   ```

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
	npm run codegen
	```

	Or manually with:
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

3. **Format the generated code:**
	```sh
	npm run prettier
	```

### Notes
- If you update proto files in the submodule, rerun `npm run codegen` to keep the TypeScript client in sync.
- If you see TypeScript errors about missing modules, ensure your `tsconfig.json` includes the `src/athena` directory and restart your IDE/tsserver.
- The generated files are automatically formatted by the pre-commit hooks, but you can run `npm run prettier` manually if needed.

---

Building Documentation
To build the documentation:

# Install uv if not already installed
curl -LsSf https://astral.sh/uv/install.sh | sh

# Sync dependencies and build
uv sync
cd docs
make html
The built documentation will be available in docs/build/html/index.html.
