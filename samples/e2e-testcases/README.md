# Athena E2E Test Cases Runner

Runs the shared end-to-end test cases from `athena-protobufs/testcases/` through the Athena classification service and validates results against expected outputs.

## Features

- ✅ **Multiple test sets** - Support for integrator_sample, benign_model, and live_model
- 📊 **Tolerance-based comparison** - Configurable tolerance for floating-point comparisons
- 🎯 **Detailed reporting** - Per-image results with label-by-label comparison
- ⚙️ **Environment-based configuration** - Uses shared samples configuration
- 📋 **Summary statistics** - Pass/fail counts and overall status

## Installation

```bash
npm install
```

## Configuration

Create a `.env` file in the samples directory with your Athena credentials as described in [the samples overview](../README.md).

Then source the environment:
```bash
set -a && source ../.env && set +a
```

## Usage

### Basic Usage

```bash
# Run default test set (integrator_sample)
npx tsx index.ts

# Using npm script
npm start
```

### Options

```bash
# Run specific test set
npx tsx index.ts --testset integrator_sample
npx tsx index.ts --testset benign_model
npx tsx index.ts --testset live_model

# Adjust tolerance (default: 0.0001)
npx tsx index.ts --tolerance 0.01

# Verbose output
npx tsx index.ts --verbose

# Show help
npx tsx index.ts --help
```

### Example Output

```
🧪 Athena E2E Test Case Runner

Configuration:
  Test Set: integrator_sample
  Tolerance: 0.0001
  Images: 10

Running tests...

✓ v_YoYo_g08_c04_0186.png - PASS
✓ v_SumoWrestling_g08_c01_0036.png - PASS
✓ v_Diving_g14_c02_0280.png - PASS
✗ v_BrushingTeeth_g05_c05_0219.png - FAIL
  Label 'UnknownCSAM-classC': expected 0.1223, got 0.1250 (diff: 0.0027)

Results: 9/10 passed (90%)
```

## Test Sets

| Test Set | Description | Use Case |
|----------|-------------|----------|
| `integrator_sample` | 10 curated images | Quick integration testing |
| `benign_model` | Safe benign images | Development/CI testing |
| `live_model` | Full test set | Production validation |

## Exit Codes

- `0` - All tests passed
- `1` - One or more tests failed
- `2` - Configuration or runtime error
