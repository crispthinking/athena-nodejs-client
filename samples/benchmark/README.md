# Athena Benchmark Harness

Measures where time actually goes on a `classifySingle` call, so a
client-observed number can be compared like-for-like against what the service
reports for itself.

## Why this exists

`athena.classify_single.duration` in New Relic starts when the server's gRPC
handler is entered. Everything a consumer pays for *outside* that window is
invisible from the service side:

- local preparation — decode, resize to 448x448, hash, optional Brotli
- DNS, TCP and the TLS handshake
- shipping the request body up to the load balancer
- reconnects when a backend goes away mid-run

This harness times each of those separately, so the gap between "our p90 is
242 ms" and "the client sees 2 s" can be attributed rather than argued about.

## Setup

```bash
cd samples/benchmark
npm install
```

## Configuration

Reads the same variables as the other samples and the functional suite, so no
new config is needed to point it somewhere:

| Variable | Required | Default |
|---|---|---|
| `ATHENA_CLIENT_ID` | yes | — |
| `ATHENA_CLIENT_SECRET` | yes | — |
| `ATHENA_AFFILIATE` | yes | — |
| `ATHENA_ISSUER_URL` | no | `https://crispthinking.auth0.com/` |
| `ATHENA_GRPC_ADDRESS` | no | `api.athena-risk-intelligence.com:443` |
| `ATHENA_AUDIENCE` | no | `crisp-athena-live` |
| `ATHENA_DEPLOYMENT_ID` | only for `--stream` | first from `listDeployments` |

The functional suite's `VITE_`-prefixed copies (`VITE_ATHENA_CLIENT_ID`,
`VITE_OAUTH_ISSUER`, `VITE_ATHENA_GRPC_ADDRESS`, …) are accepted as a fallback,
so the repo-root `.env` works as-is.

Point at an environment with `--env-file`:

```bash
npm start -- --env-file ../../.env --label staging
npm start -- --env-file ../.env       --label live
```

Variables already exported in your shell win over the file, so a single
override needs no edit:

```bash
ATHENA_GRPC_ADDRESS=api-live.athena-risk-intelligence.com:443 npm start -- --label live-direct
```

## Usage

```bash
# Default: 100 sequential calls plus a 10-sample handshake probe
npm start -- --env-file ../../.env --label staging-before

# Concurrency, and a JSON record to diff against a later run
npm start -- --env-file ../../.env --label staging-after \
  --iterations 500 --concurrency 8 --json ./staging-after.json

# Use the shared test corpus rather than one image — see "Choosing images"
npm start -- --env-file ../../.env --label live-corpus \
  --image-dir ../../athena-protobufs/testcases/benign_model --iterations 96

# Does compression change the picture? (uncompressed 448x448 BGR is always 588 KiB)
npm start -- --env-file ../../.env --encoding brotli --label staging-brotli

# A/B a keepalive setting on the channel
npm start -- --env-file ../../.env --keepalive-ms 20000 --label staging-keepalive

# Also hold a streaming classify open and count drops
npm start -- --env-file ../../.env --stream --stream-duration 120000
```

### Options

| Option | Default | Notes |
|---|---|---|
| `--env-file <path>` | — | Loaded before config is read |
| `--label <name>` | `unlabelled` | Recorded in the JSON, for diffing runs |
| `--image <path>` | `../hash-server/448x448.jpg` | Any format when resizing |
| `--image-dir <path>` | — | Directory of images, searched recursively; cycled through per call |
| `--iterations <n>` | `100` | Measured `classifySingle` calls |
| `--concurrency <n>` | `1` | Calls in flight at once |
| `--warmup <n>` | `5` | Unmeasured calls first |
| `--connect-samples <n>` | `10` | Cold TLS handshakes to time |
| `--encoding <enc>` | `uncompressed` | `uncompressed` or `brotli` |
| `--no-resize` | — | Image must already be 448x448 |
| `--keepalive-ms <ms>` | — | Sets `grpc.keepalive_time_ms` |
| `--timeout <ms>` | `30000` | Per-call deadline |
| `--stream` | off | Also exercise the streaming path |
| `--json <path>` | — | Write the full result |

## Choosing images

**Use `--image-dir` with the shared corpus for anything you intend to act on:**

```
--image-dir ../../athena-protobufs/testcases/benign_model
```

48 real photographs, all benign. A single synthetic image will mislead you in
two directions at once:

- **Compression.** Every uncompressed request is 588 KiB regardless of the
  source, because the SDK resizes to 448x448 raw BGR first. How far Brotli gets
  from there depends entirely on the picture. A flat synthetic image compresses
  to ~2.5 KiB (99.6%); real photographs only reach ~370 KiB (37%). Measure
  compression on a synthetic image and you will conclude it is free when it is
  not.
- **Preparation cost.** Decode-and-resize scales with the *source* image, not
  the output. A small pre-sized image prepares in ~7 ms; a full-resolution
  photograph takes ~590 ms. That cost lands on the caller's CPU, and it is the
  single largest term in what a consumer measures.

## Reading the output

**Latency** breaks the call into phases. The two that matter most:

- `listDeployments (control)` — same channel, same auth, negligible payload.
  A near-empty round trip.
- `classifySingle` — the same channel carrying the real request body.

The difference between them is what it costs to *ship the payload*, separately
from the base cost of a round trip. If the control call is fast and
`classifySingle` is slow, the time is going into upload, not into the service.

`prepare` is local CPU only — no network. It is part of what a consumer
measures if they time around the SDK's `classifySingle`, and it scales with
host CPU contention rather than with anything we run.

**Stability** counts departures from gRPC's `READY` state. Each one is a
reconnect: the client re-establishes TCP and TLS and retries, and the service
records nothing unusual. A run with a non-zero reconnect count while the
service reports flat latency is the signature of backend churn being paid for
on the client side.

**Attribution** prints the payload cost and the end-to-end figure, and is the
number to compare against `athena.classify_single.duration` for the same
window:

```sql
SELECT percentile(athena.classify_single.duration, 50, 90, 99)
FROM Metric WHERE cloud.account.id = 'crisp-athena-live'
SINCE 30 minutes ago
```

Whatever the harness reports above that figure is time the service cannot see.

## Before/after comparison

```bash
npm start -- --env-file ../../.env --label before --json before.json
# ... change one thing ...
npm start -- --env-file ../../.env --label after  --json after.json

diff <(jq .summaries before.json) <(jq .summaries after.json)
```

Change one variable at a time — endpoint, encoding, keepalive, concurrency —
and keep the client host fixed, since `prepare` and the handshake are both
sensitive to where the harness runs.

## Comparing SDK versions

The harness imports the SDK by package name, so pointing it at a different
version means installing that version somewhere and running the same sources
against it:

```bash
mkdir /tmp/sdk-old && cd /tmp/sdk-old
npm init -y && npm pkg set type=module
npm install @crispthinking/athena-classifier-sdk@1.0.1 commander openid-client
npm install -D tsx
cp <repo>/samples/benchmark/{index,config,stats,transport}.ts .

# Pin the endpoint explicitly: older versions default to a different address,
# and the point of the comparison is to hold the endpoint constant.
ATHENA_GRPC_ADDRESS=api.athena-risk-intelligence.com:443 \
  npx tsx index.ts --env-file ./live.env --label sdk-1.0.1 \
  --image-dir <repo>/athena-protobufs/testcases/benign_model --iterations 96
```

Check that both the harness and the SDK resolve the *same* `@grpc/grpc-js`
before trusting the result — see the last caveat below.

Run the versions back to back and compare against the same version's own
run-to-run spread, not against a single earlier run. On this corpus `p99`
moves by well over 100 ms between identical runs, so a difference smaller than
that is noise.

## Caveats

- Run it from somewhere representative of the caller. Results from inside GCP
  will understate handshake and upload cost considerably.
- `connect: dns` reflects the OS resolver cache, so repeat samples on a warm
  cache are near zero. That is realistic for a long-lived client, but it is not
  a cold-start measurement.
- `@grpc/grpc-js` is deliberately **not** declared as a dependency here. This
  sample links the SDK with `file:`, so declaring it would install a second
  copy under `samples/benchmark/node_modules`, and the SDK's generated client
  rejects credentials and metadata built from a different copy
  (`Channel credentials must be a ChannelCredentials object`, plus mismatched
  `Metadata` types at compile time). Leaving it undeclared resolves it to the
  repo-root copy the SDK itself uses. If you add it back, expect both errors.
