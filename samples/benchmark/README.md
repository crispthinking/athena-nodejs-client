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

## Two modes

| Mode | Shape | Answers |
|---|---|---|
| `--mode phased` (default) | Prepare every image up front, then measure the RPC on its own | How much of a client-observed call is *ours*? Local CPU is deliberately kept out of the measured window |
| `--mode streaming` | A fixed pool of workers, each looping read → prepare → RPC → optional delay | What does a throughput-driven consumer see, when preparation and the RPC compete for the same cores? |

The phased mode is the right tool for attributing server latency, and it is
structurally blind to CPU contention: nothing is ever being prepared while a
call is in flight. Streaming mode exists because that contention is the thing
a consumer who times the whole SDK call actually pays for. See
[Streaming mode](#streaming-mode) below.

## Setup

From the repo root:

```bash
npm install
npm run build

cd samples/benchmark
npm install
```

The sample links `@crispthinking/athena-classifier-sdk` with `file:../../`, so a
clean checkout also needs the repo-root install and SDK build above: the linked
package exports `dist/index.js`, and the harness resolves `@grpc/grpc-js` and
`sharp` from the SDK's installed copy so it uses the same runtime modules.

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

# Pipeline mode: 16 workers interleaving prepare and RPC, as a consumer does
npm start -- --env-file ../../.env --label pipeline --mode streaming \
  --dop 16 --items 300 --image-dir ../../athena-protobufs/testcases/benign_model
```

`--stream` and `--mode streaming` are different things: `--stream` exercises
the server's bidirectional `classify` RPC, `--mode streaming` changes how the
harness itself drives work. They can be used together.

### Options

| Option | Default | Notes |
|---|---|---|
| `--env-file <path>` | — | Loaded before config is read |
| `--label <name>` | `unlabelled` | Recorded in the JSON, for diffing runs |
| `--mode <mode>` | `phased` | `phased` or `streaming` — see [Streaming mode](#streaming-mode) |
| `--dop <n>` | `8` | Streaming mode: worker pool size |
| `--items <n>` | `300` | Streaming mode: items to push through the pool |
| `--extra-delay-ms <ms>` | `0` | Streaming mode: delay charged to each item after its RPC returns |
| `--concurrency-sample-ms <ms>` | `50` | Streaming mode: in-flight sampling interval |
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

## Streaming mode

```bash
npm start -- --env-file ../../.env --label pipeline-dop16 \
  --mode streaming --dop 16 --items 300 --extra-delay-ms 0 \
  --image-dir ../../athena-protobufs/testcases/benign_model \
  --json ./dop16-d0.json
```

A fixed pool of `--dop` workers each loops: read the next image **from disk**,
prepare it, issue `classifySingle`, optionally sleep for `--extra-delay-ms`,
repeat. Nothing is pre-loaded, so the pool behaves like a real consumer pulling
work off a queue: a worker only picks up the next image once it has finished
the previous one.

### Why the injected delay exists

`--extra-delay-ms` stands in for a slower server, and it is charged **inside**
the item's total, because the old stack genuinely did hold the caller for that
long. It is there to test a counter-intuitive prediction: at a fixed worker
count, *making each call slower should make per-image preparation faster*.
Workers parked in an RPC are not competing for CPU, so the number of images
being decoded at the same instant falls, and each decode gets a larger share of
the machine. If that is what is happening, a customer who times the whole SDK
call can see their number rise at the moment our server-side number falls.

### What it reports

| Row | Meaning |
|---|---|
| `read (disk)` | `readFile` for the source image |
| `prepare (local CPU)` | The read plus decode, resize, hash and optional Brotli — everything before the wire |
| `rpc (successful)` | `classifySingle` on calls that returned a response; the like-for-like number against the server's own histogram |
| `rpc (incl. failures)` | Every call attempt. A worker is parked for the whole call whether or not it succeeds, and that park is what frees the CPU |
| `injected delay` | What `--extra-delay-ms` actually cost |
| `total per item` | Read to end of delay, i.e. what the consumer would measure |

Plus three run-level figures:

- **`prepare conc.`** — the in-flight prepare count, sampled every
  `--concurrency-sample-ms`. **This is the mechanism variable.** A change in
  prepare latency can only be attributed to CPU contention if this moved; if it
  is flat between two runs, the runs did not actually differ in the way you
  think they did, and any difference in prepare time is something else.
- **`rpc conc.`** — the same for calls in flight, which is the load being put
  on the service.
- **`event loop`** — `perf_hooks.monitorEventLoopDelay` over the run. The
  resize step is a synchronous OpenCV call on the main thread, so a blocked
  loop shows up here and delays every pending RPC callback too.

The header also prints `os.cpus().length` and `sharp.concurrency()`, because
neither the prepare numbers nor the position of the concurrency knee mean
anything without them.

### Running a sweep

Hold everything constant except the one variable:

```bash
# Delay sweep at fixed DOP — the test of the prediction above
for d in 0 100 300 600; do
  npm start -- --env-file ../../.env --label "d$d" --mode streaming \
    --dop 16 --items 300 --extra-delay-ms "$d" --quiet \
    --image-dir ../../athena-protobufs/testcases/benign_model \
    --json "./d$d.json"
done

# DOP sweep at zero delay — where does the knee sit?
for n in 1 2 4 8 16 32; do
  npm start -- --env-file ../../.env --label "dop$n" --mode streaming \
    --dop "$n" --items 300 --extra-delay-ms 0 --quiet \
    --image-dir ../../athena-protobufs/testcases/benign_model \
    --json "./dop$n.json"
done

jq -r '[.label, .streamingMode.summaries.prepare.p50,
        .streamingMode.summaries.rpcAll.p50,
        .streamingMode.prepareConcurrency.mean,
        .streamingMode.throughputPerSec] | @tsv' d*.json dop*.json
```

Interleave the delay levels across several repetitions rather than running each
level once. The RPC leg drifts with whatever else the target environment is
doing, and that drift changes prepare concurrency all by itself — run the
levels in one fixed order and the drift lands on one level and looks like an
effect. Always read `rpc (incl. failures)` next to `prepare conc.`: if the two
moved together, the injected delay was not the thing that moved the pipeline.

### Caveats specific to streaming mode

- The knee will not sit where an isolated prepare benchmark puts it. Workers
  spend part of every cycle in the RPC, so a pool of *n* workers keeps fewer
  than *n* images in preparation at once, and the machine saturates at a higher
  `--dop` than core count alone suggests.
- Disk reads share libuv's thread pool with sharp's decode. On a contended run
  `read (disk)` stops being a rounding error, which is a symptom of saturation
  rather than of slow storage. Raise `UV_THREADPOOL_SIZE` if you want to
  separate the two.
- If the target cannot take the offered concurrency, failed calls park workers
  for the full deadline and prepare concurrency collapses towards zero — the
  contended regime is never reached and the sweep measures nothing. Cap
  `--timeout` (and hold the cap constant across the sweep) so a degraded
  backend cannot dominate the loop.

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

The control call is a round trip with no meaningful server work, so it is a
direct read on network round-trip time. `classifySingle` minus the control is
**server processing plus payload transfer** — not payload alone. To isolate
payload transfer, subtract `athena.classify_single.duration` for the same
window as well. Percentiles are not additive, so compare p50 to p50 and treat
the result as indicative.

On a well-connected client the payload term is close to zero: 588 KiB costs
single-digit milliseconds, which is why removing 218 KiB with Brotli saved
~9 ms. It only becomes significant on a slow or contended uplink.

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
cp <repo>/samples/benchmark/{index,config,stats,transport,streaming}.ts .

# Pin the endpoint explicitly: older versions default to a different address,
# and the point of the comparison is to hold the endpoint constant.
ATHENA_GRPC_ADDRESS=api.athena-risk-intelligence.com:443 \
  npx tsx index.ts --env-file ./live.env --label sdk-1.0.1 \
  --image-dir <repo>/athena-protobufs/testcases/benign_model --iterations 96
```

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
- The harness resolves `@grpc/grpc-js` and `sharp` from the installed SDK
  package, not from its own `node_modules`, so the harness and the SDK always
  use the same runtime copy of those modules.
