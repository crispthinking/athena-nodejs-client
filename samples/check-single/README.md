# Athena Check Single - Image Classification CLI

A command-line tool for classifying individual images using the Athena Classifier SDK. This sample demonstrates how to build a more comprehensive CLI application with the SDK.

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


Create a `.env` file in the samples directory with your Athena credentials as described in [the samples overview](../README.md).

Then source the environment:
```bash
set -a && source ../.env
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

## Supported Image Formats

The tool automatically detects image format from file extensions:

- **JPEG**: `.jpg`, `.jpeg`
- **PNG**: `.png`
- **GIF**: `.gif`
- **BMP**: `.bmp`
- **WebP**: `.webp`

Use `--format` to override automatic detection.

## Error Handling

The tool provides error messages for common issues:

- **Missing arguments**: Image path is required
- **File not found**: Image file validation
- **Invalid format**: Unsupported image formats
- **Missing credentials**: Environment variable validation
- **Network issues**: Connection and authentication errors
- **Service errors**: Classification failures with correlation IDs

## Architecture

The CLI demonstrates several SDK integration patterns:

1. **Configuration Management**: Environment-based configuration with validation
2. **Error Handling**: Comprehensive error catching and user-friendly messages
3. **Stream Processing**: Using streams for efficient image handling
4. **Event-Driven Results**: Handling asynchronous classification results
5. **Resource Management**: Proper connection lifecycle management

This sample serves as a template for building CLI tools with the Athena SDK.